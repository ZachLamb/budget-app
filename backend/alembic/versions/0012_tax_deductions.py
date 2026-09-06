"""tax deductions: category/transaction deduction fields + tax_settings table

Revision ID: 0012_tax_deductions
Revises: 0011_prefer_local_server
Create Date: 2026-09-05

Adds deductible/deduction_pct/tax_line to categories, deduction_pct_override
to transactions, and a new tax_settings table holding manually entered
rate/withholding inputs (one row per household). All nullable or defaulted —
no backfill required.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0012_tax_deductions"
down_revision = "0011_prefer_local_server"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns(table)}


def _tables() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    cat_cols = _columns("categories")
    if "deductible" not in cat_cols:
        op.add_column("categories", sa.Column("deductible", sa.Boolean(), nullable=False, server_default="0"))
    if "deduction_pct" not in cat_cols:
        op.add_column("categories", sa.Column("deduction_pct", sa.Numeric(5, 2), nullable=False, server_default="100.00"))
    if "tax_line" not in cat_cols:
        op.add_column("categories", sa.Column("tax_line", sa.String(255), nullable=True))

    txn_cols = _columns("transactions")
    if "deduction_pct_override" not in txn_cols:
        op.add_column("transactions", sa.Column("deduction_pct_override", sa.Numeric(5, 2), nullable=True))

    if "tax_settings" not in _tables():
        op.create_table(
            "tax_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False, unique=True),
            sa.Column("marginal_federal_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("marginal_state_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("current_federal_withholding_per_period", sa.Numeric(10, 2), nullable=True),
            sa.Column("remaining_pay_periods_this_year", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_tax_settings_household_id", "tax_settings", ["household_id"])


def downgrade() -> None:
    if "tax_settings" in _tables():
        op.drop_index("ix_tax_settings_household_id", table_name="tax_settings")
        op.drop_table("tax_settings")
    txn_cols = _columns("transactions")
    if "deduction_pct_override" in txn_cols:
        op.drop_column("transactions", "deduction_pct_override")
    cat_cols = _columns("categories")
    if "tax_line" in cat_cols:
        op.drop_column("categories", "tax_line")
    if "deduction_pct" in cat_cols:
        op.drop_column("categories", "deduction_pct")
    if "deductible" in cat_cols:
        op.drop_column("categories", "deductible")
