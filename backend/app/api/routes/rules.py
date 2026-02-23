from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.api.deps import get_household_id
from app.models import AutoCategorizationRule
from app.schemas.rule import RuleCreate, RuleUpdate, RuleResponse

router = APIRouter()


@router.get("/", response_model=list[RuleResponse])
async def list_rules(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AutoCategorizationRule)
        .where(AutoCategorizationRule.household_id == household_id)
        .order_by(AutoCategorizationRule.priority.desc())
    )
    return [RuleResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/", response_model=RuleResponse, status_code=201)
async def create_rule(
    data: RuleCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    rule = AutoCategorizationRule(household_id=household_id, **data.model_dump())
    db.add(rule)
    await db.flush()
    return RuleResponse.model_validate(rule)


@router.put("/{rule_id}", response_model=RuleResponse)
async def update_rule(
    rule_id: str,
    data: RuleUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AutoCategorizationRule)
        .where(AutoCategorizationRule.id == rule_id, AutoCategorizationRule.household_id == household_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    return RuleResponse.model_validate(rule)


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AutoCategorizationRule)
        .where(AutoCategorizationRule.id == rule_id, AutoCategorizationRule.household_id == household_id)
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
