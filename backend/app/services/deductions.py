"""Aggregates deductible transactions and values them through the tax
engine.

This module used to multiply a total by a hand-entered marginal rate.
That produced wrong numbers, not merely imprecise ones: a personal
deduction below the standard deduction saves nothing, but the flat-rate
code reported a saving anyway. Valuation now runs through impact_of(),
which re-runs the real engine.

See docs/superpowers/specs/2026-09-19-tax-projection-engine-design.md.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Transaction
from app.schemas.deductions import DeductionLine, DeductionsSummaryResponse
from app.services.tax import (
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    UnknownTaxYearError,
    UnsupportedFilingStatusError,
    get_rates,
    impact_of,
    project,
)
from app.services.tax_assembly import build_tax_inputs

_CENTS = Decimal("0.01")
_ZERO = Decimal("0.00")


async def compute_deductions_summary(
    db: AsyncSession, household_id: str, year: int
) -> DeductionsSummaryResponse:
    result = await db.execute(
        select(Transaction, Category)
        .join(Category, Transaction.category_id == Category.id)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Category.deductible.is_(True),
            extract("year", Transaction.date) == year,
            CategoryGroup.household_id == household_id,
            Account.household_id == household_id,
        )
    )
    rows = result.all()

    totals: dict[tuple[str, str], Decimal] = defaultdict(lambda: _ZERO)
    grand_total = _ZERO
    business_total = _ZERO
    personal_total = _ZERO

    for txn, category in rows:
        pct = (
            txn.deduction_pct_override
            if txn.deduction_pct_override is not None
            else category.deduction_pct
        )
        # Expenses are stored as negative amounts throughout this app.
        # Negate so a deductible expense summarizes as a positive
        # deduction, while a refund/credit still nets out correctly --
        # do not use abs(), which would break netting.
        amount = (-txn.amount * pct / Decimal("100")).quantize(_CENTS)
        label = category.tax_line or category.name
        kind = category.deduction_kind
        totals[(label, kind)] += amount
        grand_total += amount
        if kind == "business_expense":
            business_total += amount
        else:
            personal_total += amount

    lines = [
        DeductionLine(tax_line=label, amount=amount, deduction_kind=kind)
        for (label, kind), amount in totals.items()
    ]

    savings, personal_value, standard, per_period = await _value_deductions(
        db, household_id, year, business_total, personal_total
    )

    return DeductionsSummaryResponse(
        year=year,
        lines=lines,
        total=grand_total,
        estimated_tax_savings=savings,
        suggested_withholding_reduction_per_period=per_period,
        business_total=business_total,
        personal_itemized_total=personal_total,
        personal_itemized_value=personal_value,
        standard_deduction=standard,
    )


async def _value_deductions(
    db: AsyncSession,
    household_id: str,
    year: int,
    business_total: Decimal,
    personal_total: Decimal,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None]:
    """Returns (total savings, personal value, standard deduction,
    per-period withholding adjustment). All None when the engine cannot
    run -- genuinely unknown, never a fabricated zero.

    A returned 0.00 IS an answer: it means those deductions are worth
    nothing this year.
    """
    try:
        rates = get_rates(year)
    except UnknownTaxYearError:
        return None, None, None, None

    assembled = await build_tax_inputs(db, household_id, year)
    if assembled.inputs is None:
        return None, None, None, None

    inputs = assembled.inputs
    try:
        baseline = project(inputs, rates, assembled.remaining_periods)

        business_value = (
            -impact_of(inputs, ExtraBusinessExpense(business_total), rates)
            if business_total > _ZERO else _ZERO
        )
        personal_value = (
            -impact_of(inputs, ExtraItemizedDeduction(personal_total), rates)
            if personal_total > _ZERO else _ZERO
        )
    except UnsupportedFilingStatusError:
        return None, None, None, None

    savings = (business_value + personal_value).quantize(_CENTS)

    # Resolves the spec's shape-preservation gap: the field survives, but
    # is now derived from the projection rather than from the dropped
    # manual withholding columns.
    per_period: Decimal | None = None
    if assembled.remaining_periods > 0 and baseline.refund_or_amount_due > _ZERO:
        per_period = (
            baseline.refund_or_amount_due / Decimal(assembled.remaining_periods)
        ).quantize(_CENTS)

    return savings, personal_value.quantize(_CENTS), baseline.standard_deduction, per_period
