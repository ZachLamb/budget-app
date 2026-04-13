from __future__ import annotations

"""AI financial advisor endpoints.

All LLM calls use local Ollama (or canned demo responses in demo mode).
No cloud model APIs are used.

Route handlers are thin wrappers over per-concern services under
`app.services.ai.*`. Pydantic request/response models stay here so the
OpenAPI shape and FE types are unchanged. Chat streaming stays inline —
splitting the SSE path risks breaking the streaming contract for a minor
tidiness win.

New AI surface checklist (avoid "AI for AI's sake"):
- Grounded: output must cite user data (amounts, categories, goals) or ask for missing input.
- Actionable: each suggestion maps to one next step the UI can complete (budget, rule, plan).
- Fallback: the same job must remain doable without AI (manual edit, rules, imports).
- Failure: honor household.ai_enabled; return clear errors when no backend—no fake filler tips.
"""

import json
import logging
import time
from datetime import date
from decimal import Decimal
from typing import Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_household_id
from app.config import get_settings
from app.database import get_db
from app.models import Category, Household, Transaction, Account
from app.services.ai import llm_client
from app.services.ai.household_rate_limit import enforce_household_ai_rate_limit
from app.services.ai.json_extract import parse_llm_json_object
from app.services.ai.action import (
    _find_account_for_execute_transaction,  # re-exported for backwards compat
    execute_parsed_action,
    parse_action_message,
)
from app.services.ai.budget import (
    MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA,
    generate_budget_suggestions,
)
from app.services.ai.context import build_financial_context
from app.services.ai.debt_plan import (
    normalize_priority_order_from_llm,
    parse_debt_plan_suggestion_from_llm_response as _parse_debt_plan_dict,
    suggest_debt_plan,
)
from app.services.ai.fsa import (
    list_fsa_items as _list_fsa_items_service,
    run_fsa_review,
    update_fsa_item_status as _update_fsa_item_status_service,
)
from app.services.ai.insights import (
    generate_budget_insights,
    generate_insights,
    normalize_insights_list,
)
from app.services.ai.interest_rates import (
    suggest_interest_rates as _suggest_interest_rates_service,
)
from app.services.ai.status import get_ai_status

logger = logging.getLogger(__name__)

router = APIRouter()

_NO_AI_MSG = "No AI backend available. Start Ollama and ensure OLLAMA_URL points to it."

# Short TTL cache for Ollama probe (shared across users; payload is not
# household-specific — must stay user-agnostic to avoid a cross-tenant leak).
_AI_STATUS_CACHE_TTL_SEC = 15.0
_ai_status_cache_monotonic: float = 0.0
_ai_status_payload: Optional[dict] = None


# Back-compat alias — `_build_financial_context` is used by tests/tools that
# reach into the routes module directly. The service is the source of truth.
_build_financial_context = build_financial_context


# Re-exports for backwards compatibility with existing test imports.
# `normalize_priority_order_from_llm`, `normalize_insights_list`, and
# `MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA` come from their service modules.
__all_backcompat__ = (
    "MODEL_SOURCE_NO_BUDGET_CATEGORY_DATA",
    "normalize_insights_list",
    "normalize_priority_order_from_llm",
)


