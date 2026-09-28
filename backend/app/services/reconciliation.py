"""Checking an account against a bank statement.

Reconciling by hand is a search problem: the balance is off by some
amount and you have to work out which transaction explains it. That
search is entirely deterministic -- exact amounts, sums of pairs, a
known arithmetic signature -- so it is done here rather than left to the
person or handed to a model.

Nothing in this module writes. Sign-off is a separate, explicit step.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Payee, Reconciliation, Transaction

#: Pair search is O(n^2). Beyond this many uncleared rows the statement
#: is too far out of date for a pair hint to be the useful answer, and
#: the work stops being worth doing on a request.
_PAIR_SEARCH_LIMIT = 120

#: How many candidate explanations to offer. More than a few is not a
#: hint, it is a second list to search.
_MAX_SUGGESTIONS = 5


@dataclass(frozen=True)
class TxnRef:
    transaction_id: str
    date: date
    payee_name: str | None
    amount: Decimal


@dataclass(frozen=True)
class Suggestion:
    """A concrete thing that would close the gap, and why it might."""

    kind: str  # "clear_one" | "clear_pair" | "unclear_one" | "transposition"
    explanation: str
    transactions: tuple[TxnRef, ...] = ()


@dataclass(frozen=True)
class ReconciliationView:
    account_id: str
    statement_date: date
    statement_balance: Decimal
    cleared_balance: Decimal
    #: statement - cleared. Positive means the bank says you have more
    #: than the app accounts for, so something is missing or uncleared.
    difference: Decimal
    cleared_count: int
    uncleared: tuple[TxnRef, ...]
    #: The last statement this account was signed off against, or None if
    #: it never has been. Distinguishing "never reconciled" from
    #: "reconciled to a zero balance" is the whole reason this is
    #: nullable rather than a date defaulted to something.
    last_reconciled_on: date | None
    suggestions: tuple[Suggestion, ...]
    #: Rows already locked by a previous sign-off, which this statement
    #: cannot silently reopen.
    reconciled_count: int


def _ref(txn: Transaction, payee_names: dict[str, str]) -> TxnRef:
    return TxnRef(
        transaction_id=txn.id,
        date=txn.date,
        payee_name=payee_names.get(txn.payee_id or "") or None,
        amount=txn.amount,
    )


def find_suggestions(
    difference: Decimal, uncleared: list[TxnRef], cleared: list[TxnRef]
) -> tuple[Suggestion, ...]:
    """Work out what would close the gap.

    Ordered by how likely each is to be the real answer, which is also
    the order of how little work it takes to act on.
    """
    if difference == 0:
        return ()

    out: list[Suggestion] = []

    # 1. One uncleared transaction for exactly the missing amount. By far
    #    the most common cause: it simply has not been ticked yet.
    for txn in uncleared:
        if txn.amount == difference:
            out.append(
                Suggestion(
                    kind="clear_one",
                    explanation=(
                        "This transaction is for exactly the amount you are out by, "
                        "and is not marked cleared. Clearing it would balance the "
                        "account."
                    ),
                    transactions=(txn,),
                )
            )
            if len(out) >= _MAX_SUGGESTIONS:
                return tuple(out)

    # 2. A cleared transaction that would balance if it were NOT cleared.
    #    Usually a duplicate from an import, or something ticked early.
    for txn in cleared:
        if txn.amount == -difference:
            out.append(
                Suggestion(
                    kind="unclear_one",
                    explanation=(
                        "This transaction is marked cleared, but the account would "
                        "balance without it. Check it is not a duplicate, or that it "
                        "really has left your bank."
                    ),
                    transactions=(txn,),
                )
            )
            if len(out) >= _MAX_SUGGESTIONS:
                return tuple(out)

    # 3. Two uncleared transactions that together explain it.
    if len(out) < _MAX_SUGGESTIONS and len(uncleared) <= _PAIR_SEARCH_LIMIT:
        for a, b in combinations(uncleared, 2):
            if a.amount + b.amount == difference:
                out.append(
                    Suggestion(
                        kind="clear_pair",
                        explanation=(
                            "These two together come to exactly the amount you are "
                            "out by. Clearing both would balance the account."
                        ),
                        transactions=(a, b),
                    )
                )
                if len(out) >= _MAX_SUGGESTIONS:
                    return tuple(out)

    # 4. The transposition signature. A difference divisible by 9 is the
    #    arithmetic fingerprint of two swapped digits (54 typed as 45
    #    leaves 9; 1,200 as 2,100 leaves 900). Worth saying only when
    #    nothing concrete was found -- it points at a typo, which no
    #    amount of searching the ledger will turn up.
    if not out:
        cents = int((difference * 100).to_integral_value())
        if cents != 0 and cents % 9 == 0:
            out.append(
                Suggestion(
                    kind="transposition",
                    explanation=(
                        "The amount you are out by divides by 9, which is the "
                        "signature of two digits typed the wrong way round "
                        "(54 entered as 45, or 1,200 as 2,100). Worth re-reading "
                        "the amounts before hunting for a missing transaction."
                    ),
                )
            )

    return tuple(out)


async def build_view(
    db: AsyncSession,
    account: Account,
    *,
    statement_date: date,
    statement_balance: Decimal,
) -> ReconciliationView:
    """Compare an account against a statement. Writes nothing."""
    rows = (
        await db.execute(
            select(Transaction)
            .where(Transaction.account_id == account.id)
            .where(Transaction.parent_transaction_id.is_(None))
            .where(Transaction.date <= statement_date)
            .order_by(Transaction.date.desc())
        )
    ).scalars().all()

    payee_ids = {t.payee_id for t in rows if t.payee_id}
    payee_names: dict[str, str] = {}
    if payee_ids:
        payee_names = dict(
            (await db.execute(
                select(Payee.id, Payee.name).where(Payee.id.in_(payee_ids))
            )).all()
        )

    cleared = [t for t in rows if t.cleared]
    uncleared = [t for t in rows if not t.cleared]
    # The account's own running balance counts everything; a statement
    # only knows about what has actually settled, so only cleared rows
    # are compared against it.
    cleared_balance = sum((t.amount for t in cleared), Decimal("0.00"))
    difference = statement_balance - cleared_balance

    last = (
        await db.execute(
            select(Reconciliation.statement_date)
            .where(Reconciliation.account_id == account.id)
            .order_by(Reconciliation.statement_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    uncleared_refs = [_ref(t, payee_names) for t in uncleared]
    cleared_refs = [_ref(t, payee_names) for t in cleared]

    return ReconciliationView(
        account_id=account.id,
        statement_date=statement_date,
        statement_balance=statement_balance,
        cleared_balance=cleared_balance,
        difference=difference,
        cleared_count=len(cleared),
        uncleared=tuple(uncleared_refs),
        last_reconciled_on=last,
        suggestions=find_suggestions(difference, uncleared_refs, cleared_refs),
        reconciled_count=sum(1 for t in cleared if t.reconciled),
    )
