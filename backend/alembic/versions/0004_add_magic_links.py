"""add magic_links table

Revision ID: 0004_add_magic_links
Revises: 0003_add_llm_consent_expiration
Create Date: 2026-05-10

Stores SHA-256 hashes of single-use sign-in tokens emailed to users.
Idempotent on fresh DBs because the 0001 baseline runs
``Base.metadata.create_all`` which now sees this table too.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0004_add_magic_links"
down_revision = "0003_add_llm_consent_expiration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "magic_links" in set(inspect(bind).get_table_names()):
        return
    op.create_table(
        "magic_links",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("requested_from_ip", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_magic_links_user_id", "magic_links", ["user_id"])
    op.create_index("ix_magic_links_token_hash", "magic_links", ["token_hash"])
    op.create_index("ix_magic_links_expires_at", "magic_links", ["expires_at"])
    op.create_index("ix_magic_links_user_created", "magic_links", ["user_id", "created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if "magic_links" not in set(inspect(bind).get_table_names()):
        return
    op.drop_index("ix_magic_links_user_created", table_name="magic_links")
    op.drop_index("ix_magic_links_expires_at", table_name="magic_links")
    op.drop_index("ix_magic_links_token_hash", table_name="magic_links")
    op.drop_index("ix_magic_links_user_id", table_name="magic_links")
    op.drop_table("magic_links")
