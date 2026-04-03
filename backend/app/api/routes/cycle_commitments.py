from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from starlette.responses import Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.api.deps import get_household_id
from app.models import Household, CycleCommitment
from app.schemas.cycle_commitment import (
    CycleCommitmentCreate,
    CycleCommitmentUpdate,
    CycleCommitmentResponse,
)
from app.services.pay_cycle import resolve_pay_cycle, PayCycleResolved

router = APIRouter()

_MAX_ACTIVE = 3
_VALID_KINDS = frozenset({"cap", "cancel", "save", "custom"})
_VALID_STATUS = frozenset({"active", "done", "dismissed"})


async def _resolved_cycle(db: AsyncSession, household_id: str) -> tuple[Household, PayCycleResolved]:
    result = await db.execute(select(Household).where(Household.id == household_id))
    h = result.scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Household not found")
    c = resolve_pay_cycle(date.today(), h.pay_frequency, h.pay_last_confirmed_date)
    return h, c


@router.get("", response_model=list[CycleCommitmentResponse])
async def list_cycle_commitments(
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    _, cycle = await _resolved_cycle(db, household_id)
    result = await db.execute(
        select(CycleCommitment)
        .where(
            CycleCommitment.household_id == household_id,
            CycleCommitment.cycle_start_date == cycle.date_from,
        )
        .order_by(CycleCommitment.created_at)
    )
    return list(result.scalars().all())


@router.post("", response_model=CycleCommitmentResponse, status_code=201)
async def create_cycle_commitment(
    body: CycleCommitmentCreate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    if body.kind not in _VALID_KINDS:
        raise HTTPException(400, f"kind must be one of: {', '.join(sorted(_VALID_KINDS))}")

    _, cycle = await _resolved_cycle(db, household_id)

    cnt_result = await db.execute(
        select(func.count())
        .select_from(CycleCommitment)
        .where(
            CycleCommitment.household_id == household_id,
            CycleCommitment.cycle_start_date == cycle.date_from,
            CycleCommitment.status == "active",
        )
    )
    active_n = int(cnt_result.scalar_one() or 0)
    if active_n >= _MAX_ACTIVE:
        raise HTTPException(400, f"At most {_MAX_ACTIVE} active commitments per pay cycle.")

    now = datetime.now(timezone.utc)
    row = CycleCommitment(
        household_id=household_id,
        cycle_start_date=cycle.date_from,
        cycle_end_date=cycle.date_to,
        title=body.title.strip(),
        kind=body.kind,
        payload=body.payload,
        status="active",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return row


@router.patch("/{commitment_id}", response_model=CycleCommitmentResponse)
async def update_cycle_commitment(
    commitment_id: str,
    body: CycleCommitmentUpdate,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CycleCommitment).where(
            CycleCommitment.id == commitment_id,
            CycleCommitment.household_id == household_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Commitment not found")

    if body.title is not None:
        row.title = body.title.strip()
    if body.status is not None:
        if body.status not in _VALID_STATUS:
            raise HTTPException(400, f"status must be one of: {', '.join(sorted(_VALID_STATUS))}")
        row.status = body.status

    row.updated_at = datetime.now(timezone.utc)

    if body.status == "active":
        _, cycle = await _resolved_cycle(db, household_id)
        if row.cycle_start_date != cycle.date_from:
            raise HTTPException(400, "Cannot reactivate a commitment from a previous cycle.")
        cnt_result = await db.execute(
            select(func.count())
            .select_from(CycleCommitment)
            .where(
                CycleCommitment.household_id == household_id,
                CycleCommitment.cycle_start_date == cycle.date_from,
                CycleCommitment.status == "active",
                CycleCommitment.id != commitment_id,
            )
        )
        if int(cnt_result.scalar_one() or 0) >= _MAX_ACTIVE:
            raise HTTPException(400, f"At most {_MAX_ACTIVE} active commitments per pay cycle.")

    return row


@router.delete("/{commitment_id}", status_code=204)
async def delete_cycle_commitment(
    commitment_id: str,
    household_id: str = Depends(get_household_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CycleCommitment).where(
            CycleCommitment.id == commitment_id,
            CycleCommitment.household_id == household_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Commitment not found")
    await db.delete(row)
    return Response(status_code=204)
