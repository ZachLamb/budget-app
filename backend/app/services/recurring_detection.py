"""Heuristic recurring / subscription candidates from transaction history."""

from __future__ import annotations

import calendar
import statistics
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    Transaction,
    Payee,
    RecurringTransaction,
    RecurringSuggestionDismissal,
)


def _add_months(d: date, months: int) -> date:
    m0 = d.month - 1 + months
    y = d.year + m0 // 12
    mo = m0 % 12 + 1
    last_day = calendar.monthrange(y, mo)[1]
    return date(y, mo, min(d.day, last_day))


def step_pay_date_forward(d: date, frequency: str) -> date:
    if frequency == "weekly":
        return d + timedelta(days=7)
    if frequency == "biweekly":
        return d + timedelta(days=14)
    if frequency == "monthly":
        return _add_months(d, 1)
    if frequency == "quarterly":
        return _add_months(d, 3)
    if frequency == "yearly":
        return _add_months(d, 12)
    raise ValueError(f"unsupported frequency: {frequency}")


def amounts_similar(a: Decimal, b: Decimal) -> bool:
    aa, bb = abs(a), abs(b)
    if aa == 0 and bb == 0:
        return True
    if aa == 0 or bb == 0:
        return False
    diff = abs(aa - bb)
    rel = diff / max(aa, bb)
    return rel <= Decimal("0.02") or diff <= Decimal("1.00")


def median_decimal(values: list[Decimal]) -> Decimal:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2:
        return s[mid]
    return (s[mid - 1] + s[mid]) / Decimal(2)


def infer_frequency_from_gap_days(gaps: list[int]) -> Optional[str]:
    if not gaps:
        return None
    m = statistics.median(gaps)
    if 5 <= m <= 9:
        return "weekly"
    if 12 <= m <= 16:
        return "biweekly"
    if 26 <= m <= 35:
        return "monthly"
    if 75 <= m <= 100:
        return "quarterly"
    if 350 <= m <= 380:
        return "yearly"
    return None


def confidence_score(occurrence_count: int, gaps: list[int], median_gap: float) -> float:
    base = min(1.0, occurrence_count / 5.0)
    if occurrence_count < 3:
        base *= 0.85
    if len(gaps) >= 2 and median_gap > 0:
        try:
            sd = statistics.pstdev(gaps)
            if sd > median_gap * 0.35:
                base *= 0.8
        except statistics.StatisticsError:
            pass
    return round(min(1.0, base), 2)


def cluster_rows_by_payee(
    rows: list[tuple[date, Decimal, Optional[str], Optional[str], str]],
) -> list[list[tuple[date, Decimal, Optional[str], Optional[str], str]]]:
    """Cluster (date, amount, category_id, account_id, payee_id) per payee by similar amounts."""
    by_payee: dict[str, list[tuple[date, Decimal, Optional[str], Optional[str], str]]] = defaultdict(list)
    for row in rows:
        by_payee[row[4]].append(row)

    out: list[list[tuple[date, Decimal, Optional[str], Optional[str], str]]] = []
    for payee_id, plist in by_payee.items():
        plist.sort(key=lambda r: r[0])
        clusters: list[list] = []
        for row in plist:
            placed = False
            for c in clusters:
                med = median_decimal([x[1] for x in c])
                if amounts_similar(row[1], med):
                    c.append(row)
                    placed = True
                    break
            if not placed:
                clusters.append([row])
        for c in clusters:
            if len(c) >= 2:
                out.append(c)
    return out


def mode_or_none(values: list[Optional[str]]) -> Optional[str]:
    filtered = [v for v in values if v]
    if not filtered:
        return None
    counts: dict[str, int] = {}
    for v in filtered:
        counts[v] = counts.get(v, 0) + 1
    return max(counts, key=counts.get)


def make_dedupe_key(payee_id: str, median_amount: Decimal) -> str:
    q = median_amount.quantize(Decimal("0.01"))
    return f"{payee_id}:{q}"


def project_next_date(last_charge: date, frequency: str, today: date) -> date:
    d = last_charge
    for _ in range(64):
        d = step_pay_date_forward(d, frequency)
        if d > today:
            return d
    return step_pay_date_forward(last_charge, frequency)


