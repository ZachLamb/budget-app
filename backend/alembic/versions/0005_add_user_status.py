"""add users.status column for approval gate

Revision ID: 0005_add_user_status
Revises: 0004_add_magic_links
Create Date: 2026-05-10

Adds a "pending" | "approved" | "rejected" status to every user. The
auth gate (services.auth.admin_gate) blocks login for any non-approved
user. Existing rows are backfilled to "approved" via server_default so
we don't lock anyone out retroactively. New rows from the ORM default
to "pending" (set in models.user); the bootstrap helper promotes the
single ADMIN_EMAIL user to "approved" on next login.

Idempotent on fresh DBs because the baseline runs Base.metadata.create_all
which now sees the column.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0005_add_user_status"
down_revision = "0004_add_magic_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("users")}
    if "status" in cols:
        return
    # server_default="approved" backfills existing rows. The ORM-level default
    # of "pending" (in models.user) takes over for new INSERTs that don't
    # explicitly set the column — but every code path that creates a User
    # should explicitly set status, so the default is just a safety net.
    op.add_column(
        "users",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="approved"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("users")}
    if "status" not in cols:
        return
    op.drop_column("users", "status")