async def _require_ai_enabled(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Dependency: checks household exists and AI is enabled for that household.

    We intentionally do not preflight the LLM backend here because short-lived
    connectivity blips can cause false 503s. Endpoints that actually call the LLM
    still return 503 with _NO_AI_MSG if no completion is available.
    """
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")
    if not household.ai_enabled:
        raise HTTPException(
            403,
            "AI features are disabled for this household. Enable them in Settings → AI Financial Advisor.",
        )
    return household_id


_base_ai_household = _require_ai_enabled


async def _require_ai_enabled_rate_limited(
    household_id: str = Depends(_base_ai_household),
) -> str:
    """Dependency: AI-enabled + per-household rate limit (service-layer, keyed on
    household_id). Use this on AI routes that actually call the LLM; the chat-stream
    and advisor-turn routes both go through here.
    """
    await enforce_household_ai_rate_limit(household_id, get_settings().ai_rate_limit_per_minute)
    return household_id


# ── Schemas ────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=5000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class AdvisorTurnResponse(BaseModel):
    """Single-call advisor: either a structured action to confirm or a chat reply."""

    branch: Literal["action", "chat"]
    model_source: str
    action_type: Optional[str] = None
    data: Optional[dict] = None
    confirmation_text: Optional[str] = None
    reply: Optional[str] = None
    evidence: list[dict] = Field(default_factory=list)


def normalize_advisor_turn_payload(
    raw: dict,
    *,
    model_source: str,
    evidence_list: list[dict],
) -> AdvisorTurnResponse:
    """Validate JSON from the LLM into AdvisorTurnResponse (no trust beyond shape)."""
    branch = raw.get("branch")
    if branch == "action":
        at = raw.get("action_type")
        if at not in ("add_transaction", "add_debt"):
            raise ValueError("invalid action_type")
        data = raw.get("data")
        if not isinstance(data, dict):
            data = {}
        conf = str(raw.get("confirmation_text") or "").strip()
        if not conf:
            raise ValueError("missing confirmation_text")
        return AdvisorTurnResponse(
            branch="action",
            model_source=model_source,
            action_type=at,
            data=data,
            confirmation_text=conf,
            evidence=[],
        )
    if branch == "chat":
        reply = str(raw.get("reply") or "").strip()
        if not reply:
            raise ValueError("empty reply")
        return AdvisorTurnResponse(
            branch="chat",
            model_source=model_source,
            reply=reply,
            evidence=list(evidence_list),
        )
    raise ValueError("invalid branch")


class CategorySpendingLine(BaseModel):
    category: str = Field(..., max_length=200)
    amount: float = Field(..., ge=0)


class ChatEvidenceCategorySpending(BaseModel):
    type: Literal["category_spending"] = "category_spending"
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    lines: list[CategorySpendingLine] = Field(default_factory=list, max_length=25)


class GoalProgressLine(BaseModel):
    name: str = Field(..., max_length=200)
    goal_type: str = Field(..., max_length=80)
    current_amount: float = Field(..., ge=0)
    target_amount: float = Field(..., ge=0)
    pct_complete: float = Field(..., ge=0, le=100)


class ChatEvidenceGoalProgress(BaseModel):
    type: Literal["goal_progress"] = "goal_progress"
    goals: list[GoalProgressLine] = Field(default_factory=list, max_length=8)


class BudgetPaceLine(BaseModel):
    category: str = Field(..., max_length=200)
    budgeted: float = Field(..., ge=0)
    spent: float = Field(..., ge=0)
    remaining: float


class ChatEvidenceBudgetPace(BaseModel):
    type: Literal["budget_pace"] = "budget_pace"
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    lines: list[BudgetPaceLine] = Field(default_factory=list, max_length=12)


def build_category_spending_evidence(
    month_key: str, rows: list[tuple[str, Decimal]]
) -> list[dict]:
    """Pure helper for deterministic chat evidence (tested without DB)."""
    lines: list[CategorySpendingLine] = []
    for name, amt in rows:
        lines.append(CategorySpendingLine(category=name, amount=float(abs(amt))))
    item = ChatEvidenceCategorySpending(month=month_key, lines=lines)
    return [item.model_dump()]


def build_goal_progress_evidence_rows(
    rows: list[tuple[str, str, Decimal, Decimal]],
) -> Optional[dict]:
    """Pure helper: (name, goal_type, current_amount, target_amount) tuples."""
    if not rows:
        return None
    goal_lines: list[GoalProgressLine] = []
    for name, gt, cur, tgt in rows[:8]:
        tgt_f = float(tgt)
        cur_f = float(cur)
        pct = min(100.0, (cur_f / tgt_f * 100.0) if tgt_f > 0 else 0.0)
        goal_lines.append(
            GoalProgressLine(
                name=name[:200],
                goal_type=(gt or "goal")[:80],
                current_amount=cur_f,
                target_amount=tgt_f,
                pct_complete=round(pct, 1),
            )
        )
    return ChatEvidenceGoalProgress(goals=goal_lines).model_dump()


def build_budget_pace_evidence_rows(month_key: str, rows: list[tuple[str, float, float]]) -> Optional[dict]:
    """Pure helper: (category, budgeted, spent); remaining = budgeted - spent."""
    if not rows:
        return None
    pace_lines: list[BudgetPaceLine] = []
    for cat, bud, sp in rows[:12]:
        pace_lines.append(
            BudgetPaceLine(
                category=cat[:200],
                budgeted=bud,
                spent=sp,
                remaining=round(bud - sp, 2),
            )
        )
    return ChatEvidenceBudgetPace(month=month_key, lines=pace_lines).model_dump()


async def _build_chat_evidence_list(
    db: AsyncSession, household_id: str
) -> list[dict]:
    """Display-only snippets: category spend, active goals, budget vs spent (budget accounts)."""
    today = date.today()
    month_start = today.replace(day=1)
    month_key = month_start.strftime("%Y-%m")

    spend_result = await db.execute(
        select(Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(12)
    )
    cat_rows = list(spend_result.all())
    out: list[dict] = []
    out.extend(build_category_spending_evidence(month_key, cat_rows))

    goals_result = await db.execute(
        select(FinancialGoal.name, FinancialGoal.goal_type, FinancialGoal.current_amount, FinancialGoal.target_amount)
        .where(FinancialGoal.household_id == household_id)
        .where(FinancialGoal.is_completed == False)  # noqa: E712
        .order_by(FinancialGoal.target_amount.desc())
        .limit(8)
    )
    goal_tuples = [(n, gt, cur, tgt) for n, gt, cur, tgt in goals_result.all()]
    goal_ev = build_goal_progress_evidence_rows(goal_tuples)
    if goal_ev:
        out.append(goal_ev)

    from sqlalchemy import extract

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )
    y, m = today.year, today.month
    spent_by_cat: dict[str, Decimal] = {}
    spent_result = await db.execute(
        select(Transaction.category_id, func.sum(Transaction.amount))
        .where(Transaction.account_id.in_(budget_account_subq))
        .where(extract("year", Transaction.date) == y)
        .where(extract("month", Transaction.date) == m)
        .where(Transaction.amount < 0)
        .where(Transaction.category_id.isnot(None))
        .group_by(Transaction.category_id)
    )
    for cid, amt in spent_result.all():
        spent_by_cat[cid] = abs(amt)

    assign_result = await db.execute(
        select(Category.name, BudgetAssignment.category_id, BudgetAssignment.assigned_amount)
        .join(Category, BudgetAssignment.category_id == Category.id)
        .where(BudgetAssignment.household_id == household_id)
        .where(BudgetAssignment.month == month_key)
    )
    pace_rows: list[tuple[str, float, float]] = []
    for cat_name, cat_id, assigned in assign_result.all():
        sp = float(spent_by_cat.get(cat_id, Decimal("0")))
        bud = float(assigned)
        pace_rows.append((cat_name, bud, sp))
    pace_rows.sort(key=lambda x: x[2] - x[1])
    pace_ev = build_budget_pace_evidence_rows(month_key, pace_rows[:12])
    if pace_ev:
        out.append(pace_ev)

    return out


class InsightsResponse(BaseModel):
    insights: list[str]
    model_source: str


class SpendingTrend(BaseModel):
    category: str
    trend: str          # "up" | "down" | "stable"
    pct_change: float


class BudgetInsightsResponse(BaseModel):
    insights: list[str]
    patterns: list[SpendingTrend]
    model_source: str


class FsaEligibleTransaction(BaseModel):
    transaction_id: str
    date: str
    payee_name: str
    category_name: Optional[str]
    amount: float
    confidence: Literal["high", "medium", "low"]
    fsa_category: str
    reason: str
    status: Literal["pending", "claimed", "dismissed"] = "pending"


class FsaReviewRequest(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    include_all_outflows: bool = Field(
        default=False,
        description="Send all scanned outflows to the LLM (max 500 rows). Higher cost/latency than keyword pre-filter.",
    )


class FsaItemUpdateRequest(BaseModel):
    status: Literal["pending", "claimed", "dismissed"]


class FsaReviewResponse(BaseModel):
    eligible_transactions: list[FsaEligibleTransaction]
    total_potential_amount: float
    scan_count: int
    model_source: str
    parse_errors: int = 0
    llm_batch_failures: int = Field(
        default=0,
        description="Batches with no LLM response (e.g. Ollama unreachable).",
    )
    candidate_count: int = Field(
        default=0,
        description="Rows sent to the LLM after pre-filter (or all scanned if include_all_outflows).",
    )
    prefilter_skipped_count: int = Field(
        default=0,
        description="Rows skipped by keyword pre-filter; 0 when include_all_outflows.",
    )


class BudgetSuggestion(BaseModel):
    category_id: str
    category_name: str
    suggested_amount: float
    reasoning: str


class BudgetSuggestionsResponse(BaseModel):
    suggestions: list[BudgetSuggestion]
    model_source: str


class DebtPlanSuggestion(BaseModel):
    strategy: str          # "avalanche" | "snowball" | "hybrid"
    rationale: str
    priority_order: list[str]
    monthly_extra: float
    model_source: str


class ParseActionRequest(BaseModel):
    message: str = Field(..., max_length=500)


class ParseActionResponse(BaseModel):
    action_type: Optional[str]
    data: Optional[Dict]
    confirmation_text: str


class ExecuteActionRequest(BaseModel):
    action_type: str
    data: dict


class ExecuteActionResponse(BaseModel):
    success: bool
    message: str


class InterestRateSuggestion(BaseModel):
    account_id: str
    account_name: str
    suggested_apr: float        # as a decimal, e.g. 0.2499 for 24.99%
    suggested_min_payment: float
    reasoning: str


class InterestRateSuggestionsResponse(BaseModel):
    suggestions: list[InterestRateSuggestion]
    model_source: str
    note: str


# ── Back-compat wrapper ────────────────────────────────────────────────────────
# Tests import `parse_debt_plan_suggestion_from_llm_response` and assert the
# return type is `DebtPlanSuggestion`. The service returns a plain dict; we
# wrap it here so the pydantic model is built from the route-layer schema.
def parse_debt_plan_suggestion_from_llm_response(
    response_text: str, model_source: str
) -> DebtPlanSuggestion:
    """Parse model JSON (optional markdown fence) into DebtPlanSuggestion."""
    return DebtPlanSuggestion(**_parse_debt_plan_dict(response_text, model_source))


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def ai_status(household_id: str = Depends(_require_ai_enabled)):
    """Check which AI backend is available (authenticated; household AI must be enabled).

    Short-TTL cached — the probe hits Ollama over HTTP and we don't want to
    re-hit it on every page mount. Payload must stay user-agnostic.
    """
    global _ai_status_cache_monotonic, _ai_status_payload
    now = time.monotonic()
    if _ai_status_payload is not None and now < _ai_status_cache_monotonic:
        return _ai_status_payload

    payload = await get_ai_status()
    _ai_status_cache_monotonic = now + _AI_STATUS_CACHE_TTL_SEC
    _ai_status_payload = payload
    return payload


@router.post("/insights", response_model=InsightsResponse)
async def get_financial_insights(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Generate personalised financial insights based on the user's data."""
    return InsightsResponse(**await generate_insights(db, household_id))


_MAX_CHAT_MSG_LEN = 1000   # chars per message
_MAX_CHAT_HISTORY = 8      # message pairs to keep


def _build_chat_prompt(req: ChatRequest) -> tuple[str, list[dict]]:
    """Return (last_user_message, history_messages).
    Truncates inputs to prevent prompt-injection and runaway token costs.
    """
    messages = req.messages[-_MAX_CHAT_HISTORY * 2:]
    history = [
        {"role": m.role, "content": m.content[:_MAX_CHAT_MSG_LEN]}
        for m in messages[:-1]
    ]
    last_message = (messages[-1].content if messages else "")[:_MAX_CHAT_MSG_LEN]
    return last_message, history


def _build_chat_system(ctx: str) -> str:
    return (
        "You are a knowledgeable, empathetic personal finance advisor. "
        "You have access to the user's real financial data (provided below). "
        "Give specific, personalised advice based on their actual numbers. "
        "Be concise — keep replies to 2-4 short paragraphs. Use plain text, avoid markdown headers. "
        "Focus on helping them reduce debt and build savings.\n\n"
        f"User's current financial snapshot:\n{ctx}"
    )


# Chat routes stay inline: splitting the SSE streaming contract across modules
# is a portability risk for a small cleanup win.
@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Streaming chat — yields Server-Sent Events so the UI can show tokens as they arrive."""
    ctx = await build_financial_context(db, household_id)
    evidence_list = await _build_chat_evidence_list(db, household_id)
    system = _build_chat_system(ctx)
    last_message, history = _build_chat_prompt(req)

    full_prompt = last_message
    if history:
        history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-6:])
        full_prompt = f"Previous conversation:\n{history_text}\n\nUser: {last_message}"

    async def generate():
        any_chunk = False
        detected_source = "unavailable"
        async for chunk, src in llm_client.stream_complete_with_source(full_prompt, system=system):
            any_chunk = True
            detected_source = src
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        if not any_chunk:
            yield f"data: {json.dumps({'error': _NO_AI_MSG})}\n\n"
        yield f"data: {json.dumps({'done': True, 'model_source': detected_source, 'evidence': evidence_list})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/advisor-turn", response_model=AdvisorTurnResponse)
async def advisor_turn(
    req: ChatRequest,
    household_id: str = Depends(_require_ai_enabled_rate_limited),
    db: AsyncSession = Depends(get_db),
):
    """One JSON LLM call: detect add_transaction / add_debt intent or return a chat reply.

    Evidence panels are always assembled server-side (never from model output).
    """
    ctx = await build_financial_context(db, household_id)
    evidence_list = await _build_chat_evidence_list(db, household_id)
    system = _build_chat_system(ctx)
    last_message, history = _build_chat_prompt(req)

    history_text = ""
    if history:
        history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-6:])

    if get_settings().demo_mode:
        full_prompt = last_message
        if history_text:
            full_prompt = f"Previous conversation:\n{history_text}\n\nUser: {last_message}"
        reply, src = await llm_client.complete_with_source(
            full_prompt,
            system=system,
            max_tokens=2048,
            log_label="advisor-turn",
        )
        if not reply:
            raise HTTPException(503, _NO_AI_MSG)
        return AdvisorTurnResponse(
            branch="chat",
            model_source=src,
            reply=reply.strip(),
            evidence=evidence_list,
        )

    prompt = f"""Today's date is {date.today().isoformat()}.

Financial snapshot (facts — do not invent accounts, balances, or goals):
{ctx}
"""
    if history_text:
        prompt += f"""
Conversation so far:
{history_text}
"""
    prompt += f"""
Latest user message:
{last_message}

Return ONLY a JSON object (no markdown fences) in exactly one of these forms:

1) User clearly wants to record NEW data now (not a hypothetical):
   {{"branch":"action","action_type":"add_transaction"|"add_debt","data":{{...}},"confirmation_text":"one clear sentence"}}
   For add_transaction, data must include: account_name, payee_name, amount (positive number), date (YYYY-MM-DD), and optionally memo.
   For add_debt, data must include: account_name, payee_name, amount (positive balance), and optionally due_date (YYYY-MM-DD).

