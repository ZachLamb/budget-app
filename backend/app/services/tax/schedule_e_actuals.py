"""Build a Schedule E result from the household's own transactions.

The engine has handled rental income, allowable expenses and the passive
activity loss limitation since it was written, and none of it ever ran:
the assembler passed `schedule_e=None`, because nothing in the data said
which income was rent.

Everything here is a sum of transactions the user actually recorded.
Nothing is annualised. A rental's income is lumpy -- a summer cabin
earns most of its year in ten weeks -- so scaling a part-year figure up
to twelve months would invent a number and, worse, invent it
confidently. The result therefore covers activity TO DATE, `through` says
through when, and the page says so where the figures are shown.

The consequence is deliberate and worth stating: mid-year, this makes
the tax estimate low, and it rises as bookings come in.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Transaction
from app.services.tax.inputs import ScheduleEResult

_CENTS = Decimal("0.01")
ZERO = Decimal("0.00")


@dataclass(frozen=True)
class ScheduleEActuals:
    """What was recorded, and how far through the year it reaches."""

    result: ScheduleEResult
    gross_rental_income: Decimal
    allowable_expenses: Decimal
    #: The latest rental transaction date counted. None when there are
    #: marked categories but nothing recorded in them yet -- which is a
    #: real state, not zero activity in disguise.
    through: date | None
    #: True when the household has marked at least one rental category.
    #: Without that, there is no rental to report and the engine is told
    #: `None` rather than a net of zero.
    configured: bool
    #: False when rental EXPENSES are marked but no income category is.
    #: A common half-finished setup -- and one that otherwise shows
    #: "Rental income $0.00" next to real expenses, which reads as a bug
    #: rather than as a marker nobody has set yet.
    has_income_category: bool = True


async def build_schedule_e(
    db: AsyncSession,
    household_id: str,
    year: int,
    *,
    active_participation: bool,
    suspended_loss_carryin: Decimal = ZERO,
) -> ScheduleEActuals | None:
    """Sum this year's rental activity. Returns None if there is none.

    `None` means "this household has no rental", which the engine must
    be able to tell apart from "this household has a rental that netted
    nothing" -- the second is a fact about the year, the first is the
    absence of the whole schedule.
    """
    income_cats = (
        await db.execute(
            select(Category.id)
            .join(CategoryGroup, Category.group_id == CategoryGroup.id)
            .where(
                CategoryGroup.household_id == household_id,
                Category.rental_income.is_(True),
            )
        )
    ).scalars().all()

    # The expense side was already identifiable before this module
    # existed; it is the same rule the Deductions page uses, so the two
    # cannot report different totals for the same transactions.
    expense_cats = (
        await db.execute(
            select(Category.id, Category.deduction_pct)
            .join(CategoryGroup, Category.group_id == CategoryGroup.id)
            .where(
                CategoryGroup.household_id == household_id,
                Category.deductible.is_(True),
                Category.deduction_kind == "business_expense",
            )
        )
    ).all()

    if not income_cats and not expense_cats:
        return None

    rows = (
        await db.execute(
            select(Transaction)
            .join(Account, Transaction.account_id == Account.id)
            .where(
                Account.household_id == household_id,
                Transaction.parent_transaction_id.is_(None),
                extract("year", Transaction.date) == year,
                Transaction.category_id.in_(
                    [*income_cats, *[c for c, _ in expense_cats]]
                ),
            )
        )
    ).scalars().all()

    pct_by_cat = {cat_id: pct for cat_id, pct in expense_cats}
    income_set = set(income_cats)

    gross = ZERO
    expenses = ZERO
    through: date | None = None

    for txn in rows:
        through = txn.date if through is None else max(through, txn.date)
        if txn.category_id in income_set:
            # Income is stored positive. A refund to a guest arrives as a
            # negative row in the same category and correctly nets off,
            # which is why this is a sum and not an abs().
            gross += txn.amount
        else:
            pct = (
                txn.deduction_pct_override
                if txn.deduction_pct_override is not None
                else pct_by_cat.get(txn.category_id, Decimal("100"))
            )
            # Expenses are stored negative throughout this app; negate so
            # the figure reads as a positive expense.
            expenses += (-txn.amount * pct / Decimal("100")).quantize(_CENTS)

    gross = gross.quantize(_CENTS)
    expenses = expenses.quantize(_CENTS)

    return ScheduleEActuals(
        result=ScheduleEResult(
            gross_rental_income=gross,
            allowable_expenses=expenses,
            net=(gross - expenses).quantize(_CENTS),
            active_participation=active_participation,
            suspended_loss_carryin=suspended_loss_carryin,
        ),
        gross_rental_income=gross,
        allowable_expenses=expenses,
        through=through,
        configured=True,
        has_income_category=bool(income_cats),
    )
