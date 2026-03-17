from __future__ import annotations

"""AI financial advisor endpoints.

All data is processed locally via Ollama (or falls back to Claude).
No financial data is sent to third parties when Ollama is running.
"""

import json
import httpx
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal, Optional, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.config import get_settings
from app.database import get_db
from app.api.deps import get_household_id
from app.models import (
    Transaction, Account, Payee, Category, CategoryGroup,
    BudgetAssignment, FinancialGoal, Household,
)
from app.services.ai import llm_client

router = APIRouter()

_NO_AI_MSG = "No AI backend available. Start Ollama or set ANTHROPIC_API_KEY in settings."


async def _require_ai_enabled(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Dependency: checks household exists, household.ai_enabled, and that a backend is configured."""
    if not llm_client.has_any_backend():
        raise HTTPException(503, _NO_AI_MSG)
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household:
        raise HTTPException(404, "Household not found")
    if not household.ai_enabled:
        raise HTTPException(403, "AI features are disabled for this household. Enable them in Settings → AI Financial Advisor.")
    return household_id


# ── Schemas ────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=5000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    reply: str
    model_source: str   # ollama | claude | unavailable


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


# ── Context builder ────────────────────────────────────────────────────────────

async def _build_financial_context(db: AsyncSession, household_id: str) -> str:
    """Build a compact financial summary to inject as LLM context.

    Security notes:
    - Only account names, types, and aggregate balances are included.
    - No account numbers, routing numbers, SSNs, or credentials are ever included.
    - SimpleFIN access URLs are never included.
    - Spending data is category-level only (no individual transaction details).
    - When using Claude (not Ollama), this data is sent to Anthropic's API.
    """
    today = date.today()
    month_start = today.replace(day=1)
    three_months_ago = today - timedelta(days=90)

    # Account balances
    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
    )
    accounts = acct_result.scalars().all()

    from app.api.routes.accounts import _compute_balances
    balances = await _compute_balances(db, accounts)

    acct_summary = []
    total_assets = Decimal("0")
    total_debt = Decimal("0")
    for a in accounts:
        bal = balances.get(a.id, Decimal("0"))
        is_debt = a.account_type in ("credit", "loan")
        if is_debt:
            total_debt += abs(bal)
        else:
            total_assets += bal
        apr_str = f" APR={float(a.interest_rate)*100:.1f}%" if (a.interest_rate is not None) else ""
        acct_summary.append(f"  {a.name} ({a.account_type}): ${bal:,.2f}{apr_str}")

    # Current month spending by category
    spend_result = await db.execute(
        select(Category.name, func.sum(Transaction.amount))
        .join(Transaction, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.date >= month_start)
        .where(Transaction.amount < 0)
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount))
        .limit(10)
    )
    spending = [(name, abs(amt)) for name, amt in spend_result.all()]

    # Budget this month
    budget_result = await db.execute(
        select(func.sum(BudgetAssignment.assigned_amount))
        .where(BudgetAssignment.household_id == household_id)
        .where(BudgetAssignment.month == month_start.strftime("%Y-%m"))
    )
    total_budgeted = budget_result.scalar() or Decimal("0")

    # Goals
    goals_result = await db.execute(
        select(FinancialGoal)
        .where(FinancialGoal.household_id == household_id)
        .where(FinancialGoal.is_completed == False)  # noqa: E712
    )
    goals = goals_result.scalars().all()

    ctx_parts = [
        f"Today: {today.isoformat()}",
        f"Net worth: ${total_assets - total_debt:,.2f} (assets ${total_assets:,.2f}, debt ${total_debt:,.2f})",
        "",
        "Accounts:",
        *acct_summary,
        "",
        f"Budget assigned this month: ${total_budgeted:,.2f}",
        "",
        "Top spending this month:",
        *[f"  {name}: ${amt:,.2f}" for name, amt in spending],
    ]

    if goals:
        ctx_parts += ["", "Active financial goals:"]
        for g in goals:
            pct = 0
            if g.target_amount > 0:
                pct = float(g.current_amount / g.target_amount * 100)
            ctx_parts.append(f"  {g.name} ({g.goal_type}): ${g.current_amount:,.2f} / ${g.target_amount:,.2f} ({pct:.0f}%)")

    return "\n".join(ctx_parts)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def ai_status():
    """Check which AI backend is available."""
    settings = get_settings()
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{settings.ollama_url.rstrip('/')}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception:
        pass

    return {
        "ollama_available": ollama_ok,
        "claude_available": bool(settings.anthropic_api_key),
        "active_backend": "ollama" if ollama_ok else ("claude" if settings.anthropic_api_key else "none"),
    }


@router.post("/insights", response_model=InsightsResponse)
async def get_financial_insights(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Generate personalised financial insights based on the user's data."""
    acct_count = await db.execute(
        select(func.count(Account.id)).where(
            Account.household_id == household_id,
            Account.closed_at.is_(None),
        )
    )
    if (acct_count.scalar() or 0) == 0:
        return InsightsResponse(
            insights=["Connect and sync your accounts (or add them manually) to get personalised insights."],
            model_source="none",
        )
    ctx = await _build_financial_context(db, household_id)

    system = (
        "You are a compassionate, practical personal finance advisor. "
        "Analyse the user's financial data and give 3-5 specific, actionable insights. "
        "Focus on debt reduction, savings opportunities, and budget optimisation. "
        "Be encouraging but realistic. Use plain language. Keep each insight to 1-2 sentences."
    )
    prompt = f"""Based on this financial snapshot, give me 3-5 specific insights and actionable advice:

{ctx}

Return a JSON object with an "insights" key containing an array of strings (one per insight). No other text."""

    response, source = await llm_client.complete_with_source(prompt, system=system)
    if not response:
        raise HTTPException(503, _NO_AI_MSG)

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(text)
        insights = data.get("insights", [])
        if not isinstance(insights, list):
            insights = [str(insights)]
    except Exception:
        # If the LLM didn't return JSON, split by newlines as fallback
        insights = [line.lstrip("•-* ").strip() for line in response.split("\n") if line.strip()]

    return InsightsResponse(insights=insights[:6], model_source=source)


_MAX_CHAT_MSG_LEN = 1000   # chars per message
_MAX_CHAT_HISTORY = 8      # message pairs to keep


def _build_chat_prompt(req: ChatRequest) -> tuple[str, list[dict]]:
    """Return (last_user_message, history_messages).
    Truncates inputs to prevent prompt-injection and runaway token costs.
    """
    # Keep only recent history and cap each message length
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


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Streaming chat — yields Server-Sent Events so the UI can show tokens as they arrive."""
    ctx = await _build_financial_context(db, household_id)
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
        yield f"data: {json.dumps({'done': True, 'model_source': detected_source})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Non-streaming chat (kept for backwards compatibility)."""
    ctx = await _build_financial_context(db, household_id)
    system = _build_chat_system(ctx)
    last_message, history = _build_chat_prompt(req)

    full_prompt = last_message
    if history:
        history_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history[-6:])
        full_prompt = f"Previous conversation:\n{history_text}\n\nUser: {last_message}"

    response, source = await llm_client.complete_with_source(full_prompt, system=system)
    if not response:
        raise HTTPException(503, _NO_AI_MSG)

    return ChatResponse(reply=response.strip(), model_source=source)


