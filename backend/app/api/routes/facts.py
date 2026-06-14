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
from app.schemas.facts import BudgetFacts
from app.services.ai.budget import compute_budget_facts

router = APIRouter()


@router.get("/budget", response_model=BudgetFacts)
async def budget_facts(
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
) -> BudgetFacts:
    """Budgeted vs actual per category for the current month (deterministic)."""
    return BudgetFacts(**await compute_budget_facts(db, household_id))
