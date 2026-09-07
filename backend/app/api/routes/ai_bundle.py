"""Export/import bundles for running your own model over your own data.

Two files form the contract:

- **export** (``GET /api/ai-bundle/export``) — what you hand to a local model.
  ``scope=working_set`` is a compact slice sized for a local context window;
  ``scope=full`` is everything, for offline analysis.
- **suggestions** (``POST /api/ai-bundle/import/{preview,apply}``) — what the
  model produces and you upload back.

Why files at all, when the web app can already call a local server directly?
A file round-trip needs no network path between the browser and the model, so
it works with any tool (LM Studio, a script, a notebook) and never depends on
CORS, CSP, or local-network permissions. Nothing leaves the machine.

Security notes:
- Every id in an uploaded file is re-validated against the caller's household
  before it is written. A suggestions file is untrusted input — it is not
  proof of ownership, and a model (or a tampered file) naming another
  household's category id must not be able to move data across households.
- ``preview`` is side-effect free, so the UI can show exactly what would
  change before anything is written.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_household_id
from app.database import get_db
from app.models import (
    Account,
    BudgetAssignment,
    Category,
    CategoryGroup,
    Payee,
    AutoCategorizationRule,
    Transaction,
)

router = APIRouter()
logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
EXPORT_KIND = "snacksbudget.export"
SUGGESTIONS_KIND = "snacksbudget.suggestions"

# Caps keep a working-set export inside a local model's context window and
# bound the work an import can do in one request.
WORKING_SET_TXN_LIMIT = 500
WORKING_SET_EXAMPLE_LIMIT = 100
MAX_SUGGESTIONS_PER_KIND = 2000


def _money(value: Optional[Decimal]) -> Optional[float]:
    return float(value) if value is not None else None


# ── Export ───────────────────────────────────────────────────────────────────


async def _categories_for(db: AsyncSession, household_id: str) -> list[dict[str, Any]]:
    result = await db.execute(
        select(Category, CategoryGroup)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
        .order_by(CategoryGroup.sort_order, Category.sort_order)
    )
    return [
        {
            "id": c.id,
            "name": c.name,
            "group": g.name,
            "is_income": g.is_income,
        }
        for c, g in result.all()
    ]


def _txn_dict(txn: Transaction, payee_names: dict[str, str]) -> dict[str, Any]:
    return {
        "id": txn.id,
        "date": txn.date.isoformat() if txn.date else None,
        "amount": _money(txn.amount),
        "payee_id": txn.payee_id,
        "payee": payee_names.get(txn.payee_id or "", None),
        "category_id": txn.category_id,
        "notes": txn.notes,
    }


@router.get("/export")
async def export_bundle(
    scope: Literal["working_set", "full"] = Query(
        "working_set",
        description=(
            "working_set: uncategorized/recent transactions plus categories and "
            "examples, sized for a local model. full: every transaction."
        ),
    ),
    months: int = Query(3, ge=1, le=120, description="How far back to include."),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Build a bundle to hand to a local model."""
    since = date.today() - timedelta(days=months * 31)

    payee_rows = await db.execute(select(Payee).where(Payee.household_id == household_id))
    payees = payee_rows.scalars().all()
    payee_names = {p.id: p.name for p in payees}

    categories = await _categories_for(db, household_id)

    base = (
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id, Transaction.date >= since)
        .order_by(Transaction.date.desc())
    )

    bundle: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": EXPORT_KIND,
        "scope": scope,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "months": months,
        "categories": categories,
        "payees": [
            {"id": p.id, "name": p.name, "default_category_id": p.default_category_id}
            for p in payees
        ],
    }

    if scope == "working_set":
        # The model's job is the uncategorized ones; the categorized ones are
        # included separately as few-shot examples of this household's habits.
        todo = await db.execute(
            base.where(Transaction.category_id.is_(None)).limit(WORKING_SET_TXN_LIMIT)
        )
        examples = await db.execute(
            base.where(Transaction.category_id.is_not(None)).limit(WORKING_SET_EXAMPLE_LIMIT)
        )
        bundle["transactions"] = [
            _txn_dict(t, payee_names) for t in todo.scalars().all()
        ]
        bundle["examples"] = [
            _txn_dict(t, payee_names) for t in examples.scalars().all()
        ]
    else:
        rows = await db.execute(base)
        bundle["transactions"] = [
            _txn_dict(t, payee_names) for t in rows.scalars().all()
        ]
        rules = await db.execute(select(AutoCategorizationRule).where(AutoCategorizationRule.household_id == household_id))
        bundle["rules"] = [
            {
                "id": r.id,
                "match_field": r.match_field,
                "match_type": r.match_type,
                "match_value": r.match_value,
                "category_id": r.category_id,
                "enabled": r.enabled,
            }
            for r in rules.scalars().all()
        ]
        budgets = await db.execute(
            select(BudgetAssignment).where(BudgetAssignment.household_id == household_id)
        )
        bundle["budgets"] = [
            {
                "category_id": b.category_id,
                "month": b.month,
                "assigned_amount": _money(b.assigned_amount),
            }
            for b in budgets.scalars().all()
        ]

    bundle["instructions"] = {
        "return_kind": SUGGESTIONS_KIND,
        "schema_version": SCHEMA_VERSION,
        "how": (
            "Return a JSON object with kind='snacksbudget.suggestions' and any of: "
            "categorizations[{transaction_id, category_id}], "
            "payees[{payee_id, name}], "
            "budgets[{category_id, month, assigned_amount}], "
            "rules[{match_field, match_type, match_value, category_id}]. "
            "Use only ids present in this file. "
            "Every suggestion may also carry confidence (0-1), a short reason, "
            "and source (which model produced it) — these let the app "
            "auto-apply what you are sure about and queue the rest for review."
        ),
    }
    return bundle


