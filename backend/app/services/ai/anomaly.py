from __future__ import annotations

"""Deterministic 'unusual transaction' detection (model-free).

Flags current-month expense transactions whose absolute amount is at least
``ANOMALY_RATIO`` times the trailing-3-month mean expense for the same category.
Every threshold is a server-side constant; no LLM output is involved, so no
flagged number can originate from the model.

Aggregation mirrors ``app.services.ai.budget.compute_spending_patterns``: a
budget-account scalar subquery, ``Transaction.amount < 0`` for expenses, a
``Category`` join, and a per-month ``extract("year"/"month")`` loop (rather than
``func.row(...).in_(...)`` tuple matching, which is not portable across the dev
SQLite and prod databases).
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, Payee, Transaction

# Server-side detection knobs — never client-supplied.
ANOMALY_RATIO = 3.0
MIN_HISTORY_COUNT = 3
MIN_AMOUNT = Decimal("25")


async def compute_anomaly_facts(
    db: AsyncSession, household_id: str
) -> dict[str, object]:
    """Deterministically flagged unusual expense transactions for the household.

    Returns ``{"anomalies": [...]}`` shaped for ``app.schemas.facts.AnomalyFacts``.
    A current-month expense is flagged when, for its category, there are at least
    ``MIN_HISTORY_COUNT`` baseline expenses over the trailing 3 full months, the
    baseline mean is positive (divide-by-zero guard), the charge clears the
    ``MIN_AMOUNT`` floor, and ``abs(amount) / mean >= ANOMALY_RATIO``. Transfers
    and uncategorized rows are excluded.
    """
    today = date.today()

    # Trailing 3 full months (current month excluded) for the baseline window.
    baseline_keys: list[tuple[int, int]] = []
    for i in range(3, 0, -1):
        total = today.month - 1 - i
        year = today.year + total // 12
        month = total % 12 + 1
        baseline_keys.append((year, month))

    budget_account_subq = (
        select(Account.id)
        .where(Account.household_id == household_id)
        .where(Account.is_budget_account.is_(True))
        .where(Account.closed_at.is_(None))
        .scalar_subquery()
    )

    # Baseline: sum(abs(expense)) and count per category, summed across the 3
    # months via the proven per-month loop. Keyed by category name (as in
    # compute_spending_patterns); the budget-account subquery scopes to the
    # household so only this household's categories appear.
    baseline_sum: dict[str, float] = {}
    baseline_count: dict[str, int] = {}
    for year_num, month_num in baseline_keys:
        rows = await db.execute(
            select(
                Category.name,
                func.sum(func.abs(Transaction.amount)),
                func.count(Transaction.id),
            )
            .join(Transaction, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_(budget_account_subq),
                extract("year", Transaction.date) == year_num,
                extract("month", Transaction.date) == month_num,
                Transaction.amount < 0,
                Transaction.category_id.isnot(None),
                Transaction.transfer_pair_id.is_(None),
            )
            .group_by(Category.name)
        )
        for name, total, count in rows.all():
            baseline_sum[name] = baseline_sum.get(name, 0.0) + float(total or 0)
            baseline_count[name] = baseline_count.get(name, 0) + int(count or 0)

    # Candidates: current-month expenses (with category + optional payee name).
    candidate_rows = await db.execute(
        select(Transaction, Category.name, Payee.name)
        .join(Category, Transaction.category_id == Category.id)
        .outerjoin(Payee, Transaction.payee_id == Payee.id)
        .where(
            Transaction.account_id.in_(budget_account_subq),
            extract("year", Transaction.date) == today.year,
            extract("month", Transaction.date) == today.month,
            Transaction.amount < 0,
            Transaction.category_id.isnot(None),
            Transaction.transfer_pair_id.is_(None),
        )
    )

    anomalies: list[dict[str, object]] = []
    for txn, cat_name, payee_name in candidate_rows.all():
        count = baseline_count.get(cat_name, 0)
        if count < MIN_HISTORY_COUNT:
            continue
        mean = baseline_sum.get(cat_name, 0.0) / count
        if mean <= 0:  # divide-by-zero / degenerate-baseline guard
            continue
        amount = abs(Decimal(str(txn.amount)))
        if amount < MIN_AMOUNT:
            continue
        ratio = float(amount) / mean
        if ratio < ANOMALY_RATIO:
            continue
        anomalies.append(
            {
                "transaction_id": str(txn.id),
                "category": cat_name,
                "amount": float(txn.amount),
                "category_avg": round(mean, 2),
                "ratio": round(ratio, 2),
                "date": txn.date.isoformat(),
                "payee": payee_name,
            }
        )

    anomalies.sort(key=lambda a: a["ratio"], reverse=True)
    return {"anomalies": anomalies[:20]}
