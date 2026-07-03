from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Account, Transaction, Payee, ImportBatch
from app.services.imports.csv_import import parse_csv
from app.services.categorization.rules import apply_rules

router = APIRouter()

# Prevent accidental or malicious huge uploads tying up workers / memory
_MAX_CSV_BYTES = 15 * 1024 * 1024


@router.post("/csv")
async def upload_csv(
    file: UploadFile = File(...),
    account_id: str = Form(...),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    acct_result = await db.execute(
        select(Account).where(Account.id == account_id, Account.household_id == household_id)
    )
    account = acct_result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Read in bounded chunks so an oversized body is rejected without
    # buffering the whole thing (Starlette spools big uploads to disk,
    # but .read() of the full file would still materialize it in RAM).
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_CSV_BYTES:
            raise HTTPException(status_code=413, detail="CSV file is too large (max 15 MB)")
        chunks.append(chunk)
    try:
        content = b"".join(chunks).decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="File must be UTF-8 encoded. Re-export the CSV as UTF-8 and try again.",
        )
    result = parse_csv(content)

    if not result.transactions:
        raise HTTPException(status_code=400, detail=f"No valid transactions found. Errors: {result.errors}")

    batch = ImportBatch(
        account_id=account_id,
        source="csv",
        filename=file.filename,
        transaction_count=0,
    )
    db.add(batch)
    await db.flush()

    # Batch payee resolution: one query for every name in the file, one flush
    # for the misses — not two queries per row.
    payee_names = {p.payee_name for p in result.transactions}
    payees_result = await db.execute(
        select(Payee).where(
            Payee.household_id == household_id,
            Payee.name.in_(payee_names),
        )
    )
    payees_by_name = {p.name: p for p in payees_result.scalars().all()}
    for name in payee_names - payees_by_name.keys():
        payee = Payee(household_id=household_id, name=name)
        db.add(payee)
        payees_by_name[name] = payee
    await db.flush()  # assign ids to new payees

    # Batch dedup: pull this account's transactions for the file's date range
    # once and compare in memory on (date, amount, payee_id).
    dates = [p.date for p in result.transactions]
    existing_result = await db.execute(
        select(Transaction.date, Transaction.amount, Transaction.payee_id).where(
            Transaction.account_id == account_id,
            Transaction.date >= min(dates),
            Transaction.date <= max(dates),
        )
    )
    existing_keys = {(row.date, row.amount, row.payee_id) for row in existing_result.all()}

    imported = 0
    skipped = 0
    for parsed in result.transactions:
        payee = payees_by_name[parsed.payee_name]
        key = (parsed.date, parsed.amount, payee.id)
        if key in existing_keys:
            skipped += 1
            continue
        existing_keys.add(key)  # also dedup within the file itself

        txn = Transaction(
            account_id=account_id,
            date=parsed.date,
            payee_id=payee.id,
            amount=parsed.amount,
            notes=parsed.memo,
            cleared=True,
            category_id=payee.default_category_id,
            import_id=batch.id,
        )
        db.add(txn)
        imported += 1

    batch.transaction_count = imported
    await db.flush()

    if imported > 0:
        await apply_rules(db, household_id)

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": result.errors,
        "detected_format": result.detected_format,
        "batch_id": batch.id,
    }
