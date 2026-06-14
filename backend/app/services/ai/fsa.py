from __future__ import annotations

"""FSA reimbursement review — candidates + persisted claim/dismiss status.

On-device inference runs in the browser; this module only pre-filters
candidates and stores user decisions.
"""

import logging
import uuid as _uuid
from datetime import date
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Category, FsaReviewItem, Payee, Transaction
from app.services.ai.prompt_safety import (
    DEFAULT_CATEGORY_MAX,
    DEFAULT_NOTES_MAX,
    DEFAULT_PAYEE_MAX,
    sanitize_user_text,
)

logger = logging.getLogger(__name__)


_FSA_HINT_KEYWORDS = (
    "pharmacy", "cvs", "walgreens", "rite aid", "medical", "dental",
    "vision", "optom", "optical", "eye", "doctor", "dr.", "clinic",
    "hospital", "health", "therapy", "chiro", "ortho", "derma", "lab",
    "urgent care", "mental", "psych", "counsel", "rx", "prescription",
    "quest", "labcorp", "lenscrafters", "pearle", "contacts",
    "copay", "insurance", "dds", "md ", "pediatr", "obgyn",
    "acupuncture", "ambulance", "hearing", "dentist",
    # Insurers & health systems
    "kaiser", "aetna", "cigna", "united health", "bluecross", "anthem",
    # Online & retail vision/health
    "1800contacts", "warby", "zenni", "costco optical",
    # Telehealth & clinics
    "minute clinic", "teladoc", "mdlive", "nurx",
    "planned parenthood",
    # Specific treatments & equipment
    "physical therapy", "speech therapy", "occupational therapy",
    "invisalign", "cpap", "braces", "dme",
    # Broad-but-bounded medical terms (kept), followed by deliberately
    # dropped over-broad terms with the reason recorded:
    # - "care": matches childcare/daycare/elder care (NOT FSA-eligible — those
    #   are DCFSA/other plans). False positives here caused real misfiled claims.
    # - "wellness"/"fitness": wellness programs and gyms are NOT FSA-eligible
    #   absent a prescription / Letter of Medical Necessity.
    # - "hims"/"hers": primarily haircare/beauty; some telehealth, too broad.
    "surgeon", "surgery", "radiology", "imaging",
)


def _matches_fsa_hint(row) -> bool:
    """True when a transaction row's payee/category/notes contains a medical keyword."""
    text = " ".join(filter(None, [row.payee_name, row.category_name, row.notes])).lower()
    return any(kw in text for kw in _FSA_HINT_KEYWORDS)


async def fetch_fsa_candidates(
    db: AsyncSession,
    household_id: str,
    date_from: Optional[date],
    date_to: Optional[date],
    include_all_outflows: bool = False,
) -> dict[str, object]:
    """Load outflow rows for FSA review (no LLM). Shared by candidates API and server scan."""
    today = date.today()
    df = date_from or today.replace(month=1, day=1)
    dt = date_to or today

    if df > dt:
        raise HTTPException(400, "date_from must be on or before date_to.")
    if (dt - df).days > 366:
        raise HTTPException(400, "Date range cannot exceed 366 days.")

    result = await db.execute(
        select(
            Transaction.id,
            Transaction.date,
            Transaction.amount,
            Transaction.notes,
            Payee.name.label("payee_name"),
            Category.name.label("category_name"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Payee, Transaction.payee_id == Payee.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(Account.household_id == household_id)
        .where(Transaction.amount < 0)
        .where(Transaction.date >= df)
        .where(Transaction.date <= dt)
        .where(Transaction.parent_transaction_id.is_(None))
        .order_by(Transaction.date.desc())
        .limit(500)
    )
    rows = result.all()
    total_scanned = len(rows)

    if include_all_outflows:
        candidates = list(rows)
        prefilter_skipped = 0
    else:
        candidates = [r for r in rows if _matches_fsa_hint(r)]
        prefilter_skipped = total_scanned - len(candidates)

    status_map: dict[str, str] = {}
    if candidates:
        txn_ids = [r.id for r in candidates]
        status_result = await db.execute(
            select(FsaReviewItem.transaction_id, FsaReviewItem.status)
            .where(FsaReviewItem.household_id == household_id)
            .where(FsaReviewItem.transaction_id.in_(txn_ids))
        )
        status_map = {row.transaction_id: row.status for row in status_result.all()}

    candidate_rows = [
        {
            "transaction_id": r.id,
            "date": str(r.date),
            "payee_name": sanitize_user_text(r.payee_name, DEFAULT_PAYEE_MAX) or "Unknown",
            "category_name": sanitize_user_text(r.category_name, DEFAULT_CATEGORY_MAX),
            "amount": abs(float(r.amount)),
            "notes": sanitize_user_text(r.notes, DEFAULT_NOTES_MAX),
            "status": status_map.get(r.id, "pending"),
        }
        for r in candidates
    ]

    return {
        "candidates": candidate_rows,
        "scan_count": total_scanned,
        "candidate_count": len(candidates),
        "prefilter_skipped_count": prefilter_skipped,
        "_candidate_rows": candidates,
    }


async def update_fsa_item_status(
    db: AsyncSession,
    household_id: str,
    transaction_id: str,
    status: str,
) -> dict[str, object]:
    """Upsert claim/dismiss status for a transaction flagged by FSA review."""
    txn_check = await db.execute(
        select(Transaction.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(Account.household_id == household_id)
        .where(Transaction.id == transaction_id)
    )
    if txn_check.scalar() is None:
        raise HTTPException(404, "Transaction not found.")

    existing = await db.execute(
        select(FsaReviewItem)
        .where(FsaReviewItem.household_id == household_id)
        .where(FsaReviewItem.transaction_id == transaction_id)
    )
    item = existing.scalar_one_or_none()
    if item:
        item.status = status
    else:
        item = FsaReviewItem(
            id=str(_uuid.uuid4()),
            household_id=household_id,
            transaction_id=transaction_id,
            status=status,
        )
        db.add(item)
    await db.commit()
    return {"status": status}


async def list_fsa_items(
    db: AsyncSession, household_id: str
) -> list[dict[str, object]]:
    """List all FSA review items for the household (most-recently-updated first)."""
    result = await db.execute(
        select(FsaReviewItem)
        .where(FsaReviewItem.household_id == household_id)
        .order_by(FsaReviewItem.updated_at.desc())
    )
    items = result.scalars().all()
    return [
        {
            "transaction_id": i.transaction_id,
            "status": i.status,
            "fsa_category": i.fsa_category,
            "confidence": i.confidence,
            "reason": i.reason,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
        }
        for i in items
    ]