2) Otherwise (questions, advice, hypotheticals):
   {{"branch":"chat","reply":"plain text only, 2-4 short paragraphs, no markdown headings"}}

Use "action" sparingly — only when they are asking you to add something to their ledger."""

    response, source = await llm_client.complete_with_source(
        prompt,
        system="You output a single JSON object only. No prose outside JSON.",
        max_tokens=2048,
        json_format=True,
        log_label="advisor-turn",
    )
    if not response:
        raise HTTPException(503, _NO_AI_MSG)
    try:
        parsed = parse_llm_json_object(response)
        return normalize_advisor_turn_payload(parsed, model_source=source, evidence_list=evidence_list)
    except Exception:
        logger.warning("advisor-turn: failed to parse or validate LLM JSON", exc_info=True)
        raise HTTPException(503, "The AI returned an unreadable response. Please try again.")


# Note: `_build_budget_context` lives in app.services.ai.insights now — the
# pre-extraction duplicate that 227b35a added inline has been skipped to
# avoid two copies drifting. The advisor-turn route above does NOT need it.


@router.post("/budget-insights", response_model=BudgetInsightsResponse)
async def get_budget_insights(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Generate spending pattern insights and category trends from the last 3 months."""
    return BudgetInsightsResponse(**await generate_budget_insights(db, household_id))


