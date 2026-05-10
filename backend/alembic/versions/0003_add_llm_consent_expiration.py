"""add expires_at to llm_consent

Revision ID: 0003_add_llm_consent_expiration
Revises: 0002_add_llm_consent_audit
Create Date: 2026-05-10

Adds a 90-day expiration window to cloud (Tier 4) consent grants. The
column is nullable so existing rows in already-deployed databases don't
break — but any pre-existing row is backfilled to ``granted_at + 90 days``
so the upgrade is complete and the runtime check stays meaningful.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = "0003_add_llm_consent_expiration"
down_revision = "0002_add_llm_consent_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # On a fresh DB the 0001 baseline runs Base.metadata.create_all, which
    # already includes ``expires_at`` (it's defined on the model). Inspect
    # the live schema and only add the column if it's missing — this keeps
    # the migration safe on both fresh SQLite test DBs and existing
    # production-like Postgres deployments stamped at 0002.
    bind = op.get_bind()
    insp = inspect(bind)
    if "llm_consent" not in set(insp.get_table_names()):
        # Table doesn't exist yet — 0001/0002 will create it with the column
        # already defined on the model, nothing to do.
        return
    cols = {c["name"] for c in insp.get_columns("llm_consent")}
    if "expires_at" in cols:
        return

    op.add_column(
        "llm_consent",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_llm_consent_expires_at", "llm_consent", ["expires_at"]
    )

    # Backfill existing rows: expires_at = granted_at + 90 days. The exact
    # SQL differs between SQLite (used in tests) and Postgres (production):
    # SQLite has no INTERVAL type, so we use datetime() with a modifier.
    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.execute(
            "UPDATE llm_consent "
            "SET expires_at = datetime(granted_at, '+90 days') "
            "WHERE expires_at IS NULL"
        )
    else:
        # Postgres / most others — INTERVAL is standard SQL.
        op.execute(
            "UPDATE llm_consent "
            "SET expires_at = granted_at + INTERVAL '90 days' "
            "WHERE expires_at IS NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "llm_consent" not in set(insp.get_table_names()):
        return
    cols = {c["name"] for c in insp.get_columns("llm_consent")}
    if "expires_at" not in cols:
        return
    # Index drop is best-effort — some sqlite dumps may not have it.
    try:
        op.drop_index("ix_llm_consent_expires_at", table_name="llm_consent")
    except Exception:
        pass
    op.drop_column("llm_consent", "expires_at")
