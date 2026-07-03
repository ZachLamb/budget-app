from __future__ import annotations

"""Per-account debt facts for the rate-suggestion pipeline (model-free).

Deterministic aggregates only — there is intentionally NO LLM call here. The
debt-account filter mirrors ``app.api.routes.debt.list_debt_accounts`` (reusing
its ``DEBT_TYPES`` set and the ``_compute_balances`` helper) so these grounded
facts stay consistent with what the user sees on the debt tab.

``has_apr`` / ``has_min_payment`` flag which accounts are missing data, so the
downstream pipeline only ever suggests values for fields the user hasn't set.
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.accounts import _compute_balances
from app.api.routes.debt import DEBT_TYPES
from app.models import Account


async def compute_debt_facts(db: AsyncSession, household_id: str) -> dict[str, object]:
    """Return deterministic per-account debt facts for the household.

    Shaped for ``app.schemas.facts.DebtFacts``: ``{"accounts": [ {...} ]}`` where
    each row carries ``account_id``, ``name``, ``type``, ``balance`` and the
    ``has_apr`` / ``has_min_payment`` flags plus the current values (or ``None``).
    """
    result = await db.execute(
        select(Account)
        .where(Account.household_id == household_id)
        .where(Account.account_type.in_(DEBT_TYPES))
        .where(Account.closed_at.is_(None))
    )
    accounts = result.scalars().all()
    balances = await _compute_balances(db, accounts)

    rows: list[dict[str, object]] = []
    for a in accounts:
        apr = None if a.interest_rate is None else float(a.interest_rate)
        min_payment = None if a.minimum_payment is None else float(a.minimum_payment)
        rows.append(
            {
                "account_id": str(a.id),
                "name": a.name,
                "type": a.account_type,
                "balance": float(balances.get(a.id, Decimal("0"))),
                "has_apr": apr is not None,
                "has_min_payment": min_payment is not None,
                "current_apr": apr,
                "current_min_payment": min_payment,
            }
        )
    return {"accounts": rows}
