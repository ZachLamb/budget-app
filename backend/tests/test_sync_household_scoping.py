"""Regression tests: SimpleFIN sync must never touch another household's rows.

Previously ``run_sync`` resolved accounts by globally-unique ``simplefin_id``
and deduplicated transactions by globally-unique ``simplefin_transaction_id``.
A household syncing a provider id already present in another household would
mutate the other household's account and import transactions into it.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Household, SyncLog, Transaction
from app.services.sync import manager
from app.services.sync.base import SyncedAccount, SyncedTransaction, SyncResult


SHARED_PROVIDER_ACCOUNT_ID = "sf-acct-shared"
SHARED_PROVIDER_TXN_ID = "sf-txn-shared"


class _FakeProvider:
    """Stands in for SimpleFINProvider; returns one account + one transaction."""

    def __init__(self, access_url: str):
        self.access_url = access_url
        self.resolved_access_url = None

    async def sync_all(self, start_date, end_date) -> SyncResult:
        account = SyncedAccount(
            provider_id=SHARED_PROVIDER_ACCOUNT_ID,
            name="Synced Checking",
            institution="Test Bank",
            account_type="checking",
            balance=Decimal("100.00"),
        )
        txn = SyncedTransaction(
            provider_id=SHARED_PROVIDER_TXN_ID,
            date=date(2026, 6, 1),
            payee_name="Coffee Shop",
            amount=Decimal("-4.50"),
        )
        return SyncResult(
            accounts=[account],
            transactions={SHARED_PROVIDER_ACCOUNT_ID: [txn]},
        )


@pytest_asyncio.fixture()
async def db_env(monkeypatch):
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    monkeypatch.setattr(manager, "async_session", Session)
    monkeypatch.setattr(manager, "SimpleFINProvider", _FakeProvider)

    async with Session() as db:
        household_a = Household(name="Household A")
        household_b = Household(
            name="Household B",
            simplefin_access_url="https://user:pass@beta-bridge.simplefin.org/simplefin",
        )
        db.add_all([household_a, household_b])
        await db.flush()

        # Household A already owns the provider account id that B will sync.
        account_a = Account(
            household_id=household_a.id,
            name="A's Checking",
            account_type="checking",
            institution="A's Bank",
            simplefin_id=SHARED_PROVIDER_ACCOUNT_ID,
        )
        db.add(account_a)
        await db.commit()
        ids = (household_a.id, household_b.id, account_a.id)

    try:
        yield Session, ids
    finally:
        await engine.dispose()


async def _run_sync_for(Session, household_id: str) -> SyncLog:
    async with Session() as db:
        log = SyncLog(household_id=household_id, provider="simplefin", status="in_progress")
        db.add(log)
        await db.commit()
        log_id = log.id
    await manager.run_sync(household_id, log_id)
    async with Session() as db:
        result = await db.execute(select(SyncLog).where(SyncLog.id == log_id))
        return result.scalar_one()


@pytest.mark.asyncio
async def test_sync_does_not_hijack_other_households_account(db_env):
    Session, (household_a_id, household_b_id, account_a_id) = db_env

    log = await _run_sync_for(Session, household_b_id)
    assert log.status == "success", log.error_message

    async with Session() as db:
        # Household A's account must be untouched.
        account_a = (
            await db.execute(select(Account).where(Account.id == account_a_id))
        ).scalar_one()
        assert account_a.name == "A's Checking"
        assert account_a.institution == "A's Bank"
        assert account_a.household_id == household_a_id

        # Household B gets its own account for the same provider id.
        account_b = (
            await db.execute(
                select(Account).where(
                    Account.household_id == household_b_id,
                    Account.simplefin_id == SHARED_PROVIDER_ACCOUNT_ID,
                )
            )
        ).scalar_one()
        assert account_b.id != account_a_id
        assert account_b.name == "Synced Checking"

        # The synced transaction lands in B's account, never A's.
        txns_a = (
            await db.execute(select(Transaction).where(Transaction.account_id == account_a_id))
        ).scalars().all()
        synced_txns_a = [t for t in txns_a if t.simplefin_transaction_id == SHARED_PROVIDER_TXN_ID]
        assert synced_txns_a == []

        txn_b = (
            await db.execute(
                select(Transaction).where(
                    Transaction.account_id == account_b.id,
                    Transaction.simplefin_transaction_id == SHARED_PROVIDER_TXN_ID,
                )
            )
        ).scalar_one()
        assert txn_b.amount == Decimal("-4.50")


@pytest.mark.asyncio
async def test_transaction_dedup_is_scoped_per_account(db_env):
    Session, (household_a_id, household_b_id, account_a_id) = db_env

    # Household A already imported the same provider transaction id.
    async with Session() as db:
        db.add(
            Transaction(
                account_id=account_a_id,
                date=date(2026, 5, 30),
                amount=Decimal("-4.50"),
                simplefin_transaction_id=SHARED_PROVIDER_TXN_ID,
            )
        )
        await db.commit()

    log = await _run_sync_for(Session, household_b_id)
    assert log.status == "success", log.error_message
    # A's pre-existing copy must not suppress B's import.
    assert log.transactions_imported >= 1

    async with Session() as db:
        copies = (
            await db.execute(
                select(Transaction).where(
                    Transaction.simplefin_transaction_id == SHARED_PROVIDER_TXN_ID
                )
            )
        ).scalars().all()
        assert len(copies) == 2
        assert {c.account_id for c in copies} != {account_a_id}
