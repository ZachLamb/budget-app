from typing import Optional

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select, update

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Account, Category, Payee, Transaction, RecurringTransaction
from app.schemas.payee import (
    PayeeActivityResponse,
    PayeeCreate,
    PayeeUpdate,
    PayeeResponse,
    DuplicateClusterResponse,
    DuplicatePayeeMember,
    PayeeMergeRequest,
)
from app.services.payee_dedup import PayeeView, find_duplicate_clusters
from app.utils import escape_like, validate_category_ownership, validate_account_ownership

router = APIRouter()


@router.get("/duplicates", response_model=list[DuplicateClusterResponse])
async def list_duplicate_payees(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Find payees that normalize to the same merchant and could be merged.

    Deterministic: normalizes each payee name and clusters exact-key collisions.
    No model involved.
    """
    result = await db.execute(
        select(Payee).where(Payee.household_id == household_id)
    )
    payees = [PayeeView(id=p.id, name=p.name) for p in result.scalars().all()]
    clusters = find_duplicate_clusters(payees)
    name_by_id = {p.id: p.name for p in payees}
    return [
        DuplicateClusterResponse(
            normalized_key=c.normalized_key,
            canonical_id=c.canonical_id,
            canonical_name=c.canonical_name,
            duplicate_ids=list(c.duplicate_ids),
            members=[
                DuplicatePayeeMember(id=c.canonical_id, name=name_by_id[c.canonical_id]),
                *[
                    DuplicatePayeeMember(id=pid, name=name_by_id[pid])
                    for pid in c.duplicate_ids
                ],
            ],
        )
        for c in clusters
    ]



@router.get("/activity", response_model=list[PayeeActivityResponse])
async def list_payee_activity(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Per-payee totals for the payees list.

    Split children are excluded from the count and total so a split
    transaction is not counted once as the parent and again as each of
    its parts. The usual category is worked out from every row that
    carries one, children included -- that is where a split keeps its
    categories, and it is the only place the answer lives.
    """
    totals = (
        await db.execute(
            select(
                Transaction.payee_id,
                func.count(Transaction.id),
                func.sum(Transaction.amount),
                func.max(Transaction.date),
            )
            .join(Account, Transaction.account_id == Account.id)
            .where(
                Account.household_id == household_id,
                Transaction.payee_id.is_not(None),
                Transaction.parent_transaction_id.is_(None),
            )
            .group_by(Transaction.payee_id)
        )
    ).all()
    by_payee = {r[0]: r for r in totals}

    category_counts = (
        await db.execute(
            select(
                Transaction.payee_id,
                Transaction.category_id,
                Category.name,
                func.count(Transaction.id).label("n"),
            )
            .join(Account, Transaction.account_id == Account.id)
            .join(Category, Transaction.category_id == Category.id)
            .where(
                Account.household_id == household_id,
                Transaction.payee_id.is_not(None),
            )
            .group_by(Transaction.payee_id, Transaction.category_id, Category.name)
        )
    ).all()
    top_category: dict[str, tuple[str, str, int]] = {}
    for payee_id, category_id, category_name, count in category_counts:
        current = top_category.get(payee_id)
        # Most-used category wins; ties break on the category name so the
        # answer is stable between requests rather than following row order.
        wins = current is None or count > current[2] or (
            count == current[2] and category_name < current[1]
        )
        if wins:
            top_category[payee_id] = (category_id, category_name, count)

    payees = (
        await db.execute(
            select(Payee).where(Payee.household_id == household_id).order_by(Payee.name)
        )
    ).scalars().all()

    rows: list[PayeeActivityResponse] = []
    for payee in payees:
        agg = by_payee.get(payee.id)
        cat = top_category.get(payee.id)
        rows.append(
            PayeeActivityResponse(
                payee_id=payee.id,
                name=payee.name,
                transaction_count=agg[1] if agg else 0,
                total_amount=(agg[2] if agg and agg[2] is not None else Decimal("0")),
                last_date=agg[3] if agg else None,
                top_category_id=cat[0] if cat else None,
                top_category_name=cat[1] if cat else None,
            )
        )
    return rows


@router.post("/merge", response_model=PayeeResponse)
async def merge_payees(
    data: PayeeMergeRequest,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    """Reassign every transaction and recurring item from the source payees to
    the target, then delete the sources. All payees must belong to the caller.
    """
    ids = {data.target_id, *data.source_ids}
    if data.target_id in data.source_ids:
        raise HTTPException(status_code=400, detail="Target cannot also be a source")
    if not data.source_ids:
        raise HTTPException(status_code=400, detail="No source payees to merge")

    result = await db.execute(
        select(Payee).where(Payee.id.in_(ids), Payee.household_id == household_id)
    )
    found = {p.id: p for p in result.scalars().all()}
    if set(found) != ids:
        raise HTTPException(status_code=404, detail="Payee not found in this household")

    await db.execute(
        update(Transaction)
        .where(Transaction.payee_id.in_(data.source_ids))
        .values(payee_id=data.target_id)
    )
    await db.execute(
        update(RecurringTransaction)
        .where(RecurringTransaction.payee_id.in_(data.source_ids))
        .values(payee_id=data.target_id)
    )
    for sid in data.source_ids:
        await db.delete(found[sid])
    await db.flush()
    return PayeeResponse.model_validate(found[data.target_id])


@router.get("", response_model=list[PayeeResponse])
async def list_payees(
    q: Optional[str] = Query(None, max_length=200),
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    query = select(Payee).where(Payee.household_id == household_id).order_by(Payee.name)
    if q:
        query = query.where(Payee.name.ilike(f"%{escape_like(q)}%"))
    result = await db.execute(query)
    return [PayeeResponse.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PayeeResponse, status_code=201)
async def create_payee(
    data: PayeeCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(Payee).where(Payee.household_id == household_id, Payee.name == data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Payee already exists")

    await validate_category_ownership(db, data.default_category_id, household_id)
    await validate_account_ownership(db, data.transfer_account_id, household_id)

    payee = Payee(household_id=household_id, **data.model_dump())
    db.add(payee)
    await db.flush()
    return PayeeResponse.model_validate(payee)


@router.put("/{payee_id}", response_model=PayeeResponse)
async def update_payee(
    payee_id: str,
    data: PayeeUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payee).where(Payee.id == payee_id, Payee.household_id == household_id)
    )
    payee = result.scalar_one_or_none()
    if not payee:
        raise HTTPException(status_code=404, detail="Payee not found")
    updates = data.model_dump(exclude_unset=True)
    if "default_category_id" in updates:
        await validate_category_ownership(db, updates["default_category_id"], household_id)
    if "transfer_account_id" in updates:
        await validate_account_ownership(db, updates["transfer_account_id"], household_id)
    for field, value in updates.items():
        setattr(payee, field, value)
    return PayeeResponse.model_validate(payee)


@router.delete("/{payee_id}", status_code=204)
async def delete_payee(
    payee_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Payee).where(Payee.id == payee_id, Payee.household_id == household_id)
    )
    payee = result.scalar_one_or_none()
    if not payee:
        raise HTTPException(status_code=404, detail="Payee not found")

    # transactions.payee_id is a plain foreign key with no ON DELETE, so
    # deleting a payee that is still referenced raised an IntegrityError and
    # reached the caller as a bare 500. Say what is in the way, and name the
    # thing that does work: merging moves the history somewhere it belongs.
    txn_count = (
        await db.execute(
            select(func.count(Transaction.id))
            .join(Account, Transaction.account_id == Account.id)
            .where(
                Account.household_id == household_id,
                Transaction.payee_id == payee_id,
            )
        )
    ).scalar_one()
    if txn_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{payee.name} is used by {txn_count} transaction"
                f"{'' if txn_count == 1 else 's'}. Merge it into another payee "
                "to keep that history, or recategorize those transactions first."
            ),
        )

    recurring_count = (
        await db.execute(
            select(func.count(RecurringTransaction.id)).where(
                RecurringTransaction.household_id == household_id,
                RecurringTransaction.payee_id == payee_id,
            )
        )
    ).scalar_one()
    if recurring_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{payee.name} is used by {recurring_count} recurring item"
                f"{'' if recurring_count == 1 else 's'}. Point those at another "
                "payee, or merge this one, before deleting it."
            ),
        )

    await db.delete(payee)
