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

    content = (await file.read()).decode("utf-8-sig")
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

    imported = 0
    skipped = 0
    for parsed in result.transactions:
        # Get or create payee
        payee_result = await db.execute(
            select(Payee).where(Payee.household_id == household_id, Payee.name == parsed.payee_name)
        )
        payee = payee_result.scalar_one_or_none()
        if not payee:
            payee = Payee(household_id=household_id, name=parsed.payee_name)
            db.add(payee)
            await db.flush()

        # Basic dedup: same account, date, amount, payee
        existing = await db.execute(
            select(Transaction).where(
                Transaction.account_id == account_id,
                Transaction.date == parsed.date,
                Transaction.amount == parsed.amount,
                Transaction.payee_id == payee.id,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

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
