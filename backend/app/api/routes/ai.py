from __future__ import annotations

"""Household AI routes — FSA data endpoints and the shared AI-enabled gate.

Model-calling cloud routes were removed in the nano-only migration. On-device
pipelines fetch grounded facts from ``/api/ai/facts/*`` and run inference in
the browser; this module keeps deterministic server helpers only.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_household_id
from app.models import Household
from app.schemas.ai import (
    ExecuteActionRequest,
    ExecuteActionResponse,
    FsaCandidatesResponse,
    FsaItemUpdateRequest,
    FsaReviewRequest,
)
from app.services.ai.action import execute_parsed_action
from app.services.ai.action_token import redeem_action_token
from app.services.ai.fsa import (
    fetch_fsa_candidates,
    list_fsa_items as _list_fsa_items_service,
    update_fsa_item_status as _update_fsa_item_status_service,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _require_ai_enabled(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Dependency: household exists and AI is enabled for that household."""
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


@router.post("/fsa-review/candidates", response_model=FsaCandidatesResponse)
async def fsa_review_candidates(
    req: FsaReviewRequest = FsaReviewRequest(),
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Return FSA scan candidates without calling a model (for on-device review)."""
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


@router.post("/execute-action", response_model=ExecuteActionResponse)
async def execute_action(
    req: ExecuteActionRequest,
    household_id: str = Depends(_require_ai_enabled),
    db: AsyncSession = Depends(get_db),
):
    """Execute a parsed action intent (create transaction or debt account).

    Gated on a single-use confirmation token — without it this would be an open
    mutation endpoint accepting arbitrary payloads.
    """
    if not await redeem_action_token(req.confirmation_token, household_id, req.action_type):
        raise HTTPException(
            403,
            "Action confirmation expired or invalid.",
        )
    return ExecuteActionResponse(
        **await execute_parsed_action(db, household_id, req.action_type, req.data)
    )
