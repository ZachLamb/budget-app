from __future__ import annotations

"""Validate advisor actions and issue confirmation tokens (no writes)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, CategoryGroup, Payee, Transaction
from app.services.ai.action_token import issue_action_token
from app.utils import escape_like

_ALLOWED = frozenset(
    {"add_transaction", "add_debt", "create_category", "bulk_recategorize"}
)
_MAX_AMOUNT = 1_000_000  # sanity cap — mirrors app/services/ai/action.py


def _parse_amount(data: dict) -> tuple[bool, float]:
    """Parse and range-check an untrusted LLM-proposed amount.

    Returns (ok, amount). On ok=False the caller should reject the proposal
    at prepare time with a recoverable {"ok": False, ...} response instead of
    letting a bad cast/value reach execute.
    """
    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return False, 0.0
    if amount <= 0 or amount > _MAX_AMOUNT:
        return False, 0.0
    return True, amount


async def _count_bulk_recategorize(
    db: AsyncSession,
    household_id: str,
    payee_match: str,
    category_name: str,
) -> tuple[bool, str, dict]:
    if len(payee_match) < 3:
        return False, "Payee match must be at least 3 characters.", {}

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
        return (
            False,
            f"No category named '{category_name}'. Create it first.",
            {},
        )

    esc = escape_like(payee_match)
    count = (
        await db.execute(
            select(func.count(Transaction.id))
            .join(Account, Transaction.account_id == Account.id)
            .join(Payee, Transaction.payee_id == Payee.id)
            .where(Account.household_id == household_id)
            .where(Payee.name.ilike(f"%{esc}%"))
            .limit(500)
        )
    ).scalar_one()
    if not count:
        return False, f"No transactions matched '{payee_match}'.", {}

    normalized = {"payee_match": payee_match, "category_name": category.name}
    txn_word = "transaction" if count == 1 else "transactions"
    preview = (
        f"Will move {count} {txn_word} matching '{payee_match}' "
        f"to '{category.name}'."
    )
    return True, preview, normalized


async def prepare_action(
    db: AsyncSession,
    household_id: str,
    action_type: str,
    data: dict,
) -> dict:
    """Validate an action proposal and issue a single-use confirmation token."""
    if action_type not in _ALLOWED:
        return {
            "ok": False,
            "confirmation_token": None,
            "preview": "Unsupported action type.",
            "normalized_data": {},
        }

    if action_type == "create_category":
        name = str(data.get("name", "")).strip()[:100]
        group_name = str(data.get("group_name", "") or "").strip()[:100]
        if not name:
            return {
                "ok": False,
                "confirmation_token": None,
                "preview": "Category name is required.",
                "normalized_data": {},
            }
        normalized = {"name": name}
        if group_name:
            normalized["group_name"] = group_name
        preview = f"Create category '{name}'"
        if group_name:
            preview += f" in group '{group_name}'"
        preview += "."
        token = await issue_action_token(household_id, action_type)
        return {
            "ok": True,
            "confirmation_token": token,
            "preview": preview,
            "normalized_data": normalized,
        }

    if action_type == "bulk_recategorize":
        payee_match = str(data.get("payee_match", "")).strip()[:200]
        category_name = str(data.get("category_name", "")).strip()[:100]
        if not category_name:
            return {
                "ok": False,
                "confirmation_token": None,
                "preview": "Category name is required.",
                "normalized_data": {},
            }
        ok, preview, normalized = await _count_bulk_recategorize(
            db, household_id, payee_match, category_name
        )
        if not ok:
            return {
                "ok": False,
                "confirmation_token": None,
                "preview": preview,
                "normalized_data": {},
            }
        token = await issue_action_token(household_id, action_type)
        return {
            "ok": True,
            "confirmation_token": token,
            "preview": preview,
            "normalized_data": normalized,
        }

    if action_type in ("add_transaction", "add_debt"):
        normalized = dict(data)
        if action_type == "add_transaction":
            amount_ok, amount = _parse_amount(data)
            if not amount_ok:
                return {
                    "ok": False,
                    "confirmation_token": None,
                    "preview": "Invalid amount.",
                    "normalized_data": {},
                }
            preview = (
                f"Add ${amount:.2f} transaction"
                f" to '{str(data.get('account_name', '')).strip()[:200]}'."
            )
        else:
            amount_ok, _amount = _parse_amount(data)
            if not amount_ok:
                return {
                    "ok": False,
                    "confirmation_token": None,
                    "preview": "Invalid amount.",
                    "normalized_data": {},
                }
            preview = (
                f"Create debt account '{str(data.get('account_name', 'Debt Account')).strip()[:200]}'."
            )
        token = await issue_action_token(household_id, action_type)
        return {
            "ok": True,
            "confirmation_token": token,
            "preview": preview,
            "normalized_data": normalized,
        }

    return {
        "ok": False,
        "confirmation_token": None,
        "preview": "Unsupported action type.",
        "normalized_data": {},
    }
