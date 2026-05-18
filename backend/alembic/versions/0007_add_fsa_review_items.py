"""add fsa_review_items table for FSA claim/dismiss status

Revision ID: 0007_add_fsa_review_items
Revises: 0006_add_user_session_version
Create Date: 2026-05-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0007_add_fsa_review_items"
down_revision = "0006_add_user_session_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "fsa_review_items" in inspect(bind).get_table_names():
        return
    op.create_table(
        "fsa_review_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
        sa.Column("transaction_id", sa.String(36), sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("fsa_category", sa.String(50), nullable=True),
        sa.Column("confidence", sa.String(10), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("household_id", "transaction_id", name="uq_fsa_household_txn"),
    )
    op.create_index("ix_fsa_review_items_household_id", "fsa_review_items", ["household_id"])
    op.create_index("ix_fsa_review_items_transaction_id", "fsa_review_items", ["transaction_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if "fsa_review_items" not in inspect(bind).get_table_names():
        return
    op.drop_index("ix_fsa_review_items_transaction_id", table_name="fsa_review_items")
    op.drop_index("ix_fsa_review_items_household_id", table_name="fsa_review_items")
    op.drop_table("fsa_review_items")
