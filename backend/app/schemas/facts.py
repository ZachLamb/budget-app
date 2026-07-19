from __future__ import annotations

"""Grounded (model-free) fact schemas.

These describe the deterministic aggregates the backend exposes for the
on-device pipeline. No LLM output is ever shaped by these models.
"""

from pydantic import BaseModel


class BudgetCategoryFact(BaseModel):
    category_id: str
    name: str
    budgeted: float
    actual: float
    remaining: float


class BudgetFacts(BaseModel):
    month: str
    categories: list[BudgetCategoryFact]
    total_budgeted: float
    total_actual: float


class GoalFact(BaseModel):
    goal_id: str
    name: str
    target_amount: float
    current_amount: float
    monthly_contribution: float
    # None when contribution is 0/None and no future target date makes it
    # derivable (mirrors the goals route's ``Optional[int]`` months_remaining).
    months_remaining: int | None


class GoalFacts(BaseModel):
    goals: list[GoalFact]


class AccountSummaryFact(BaseModel):
    account_id: str
    name: str
    balance: float


class SpendByCategoryFact(BaseModel):
    category_id: str
    name: str
    amount: float


class SpendingTrendFact(BaseModel):
    category: str
    trend: str
    pct_change: float


class SpendingPatternsFacts(BaseModel):
    patterns: list[SpendingTrendFact]


class CycleMoverFact(BaseModel):
    category: str
    direction: str
    pct_change: float


class CycleOverspendFact(BaseModel):
    category: str
    over_by: float


class CycleProgressFact(BaseModel):
    observed: bool
    diagnosed: bool
    decided: bool


class CycleSummaryFacts(BaseModel):
    """Grounding payload for the on-device pay-cycle narration (deterministic)."""

    window: str
    income: float
    spent: float
    net: float
    top_movers: list[CycleMoverFact]
    overspent: list[CycleOverspendFact]
    cycle_progress: CycleProgressFact
    open_commitments: int
    next_step: str


class ContextFacts(BaseModel):
    """Deterministic structured financial snapshot for the on-device verifier.

    Typed numbers/ids only (no free-text blob). ``budget``/``goals`` reuse the
    A1/A2 fact helpers so all fact endpoints share one source of truth.
    """

    net_worth: float
    accounts: list[AccountSummaryFact]
    recent_spend_by_category: list[SpendByCategoryFact]
    budget: BudgetFacts
    goals: list[GoalFact]


class AnomalyFact(BaseModel):
    transaction_id: str
    category: str
    amount: float  # signed, as stored (negative for expense)
    category_avg: float  # mean absolute expense in this category, trailing 3 mo
    ratio: float  # abs(amount) / category_avg
    date: str  # ISO date
    payee: str | None


class AnomalyFacts(BaseModel):
    anomalies: list[AnomalyFact]


class DebtAccountFact(BaseModel):
    account_id: str
    name: str
    type: str
    balance: float
    has_apr: bool
    has_min_payment: bool
    current_apr: float | None
    current_min_payment: float | None


class DebtFacts(BaseModel):
    accounts: list[DebtAccountFact]


class SearchMatchFact(BaseModel):
    kind: str
    id: str
    name: str
    this_month: float
    last_month: float
    three_month_total: float
    txn_count: int


class SearchFacts(BaseModel):
    query_terms: list[str]
    matches: list[SearchMatchFact]
