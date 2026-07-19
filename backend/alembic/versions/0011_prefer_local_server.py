"""household: prefer_local_server flag for the LM Studio / local-server tier

Revision ID: 0011_prefer_local_server
Revises: 0010_cycle_review_signals
Create Date: 2026-07-18

When set, AI features route to the self-hosted OpenAI-compatible model server
(LM Studio, Ollama) as the primary model, with on-device tiers as fallback.
Defaults off so existing households keep the on-device-first behavior.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0011_prefer_local_server"
down_revision = "0010_cycle_review_signals"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns("households")}


def upgrade() -> None:
    if "prefer_local_server" not in _columns():
        op.add_column(
            "households",
            sa.Column(
                "prefer_local_server",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    if "prefer_local_server" in _columns():
        op.drop_column("households", "prefer_local_server")