# ── Import ───────────────────────────────────────────────────────────────────


class Attribution(BaseModel):
    """Per-suggestion provenance, so a bundle can mix models.

    Chrome's Gemini Nano can settle easy cases on-device in the browser while a
    larger local model handles ambiguous ones; both write into the same file.
    Keeping confidence and source per suggestion (rather than per file) is what
    lets the UI auto-apply the safe ones, queue the rest for review, and show
    the user which model proposed what.

    ``reason`` is free text from a model — it is display-only and must never be
    rendered as HTML or used for any authorization decision.
    """

    confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    reason: Optional[str] = Field(None, max_length=500)
    source: Optional[str] = Field(
        None,
        max_length=40,
        description="Which model proposed this, e.g. 'nano', 'lm-studio', 'rule'.",
    )


class CategorizationSuggestion(Attribution):
    transaction_id: str = Field(..., max_length=36)
    category_id: str = Field(..., max_length=36)


class PayeeSuggestion(Attribution):
    payee_id: str = Field(..., max_length=36)
    name: str = Field(..., min_length=1, max_length=255)


class BudgetSuggestion(Attribution):
    category_id: str = Field(..., max_length=36)
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    assigned_amount: Decimal = Field(..., ge=0, le=Decimal("99999999.99"))


class RuleSuggestion(Attribution):
    match_field: Literal["payee", "amount", "notes"]
    match_type: Literal["contains", "exact", "regex"]
    match_value: str = Field(..., min_length=1, max_length=500)
    category_id: str = Field(..., max_length=36)


class SuggestionsBundle(BaseModel):
    kind: str = Field(..., max_length=64)
    schema_version: int = 1
    categorizations: list[CategorizationSuggestion] = Field(
        default_factory=list, max_length=MAX_SUGGESTIONS_PER_KIND
    )
    payees: list[PayeeSuggestion] = Field(
        default_factory=list, max_length=MAX_SUGGESTIONS_PER_KIND
    )
    budgets: list[BudgetSuggestion] = Field(
        default_factory=list, max_length=MAX_SUGGESTIONS_PER_KIND
    )
    rules: list[RuleSuggestion] = Field(
        default_factory=list, max_length=MAX_SUGGESTIONS_PER_KIND
    )


class ImportReport(BaseModel):
    """What was (or would be) applied, plus why anything was skipped."""

    applied: dict[str, int]
    skipped: dict[str, int]
    """Valid, owned suggestions held back only by ``min_confidence``. These are
    the ones worth showing the user for manual review — unlike ``skipped``,
    nothing is wrong with them."""
    below_threshold: dict[str, int]
    warnings: list[str]
    dry_run: bool


