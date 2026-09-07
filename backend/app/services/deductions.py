"""Aggregates deductible transactions into a per-tax-line summary, with an
optional estimated-tax-savings and withholding nudge driven by manually
entered TaxSettings. No IRS bracket logic — arithmetic on user-supplied
rates only. See docs/superpowers/specs/2026-09-05-tax-deductions-design.md.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, TaxSettings, Transaction
from app.schemas.deductions import DeductionLine, DeductionsSummaryResponse

_CENTS = Decimal("0.01")


async def compute_deductions_summary(db: AsyncSession, household_id: str, year: int) -> DeductionsSummaryResponse:
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

    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    grand_total = Decimal("0.00")
    for txn, category in rows:
        pct = txn.deduction_pct_override if txn.deduction_pct_override is not None else category.deduction_pct
        # Expenses are stored as negative amounts throughout this app (see
        # Transaction.amount usage elsewhere, e.g. transactions page). Negate
        # so a deductible expense summarizes as a positive deduction amount,
        # while a refund/credit (positive amount) still nets out correctly —
        # do not use abs(), which would break netting (spec: "Negative
        # transaction amounts (refunds/credits) ... net out normally").
        deductible_amount = (-txn.amount * pct / Decimal("100")).quantize(_CENTS)
        label = category.tax_line or category.name
        totals[label] += deductible_amount
        grand_total += deductible_amount

    lines = [DeductionLine(tax_line=label, amount=amount) for label, amount in totals.items()]

    settings_result = await db.execute(select(TaxSettings).where(TaxSettings.household_id == household_id))
    settings = settings_result.scalar_one_or_none()

    estimated_tax_savings: Decimal | None = None
    suggested_withholding_reduction_per_period: Decimal | None = None
    if settings and settings.marginal_federal_rate is not None and settings.marginal_state_rate is not None:
        combined_rate = (settings.marginal_federal_rate + settings.marginal_state_rate) / Decimal("100")
        estimated_tax_savings = (grand_total * combined_rate).quantize(_CENTS)
        if (
            settings.current_federal_withholding_per_period is not None
            and settings.remaining_pay_periods_this_year is not None
            and settings.remaining_pay_periods_this_year > 0
        ):
            suggested_withholding_reduction_per_period = (
                estimated_tax_savings / settings.remaining_pay_periods_this_year
            ).quantize(_CENTS)

    return DeductionsSummaryResponse(
        year=year,
        lines=lines,
        total=grand_total,
        estimated_tax_savings=estimated_tax_savings,
        suggested_withholding_reduction_per_period=suggested_withholding_reduction_per_period,
    )
