import json
from typing import Optional

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Transaction, Payee, Account, CategoryGroup, Category


async def suggest_categories_batch(
    db: AsyncSession, household_id: str
) -> list[dict]:
    """Send uncategorized transactions to Claude for category suggestions.

    Returns a list of {transaction_id, suggested_category_id, payee_name, category_name}
    for the user to confirm.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        return []

    # Gather uncategorized transactions
    txn_result = await db.execute(
        select(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.category_id.is_(None))
        .where(Transaction.parent_transaction_id.is_(None))
        .limit(50)
    )
    transactions = txn_result.scalars().all()
    if not transactions:
        return []

    # Build payee names
    payee_ids = {t.payee_id for t in transactions if t.payee_id}
    payee_names: dict[str, str] = {}
    if payee_ids:
        p_result = await db.execute(select(Payee).where(Payee.id.in_(payee_ids)))
        for p in p_result.scalars().all():
            payee_names[p.id] = p.name

    # Build category list
    groups_result = await db.execute(
        select(CategoryGroup)
        .where(CategoryGroup.household_id == household_id)
        .order_by(CategoryGroup.sort_order)
    )
    categories_result = await db.execute(
        select(Category).join(CategoryGroup).where(CategoryGroup.household_id == household_id)
    )
    all_categories = categories_result.scalars().all()

    cat_list = []
    cat_map: dict[str, str] = {}
    for cat in all_categories:
        cat_list.append({"id": cat.id, "name": cat.name})
        cat_map[cat.name.lower()] = cat.id

    txn_list = []
    for t in transactions:
        payee = payee_names.get(t.payee_id, "Unknown") if t.payee_id else "Unknown"
        txn_list.append({
            "id": t.id,
            "payee": payee,
            "amount": str(t.amount),
            "date": t.date.isoformat(),
            "notes": t.notes or "",
        })

    prompt = f"""Categorize these transactions. For each, return the most appropriate category_id.

Categories:
{json.dumps(cat_list, indent=2)}

Transactions:
{json.dumps(txn_list, indent=2)}

Return a JSON array of objects with "transaction_id" and "category_id" fields. Only return the JSON array, no other text."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        response_text = message.content[0].text.strip()
        if response_text.startswith("```"):
            response_text = response_text.split("\n", 1)[1].rsplit("```", 1)[0]
        suggestions = json.loads(response_text)
    except (json.JSONDecodeError, IndexError, KeyError):
        return []

    results = []
    for s in suggestions:
        txn_id = s.get("transaction_id")
        cat_id = s.get("category_id")
        txn = next((t for t in transactions if t.id == txn_id), None)
        cat = next((c for c in all_categories if c.id == cat_id), None)
        if txn and cat:
            payee = payee_names.get(txn.payee_id, "Unknown") if txn.payee_id else "Unknown"
            results.append({
                "transaction_id": txn_id,
                "suggested_category_id": cat_id,
                "payee_name": payee,
                "category_name": cat.name,
            })

    return results
