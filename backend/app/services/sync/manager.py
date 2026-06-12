from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

logger = logging.getLogger(__name__)

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import Account, AccountSnapshot, Transaction, Payee, SyncLog, ImportBatch, Household
from app.services.crypto import decrypt_value, encrypt_value, is_encrypted
from app.services.sync.simplefin import SimpleFINProvider
from app.services.categorization.rules import apply_rules


async def _get_simplefin_url(db: AsyncSession, household_id: str) -> str | None:
    """Return the decrypted SimpleFIN access URL (DB is sole source of truth).

    Bank credentials are encrypted at rest (services.crypto); plaintext rows
    written before encryption shipped are upgraded in place on first read.
    """
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if not household or not household.simplefin_access_url:
        return None
    stored = household.simplefin_access_url
    url = decrypt_value(stored)
    if url and not is_encrypted(stored):
        household.simplefin_access_url = encrypt_value(url)
        await db.commit()
    return url


async def _persist_access_url(db: AsyncSession, household_id: str, access_url: str):
    """Save the claimed SimpleFIN access URL (encrypted) so we never re-claim the setup token."""
    result = await db.execute(select(Household).where(Household.id == household_id))
    household = result.scalar_one_or_none()
    if household:
        household.simplefin_access_url = encrypt_value(access_url)
        await db.commit()


async def run_sync(household_id: str, sync_log_id: str):
    """Run a full sync for a household. Called as a background task."""
    async with async_session() as db:
        access_url = await _get_simplefin_url(db, household_id)

    if not access_url:
        async with async_session() as db:
            result = await db.execute(select(SyncLog).where(SyncLog.id == sync_log_id))
            log = result.scalar_one()
            log.status = "error"
            log.error_message = "SimpleFIN access URL not configured"
            log.completed_at = datetime.now(timezone.utc)
            await db.commit()
        return

    provider = SimpleFINProvider(access_url)
    accounts_synced = 0
    transactions_imported = 0
    error_msg = None

    try:
        end_date = datetime.now(timezone.utc).date()
        default_start = end_date - timedelta(days=30)

        # Incremental sync: use the earliest last_synced_at across all
        # household accounts minus a 3-day overlap to catch back-dated
        # transactions. Deduplication by simplefin_transaction_id is safe.
        async with async_session() as db:
            accts_result = await db.execute(
                select(Account.last_synced_at).where(
                    Account.household_id == household_id,
                    Account.simplefin_id.isnot(None),
                    Account.last_synced_at.isnot(None),
                )
            )
            synced_dates = [r[0] for r in accts_result.all()]

        if synced_dates:
            earliest = min(synced_dates)
            incremental_start = (earliest - timedelta(days=3)).date()
            start_date = max(incremental_start, default_start)
        else:
            start_date = default_start

        sync_result = await provider.sync_all(start_date, end_date)

        resolved = provider.resolved_access_url
        if resolved and resolved != access_url:
            async with async_session() as db:
                await _persist_access_url(db, household_id, resolved)

        async with async_session() as db:
            for synced_acct in sync_result.accounts:
                # Scope by household: simplefin_id values are provider-assigned and
                # must never resolve to (or mutate) another household's account.
                result = await db.execute(
                    select(Account).where(
                        Account.household_id == household_id,
                        Account.simplefin_id == synced_acct.provider_id,
                    )
                )
                account = result.scalar_one_or_none()

                if account is None:
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
                else:
                    account.name = synced_acct.name
                    account.institution = synced_acct.institution

                account.available_balance = synced_acct.available_balance
                account.last_synced_at = datetime.now(timezone.utc)

                if not account.sync_enabled:
                    continue

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

                # Count pre-existing transactions for this account (before this sync run).
                # Used to determine whether an opening balance is needed.
                prior_txn_count_result = await db.execute(
                    select(func.count()).where(Transaction.account_id == account.id)
                )
                prior_txn_count = prior_txn_count_result.scalar() or 0

                # Track the sum of amounts actually imported in this run (skips deduped rows).
                imported_total = Decimal("0")

                if acct_txns:
                    batch = ImportBatch(
                        account_id=account.id, source="simplefin", transaction_count=0
                    )
                    db.add(batch)
                    await db.flush()

                    seen_ids: set[str] = set()
                    for synced_txn in acct_txns:
                        if not synced_txn.provider_id:
                            continue
                        if synced_txn.provider_id in seen_ids:
                            logger.warning("Duplicate transaction id in sync response: %s", synced_txn.provider_id)
                            continue
                        seen_ids.add(synced_txn.provider_id)

                        # Dedup within this account only; provider txn ids are not
                        # globally unique across unrelated households.
                        existing = await db.execute(
                            select(Transaction).where(
                                Transaction.account_id == account.id,
                                Transaction.simplefin_transaction_id == synced_txn.provider_id,
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
                        imported_total += synced_txn.amount

                    await db.flush()

                # Create an opening balance transaction when a budget account has no prior
                # transactions (newly created OR all transactions were manually deleted).
                # This makes the sum-of-transactions balance match SimpleFIN's reported
                # balance, since SimpleFIN only returns 30 days of history.
                if account.is_budget_account and prior_txn_count == 0:
                    opening_amount = synced_acct.balance - imported_total
                    if abs(opening_amount) > Decimal("0.01"):
                        ob_payee_result = await db.execute(
                            select(Payee).where(
                                Payee.household_id == household_id,
                                Payee.name == "Opening Balance",
                            )
                        )
                        ob_payee = ob_payee_result.scalar_one_or_none()
                        if not ob_payee:
                            ob_payee = Payee(household_id=household_id, name="Opening Balance")
                            db.add(ob_payee)
                            await db.flush()
                        ob_txn = Transaction(
                            account_id=account.id,
                            date=start_date - timedelta(days=1),
                            payee_id=ob_payee.id,
                            amount=opening_amount,
                            notes="Opening balance from SimpleFIN import",
                            cleared=True,
                        )
                        db.add(ob_txn)
                        transactions_imported += 1
                        await db.flush()
                        logger.info(
                            "Created opening balance of %s for account %s (%s)",
                            opening_amount, account.name, account.id,
                        )

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
