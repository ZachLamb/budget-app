from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.api.deps import get_household_id
from app.models import AutoCategorizationRule, Transaction, Account, Category, Payee
from app.schemas.rule import (
    RuleCreate,
    RuleUpdate,
    RuleResponse,
    RuleSuggestionResponse,
)
from app.services.rule_suggestions import (
    ExistingRuleView,
    PayeeCategoryStat,
    build_rule_suggestions,
)
from app.utils import validate_category_ownership

router = APIRouter()


@router.get("/suggestions", response_model=list[RuleSuggestionResponse])
async def list_rule_suggestions(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Propose payee→category rules from consistent categorization history.

    Deterministic: aggregates how each payee's categorized transactions are
    filed, then surfaces the strong, uncovered patterns. No model involved.
    """
    counts = await db.execute(
        select(
            Payee.name,
            Transaction.category_id,
            func.count(Transaction.id).label("count"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Payee, Transaction.payee_id == Payee.id)
        .where(
            Account.household_id == household_id,
            Transaction.category_id.is_not(None),
        )
        .group_by(Payee.name, Transaction.category_id)
    )
    stats = [
        PayeeCategoryStat(payee_name=name, category_id=cat_id, count=count)
        for name, cat_id, count in counts.all()
    ]

    rules_result = await db.execute(
        select(AutoCategorizationRule).where(
            AutoCategorizationRule.household_id == household_id
        )
    )
    existing = [
        ExistingRuleView(
            match_field=r.match_field,
            match_type=r.match_type,
            match_value=r.match_value,
            enabled=r.enabled,
        )
        for r in rules_result.scalars().all()
    ]

    suggestions = build_rule_suggestions(stats, existing)
    if not suggestions:
        return []

    cat_result = await db.execute(
        select(Category.id, Category.name).where(
            Category.id.in_({s.category_id for s in suggestions})
        )
    )
    cat_names = {cid: name for cid, name in cat_result.all()}

    return [
        RuleSuggestionResponse(
            match_field=s.match_field,
            match_type=s.match_type,
            match_value=s.match_value,
            category_id=s.category_id,
            category_name=cat_names.get(s.category_id, "Unknown"),
            support=s.support,
            total=s.total,
            dominance=s.dominance,
        )
        for s in suggestions
    ]


@router.get("", response_model=list[RuleResponse])
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


@router.post("", response_model=RuleResponse, status_code=201)
async def create_rule(
    data: RuleCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    await validate_category_ownership(db, data.category_id, household_id)
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
    updates = data.model_dump(exclude_unset=True)
    if "category_id" in updates:
        await validate_category_ownership(db, updates["category_id"], household_id)
    for field, value in updates.items():
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
