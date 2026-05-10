from __future__ import annotations

"""Privacy-rights endpoints for the current user.

GET    /api/me/export — stream every piece of data tied to the current user
                         as a single JSON document.
DELETE /api/me        — hard-delete the current user. If they're the last
                         user in their household, also delete the household
                         and all its data.

Both routes are per-user rate-limited via the shared rate-limit store on
``app.state``. We do NOT use the LLM-specific rate limiter because that
shares its key namespace with cloud AI calls — privacy-rights endpoints
deserve their own bucket.
"""

import json
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.middleware.rate_limit_store import RateLimitStore
from app.models import (
    Account,
    AccountSnapshot,
    AutoCategorizationRule,
    BudgetAssignment,
    Category,
    CategoryGroup,
    CycleCommitment,
    FinancialGoal,
    FsaReviewItem,
    Household,
    ImportBatch,
    LlmAudit,
    LlmConsent,
    Payee,
    RecurringSuggestionDismissal,
    RecurringTransaction,
    SyncLog,
    Transaction,
    User,
    WebAuthnCredential,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Rate limit constants ──────────────────────────────────────────────────────


_EXPORT_LIMIT_PER_DAY = 5
_EXPORT_WINDOW_SECONDS = 86_400

_DELETE_LIMIT_PER_HOUR = 3
_DELETE_WINDOW_SECONDS = 3_600


def _get_rate_limit_store(request: Request) -> RateLimitStore:
    """Typed accessor for the shared rate-limit store on app.state.

    Mirrors the helper in ``llm.py`` — making a missing store a clear
    runtime error at the route boundary.
    """
    store = getattr(request.app.state, "rate_limit_store", None)
    if store is None:  # pragma: no cover — only reachable if main.py changed
        raise RuntimeError("rate_limit_store is not configured on app.state")
    return store


# ── JSON encoding helpers ─────────────────────────────────────────────────────


def _json_default(value: Any) -> Any:
    """JSON encoder fallback for SQLAlchemy row values.

    - datetime → ISO-8601 string (UTC if naive)
    - date     → ISO-8601 string
    - Decimal  → string (avoid float rounding for monetary values)
    - bytes    → null (we never want raw passkey blobs in exports)
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return None
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _row_to_dict(row: Any, *, omit: tuple[str, ...] = ()) -> dict[str, Any]:
    """Convert a SQLAlchemy ORM row to a plain dict, skipping ``omit`` cols."""
    omitted = set(omit)
    return {
        col.name: getattr(row, col.name)
        for col in row.__table__.columns
        if col.name not in omitted
    }


def _sanitize_user(user: User) -> dict[str, Any]:
    """User export row — strips secrets, replaces raw google_id with a flag.

    - ``password_hash`` is never included.
    - ``google_id`` is replaced by a boolean ``has_google`` so the export
      reveals whether the user is linked without leaking the upstream id
      (which is a stable cross-app identifier).
    """
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "created_at": user.created_at,
        "has_google": user.google_id is not None,
        "household_id": user.household_id,
    }


def _dumps(value: Any) -> bytes:
    """Compact UTF-8 JSON bytes for a single value, applying _json_default."""
    return json.dumps(value, default=_json_default, separators=(",", ":")).encode("utf-8")


# ── Export ────────────────────────────────────────────────────────────────────


@router.get("/export")
async def export_my_data(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a JSON document containing every row tied to this user.

    The document is assembled key-by-key. Heavy tables (transactions,
    account_snapshots, llm_audit) use ``db.stream`` to avoid loading
    everything into process memory before the first byte ships.
    """
    store = _get_rate_limit_store(request)
    rl = await store.check_and_increment(
        f"me:export:{user.id}", _EXPORT_LIMIT_PER_DAY, _EXPORT_WINDOW_SECONDS
    )
    if rl.over:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Export rate limit reached ({_EXPORT_LIMIT_PER_DAY}/day). Try again later.",
        )

    household_id = user.household_id
    today = datetime.now(timezone.utc).date().isoformat()
    filename = f"clarity-export-{user.id}-{today}.json"

    async def gen() -> AsyncIterator[bytes]:
        # State for "is this the first key?" — controls whether we prepend a
        # comma to the next key's bytes.
        first = True

        def key_header(name: str) -> bytes:
            nonlocal first
            sep = b"" if first else b","
            first = False
            return sep + json.dumps(name).encode("utf-8") + b":"

        yield b"{"

        # ── always-present meta ──
        yield key_header("exported_at")
        yield _dumps(datetime.now(timezone.utc).isoformat())
        yield key_header("schema_version")
        yield _dumps(1)

        # ── user (sanitized) ──
        yield key_header("user")
        yield _dumps(_sanitize_user(user))

        # ── household ──
        h_res = await db.execute(select(Household).where(Household.id == household_id))
        household = h_res.scalar_one_or_none()
        if household is not None:
            yield key_header("household")
            yield _dumps(_row_to_dict(household))

        # Helper for "small" tables (loaded in one shot). Only emits the key
        # if there's at least one row — keeps the document compact.
        async def emit_small(name: str, stmt) -> AsyncIterator[bytes]:
            res = await db.execute(stmt)
            rows = res.scalars().all()
            if not rows:
                return
            yield key_header(name)
            yield b"["
            sep = b""
            for r in rows:
                yield sep + _dumps(_row_to_dict(r))
                sep = b","
            yield b"]"

        # accounts
        async for chunk in emit_small(
            "accounts",
            select(Account).where(Account.household_id == household_id).order_by(Account.created_at),
        ):
            yield chunk

        # account_id list — used to scope account_snapshots, transactions, imports.
        account_id_res = await db.execute(
            select(Account.id).where(Account.household_id == household_id)
        )
        account_ids = [row[0] for row in account_id_res.all()]

        async for chunk in emit_small(
            "category_groups",
            select(CategoryGroup)
            .where(CategoryGroup.household_id == household_id)
            .order_by(CategoryGroup.sort_order),
        ):
            yield chunk

        async for chunk in emit_small(
            "categories",
            select(Category)
            .join(CategoryGroup, Category.group_id == CategoryGroup.id)
            .where(CategoryGroup.household_id == household_id)
            .order_by(Category.sort_order),
        ):
            yield chunk

        async for chunk in emit_small(
            "budgets",
            select(BudgetAssignment).where(BudgetAssignment.household_id == household_id),
        ):
            yield chunk

        async for chunk in emit_small(
            "goals",
            select(FinancialGoal)
            .where(FinancialGoal.household_id == household_id)
            .order_by(FinancialGoal.sort_order),
        ):
            yield chunk

        async for chunk in emit_small(
            "rules",
            select(AutoCategorizationRule)
            .where(AutoCategorizationRule.household_id == household_id)
            .order_by(AutoCategorizationRule.priority),
        ):
            yield chunk

        async for chunk in emit_small(
            "recurring",
            select(RecurringTransaction).where(
                RecurringTransaction.household_id == household_id
            ),
        ):
            yield chunk

        async for chunk in emit_small(
            "payees",
            select(Payee).where(Payee.household_id == household_id).order_by(Payee.name),
        ):
            yield chunk

        if account_ids:
            async for chunk in emit_small(
                "imports",
                select(ImportBatch)
                .where(ImportBatch.account_id.in_(account_ids))
                .order_by(ImportBatch.imported_at),
            ):
                yield chunk

        async for chunk in emit_small(
            "fsa_review",
            select(FsaReviewItem).where(FsaReviewItem.household_id == household_id),
        ):
            yield chunk

        async for chunk in emit_small(
            "llm_consent",
            select(LlmConsent)
            .where(LlmConsent.user_id == user.id)
            .order_by(LlmConsent.granted_at),
        ):
            yield chunk

        # ── heavy tables: row-by-row stream ──
        async def emit_streamed(name: str, stmt) -> AsyncIterator[bytes]:
            # Probe with a small fetch so we don't emit a key for an empty
            # set (matches the "omit empty" rule used by emit_small).
            stream = await db.stream(stmt)
            scalars = stream.scalars()
            # Pull the first row to decide whether to emit the key at all.
            try:
                first_row = await scalars.__anext__()
            except StopAsyncIteration:
                return
            yield key_header(name)
            yield b"["
            yield _dumps(_row_to_dict(first_row))
            async for row in scalars:
                yield b"," + _dumps(_row_to_dict(row))
            yield b"]"

        if account_ids:
            async for chunk in emit_streamed(
                "transactions",
                select(Transaction)
                .where(Transaction.account_id.in_(account_ids))
                .order_by(Transaction.date, Transaction.id),
            ):
                yield chunk

            async for chunk in emit_streamed(
                "account_snapshots",
                select(AccountSnapshot)
                .where(AccountSnapshot.account_id.in_(account_ids))
                .order_by(AccountSnapshot.date),
            ):
                yield chunk

        async for chunk in emit_streamed(
            "llm_audit",
            select(LlmAudit)
            .where(LlmAudit.user_id == user.id)
            .order_by(LlmAudit.created_at),
        ):
            yield chunk

        yield b"}"

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "no-store",
    }
    return StreamingResponse(gen(), media_type="application/json", headers=headers)


