"""add llm_consent and llm_audit tables

Revision ID: 0002_add_llm_consent_audit
Revises: 0001_baseline
Create Date: 2026-04-26

Adds the two tables that back per-feature cloud (Tier 4) consent and the
privacy-preserving audit log. ``llm_audit`` deliberately does *not* store
prompt or completion text — only metadata. Retention is enforced out of band.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0002_add_llm_consent_audit"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_consent",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feature", sa.String(length=64), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False, server_default="4"),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_llm_consent_user_id", "llm_consent", ["user_id"])
    op.create_index("ix_llm_consent_user_feature", "llm_consent", ["user_id", "feature"])

    op.create_table(
        "llm_audit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("feature", sa.String(length=64), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("cache_hit", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_llm_audit_user_id", "llm_audit", ["user_id"])
    op.create_index("ix_llm_audit_created_at", "llm_audit", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_llm_audit_created_at", table_name="llm_audit")
    op.drop_index("ix_llm_audit_user_id", table_name="llm_audit")
    op.drop_table("llm_audit")
    op.drop_index("ix_llm_consent_user_feature", table_name="llm_consent")
    op.drop_index("ix_llm_consent_user_id", table_name="llm_consent")
    op.drop_table("llm_consent")
