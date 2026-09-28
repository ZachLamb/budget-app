from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, Payee, Account, AutoCategorizationRule


@dataclass(frozen=True)
class CandidateRule:
    """A rule to match with -- saved or not yet.

    The editor previews a rule before it exists, so matching cannot take
    a database row. `id` is empty for a candidate.
    """

    match_field: str
    match_type: str
    match_value: str
    category_id: str
    id: str = ""


@dataclass(frozen=True)
class RuleMatch:
    """One transaction a rule would claim, and why."""

    transaction_id: str
    date: date
    payee_name: str | None
    amount: Decimal
    matched_on: str
    rule_id: str
    category_id: str


async def _saved_rules(
    db: AsyncSession, household_id: str, *, only_rule_id: str | None = None
) -> list[CandidateRule]:
    """This household's enabled rules, highest priority first."""
    query = (
        select(AutoCategorizationRule)
        .where(
            AutoCategorizationRule.household_id == household_id,
            AutoCategorizationRule.enabled.is_(True),
        )
        .order_by(AutoCategorizationRule.priority.desc())
    )
    if only_rule_id is not None:
        query = query.where(AutoCategorizationRule.id == only_rule_id)
    rows = (await db.execute(query)).scalars().all()
    return [
        CandidateRule(
            id=r.id,
            match_field=r.match_field,
            match_type=r.match_type,
            match_value=r.match_value,
            category_id=r.category_id,
        )
        for r in rows
    ]


async def _matches(
    db: AsyncSession,
    household_id: str,
    rules: list[CandidateRule],
) -> list[RuleMatch]:
    """Work out what these rules would do, without doing it.

    The single source of truth for matching. Applying, previewing a saved
    rule and previewing one still being typed all come through here, so
    what you are shown and what happens cannot drift apart -- a preview
    that reimplemented the matcher would be right until the day someone
    changed one of them.

    Only uncategorized transactions are considered, which is what makes
    running rules safe: a category a person chose is never overwritten.
    """
    if not rules:
        return []

    transactions = (
        await db.execute(
            select(Transaction)
            .join(Account, Transaction.account_id == Account.id)
            .where(Account.household_id == household_id)
            .where(Transaction.category_id.is_(None))
            .where(Transaction.parent_transaction_id.is_(None))
            .order_by(Transaction.date.desc())
        )
    ).scalars().all()

    payee_cache: dict[str, str] = {}
    out: list[RuleMatch] = []

    for txn in transactions:
        for rule in rules:
            matched = False
            target_value = ""

            if rule.match_field == "payee" and txn.payee_id:
                if txn.payee_id not in payee_cache:
                    p_result = await db.execute(
                        select(Payee.name).where(Payee.id == txn.payee_id)
                    )
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
                    # A rule nobody can compile matches nothing, rather
                    # than stopping every rule behind it.
                    continue

            if matched:
                out.append(
                    RuleMatch(
                        transaction_id=txn.id,
                        date=txn.date,
                        payee_name=payee_cache.get(txn.payee_id or "") or None,
                        amount=txn.amount,
                        matched_on=target_value,
                        rule_id=rule.id,
                        category_id=rule.category_id,
                    )
                )
                break

    return out


async def preview_rules(
    db: AsyncSession, household_id: str, *, only_rule_id: str | None = None
) -> list[RuleMatch]:
    """What running the saved rules would change. Writes nothing."""
    rules = await _saved_rules(db, household_id, only_rule_id=only_rule_id)
    return await _matches(db, household_id, rules)


async def preview_candidate(
    db: AsyncSession, household_id: str, candidate: CandidateRule
) -> list[RuleMatch]:
    """What a rule that does not exist yet would claim.

    Answers the question you actually have while writing one: does this
    pattern catch what I meant, and nothing else?
    """
    return await _matches(db, household_id, [candidate])


async def apply_rules(
    db: AsyncSession, household_id: str, *, only_rule_id: str | None = None
) -> int:
    """Categorize what the rules claim. Returns how many changed."""
    rules = await _saved_rules(db, household_id, only_rule_id=only_rule_id)
    matches = await _matches(db, household_id, rules)
    if not matches:
        return 0

    by_id = {m.transaction_id: m.category_id for m in matches}
    rows = (
        await db.execute(select(Transaction).where(Transaction.id.in_(by_id)))
    ).scalars().all()
    for txn in rows:
        txn.category_id = by_id[txn.id]
    return len(rows)
