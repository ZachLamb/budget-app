from __future__ import annotations

import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, Payee, Account, AutoCategorizationRule


async def apply_rules(db: AsyncSession, household_id: str):
    """Apply auto-categorization rules to uncategorized transactions."""
    rules_result = await db.execute(
        select(AutoCategorizationRule)
        .where(
            AutoCategorizationRule.household_id == household_id,
            AutoCategorizationRule.enabled.is_(True),
        )
        .order_by(AutoCategorizationRule.priority.desc())
    )
    rules = rules_result.scalars().all()
    if not rules:
        return

    txn_result = await db.execute(
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.category_id.is_(None))
        .where(Transaction.parent_transaction_id.is_(None))
    )
    transactions = txn_result.scalars().all()

    payee_cache: dict[str, str] = {}

    for txn in transactions:
        for rule in rules:
            matched = False
            target_value = ""

            if rule.match_field == "payee" and txn.payee_id:
                if txn.payee_id not in payee_cache:
                    p_result = await db.execute(select(Payee.name).where(Payee.id == txn.payee_id))
                    payee_cache[txn.payee_id] = p_result.scalar_one_or_none() or ""
                target_value = payee_cache[txn.payee_id]
            elif rule.match_field == "notes":
                target_value = txn.notes or ""
            elif rule.match_field == "amount":
                target_value = str(txn.amount)

            if rule.match_type == "contains":
                matched = rule.match_value.lower() in target_value.lower()
            elif rule.match_type == "exact":
                matched = rule.match_value.lower() == target_value.lower()
            elif rule.match_type == "regex":
                try:
                    matched = bool(re.search(rule.match_value, target_value, re.IGNORECASE))
                except re.error:
                    continue

            if matched:
                txn.category_id = rule.category_id
                break