async def _owned_category_ids(db: AsyncSession, household_id: str) -> set[str]:
    rows = await db.execute(
        select(Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
    )
    return set(rows.scalars().all())


async def _apply_bundle(
    data: SuggestionsBundle,
    household_id: str,
    db: AsyncSession,
    *,
    dry_run: bool,
    min_confidence: float = 0.0,
) -> ImportReport:
    if data.kind != SUGGESTIONS_KIND:
        raise HTTPException(
            status_code=400,
            detail=f"Unexpected file kind {data.kind!r}; expected {SUGGESTIONS_KIND!r}",
        )
    if data.schema_version != SCHEMA_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported schema_version {data.schema_version}",
        )

    applied = {"categorizations": 0, "payees": 0, "budgets": 0, "rules": 0}
    skipped = {"categorizations": 0, "payees": 0, "budgets": 0, "rules": 0}
    below_threshold = {"categorizations": 0, "payees": 0, "budgets": 0, "rules": 0}
    warnings: list[str] = []

    def held_back(kind: str, s: Attribution) -> bool:
        """True if a valid suggestion is below the caller's confidence bar.

        An absent confidence is treated as unrated and always passes, so files
        from tools that don't score their output still work.
        """
        if min_confidence <= 0.0 or s.confidence is None:
            return False
        if s.confidence >= min_confidence:
            return False
        below_threshold[kind] += 1
        return True

    # Ownership is resolved once up front; every id in the file is checked
    # against these sets. An id the household doesn't own is skipped, never
    # written — the file is untrusted regardless of who generated it.
    owned_categories = await _owned_category_ids(db, household_id)

    # ── categorizations ──
    if data.categorizations:
        ids = {s.transaction_id for s in data.categorizations}
        rows = await db.execute(
            select(Transaction)
            .join(Account, Transaction.account_id == Account.id)
            .where(Transaction.id.in_(ids), Account.household_id == household_id)
        )
        owned_txns = {t.id: t for t in rows.scalars().all()}
        for s in data.categorizations:
            txn = owned_txns.get(s.transaction_id)
            if txn is None or s.category_id not in owned_categories:
                skipped["categorizations"] += 1
                continue
            if held_back("categorizations", s):
                continue
            if not dry_run:
                txn.category_id = s.category_id
            applied["categorizations"] += 1

    # ── payee renames ──
    if data.payees:
        ids = {s.payee_id for s in data.payees}
        rows = await db.execute(
            select(Payee).where(Payee.id.in_(ids), Payee.household_id == household_id)
        )
        owned_payees = {p.id: p for p in rows.scalars().all()}
        for s in data.payees:
            payee = owned_payees.get(s.payee_id)
            if payee is None:
                skipped["payees"] += 1
                continue
            if held_back("payees", s):
                continue
            if not dry_run:
                payee.name = s.name
            applied["payees"] += 1

    # ── budget assignments ──
    if data.budgets:
        for s in data.budgets:
            if s.category_id not in owned_categories:
                skipped["budgets"] += 1
                continue
            if held_back("budgets", s):
                continue
            existing = await db.execute(
                select(BudgetAssignment).where(
                    BudgetAssignment.household_id == household_id,
                    BudgetAssignment.category_id == s.category_id,
                    BudgetAssignment.month == s.month,
                )
            )
            row = existing.scalar_one_or_none()
            if not dry_run:
                if row is None:
                    db.add(
                        BudgetAssignment(
                            household_id=household_id,
                            category_id=s.category_id,
                            month=s.month,
                            assigned_amount=s.assigned_amount,
                        )
                    )
                else:
                    row.assigned_amount = s.assigned_amount
            applied["budgets"] += 1

    # ── rules ──
    if data.rules:
        for s in data.rules:
            if s.category_id not in owned_categories:
                skipped["rules"] += 1
                continue
            if held_back("rules", s):
                continue
            if not dry_run:
                db.add(
                    AutoCategorizationRule(
                        household_id=household_id,
                        match_field=s.match_field,
                        match_type=s.match_type,
                        match_value=s.match_value,
                        category_id=s.category_id,
                        # Marks provenance so these are distinguishable from
                        # rules the user wrote by hand.
                        source="llm_suggested",
                        enabled=True,
                    )
                )
            applied["rules"] += 1

    total_skipped = sum(skipped.values())
    if total_skipped:
        warnings.append(
            f"{total_skipped} suggestion(s) referenced ids that don't belong to "
            "your household and were ignored."
        )

    if dry_run:
        await db.rollback()
    else:
        await db.commit()

    total_held = sum(below_threshold.values())
    if total_held:
        warnings.append(
            f"{total_held} suggestion(s) scored below the confidence threshold "
            "and were left for you to review."
        )

    return ImportReport(
        applied=applied,
        skipped=skipped,
        below_threshold=below_threshold,
        warnings=warnings,
        dry_run=dry_run,
    )


@router.post("/import/preview", response_model=ImportReport)
async def preview_import(
    data: SuggestionsBundle,
    min_confidence: float = Query(0.0, ge=0.0, le=1.0),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> ImportReport:
    """Validate a suggestions file and report what would change. Writes nothing."""
    return await _apply_bundle(
        data, household_id, db, dry_run=True, min_confidence=min_confidence
    )


@router.post("/import/apply", response_model=ImportReport)
async def apply_import(
    data: SuggestionsBundle,
    min_confidence: float = Query(
        0.0,
        ge=0.0,
        le=1.0,
        description=(
            "Only apply suggestions scoring at or above this. Lets a triage "
            "model auto-apply what it is sure about and leave the rest for "
            "review. Unrated suggestions always pass."
        ),
    ),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
) -> ImportReport:
    """Apply a suggestions file."""
    return await _apply_bundle(
        data, household_id, db, dry_run=False, min_confidence=min_confidence
    )
