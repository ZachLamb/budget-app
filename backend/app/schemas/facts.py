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
