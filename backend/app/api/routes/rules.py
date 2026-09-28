from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.api.deps import get_household_id
from app.models import AutoCategorizationRule, Transaction, Account, Category, Payee
from app.schemas.rule import (
    RulePreviewRequest,
    RulePreviewResponse,
    RuleMatchResponse,
    RuleCreate,
    RuleUpdate,
    RuleResponse,
    RuleSuggestionResponse,
)
from app.services.categorization.rules import (
    CandidateRule,
    apply_rules,
    preview_candidate,
    preview_rules,
)
from app.services.categorization.pattern_guard import BadPattern, check_match_value
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
    # A partial update can change the pattern, the type it is read as, or
    # only one of the two. The schema can only check a pair that arrives
    # together, so the merged result is what actually has to be valid --
    # otherwise switching an existing `contains` rule to `regex` slips an
    # uncompilable pattern past every check.
    if "match_value" in updates or "match_type" in updates:
        try:
            check_match_value(
                updates.get("match_type", rule.match_type),
                updates.get("match_value", rule.match_value),
            )
        except BadPattern as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
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


#: Enough rows to judge a rule by, few enough to read.
_SAMPLE_SIZE = 10


async def _rule_or_404(db: AsyncSession, rule_id: str, household_id: str):
    rule = (
        await db.execute(
            select(AutoCategorizationRule).where(
                AutoCategorizationRule.id == rule_id,
                AutoCategorizationRule.household_id == household_id,
            )
        )
    ).scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.get("/preview", response_model=RulePreviewResponse)
async def preview_all_rules(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """What running every enabled rule would change. Writes nothing."""
    matches = await preview_rules(db, household_id)
    return RulePreviewResponse(
        total=len(matches),
        sample=[RuleMatchResponse.model_validate(m, from_attributes=True)
                for m in matches[:_SAMPLE_SIZE]],
    )


@router.post("/preview", response_model=RulePreviewResponse)
async def preview_candidate_rule(
    body: RulePreviewRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """What a rule would claim, before you commit to it.

    The rule editor calls this while you type, so the match count answers
    the question you actually have -- does this pattern catch what I
    meant, and nothing else -- at the moment you are asking it, rather
    than after you have saved the rule and run it over everything.

    The category is not part of the question and is not accepted here:
    which transactions a rule claims depends only on the pattern.
    """
    matches = await preview_candidate(
        db,
        household_id,
        CandidateRule(
            match_field=body.match_field,
            match_type=body.match_type,
            match_value=body.match_value,
            category_id="",
        ),
    )
    return RulePreviewResponse(
        total=len(matches),
        sample=[RuleMatchResponse.model_validate(m, from_attributes=True)
                for m in matches[:_SAMPLE_SIZE]],
    )


@router.get("/{rule_id}/preview", response_model=RulePreviewResponse)
async def preview_one_rule(
    rule_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """What one rule would claim on its own.

    Scoped to this household before anything is matched, so a rule id
    from elsewhere finds nothing rather than someone else's transactions.
    """
    await _rule_or_404(db, rule_id, household_id)
    matches = await preview_rules(db, household_id, only_rule_id=rule_id)
    return RulePreviewResponse(
        total=len(matches),
        sample=[RuleMatchResponse.model_validate(m, from_attributes=True)
                for m in matches[:_SAMPLE_SIZE]],
    )


@router.post("/{rule_id}/apply")
async def apply_one_rule(
    rule_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Run a single rule. Until now it was every rule or none."""
    await _rule_or_404(db, rule_id, household_id)
    changed = await apply_rules(db, household_id, only_rule_id=rule_id)
    return {"categorized": changed}
