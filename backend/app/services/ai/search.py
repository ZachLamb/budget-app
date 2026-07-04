from __future__ import annotations

"""Question-aware deterministic fact search (model-free).

Matches the user's question terms against category and payee names, then
computes spend sums in SQL. The on-device model narrates these numbers; it
never computes them. Quoted phrases are kept whole; everything else is
tokenized with stopwords removed.
"""

import re
from datetime import date
from decimal import Decimal

from sqlalchemy import or_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Payee, Transaction
from app.services.ai.prompt_safety import DEFAULT_CATEGORY_MAX, DEFAULT_PAYEE_MAX, sanitize_user_text
from app.utils import escape_like

_STOPWORDS = frozenset(
    "a an and are be by can do for from how i in is it me much my of on or per "
    "put should so sum tell that the them these this to up was what when where "
    "which who will with you your all also any each into onto over past last "
    "month months week year today separate own category categories".split()
)
_MAX_TERMS = 6
_MAX_MATCHES_PER_KIND = 8


def extract_terms(q: str) -> list[str]:
    """Quoted phrases first, then words of length >= 4 minus stopwords."""
    q = q.strip()[:500]
    terms: list[str] = []
    for phrase in re.findall(r'"([^"]{3,80})"', q):
        terms.append(phrase.strip().lower())
    unquoted = re.sub(r'"[^"]*"', " ", q)
    for word in re.findall(r"[A-Za-z][A-Za-z'-]{3,}", unquoted):
        w = word.lower()
        if w not in _STOPWORDS and w not in terms:
            terms.append(w)
    return terms[:_MAX_TERMS]


def _month_start(today: date, months_back: int) -> date:
    total = today.year * 12 + (today.month - 1) - months_back
    return date(total // 12, total % 12 + 1, 1)


async def _sum_window(
    db: AsyncSession, household_id: str, start: date, end: date, *, category_id=None, payee_id=None
) -> tuple[float, int]:
    q = (
        select(func.coalesce(func.sum(Transaction.amount), 0), func.count(Transaction.id))
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.amount < 0)
        .where(Transaction.date >= start)
        .where(Transaction.date < end)
    )
    if category_id is not None:
        q = q.where(Transaction.category_id == category_id)
    if payee_id is not None:
        q = q.where(Transaction.payee_id == payee_id)
    total, count = (await db.execute(q)).one()
    return float(abs(Decimal(str(total)))), int(count)


async def compute_search_facts(db: AsyncSession, household_id: str, q: str) -> dict:
    """Match category/payee names against the question's terms and sum spend.

    Returns ``{"query_terms": [...], "matches": [...]}``. Each match has keys
    kind/id/name/this_month/last_month/three_month_total/txn_count. Names are
    sanitized (see ``prompt_safety``) since they are user-authored and will be
    interpolated into an LLM prompt by the caller. All sums are scoped to the
    household via the ``Account``/``CategoryGroup`` joins — no cross-household
    data can leak.
    """
    terms = extract_terms(q)
    if not terms:
        return {"query_terms": [], "matches": []}

    def ilike_any(col):
        return or_(*[col.ilike(f"%{escape_like(t)}%") for t in terms])

    cats = (await db.execute(
        select(Category.id, Category.name)
        .join(CategoryGroup, Category.group_id == CategoryGroup.id)
        .where(CategoryGroup.household_id == household_id)
        .where(ilike_any(Category.name))
        .limit(_MAX_MATCHES_PER_KIND)
    )).all()
    payees = (await db.execute(
        select(Payee.id, Payee.name)
        .where(Payee.household_id == household_id)
        .where(ilike_any(Payee.name))
        .limit(_MAX_MATCHES_PER_KIND)
    )).all()

    today = date.today()
    this_start = _month_start(today, 0)
    last_start = _month_start(today, 1)
    three_start = _month_start(today, 2)
    next_start = _month_start(today, -1)

    matches: list[dict] = []
    for kind, rows, max_len in (
        ("category", cats, DEFAULT_CATEGORY_MAX),
        ("payee", payees, DEFAULT_PAYEE_MAX),
    ):
        for row_id, name in rows:
            key = {"category_id": row_id} if kind == "category" else {"payee_id": row_id}
            this_m, this_n = await _sum_window(db, household_id, this_start, next_start, **key)
            last_m, _ = await _sum_window(db, household_id, last_start, this_start, **key)
            three_m, three_n = await _sum_window(db, household_id, three_start, next_start, **key)
            matches.append({
                "kind": kind, "id": row_id, "name": sanitize_user_text(name, max_len),
                "this_month": round(this_m, 2), "last_month": round(last_m, 2),
                "three_month_total": round(three_m, 2), "txn_count": this_n,
            })
    return {"query_terms": terms, "matches": matches}
