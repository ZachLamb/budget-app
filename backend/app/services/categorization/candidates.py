from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, AutoCategorizationRule, Category, CategoryGroup, Payee, Transaction
from app.services.ai.prompt_safety import (
    DEFAULT_NOTES_MAX,
    DEFAULT_PAYEE_MAX,
    sanitize_user_text,
)
from app.utils import escape_like


def _rule_matches(rule: AutoCategorizationRule, payee_name: str, notes: str, amount: str) -> bool:
    target_value = ""
    if rule.match_field == "payee":
        target_value = payee_name
    elif rule.match_field == "notes":
        target_value = notes
    elif rule.match_field == "amount":
        target_value = amount

    if rule.match_type == "contains":
        return rule.match_value.lower() in target_value.lower()
    if rule.match_type == "exact":
        return rule.match_value.lower() == target_value.lower()
    if rule.match_type == "regex":
        try:
            return bool(re.search(rule.match_value, target_value, re.IGNORECASE))
        except re.error:
            return False
    return False


async def _load_rules(db: AsyncSession, household_id: str) -> list[AutoCategorizationRule]:
    rules_result = await db.execute(
        select(AutoCategorizationRule)
        .where(
            AutoCategorizationRule.household_id == household_id,
            AutoCategorizationRule.enabled.is_(True),
        )
        .order_by(AutoCategorizationRule.priority.desc())
    )
    return list(rules_result.scalars().all())


async def _payee_default_categories(
    db: AsyncSession, payee_ids: set[str]
) -> dict[str, str]:
    if not payee_ids:
        return {}
    result = await db.execute(
        select(Payee.id, Payee.default_category_id).where(Payee.id.in_(payee_ids))
    )
    out: dict[str, str] = {}
    for pid, cat_id in result.all():
        if cat_id:
            out[pid] = cat_id
    return out


async def _payee_history_modes(
    db: AsyncSession, household_id: str, payee_ids: set[str]
) -> dict[str, str]:
    """Most frequent past category per payee (categorized transactions only)."""
    if not payee_ids:
        return {}
    result = await db.execute(
        select(Transaction.payee_id, Transaction.category_id, func.count())
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Account.household_id == household_id,
            Transaction.payee_id.in_(payee_ids),
            Transaction.category_id.is_not(None),
            Transaction.parent_transaction_id.is_(None),
        )
        .group_by(Transaction.payee_id, Transaction.category_id)
    )
    counts: dict[str, dict[str, int]] = defaultdict(dict)
    for payee_id, category_id, count in result.all():
        if payee_id and category_id:
            counts[payee_id][category_id] = int(count)
    modes: dict[str, str] = {}
    for payee_id, by_cat in counts.items():
        modes[payee_id] = max(by_cat.items(), key=lambda kv: kv[1])[0]
    return modes


def _prefill_for_transaction(
    txn_id: str,
    payee_name: str,
    notes: str,
    amount: str,
    payee_id: Optional[str],
    rules: list[AutoCategorizationRule],
    payee_defaults: dict[str, str],
    payee_modes: dict[str, str],
) -> Optional[dict[str, str]]:
    for rule in rules:
        if _rule_matches(rule, payee_name, notes, amount):
            return {"transaction_id": txn_id, "category_id": rule.category_id}

    if payee_id:
        default_cat = payee_defaults.get(payee_id)
        if default_cat:
            return {"transaction_id": txn_id, "category_id": default_cat}
        mode_cat = payee_modes.get(payee_id)
        if mode_cat:
            return {"transaction_id": txn_id, "category_id": mode_cat}
    return None


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
    valid_category_ids = {cat.id for cat in all_categories}

    payee_ids = {t.payee_id for t in transactions if t.payee_id}
    payee_names: dict[str, str] = {}
    if payee_ids:
        p_result = await db.execute(select(Payee).where(Payee.id.in_(payee_ids)))
        for p in p_result.scalars().all():
            payee_names[p.id] = p.name

    rules = await _load_rules(db, household_id)
    payee_defaults = await _payee_default_categories(db, payee_ids)
    payee_modes = await _payee_history_modes(db, household_id, payee_ids)

    txn_list = []
    prefilled: list[dict[str, str]] = []
    for t in transactions:
        payee_raw = payee_names.get(t.payee_id, "Unknown") if t.payee_id else "Unknown"
        payee = sanitize_user_text(payee_raw, DEFAULT_PAYEE_MAX) or "Unknown"
        notes = sanitize_user_text(t.notes, DEFAULT_NOTES_MAX)
        amount = str(t.amount)
        txn_list.append(
            {
                "id": t.id,
                "payee": payee,
                "amount": amount,
                "date": t.date.isoformat(),
                "notes": notes,
            }
        )
        suggestion = _prefill_for_transaction(
            t.id,
            payee,
            notes or "",
            amount,
            t.payee_id,
            rules,
            payee_defaults,
            payee_modes,
        )
        if suggestion and suggestion["category_id"] in valid_category_ids:
            prefilled.append(suggestion)

    cat_list = [{"id": cat.id, "name": cat.name} for cat in all_categories]

    return {
        "transactions": txn_list,
        "categories": cat_list,
        "prefilled_suggestions": prefilled,
    }
