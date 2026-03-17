from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Transaction, Account
from app.services.categorization.llm import suggest_categories_batch
from app.services.categorization.rules import apply_rules
from app.utils import validate_category_ownership

router = APIRouter()


class ApplySuggestion(BaseModel):
    transaction_id: str
    category_id: str


class ApplySuggestionsRequest(BaseModel):
    suggestions: list[ApplySuggestion]


@router.post("/suggest")
async def suggest_categories(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    suggestions = await suggest_categories_batch(db, household_id)
    return {"suggestions": suggestions}


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