# ── Delete ────────────────────────────────────────────────────────────────────


_DELETE_CONFIRM_STRING = "delete my account and all data"


class DeleteMeRequest(BaseModel):
    confirm: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description=f'Must equal exactly: "{_DELETE_CONFIRM_STRING}"',
    )


@router.delete("")
async def delete_me(
    body: DeleteMeRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Hard-delete this user. Cascade-deletes the household if empty after.

    Steps:
        1. Revoke any active LLM consent (defensive — race with retention
           or cache code that might re-check consent during cleanup).
        2. Best-effort cache purge.
        3. Delete llm_audit rows for this user (no FK; explicit delete).
        4. Delete llm_consent for this user (FK does CASCADE, but be
           explicit — protects us if the SQLite test backend skips FK
           enforcement).
        5. Delete webauthn_credentials for this user (CASCADE in DDL, but
           same defensive rationale).
        6. Delete the user row.
        7. If the household has no remaining users, delete the household
           and ALL tables that reference it. Most FKs are NO ACTION at the
           DB level (default), so we do explicit deletes in dependency
           order — see ``_delete_household_cascade``.
        8. Commit.
    """
    # Rate limit BEFORE the confirm check so wrong-confirm attempts can't be
    # used to probe the confirm string indefinitely.
    store = _get_rate_limit_store(request)
    rl = await store.check_and_increment(
        f"me:delete:{user.id}", _DELETE_LIMIT_PER_HOUR, _DELETE_WINDOW_SECONDS
    )
    if rl.over:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Delete attempts rate limit reached ({_DELETE_LIMIT_PER_HOUR}/hour). Try again later.",
        )

    if body.confirm != _DELETE_CONFIRM_STRING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation string did not match.",
        )

    user_id = user.id
    household_id = user.household_id

    # 1. Revoke active consent.
    await db.execute(
        update(LlmConsent)
        .where(LlmConsent.user_id == user_id)
        .where(LlmConsent.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )

    # 2. Best-effort cache purge — never block the delete on a cache failure.
    try:
        from app.services.ai import cache as _cache

        await _cache.purge_user(user_id)
    except Exception as cache_err:  # pragma: no cover — log only
        logger.warning("cache.purge_user failed during user delete: %s", cache_err)

    # 3. llm_audit — no FK, must be explicit.
    await db.execute(delete(LlmAudit).where(LlmAudit.user_id == user_id))

    # 4. llm_consent — explicit even though FK is CASCADE.
    await db.execute(delete(LlmConsent).where(LlmConsent.user_id == user_id))

    # 5. webauthn_credentials — explicit even though FK is CASCADE.
    await db.execute(
        delete(WebAuthnCredential).where(WebAuthnCredential.user_id == user_id)
    )

    # 6. Delete the user row.
    user_obj = await db.get(User, user_id)
    if user_obj is not None:
        await db.delete(user_obj)
    await db.flush()

    # 7. If the household has no remaining users, wipe it.
    remaining_res = await db.execute(
        select(User.id).where(User.household_id == household_id).limit(1)
    )
    has_remaining = remaining_res.scalar_one_or_none() is not None

    household_deleted = False
    if not has_remaining:
        household_deleted = await _delete_household_cascade(db, household_id)

    await db.commit()

    logger.info(
        "user_self_delete user_id=%s household_deleted=%s",
        user_id,
        household_deleted,
    )

    return {
        "ok": True,
        "deleted_user_id": user_id,
        "household_deleted": household_deleted,
    }


async def _delete_household_cascade(db: AsyncSession, household_id: str) -> bool:
    """Delete a household and all tables that reference it, in FK order.

    Most FKs to ``households.id`` (and to descendant tables like
    ``accounts.id``, ``categories.id``) are NO ACTION at the DB level
    because the model definitions don't pass ``ondelete=`` — that's the
    SQLAlchemy default. We delete dependents explicitly in topological
    order so the final ``DELETE households`` succeeds even when the
    underlying engine enforces FKs.

    Order (bottom-up):
        fsa_review_items   (refs transactions, household)
        account_snapshots  (refs accounts)
        transactions       (refs accounts, payees, categories, import_batches)
        import_batches     (refs accounts)
        recurring_transactions (refs household, payees, categories, accounts)
        auto_categorization_rules (refs household, categories)
        budget_assignments (refs household, categories)
        financial_goals    (refs household, accounts)
        payees             (refs household, categories, accounts)
        categories         (refs category_groups)
        category_groups    (refs household)
        accounts           (refs household)
        cycle_commitments  (refs household)
        recurring_suggestion_dismissals (refs household)
        sync_log           (refs household)
        household
    """
    household = await db.get(Household, household_id)
    if household is None:
        return False

    # Account ids — needed to scope deletes on tables that only reach the
    # household via the account.
    account_ids_res = await db.execute(
        select(Account.id).where(Account.household_id == household_id)
    )
    account_ids = [row[0] for row in account_ids_res.all()]

    # fsa_review_items: scoped by household_id directly (and would also
    # block the transactions delete because it FKs the transaction id).
    await db.execute(
        delete(FsaReviewItem).where(FsaReviewItem.household_id == household_id)
    )

    if account_ids:
        await db.execute(
            delete(AccountSnapshot).where(AccountSnapshot.account_id.in_(account_ids))
        )
        # transactions: parent_transaction_id is a self-FK. Doing a single
        # bulk DELETE is fine because constraint checking happens at
        # statement end on Postgres, and SQLite skips FKs by default.
        await db.execute(
            delete(Transaction).where(Transaction.account_id.in_(account_ids))
        )
        await db.execute(
            delete(ImportBatch).where(ImportBatch.account_id.in_(account_ids))
        )

    await db.execute(
        delete(RecurringTransaction).where(
            RecurringTransaction.household_id == household_id
        )
    )
    await db.execute(
        delete(AutoCategorizationRule).where(
            AutoCategorizationRule.household_id == household_id
        )
    )
    await db.execute(
        delete(BudgetAssignment).where(BudgetAssignment.household_id == household_id)
    )
    await db.execute(
        delete(FinancialGoal).where(FinancialGoal.household_id == household_id)
    )
    await db.execute(delete(Payee).where(Payee.household_id == household_id))

    group_id_res = await db.execute(
        select(CategoryGroup.id).where(CategoryGroup.household_id == household_id)
    )
    group_ids = [row[0] for row in group_id_res.all()]
    if group_ids:
        await db.execute(delete(Category).where(Category.group_id.in_(group_ids)))

    await db.execute(
        delete(CategoryGroup).where(CategoryGroup.household_id == household_id)
    )
    await db.execute(delete(Account).where(Account.household_id == household_id))
    await db.execute(
        delete(CycleCommitment).where(CycleCommitment.household_id == household_id)
    )
    await db.execute(
        delete(RecurringSuggestionDismissal).where(
            RecurringSuggestionDismissal.household_id == household_id
        )
    )
    await db.execute(delete(SyncLog).where(SyncLog.household_id == household_id))
    await db.delete(household)
    await db.flush()
    return True
