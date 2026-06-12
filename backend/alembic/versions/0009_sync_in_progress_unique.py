"""partial unique index: one in_progress sync per household

Revision ID: 0009_sync_in_progress_unique
Revises: 0008_scope_simplefin_uniques
Create Date: 2026-06-12

Makes the "is a sync already running?" check atomic at the DB level. The
scheduler and the manual trigger route both INSERT the in_progress row as
the lock acquisition; concurrent claimers hit a unique violation instead of
starting duplicate syncs.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0009_sync_in_progress_unique"
down_revision = "0008_scope_simplefin_uniques"
branch_labels = None
depends_on = None

_INDEX_NAME = "uq_sync_log_household_in_progress"


def upgrade() -> None:
    bind = op.get_bind()
    existing = {ix["name"] for ix in inspect(bind).get_indexes("sync_log")}
    if _INDEX_NAME in existing:
        return

    # Stale in_progress rows (crashed background tasks) would violate the new
    # index if a household has more than one. They're dead anyway — the app
    # marks >10-minute-old in_progress syncs as errors; deploys restart the
    # process and kill running syncs.
    op.execute(
        sa.text(
            "UPDATE sync_log SET status = 'error', "
            "error_message = 'Marked stale during 0009 migration', "
            "completed_at = CURRENT_TIMESTAMP "
            "WHERE status = 'in_progress'"
        )
    )

    op.create_index(
        _INDEX_NAME,
        "sync_log",
        ["household_id"],
        unique=True,
        postgresql_where=sa.text("status = 'in_progress'"),
        sqlite_where=sa.text("status = 'in_progress'"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    existing = {ix["name"] for ix in inspect(bind).get_indexes("sync_log")}
    if _INDEX_NAME in existing:
        op.drop_index(_INDEX_NAME, table_name="sync_log")
