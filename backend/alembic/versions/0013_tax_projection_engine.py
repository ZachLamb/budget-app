"""tax projection engine: tax_profiles, paystubs, prior_year_returns

Revision ID: 0013_tax_projection_engine
Revises: 0012_tax_deductions
Create Date: 2026-09-19

Replaces tax_settings with tax_profiles. The four manual rate/withholding
columns are dropped -- those numbers are now computed by the engine from
paystub actuals. Existing rows are preserved as profiles with a null
filing_status, which the Taxes page prompts to fill via the walkthrough.

Adds categories.deduction_kind, defaulting to 'personal_itemized' so
existing rows keep their current meaning.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "0013_tax_projection_engine"
down_revision = "0012_tax_deductions"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns(table)}


def _tables() -> set[str]:
    bind = op.get_bind()
    return set(inspect(bind).get_table_names())


def upgrade() -> None:
    tables = _tables()

    if "tax_profiles" not in tables:
        op.create_table(
            "tax_profiles",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("filing_status", sa.String(40), nullable=True),
            sa.Column("walkthrough_answers", sa.JSON(), nullable=True),
            sa.Column("walkthrough_completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("de_minimis_election", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_tax_profiles_household_id", "tax_profiles", ["household_id"], unique=True)

        # Carry existing households forward so the feature does not appear
        # to lose their data. The rate columns are deliberately not copied.
        if "tax_settings" in tables:
            op.execute(
                "INSERT INTO tax_profiles (id, household_id, filing_status, "
                "de_minimis_election, created_at) "
                "SELECT id, household_id, NULL, FALSE, created_at FROM tax_settings"
            )

    if "paystubs" not in tables:
        op.create_table(
            "paystubs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("pay_date", sa.Date(), nullable=False),
            sa.Column("gross", sa.Numeric(14, 2), nullable=False),
            sa.Column("pretax_401k", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_hsa", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_other", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("federal_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("state_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("ss_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("medicare_withheld", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("gross_ytd", sa.Numeric(14, 2), nullable=False),
            sa.Column("pretax_401k_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_hsa_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("pretax_other_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("federal_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("state_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("ss_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("medicare_withheld_ytd", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_paystubs_household_id", "paystubs", ["household_id"])
        op.create_index("uq_paystubs_household_pay_date", "paystubs", ["household_id", "pay_date"], unique=True)

    if "prior_year_returns" not in tables:
        op.create_table(
            "prior_year_returns",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("filing_status", sa.String(40), nullable=True),
            sa.Column("agi", sa.Numeric(14, 2), nullable=True),
            sa.Column("taxable_income", sa.Numeric(14, 2), nullable=True),
            sa.Column("total_tax", sa.Numeric(14, 2), nullable=True),
            sa.Column("total_withheld", sa.Numeric(14, 2), nullable=True),
            sa.Column("itemized", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("itemized_amount", sa.Numeric(14, 2), nullable=True),
            sa.Column("schedule_e_net", sa.Numeric(14, 2), nullable=True),
            sa.Column("passive_loss_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("capital_loss_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("qbi_carryforward", sa.Numeric(14, 2), nullable=False, server_default="0.00"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_prior_year_returns_household_id", "prior_year_returns", ["household_id"])
        op.create_index("uq_prior_year_returns_household_year", "prior_year_returns", ["household_id", "year"], unique=True)

    if "deduction_kind" not in _columns("categories"):
        op.add_column(
            "categories",
            sa.Column("deduction_kind", sa.String(30), nullable=False, server_default="personal_itemized"),
        )

    if "tax_settings" in _tables():
        op.drop_table("tax_settings")


def downgrade() -> None:
    tables = _tables()
    if "tax_settings" not in tables:
        op.create_table(
            "tax_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("household_id", sa.String(36), sa.ForeignKey("households.id"), nullable=False),
            sa.Column("marginal_federal_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("marginal_state_rate", sa.Numeric(5, 2), nullable=True),
            sa.Column("current_federal_withholding_per_period", sa.Numeric(10, 2), nullable=True),
            sa.Column("remaining_pay_periods_this_year", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_tax_settings_household_id", "tax_settings", ["household_id"], unique=True)

    if "deduction_kind" in _columns("categories"):
        op.drop_column("categories", "deduction_kind")
    for table in ("prior_year_returns", "paystubs", "tax_profiles"):
        if table in _tables():
            op.drop_table(table)