@router.post("/budget-suggestions", response_model=BudgetSuggestionsResponse)
async def get_budget_suggestions(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Suggest monthly budget amounts per category based on 3-month spending averages."""
    return BudgetSuggestionsResponse(**await generate_budget_suggestions(db, household_id))


@router.post("/debt-plan-suggestion", response_model=DebtPlanSuggestion)
async def get_debt_plan_suggestion(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Recommend a debt payoff strategy based on the user's debt accounts."""
    return DebtPlanSuggestion(**await suggest_debt_plan(db, household_id))


@router.post("/parse-action", response_model=ParseActionResponse)
async def parse_action(
    req: ParseActionRequest,
    household_id: str = Depends(_require_ai_enabled),
):
    """Parse a natural language message to detect data-entry action intents."""
    return ParseActionResponse(**await parse_action_message(req.message))


@router.post("/execute-action", response_model=ExecuteActionResponse)
async def execute_action(
    req: ExecuteActionRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Execute a parsed action intent (create transaction or debt account)."""
    return ExecuteActionResponse(
        **await execute_parsed_action(db, household_id, req.action_type, req.data)
    )


@router.post("/suggest-interest-rates", response_model=InterestRateSuggestionsResponse)
async def suggest_interest_rates(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Suggest typical APR and minimum payment for debt accounts missing that info.

    SimpleFIN does not provide interest rates. This uses the LLM to estimate
    typical rates based on account name / card type as a starting point for users
    to review and correct.
    """
    return InterestRateSuggestionsResponse(
        **await _suggest_interest_rates_service(db, household_id)
    )


@router.post("/fsa-review", response_model=FsaReviewResponse)
async def fsa_review(
    req: FsaReviewRequest = FsaReviewRequest(),
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Review transactions for potential FSA-eligible purchases."""
    return FsaReviewResponse(
        **await run_fsa_review(
            db,
            household_id,
            req.date_from,
            req.date_to,
            include_all_outflows=req.include_all_outflows,
        )
    )


@router.patch("/fsa-review/items/{transaction_id}")
async def update_fsa_item_status(
    transaction_id: str,
    req: FsaItemUpdateRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Update the claim/dismiss status of an FSA-reviewed transaction."""
    return await _update_fsa_item_status_service(
        db, household_id, transaction_id, req.status
    )


@router.get("/fsa-review/items")
async def list_fsa_items(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """List all FSA review items for the household."""
    return await _list_fsa_items_service(db, household_id)
