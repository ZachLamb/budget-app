from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.config import get_settings
from app.models import Account, AccountSnapshot, Transaction, Payee, SyncLog, ImportBatch
from app.services.sync.simplefin import SimpleFINProvider
from app.services.categorization.rules import apply_rules


async def run_sync(household_id: str, sync_log_id: str):
    """Run a full sync for a household. Called as a background task."""
    settings = get_settings()
    if not settings.simplefin_access_url:
        async with async_session() as db:
            result = await db.execute(select(SyncLog).where(SyncLog.id == sync_log_id))
            log = result.scalar_one()
            log.status = "error"
            log.error_message = "SimpleFIN access URL not configured"
            log.completed_at = datetime.now(timezone.utc)
            await db.commit()
        return

    provider = SimpleFINProvider(settings.simplefin_access_url)
    accounts_synced = 0
    transactions_imported = 0
    error_msg = None

    try:
        end_date = date.today()
        start_date = end_date - timedelta(days=30)

        sync_result = await provider.sync_all(start_date, end_date)

        async with async_session() as db:
            for synced_acct in sync_result.accounts:
                result = await db.execute(
                    select(Account).where(Account.simplefin_id == synced_acct.provider_id)
                )
                account = result.scalar_one_or_none()

                if not account:
                    is_budget = synced_acct.account_type in ("checking", "savings", "credit")
                    account = Account(
                        household_id=household_id,
                        name=synced_acct.name,
                        account_type=synced_acct.account_type,
                        institution=synced_acct.institution,
                        currency=synced_acct.currency,
                        is_budget_account=is_budget,
                        simplefin_id=synced_acct.provider_id,
                    )
                    db.add(account)
                    await db.flush()

                if not account.is_budget_account:
                    snapshot = AccountSnapshot(
                        account_id=account.id,
                        date=end_date,
                        balance=synced_acct.balance,
                    )
                    existing = await db.execute(
                        select(AccountSnapshot).where(
                            AccountSnapshot.account_id == account.id,
                            AccountSnapshot.date == end_date,
                        )
                    )
                    if not existing.scalar_one_or_none():
                        db.add(snapshot)

                accounts_synced += 1

                acct_txns = sync_result.transactions.get(synced_acct.provider_id, [])
                if not acct_txns:
                    continue

                batch = ImportBatch(
                    account_id=account.id, source="simplefin", transaction_count=0
                )
                db.add(batch)
                await db.flush()

                for synced_txn in acct_txns:
                    existing = await db.execute(
                        select(Transaction).where(
                            Transaction.simplefin_transaction_id == synced_txn.provider_id
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    payee_result = await db.execute(
                        select(Payee).where(
                            Payee.household_id == household_id,
                            Payee.name == synced_txn.payee_name,
                        )
                    )
                    payee = payee_result.scalar_one_or_none()
                    if not payee:
                        payee = Payee(household_id=household_id, name=synced_txn.payee_name)
                        db.add(payee)
                        await db.flush()

                    category_id = payee.default_category_id

                    txn = Transaction(
                        account_id=account.id,
                        date=synced_txn.date,
                        payee_id=payee.id,
                        amount=synced_txn.amount,
                        notes=synced_txn.memo,
                        cleared=True,
                        category_id=category_id,
                        import_id=batch.id,
                        simplefin_transaction_id=synced_txn.provider_id,
                    )
                    db.add(txn)
                    transactions_imported += 1
                    batch.transaction_count += 1

                await db.flush()

            if transactions_imported > 0:
                await apply_rules(db, household_id)

            await db.commit()
            status = "success"

    except Exception as e:
        error_msg = str(e)
        status = "error"

    async with async_session() as db:
        result = await db.execute(select(SyncLog).where(SyncLog.id == sync_log_id))
        log = result.scalar_one()
        log.status = status
        log.accounts_synced = accounts_synced
        log.transactions_imported = transactions_imported
        log.error_message = error_msg
        log.completed_at = datetime.now(timezone.utc)
        await db.commit()
