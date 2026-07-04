"""Pydantic schemas (and pure schema-bound helpers) for the AI routes.

Extracted from ``app.api.routes.ai`` to keep the route module focused on
HTTP wiring. The route module re-exports these names for backward
compatibility with existing imports.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Dict, Literal, Optional

from pydantic import BaseModel, Field


# ── Chat / advisor ─────────────────────────────────────────────────────────────


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
    # Single-use server-issued token required by /execute-action.
    confirmation_token: Optional[str] = None
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
        if at not in ("add_transaction", "add_debt", "create_category", "bulk_recategorize"):
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


# ── Chat evidence ──────────────────────────────────────────────────────────────


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


# ── Insights / budgets / FSA / debt ───────────────────────────────────────────


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


class FsaCandidatesResponse(BaseModel):
    candidates: list[dict]
    scan_count: int
    candidate_count: int
    prefilter_skipped_count: int


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


# ── Actions ───────────────────────────────────────────────────────────────────


class ParseActionRequest(BaseModel):
    message: str = Field(..., max_length=500)


class ParseActionResponse(BaseModel):
    action_type: Optional[str]
    data: Optional[Dict]
    confirmation_text: str
    # Single-use server-issued token required by /execute-action.
    confirmation_token: Optional[str] = None


class ExecuteActionRequest(BaseModel):
    action_type: str
    data: dict
    confirmation_token: str = Field(..., min_length=1)


class ExecuteActionResponse(BaseModel):
    success: bool
    message: str


class PrepareActionRequest(BaseModel):
    action_type: Literal[
        "add_transaction", "add_debt", "create_category", "bulk_recategorize"
    ]
    data: dict


class PrepareActionResponse(BaseModel):
    ok: bool
    confirmation_token: Optional[str] = None
    preview: str
    normalized_data: dict = Field(default_factory=dict)


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