# ── Budget insights ─────────────────────────────────────────────────────────────

async def _build_budget_context(
    db: AsyncSession, household_id: str
) -> tuple[str, list[SpendingTrend]]:
    """Build 3-month spending trend context for LLM."""
    today = date.today()

    # Generate last 4 months (3 previous + current) as "YYYY-MM" strings
    month_keys: list[str] = []
    for i in range(3, -1, -1):
        total = today.month - 1 - i
        year = today.year + total // 12
        month = total % 12 + 1
        month_keys.append(f"{year}-{month:02d}")

    from sqlalchemy import extract
    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    # Spending per category per month
    monthly_spend: dict[str, dict[str, Decimal]] = {m: {} for m in month_keys}
    for mk in month_keys:
        year_num, month_num = int(mk[:4]), int(mk[5:])
        result = await db.execute(
            select(Category.name, func.sum(Transaction.amount))
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_(budget_account_subq),
                extract("year", Transaction.date) == year_num,
                extract("month", Transaction.date) == month_num,
                Transaction.amount < 0,
                Transaction.category_id.isnot(None),
            )
            .group_by(Category.name)
        )
        monthly_spend[mk] = {name: abs(amt) for name, amt in result.all()}

    current_key = month_keys[-1]
    past_keys = month_keys[:-1]
    all_categories = set(monthly_spend[current_key].keys())

    patterns: list[SpendingTrend] = []
    for cat in all_categories:
        cur_val = float(monthly_spend[current_key].get(cat, Decimal("0")))
        past_vals = [float(monthly_spend[m].get(cat, Decimal("0"))) for m in past_keys]
        past_avg = sum(past_vals) / len(past_vals) if past_vals else 0
        if past_avg == 0:
            pct_change = 0.0
            trend = "stable"
        else:
            pct_change = (cur_val - past_avg) / past_avg * 100
            trend = "up" if pct_change > 5 else ("down" if pct_change < -5 else "stable")
        patterns.append(SpendingTrend(category=cat, trend=trend, pct_change=round(pct_change, 1)))

    patterns.sort(key=lambda p: abs(p.pct_change), reverse=True)

    # Build text representation for LLM
    lines = ["Month-by-month spending by category (last 3 months):"]
    for cat in sorted(all_categories):
        vals = " | ".join(f"{m}: ${float(monthly_spend[m].get(cat, Decimal('0'))):,.2f}" for m in month_keys)
        lines.append(f"  {cat}: {vals}")

    return "\n".join(lines), patterns[:12]


