from __future__ import annotations

"""Grounded (model-free) fact endpoints.

These return the household's own deterministic aggregates for the on-device
pipeline — NO LLM call. Same household/AI auth gate as the FSA candidates
route (``_require_ai_enabled``), and covered by the existing ``/api/ai/``
IP rate-limit middleware.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.api.routes.ai import _require_ai_enabled
from app.api.routes.goals import compute_goal_facts
from app.schemas.facts import BudgetFacts, ContextFacts, GoalFacts, SpendingPatternsFacts
from app.services.ai.budget import compute_budget_facts, compute_spending_patterns
from app.services.ai.context import build_context_facts

router = APIRouter()


@router.get("/budget", response_model=BudgetFacts)
async def budget_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> BudgetFacts:
    """Budgeted vs actual per category for the current month (deterministic)."""
    return BudgetFacts(**await compute_budget_facts(db, household_id))


@router.get("/goal", response_model=GoalFacts)
async def goal_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> GoalFacts:
    """Savings-goal progress facts for the household (deterministic)."""
    return GoalFacts(**await compute_goal_facts(db, household_id))


@router.get("/context", response_model=ContextFacts)
async def context_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> ContextFacts:
    """Structured financial snapshot (typed numbers/ids) for the verifier."""
    return ContextFacts(**await build_context_facts(db, household_id))


@router.get("/spending-patterns", response_model=SpendingPatternsFacts)
async def spending_patterns_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> SpendingPatternsFacts:
    """Category spending trends vs 3-month average (deterministic)."""
    return SpendingPatternsFacts(**await compute_spending_patterns(db, household_id))

