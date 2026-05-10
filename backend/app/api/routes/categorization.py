from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.api.deps_llm import LlmCallContext, require_cloud_feature, write_audit
from app.models import Transaction, Account
from app.services.categorization.llm import suggest_categories_batch
from app.services.categorization.rules import apply_rules
from app.utils import validate_account_ownership, validate_category_ownership

router = APIRouter()


class ApplySuggestion(BaseModel):
    transaction_id: str
    category_id: str


class ApplySuggestionsRequest(BaseModel):
    suggestions: list[ApplySuggestion]


class SuggestCategoriesBody(BaseModel):
    """Optional filters (same semantics as GET /transactions). Empty body = recent uncategorized (up to 50)."""

    account_id: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    search: Optional[str] = Field(default=None, max_length=200)
    limit: int = Field(default=50, ge=1, le=50)


@router.post("/suggest")
async def suggest_categories(
    household_id: str = Depends(get_household_id),
    llm_ctx: LlmCallContext = Depends(require_cloud_feature("categorize_transaction")),
    db: AsyncSession = Depends(get_db),
    body: SuggestCategoriesBody = Body(default_factory=SuggestCategoriesBody),
):
    if body.date_from and body.date_to and body.date_from > body.date_to:
        raise HTTPException(400, "date_from must be on or before date_to.")
    if body.account_id:
        await validate_account_ownership(db, body.account_id, household_id)
    try:
        suggestions = await suggest_categories_batch(
            db,
            household_id,
            account_id=body.account_id,
            date_from=body.date_from,
            date_to=body.date_to,
            search=body.search,
            limit=body.limit,
        )
        await write_audit(db, llm_ctx, status_code=200)
        return {"suggestions": suggestions}
    except HTTPException as he:
        await write_audit(db, llm_ctx, status_code=he.status_code)
        raise


@router.post("/apply")
async def apply_suggestions(
    data: ApplySuggestionsRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    applied = 0
    for s in data.suggestions:
        await validate_category_ownership(db, s.category_id, household_id)
        result = await db.execute(
            select(Transaction)
            .join(Account)
            .where(Transaction.id == s.transaction_id, Account.household_id == household_id)
        )
        txn = result.scalar_one_or_none()
        if txn:
            txn.category_id = s.category_id
            applied += 1
    return {"applied": applied}


@router.post("/apply-rules")
async def run_rules(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    await apply_rules(db, household_id)
    return {"status": "ok"}