@router.post("/budget-insights", response_model=BudgetInsightsResponse)
async def get_budget_insights(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Generate spending pattern insights and category trends from the last 3 months."""
    ctx, patterns = await _build_budget_context(db, household_id)

    system = (
        "You are a personal finance advisor specialising in budget analysis. "
        "Identify meaningful spending trends and give 3-4 specific, actionable insights. "
        "Focus on categories with unusual spikes, recurring waste, or opportunities to save. "
        "Be concise, encouraging, and practical."
    )
    prompt = f"""{ctx}

Based on these spending trends, provide 3-4 actionable insights about spending patterns and where money could be saved.
Return JSON: {{"insights": ["...", "..."]}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt, system=system)
    insights: list[str] = []
    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            insights = json.loads(text).get("insights", [])
        except Exception:
            insights = [ln.lstrip("•-* ").strip() for ln in response.split("\n") if ln.strip()]

    return BudgetInsightsResponse(insights=insights[:5], patterns=patterns, model_source=source)


# ── Budget suggestions ──────────────────────────────────────────────────────────

class BudgetSuggestion(BaseModel):
    category_id: str
    category_name: str
    suggested_amount: float
    reasoning: str


class BudgetSuggestionsResponse(BaseModel):
    suggestions: list[BudgetSuggestion]
    model_source: str


@router.post("/budget-suggestions", response_model=BudgetSuggestionsResponse)
async def get_budget_suggestions(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Suggest monthly budget amounts per category based on 3-month spending averages."""
    from sqlalchemy import extract
    today = date.today()

    # Build 3-month average spending per category
    month_keys: list[str] = []
    for i in range(3, 0, -1):
        total = today.month - 1 - i
        year = today.year + total // 12
        month = total % 12 + 1
        month_keys.append(f"{year}-{month:02d}")

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    # Collect per-month spending and category IDs
    monthly_spend: dict[str, dict[str, Decimal]] = {m: {} for m in month_keys}
    cat_ids: dict[str, str] = {}  # name -> id

    for mk in month_keys:
        year_num, month_num = int(mk[:4]), int(mk[5:])
        result = await db.execute(
            select(Category.id, Category.name, func.sum(Transaction.amount))
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_(budget_account_subq),
                extract("year", Transaction.date) == year_num,
                extract("month", Transaction.date) == month_num,
                Transaction.amount < 0,
                Transaction.category_id.isnot(None),
            )
            .group_by(Category.id, Category.name)
        )
        for cat_id, cat_name, amt in result.all():
            monthly_spend[mk][cat_name] = abs(amt)
            cat_ids[cat_name] = cat_id

    if not cat_ids:
        return BudgetSuggestionsResponse(suggestions=[], model_source="unavailable")

    # Build context lines
    lines = []
    for cat_name in sorted(cat_ids.keys()):
        vals = [float(monthly_spend[m].get(cat_name, Decimal("0"))) for m in month_keys]
        avg = sum(vals) / len(vals) if vals else 0
        lines.append(f"  {cat_name}: 3-month avg ${avg:,.2f} (months: {', '.join(f'${v:,.2f}' for v in vals)})")

    context = "3-month average spending per category:\n" + "\n".join(lines)

    prompt = f"""{context}

Based on the following 3-month average spending per category, suggest monthly budget amounts.
For categories with consistent spending, suggest ~10% above average.
For categories with high variance, suggest the 75th percentile.
Return JSON: {{"suggestions": [{{"category_name": "...", "suggested_amount": 150.00, "reasoning": "one line reason"}}]}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt)
    suggestions: list[BudgetSuggestion] = []

    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            raw = json.loads(text).get("suggestions", [])
            for item in raw:
                cat_name = item.get("category_name", "")
                cat_id = cat_ids.get(cat_name)
                if cat_id and isinstance(item.get("suggested_amount"), (int, float)):
                    suggestions.append(BudgetSuggestion(
                        category_id=cat_id,
                        category_name=cat_name,
                        suggested_amount=float(item["suggested_amount"]),
                        reasoning=str(item.get("reasoning", "")),
                    ))
        except Exception:
            pass

    return BudgetSuggestionsResponse(suggestions=suggestions, model_source=source)


# ── Debt plan suggestion ────────────────────────────────────────────────────────

class DebtPlanSuggestion(BaseModel):
    strategy: str          # "avalanche" | "snowball" | "hybrid"
    rationale: str
    priority_order: list[str]
    monthly_extra: float
    model_source: str


@router.post("/debt-plan-suggestion", response_model=DebtPlanSuggestion)
async def get_debt_plan_suggestion(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Recommend a debt payoff strategy based on the user's debt accounts."""
    from app.api.routes.accounts import _compute_balances

    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
        .where(Account.account_type.in_(["credit", "loan"]))
    )
    debt_accounts = acct_result.scalars().all()

    if not debt_accounts:
        raise HTTPException(400, "No debt accounts found.")

    balances = await _compute_balances(db, debt_accounts)

    debt_lines = []
    for a in debt_accounts:
        bal = abs(balances.get(a.id, Decimal("0")))
        apr = f"{float(a.interest_rate) * 100:.2f}%" if a.interest_rate else "unknown"
        min_pay = f"${float(a.minimum_payment):,.2f}" if a.minimum_payment else "unknown"
        debt_lines.append(f"  - {a.name}: balance ${bal:,.2f}, APR {apr}, min payment {min_pay}")

    context = "Debt accounts:\n" + "\n".join(debt_lines)

    prompt = f"""{context}

Based on these debt accounts, recommend the best payoff strategy.
Consider avalanche (highest interest first), snowball (lowest balance first), or hybrid.
Return JSON exactly:
{{"strategy": "avalanche", "rationale": "2-3 sentences explaining why", "priority_order": ["Account Name 1", "Account Name 2"], "monthly_extra": 100.0}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt)
    if not response:
        raise HTTPException(503, _NO_AI_MSG)

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(text)
        return DebtPlanSuggestion(
            strategy=str(data.get("strategy", "avalanche")),
            rationale=str(data.get("rationale", "")),
            priority_order=[str(x) for x in data.get("priority_order", [])],
            monthly_extra=float(data.get("monthly_extra", 0)),
            model_source=source,
        )
    except Exception:
        raise HTTPException(500, "Failed to parse AI response.")


# ── Action parsing ──────────────────────────────────────────────────────────────

class ParseActionRequest(BaseModel):
    message: str


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


@router.post("/parse-action", response_model=ParseActionResponse)
async def parse_action(
    req: ParseActionRequest,
    household_id: str = Depends(_require_ai_enabled),
):
    """Parse a natural language message to detect data-entry action intents."""
    # Limit message length to prevent prompt-injection and runaway LLM costs
    message = req.message.strip()[:500]
    today_str = date.today().isoformat()

    # Use a hard delimiter so user text cannot escape the quoted block
    prompt = f"""Today's date is {today_str}.
A user typed the following message (contained between the --- markers):
---
{message}
---
If the message is a request to add financial data, extract it as structured JSON.
Supported actions:
- add_transaction: {{"action": "add_transaction", "account_name": "...", "payee_name": "...", "amount": 0.0, "date": "YYYY-MM-DD", "memo": "..."}}
- add_debt: {{"action": "add_debt", "account_name": "...", "amount": 0.0, "due_date": "YYYY-MM-DD", "payee_name": "..."}}
If no supported action is detected, return {{"action": null}}.
Return ONLY the JSON object, no other text."""

    response, _ = await llm_client.complete_with_source(prompt)
    if not response:
        return ParseActionResponse(action_type=None, data=None, confirmation_text="")

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(text)
        action = parsed.get("action")

        if not action:
            return ParseActionResponse(action_type=None, data=None, confirmation_text="")

        # Build human-readable confirmation
        if action == "add_transaction":
            amount = parsed.get("amount", 0)
            payee = parsed.get("payee_name", "unknown payee")
            acct = parsed.get("account_name", "your account")
            dt = parsed.get("date", today_str)
            memo = parsed.get("memo", "")
            memo_str = f' with memo "{memo}"' if memo else ""
            confirmation = (
                f"I'd add a ${abs(float(amount)):.2f} transaction to '{payee}' "
                f"on {dt} in '{acct}'{memo_str}."
            )
        elif action == "add_debt":
            amount = parsed.get("amount", 0)
            payee = parsed.get("payee_name", "unknown creditor")
            acct = parsed.get("account_name", "debt account")
            due = parsed.get("due_date", "")
            due_str = f" due {due}" if due else ""
            confirmation = (
                f"I'd create a debt account '{acct}' for '{payee}' "
                f"with balance ${abs(float(amount)):.2f}{due_str}."
            )
        else:
            return ParseActionResponse(action_type=None, data=None, confirmation_text="")

        return ParseActionResponse(
            action_type=action,
            data={k: v for k, v in parsed.items() if k != "action"},
            confirmation_text=confirmation,
        )
    except Exception:
        return ParseActionResponse(action_type=None, data=None, confirmation_text="")


@router.post("/execute-action", response_model=ExecuteActionResponse)
async def execute_action(
    req: ExecuteActionRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Execute a parsed action intent (create transaction or debt account)."""
    _MAX_AMOUNT = 1_000_000  # sanity cap — reject obviously bad LLM hallucinations

    if req.action_type == "add_transaction":
        data = req.data
        account_name = str(data.get("account_name", "")).strip()[:200]
        payee_name = str(data.get("payee_name", "")).strip()[:200]
        try:
            amount = float(data.get("amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid amount")
        if amount <= 0 or amount > _MAX_AMOUNT:
            raise HTTPException(400, f"Amount must be between $0.01 and ${_MAX_AMOUNT:,}")
        txn_date = data.get("date") or date.today().isoformat()
        memo = str(data.get("memo", "")).strip()[:500]

        from app.utils import escape_like
        # Look up account by name
        acct_result = await db.execute(
            select(Account)
            .where(Account.household_id == household_id)
            .where(Account.name.ilike(f"%{escape_like(account_name)}%"))
            .where(Account.closed_at.is_(None))
            .limit(1)
        )
        account = acct_result.scalar_one_or_none()
        if not account:
            # Try to use first budget account as fallback
            acct_result = await db.execute(
                select(Account)
                .where(Account.household_id == household_id)
                .where(Account.is_budget_account.is_(True))
                .where(Account.closed_at.is_(None))
                .limit(1)
            )
            account = acct_result.scalar_one_or_none()
        if not account:
            return ExecuteActionResponse(success=False, message="No matching account found.")

        # Look up or create payee
        payee_result = await db.execute(
            select(Payee)
            .where(Payee.household_id == household_id)
            .where(Payee.name.ilike(payee_name))
            .limit(1)
        )
        payee = payee_result.scalar_one_or_none()
        if not payee and payee_name:
            payee = Payee(household_id=household_id, name=payee_name)
            db.add(payee)
            await db.flush()

        try:
            txn_date_parsed = date.fromisoformat(str(txn_date))
        except Exception:
            txn_date_parsed = date.today()

        txn = Transaction(
            account_id=account.id,
            payee_id=payee.id if payee else None,
            amount=Decimal(str(-abs(amount))),
            date=txn_date_parsed,
            notes=memo or None,
            cleared=False,
        )
        db.add(txn)
        await db.commit()
        return ExecuteActionResponse(
            success=True,
            message=f"Added ${abs(amount):.2f} transaction to '{account.name}'.",
        )

    elif req.action_type == "add_debt":
        data = req.data
        account_name = str(data.get("account_name", "Debt Account")).strip()[:200]
        payee_name = str(data.get("payee_name", "")).strip()[:200]
        try:
            amount = float(data.get("amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid amount")
        if amount <= 0 or amount > _MAX_AMOUNT:
            raise HTTPException(400, f"Amount must be between $0.01 and ${_MAX_AMOUNT:,}")
        due_date = data.get("due_date")

        new_account = Account(
            household_id=household_id,
            name=account_name,
            account_type="loan",
            is_budget_account=True,
            institution=payee_name or None,
        )
        db.add(new_account)
        await db.flush()

        if amount > 0:
            txn = Transaction(
                account_id=new_account.id,
                date=date.today(),
                amount=Decimal(str(-abs(amount))),
                notes=f"Opening balance — due {due_date}" if due_date else "Opening balance",
                cleared=True,
            )
            db.add(txn)

        await db.commit()
        return ExecuteActionResponse(
            success=True,
            message=f"Created debt account '{account_name}' with balance ${abs(amount):.2f}.",
        )

    return ExecuteActionResponse(success=False, message="Unknown action type.")


# ── Interest rate suggestions ────────────────────────────────────────────────────

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
    acct_result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.account_type.in_(["credit", "loan"]))
        .where(Account.closed_at.is_(None))
    )
    accounts = acct_result.scalars().all()

    # Only suggest for accounts missing rates
    missing = [a for a in accounts if a.interest_rate is None or a.minimum_payment is None]
    if not missing:
        return InterestRateSuggestionsResponse(
            suggestions=[],
            model_source="none",
            note="All accounts already have interest rate data.",
        )

    from app.api.routes.accounts import _compute_balances
    balances = await _compute_balances(db, missing)

    lines = []
    for a in missing:
        bal = abs(balances.get(a.id, Decimal("0")))
        lines.append(f"  - Name: \"{a.name}\", Type: {a.account_type}, Balance: ${bal:,.2f}")

    context = "\n".join(lines)
    prompt = f"""The following are credit card or loan accounts. Based on the account name and type,
estimate a typical APR (annual interest rate) and typical minimum monthly payment for each.
Use common knowledge about card types — e.g. Chase Freedom ~24.99%, store cards ~29.99%,
mortgages ~7%, auto loans ~6-8%, personal loans ~10-15%.
Round APR to 2 decimal places as a percentage (e.g. 24.99).
For minimum payment use the greater of $25 or 2% of balance.

Accounts:
{context}

Return JSON:
{{"suggestions": [{{"account_name": "...", "apr_percent": 24.99, "min_payment": 35.00, "reasoning": "one line"}}]}}
No other text."""

    response, source = await llm_client.complete_with_source(prompt)
    suggestions: list[InterestRateSuggestion] = []

    if response:
        try:
            text = response.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0]
            raw = json.loads(text).get("suggestions", [])
            name_to_acct = {a.name: a for a in missing}
            for item in raw:
                acct = name_to_acct.get(item.get("account_name", ""))
                if not acct:
                    continue
                apr_pct = float(item.get("apr_percent", 0))
                min_pay = float(item.get("min_payment", 0))
                if not (0 < apr_pct < 100):
                    continue
                suggestions.append(InterestRateSuggestion(
                    account_id=acct.id,
                    account_name=acct.name,
                    suggested_apr=round(apr_pct / 100, 6),   # store as decimal
                    suggested_min_payment=round(min_pay, 2),
                    reasoning=str(item.get("reasoning", ""))[:200],
                ))
        except Exception:
            pass

    return InterestRateSuggestionsResponse(
        suggestions=suggestions,
        model_source=source,
        note="These are estimates based on typical rates for your card types. Please verify and correct them.",
    )