@dataclass
class RecurringSuggestionOut:
    dedupe_key: str
    payee_id: str
    payee_name: str
    suggested_amount: Decimal
    suggested_frequency: str
    occurrence_count: int
    last_date: date
    suggested_next_date: date
    confidence: float
    category_id: Optional[str]
    account_id: Optional[str]


async def suggest_recurring_from_transactions(
    db: AsyncSession,
    household_id: str,
    *,
    lookback_days: int = 90,
    today: Optional[date] = None,
) -> list[RecurringSuggestionOut]:
    today = today or date.today()
    since = today - timedelta(days=max(30, min(lookback_days, 730)))

    budget_accounts = (
        select(Account.id).where(
            Account.household_id == household_id,
            Account.is_budget_account.is_(True),
            Account.closed_at.is_(None),
        )
    )

    tx_result = await db.execute(
        select(
            Transaction.date,
            Transaction.amount,
            Transaction.category_id,
            Transaction.account_id,
            Transaction.payee_id,
        )
        .where(
            Transaction.account_id.in_(budget_accounts),
            Transaction.date >= since,
            Transaction.date <= today,
            Transaction.amount < 0,
            Transaction.parent_transaction_id.is_(None),
            Transaction.payee_id.isnot(None),
        )
    )
    raw_rows = tx_result.all()
    rows: list[tuple[date, Decimal, Optional[str], Optional[str], str]] = [
        (r[0], r[1], r[2], r[3], r[4]) for r in raw_rows if r[4]
    ]

    dismiss_result = await db.execute(
        select(RecurringSuggestionDismissal.dedupe_key).where(
            RecurringSuggestionDismissal.household_id == household_id
        )
    )
    dismissed = set(dismiss_result.scalars().all())

    rec_result = await db.execute(
        select(RecurringTransaction.payee_id, RecurringTransaction.amount).where(
            RecurringTransaction.household_id == household_id,
            RecurringTransaction.payee_id.isnot(None),
        )
    )
    existing_pairs = list(rec_result.all())

    def covered_by_recurring(payee_id: str, median_amt: Decimal) -> bool:
        for pid, amt in existing_pairs:
            if pid == payee_id and amounts_similar(median_amt, amt):
                return True
        return False

    clusters = cluster_rows_by_payee(rows)
    payee_ids = {c[0][4] for c in clusters}
    payee_names: dict[str, str] = {}
    if payee_ids:
        pr = await db.execute(select(Payee.id, Payee.name).where(Payee.id.in_(payee_ids)))
        payee_names = dict(pr.all())

    suggestions: list[RecurringSuggestionOut] = []
    for cluster in clusters:
        payee_id = cluster[0][4]
        dates = sorted({r[0] for r in cluster})
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        freq = infer_frequency_from_gap_days(gaps)
        if not freq:
            continue

        med_amt = median_decimal([r[1] for r in cluster])
        if covered_by_recurring(payee_id, med_amt):
            continue

        key = make_dedupe_key(payee_id, med_amt)
        if key in dismissed:
            continue

        last_d = max(r[0] for r in cluster)
        next_d = project_next_date(last_d, freq, today)
        med_gap = float(statistics.median(gaps)) if gaps else 0.0
        conf = confidence_score(len(cluster), gaps, med_gap)

        suggestions.append(
            RecurringSuggestionOut(
                dedupe_key=key,
                payee_id=payee_id,
                payee_name=payee_names.get(payee_id, "Unknown"),
                suggested_amount=med_amt,
                suggested_frequency=freq,
                occurrence_count=len(cluster),
                last_date=last_d,
                suggested_next_date=next_d,
                confidence=conf,
                category_id=mode_or_none([r[2] for r in cluster]),
                account_id=mode_or_none([r[3] for r in cluster]),
            )
        )

    suggestions.sort(key=lambda s: (-s.confidence, s.payee_name.lower()))
    return suggestions


def suggestion_to_api_dict(s: RecurringSuggestionOut) -> dict[str, Any]:
    return {
        "dedupe_key": s.dedupe_key,
        "payee_id": s.payee_id,
        "payee_name": s.payee_name,
        "suggested_amount": float(s.suggested_amount),
        "suggested_frequency": s.suggested_frequency,
        "occurrence_count": s.occurrence_count,
        "last_date": s.last_date.isoformat(),
        "suggested_next_date": s.suggested_next_date.isoformat(),
        "confidence": s.confidence,
        "category_id": s.category_id,
        "account_id": s.account_id,
    }
