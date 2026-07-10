"""cycle review: replace manual step counter with per-signal columns

Revision ID: 0010_cycle_review_signals
Revises: 0009_sync_in_progress_unique
Create Date: 2026-07-10

The "This pay cycle" checklist no longer uses a manually-advanced step
counter (0-3). Progress is derived from what the user actually did this
cycle: visited Transactions (observed), visited Recurring (diagnosed),
and added a commitment or explicitly acknowledged "nothing to change"
(decide_ack). The old step value is intentionally not mapped onto the new
columns — it recorded button clicks, not the underlying actions.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0010_cycle_review_signals"
down_revision = "0009_sync_in_progress_unique"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns("households")}


def upgrade() -> None:
    existing = _columns()
    if "cycle_observed_at" not in existing:
        op.add_column("households", sa.Column("cycle_observed_at", sa.Date(), nullable=True))
    if "cycle_diagnosed_at" not in existing:
        op.add_column("households", sa.Column("cycle_diagnosed_at", sa.Date(), nullable=True))
    if "cycle_decide_ack" not in existing:
        op.add_column(
            "households",
            sa.Column("cycle_decide_ack", sa.Boolean(), nullable=False, server_default="0"),
        )
    if "cycle_review_step" in existing:
        op.drop_column("households", "cycle_review_step")


def downgrade() -> None:
    existing = _columns()
    if "cycle_review_step" not in existing:
        op.add_column(
            "households",
            sa.Column("cycle_review_step", sa.SmallInteger(), nullable=False, server_default="0"),
        )
    for col in ("cycle_observed_at", "cycle_diagnosed_at", "cycle_decide_ack"):
        if col in existing:
            op.drop_column("households", col)
