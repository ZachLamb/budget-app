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
from app.api.deps_llm import LlmCallContext, require_cloud_feature, write_audit
from app.config import get_settings
from app.database import get_db
from app.models import Category, Household, Transaction, Account
from app.services.ai import llm_client
from app.services.ai.household_rate_limit import enforce_household_ai_rate_limit
from app.services.ai.json_extract import parse_llm_json_object
from app.services.ai.action_token import issue_action_token, redeem_action_token
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
    fetch_fsa_candidates,
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
# Schemas live in app.schemas.ai; chat evidence assembly in
# app.services.ai.evidence. Names are re-exported here because existing
# tests and callers import them from this module.

from app.schemas.ai import (  # noqa: E402
    AdvisorTurnResponse,
    BudgetInsightsResponse,
    BudgetPaceLine,
    BudgetSuggestion,
    BudgetSuggestionsResponse,
    CategorySpendingLine,
    ChatEvidenceBudgetPace,
    ChatEvidenceCategorySpending,
    ChatEvidenceGoalProgress,
    ChatMessage,
    ChatRequest,
    DebtPlanSuggestion,
    ExecuteActionRequest,
    ExecuteActionResponse,
    FsaCandidatesResponse,
    FsaEligibleTransaction,
    FsaItemUpdateRequest,
    FsaReviewRequest,
    FsaReviewResponse,
    GoalProgressLine,
    InsightsResponse,
    InterestRateSuggestion,
    InterestRateSuggestionsResponse,
    ParseActionRequest,
    ParseActionResponse,
    SpendingTrend,
    build_budget_pace_evidence_rows,
    build_category_spending_evidence,
    build_goal_progress_evidence_rows,
    normalize_advisor_turn_payload,
)
from app.services.ai.evidence import build_chat_evidence_list as _build_chat_evidence_list  # noqa: E402


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
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("financial_advice")),
    db: AsyncSession = Depends(get_db),
):
    """Generate personalised financial insights based on the user's data."""
    try:
        result = await generate_insights(db, household_id)
        await write_audit(db, llm_ctx, status_code=200)
        return InsightsResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


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
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("free_form_qa")),
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
        completion_buf: list[str] = []
        # Status reflects the user-visible outcome: 200 if we streamed any
        # chunk, 503 if the backend was unreachable for the whole call.
        # Streaming exceptions are swallowed by the underlying client so we
        # don't try to detect them here.
        try:
            async for chunk, src in llm_client.stream_complete_with_source(full_prompt, system=system):
                any_chunk = True
                detected_source = src
                completion_buf.append(chunk)
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            if not any_chunk:
                yield f"data: {json.dumps({'error': _NO_AI_MSG})}\n\n"
            yield f"data: {json.dumps({'done': True, 'model_source': detected_source, 'evidence': evidence_list})}\n\n"
        finally:
            await write_audit(
                db,
                llm_ctx,
                status_code=200 if any_chunk else 503,
                prompt_text=full_prompt,
                completion_text="".join(completion_buf) if any_chunk else None,
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/advisor-turn", response_model=AdvisorTurnResponse)
async def advisor_turn(
    req: ChatRequest,
    household_id: str = Depends(_require_ai_enabled_rate_limited),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("free_form_qa")),
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
            await write_audit(db, llm_ctx, status_code=503, prompt_text=full_prompt)
            raise HTTPException(503, _NO_AI_MSG)
        await write_audit(
            db, llm_ctx, status_code=200, prompt_text=full_prompt, completion_text=reply
        )
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
        await write_audit(db, llm_ctx, status_code=503, prompt_text=prompt)
        raise HTTPException(503, _NO_AI_MSG)
    try:
        parsed = parse_llm_json_object(response)
        result = normalize_advisor_turn_payload(parsed, model_source=source, evidence_list=evidence_list)
        if result.branch == "action" and result.action_type:
            result.confirmation_token = await issue_action_token(
                household_id, result.action_type
            )
        await write_audit(
            db, llm_ctx, status_code=200, prompt_text=prompt, completion_text=response
        )
        return result
    except Exception:
        logger.warning("advisor-turn: failed to parse or validate LLM JSON", exc_info=True)
        await write_audit(db, llm_ctx, status_code=503, prompt_text=prompt, completion_text=response)
        raise HTTPException(503, "The AI returned an unreadable response. Please try again.")


# Note: `_build_budget_context` lives in app.services.ai.insights now — the
# pre-extraction duplicate that 227b35a added inline has been skipped to
# avoid two copies drifting. The advisor-turn route above does NOT need it.


@router.post("/budget-insights", response_model=BudgetInsightsResponse)
async def get_budget_insights(
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("financial_advice")),
    db: AsyncSession = Depends(get_db),
):
    """Generate spending pattern insights and category trends from the last 3 months."""
    try:
        result = await generate_budget_insights(db, household_id)
        await write_audit(db, llm_ctx, status_code=200)
        return BudgetInsightsResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


