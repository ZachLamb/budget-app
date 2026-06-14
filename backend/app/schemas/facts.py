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
