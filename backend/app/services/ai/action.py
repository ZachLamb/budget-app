from __future__ import annotations

"""Natural-language action parsing and execution.

Backs /parse-action and /execute-action. The route layer keeps the pydantic
request/response models; this service returns plain dicts.
"""

import json
import logging
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Payee, Transaction
from app.services.ai import llm_client

logger = logging.getLogger(__name__)

_MAX_AMOUNT = 1_000_000  # sanity cap — reject obviously bad LLM hallucinations


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


async def parse_action_message(message: str) -> dict[str, object]:
    """Parse a natural language message for a data-entry action.

    Returns a dict shaped for `ParseActionResponse`.
    """
    message = message.strip()[:500]
    today_str = date.today().isoformat()

    prompt = f"""Today's date is {today_str}.
A user typed the following message (contained between the --- markers):
---
{message}
---
If the message is a request to add financial data, extract it as structured JSON.
Supported actions:
- add_transaction: {{"action": "add_transaction", "account_name": "...", "payee_name": "...", "amount": 0.0, "date": "YYYY-MM-DD", "memo": "..."}}
- add_debt: {{"action": "add_debt", "account_name": "...", "amount": 0.0, "due_date": "YYYY-MM-DD", "payee_name": "..."}}
If no supported action is detected, return {{"action": null}}.
Return ONLY the JSON object, no other text."""

    response, _ = await llm_client.complete_with_source(prompt, json_format=True)
    empty = {"action_type": None, "data": None, "confirmation_text": ""}
    if not response:
        return empty

    try:
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        parsed = json.loads(text)
        action = parsed.get("action")

        if not action:
            return empty

        if action == "add_transaction":
            amount = parsed.get("amount", 0)
            payee = parsed.get("payee_name", "unknown payee")
            acct = parsed.get("account_name", "your account")
            dt = parsed.get("date", today_str)
            memo = parsed.get("memo", "")
            memo_str = f' with memo "{memo}"' if memo else ""
            confirmation = (
                f"I'd add a ${abs(float(amount)):.2f} transaction to '{payee}' "
                f"on {dt} in '{acct}'{memo_str}."
            )
        elif action == "add_debt":
            amount = parsed.get("amount", 0)
            payee = parsed.get("payee_name", "unknown creditor")
            acct = parsed.get("account_name", "debt account")
            due = parsed.get("due_date", "")
            due_str = f" due {due}" if due else ""
            confirmation = (
                f"I'd create a debt account '{acct}' for '{payee}' "
                f"with balance ${abs(float(amount)):.2f}{due_str}."
            )
        else:
            return empty

        return {
            "action_type": action,
            "data": {k: v for k, v in parsed.items() if k != "action"},
            "confirmation_text": confirmation,
        }
    except Exception:
        return empty


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

    return {"success": False, "message": "Unknown action type."}