@router.post("/budget-suggestions", response_model=BudgetSuggestionsResponse)
async def get_budget_suggestions(
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("budget_recommendations")),
    db: AsyncSession = Depends(get_db),
):
    """Suggest monthly budget amounts per category based on 3-month spending averages."""
    try:
        result = await generate_budget_suggestions(db, household_id)
        await write_audit(db, llm_ctx, status_code=200)
        return BudgetSuggestionsResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


@router.post("/debt-plan-suggestion", response_model=DebtPlanSuggestion)
async def get_debt_plan_suggestion(
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("financial_advice")),
    db: AsyncSession = Depends(get_db),
):
    """Recommend a debt payoff strategy based on the user's debt accounts."""
    try:
        result = await suggest_debt_plan(db, household_id)
        await write_audit(db, llm_ctx, status_code=200)
        return DebtPlanSuggestion(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


@router.post("/parse-action", response_model=ParseActionResponse)
async def parse_action(
    req: ParseActionRequest,
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("free_form_qa")),
    db: AsyncSession = Depends(get_db),
):
    """Parse a natural language message to detect data-entry action intents."""
    try:
        result = await parse_action_message(req.message)
        if result.get("action_type"):
            result["confirmation_token"] = await issue_action_token(
                household_id, str(result["action_type"])
            )
        await write_audit(
            db, llm_ctx, status_code=200, prompt_text=req.message
        )
        return ParseActionResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code, prompt_text=req.message)
        raise


@router.post("/execute-action", response_model=ExecuteActionResponse)
async def execute_action(
    req: ExecuteActionRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Execute a parsed action intent (create transaction or debt account).

    No LLM call here, but the write is gated on a single-use confirmation
    token issued by ``/advisor-turn`` or ``/parse-action`` — without it this
    would be an open mutation endpoint accepting arbitrary payloads.
    """
    if not await redeem_action_token(req.confirmation_token, household_id, req.action_type):
        raise HTTPException(
            403,
            "Action confirmation expired or invalid. Ask the advisor again to retry.",
        )
    return ExecuteActionResponse(
        **await execute_parsed_action(db, household_id, req.action_type, req.data)
    )


@router.post("/suggest-interest-rates", response_model=InterestRateSuggestionsResponse)
async def suggest_interest_rates(
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("financial_advice")),
    db: AsyncSession = Depends(get_db),
):
    """Suggest typical APR and minimum payment for debt accounts missing that info.

    SimpleFIN does not provide interest rates. This uses the LLM to estimate
    typical rates based on account name / card type as a starting point for users
    to review and correct.
    """
    try:
        result = await _suggest_interest_rates_service(db, household_id)
        await write_audit(db, llm_ctx, status_code=200)
        return InterestRateSuggestionsResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


@router.post("/fsa-review/candidates", response_model=FsaCandidatesResponse)
async def fsa_review_candidates(
    req: FsaReviewRequest = FsaReviewRequest(),
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Return FSA scan candidates without calling the LLM (for on-device review)."""
    result = await fetch_fsa_candidates(
        db,
        household_id,
        req.date_from,
        req.date_to,
        include_all_outflows=req.include_all_outflows,
    )
    return FsaCandidatesResponse(
        candidates=result["candidates"],
        scan_count=result["scan_count"],
        candidate_count=result["candidate_count"],
        prefilter_skipped_count=result["prefilter_skipped_count"],
    )


@router.post("/fsa-review", response_model=FsaReviewResponse)
async def fsa_review(
    req: FsaReviewRequest = FsaReviewRequest(),
    household_id: str = Depends(_require_ai_enabled),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("fsa_review")),
    db: AsyncSession = Depends(get_db),
):
    """Review transactions for potential FSA-eligible purchases."""
    try:
        result = await run_fsa_review(
            db,
            household_id,
            req.date_from,
            req.date_to,
            include_all_outflows=req.include_all_outflows,
        )
        await write_audit(db, llm_ctx, status_code=200)
        return FsaReviewResponse(**result)
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


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
