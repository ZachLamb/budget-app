"""add users.session_version for server-side session invalidation

Revision ID: 0006_add_user_session_version
Revises: 0005_add_user_status
Create Date: 2026-05-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0006_add_user_session_version"
down_revision = "0005_add_user_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("users")}
    if "session_version" in cols:
        return
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("users")}
    if "session_version" not in cols:
        return
    op.drop_column("users", "session_version")
