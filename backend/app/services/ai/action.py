from __future__ import annotations

"""Natural-language action execution (parse route removed; execute stays for tokens)."""

import logging
import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Payee, Transaction
from app.utils import escape_like

logger = logging.getLogger(__name__)

_MAX_AMOUNT = 1_000_000  # sanity cap — reject obviously bad values


async def _find_account_for_execute_transaction(
    db: AsyncSession,
    household_id: str,
    account_name: str,
) -> Optional[Account]:
    """Resolve account by name: exact (case-insensitive), then shortest prefix, then shortest substring."""
    from app.utils import escape_like

    norm = account_name.strip()
    if not norm:
        return None
    esc = escape_like(norm)
    q_base = (
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.closed_at.is_(None))
    )
    r = await db.execute(q_base.where(func.lower(Account.name) == norm.lower()).limit(1))
    acct = r.scalar_one_or_none()
    if acct:
        return acct
    r = await db.execute(
        q_base.where(Account.name.ilike(f"{esc}%")).order_by(func.length(Account.name)).limit(1)
    )
    acct = r.scalar_one_or_none()
    if acct:
        return acct
    r = await db.execute(
        q_base.where(Account.name.ilike(f"%{esc}%")).order_by(func.length(Account.name)).limit(1)
    )
    return r.scalar_one_or_none()


async def execute_parsed_action(
    db: AsyncSession,
    household_id: str,
    action_type: str,
    data: dict,
) -> dict[str, object]:
    """Execute a parsed action intent. Returns dict shaped for ExecuteActionResponse."""
    if action_type == "add_transaction":
        account_name = str(data.get("account_name", "")).strip()[:200]
        payee_name = str(data.get("payee_name", "")).strip()[:200]
        try:
            amount = float(data.get("amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid amount")
        if amount <= 0 or amount > _MAX_AMOUNT:
            raise HTTPException(400, f"Amount must be between $0.01 and ${_MAX_AMOUNT:,}")
        txn_date = data.get("date") or date.today().isoformat()
        memo = str(data.get("memo", "")).strip()[:500]

        account = await _find_account_for_execute_transaction(db, household_id, account_name)
        if not account:
            acct_result = await db.execute(
                select(Account)
                .where(Account.household_id == household_id)
                .where(Account.is_budget_account.is_(True))
                .where(Account.closed_at.is_(None))
                .limit(1)
            )
            account = acct_result.scalar_one_or_none()
        if not account:
            return {"success": False, "message": "No matching account found."}

        payee_result = await db.execute(
            select(Payee)
            .where(Payee.household_id == household_id)
            .where(Payee.name.ilike(payee_name))
            .limit(1)
        )
        payee = payee_result.scalar_one_or_none()
        if not payee and payee_name:
            payee = Payee(household_id=household_id, name=payee_name)
            db.add(payee)
            await db.flush()

        try:
            txn_date_parsed = date.fromisoformat(str(txn_date))
        except Exception:
            txn_date_parsed = date.today()

        txn = Transaction(
            account_id=account.id,
            payee_id=payee.id if payee else None,
            amount=Decimal(str(-abs(amount))),
            date=txn_date_parsed,
            notes=memo or None,
            cleared=False,
        )
        db.add(txn)
        await db.commit()
        return {
            "success": True,
            "message": f"Added ${abs(amount):.2f} transaction to '{account.name}'.",
        }

    elif action_type == "add_debt":
        account_name = str(data.get("account_name", "Debt Account")).strip()[:200]
        payee_name = str(data.get("payee_name", "")).strip()[:200]
        try:
            amount = float(data.get("amount", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid amount")
        if amount <= 0 or amount > _MAX_AMOUNT:
            raise HTTPException(400, f"Amount must be between $0.01 and ${_MAX_AMOUNT:,}")
        due_date = data.get("due_date")

        new_account = Account(
            household_id=household_id,
            name=account_name,
            account_type="loan",
            is_budget_account=True,
            institution=payee_name or None,
        )
        db.add(new_account)
        await db.flush()

        if amount > 0:
            txn = Transaction(
                account_id=new_account.id,
                date=date.today(),
                amount=Decimal(str(-abs(amount))),
                notes=f"Opening balance — due {due_date}" if due_date else "Opening balance",
                cleared=True,
            )
            db.add(txn)

        await db.commit()
        return {
            "success": True,
            "message": f"Created debt account '{account_name}' with balance ${abs(amount):.2f}.",
        }

    elif action_type == "create_category":
        name = str(data.get("name", "")).strip()[:100]
        group_name = str(data.get("group_name", "") or "").strip()[:100]
        if not name:
            return {"success": False, "message": "Category name is required."}

        existing = (
            await db.execute(
                select(Category)
                .join(CategoryGroup, Category.group_id == CategoryGroup.id)
                .where(CategoryGroup.household_id == household_id)
                .where(func.lower(Category.name) == name.lower())
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing:
            return {
                "success": True,
                "message": f"Category '{existing.name}' already exists.",
            }

        target_group_name = group_name or "Other"
        group = (
            await db.execute(
                select(CategoryGroup)
                .where(CategoryGroup.household_id == household_id)
                .where(func.lower(CategoryGroup.name) == target_group_name.lower())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not group:
            group = CategoryGroup(
                id=str(uuid.uuid4()),
                household_id=household_id,
                name=target_group_name,
            )
            db.add(group)
            await db.flush()

        db.add(
            Category(
                id=str(uuid.uuid4()),
                group_id=group.id,
                name=name,
            )
        )
        await db.commit()
        return {
            "success": True,
            "message": f"Created category '{name}' in '{group.name}'.",
        }

    elif action_type == "bulk_recategorize":
        payee_match = str(data.get("payee_match", "")).strip()[:200]
        category_name = str(data.get("category_name", "")).strip()[:100]
        if len(payee_match) < 3:
            return {
                "success": False,
                "message": "Payee match must be at least 3 characters.",
            }

        category = (
            await db.execute(
                select(Category)
                .join(CategoryGroup, Category.group_id == CategoryGroup.id)
                .where(CategoryGroup.household_id == household_id)
                .where(func.lower(Category.name) == category_name.lower())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not category:
            return {
                "success": False,
                "message": f"No category named '{category_name}'. Create it first.",
            }

        esc = escape_like(payee_match)
        txn_ids = (
            await db.execute(
                select(Transaction.id)
                .join(Account, Transaction.account_id == Account.id)
                .join(Payee, Transaction.payee_id == Payee.id)
                .where(Account.household_id == household_id)
                .where(Payee.name.ilike(f"%{esc}%"))
                .limit(500)
            )
        ).scalars().all()
        if not txn_ids:
            return {
                "success": False,
                "message": f"No transactions matched '{payee_match}'.",
            }

        await db.execute(
            update(Transaction)
            .where(Transaction.id.in_(txn_ids))
            .values(category_id=category.id)
        )
        await db.commit()
        n = len(txn_ids)
        txn_word = "transaction" if n == 1 else "transactions"
        return {
            "success": True,
            "message": f"Moved {n} {txn_word} to '{category.name}'.",
        }

    return {"success": False, "message": "Unknown action type."}
