from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Payee, Transaction
from app.services.ai.prompt_safety import (
    DEFAULT_NOTES_MAX,
    DEFAULT_PAYEE_MAX,
    sanitize_user_text,
)
from app.utils import escape_like


async def fetch_categorize_candidates(
    db: AsyncSession,
    household_id: str,
    *,
    account_id: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    limit: int = 50,
) -> dict[str, object]:
    """Uncategorized transactions + category list for client-side LLM (no model call)."""
    lim = max(1, min(limit, 50))
    q = (
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.category_id.is_(None))
        .where(Transaction.parent_transaction_id.is_(None))
    )
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if date_from:
        q = q.where(Transaction.date >= date_from)
    if date_to:
        q = q.where(Transaction.date <= date_to)
    if search and search.strip():
        escaped = escape_like(search.strip())
        q = q.outerjoin(Payee, Transaction.payee_id == Payee.id).where(
            or_(Payee.name.ilike(f"%{escaped}%"), Transaction.notes.ilike(f"%{escaped}%"))
        )

    txn_result = await db.execute(q.order_by(desc(Transaction.date)).limit(lim))
    transactions = txn_result.scalars().all()

    categories_result = await db.execute(
        select(Category).join(CategoryGroup).where(CategoryGroup.household_id == household_id)
    )
    all_categories = categories_result.scalars().all()

    payee_ids = {t.payee_id for t in transactions if t.payee_id}
    payee_names: dict[str, str] = {}
    if payee_ids:
        p_result = await db.execute(select(Payee).where(Payee.id.in_(payee_ids)))
        for p in p_result.scalars().all():
            payee_names[p.id] = p.name

    txn_list = []
    for t in transactions:
        payee_raw = payee_names.get(t.payee_id, "Unknown") if t.payee_id else "Unknown"
        txn_list.append(
            {
                "id": t.id,
                "payee": sanitize_user_text(payee_raw, DEFAULT_PAYEE_MAX) or "Unknown",
                "amount": str(t.amount),
                "date": t.date.isoformat(),
                "notes": sanitize_user_text(t.notes, DEFAULT_NOTES_MAX),
            }
        )

    cat_list = [{"id": cat.id, "name": cat.name} for cat in all_categories]

    return {"transactions": txn_list, "categories": cat_list}
