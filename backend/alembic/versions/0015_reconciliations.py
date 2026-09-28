"""reconciliations

Revision ID: 0015_reconciliations
Revises: 0014_tax_profile_state
Create Date: 2026-09-28

`reconciled` existed on transactions as a checkbox in an edit dialog and
nothing else -- a flag with no flow behind it, which meant the question
it was meant to answer ("does this account agree with the bank, and as
of when") had no answer anywhere in the app.

This table records a statement that was signed off: the figure it was
checked against, what the app computed at the time, and the gap between
them. `cleared_balance` is stored rather than derived because deriving
it later gives a different number once transactions are edited, and the
point of the record is what was true on the day.
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_reconciliations"
down_revision = "0014_tax_profile_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reconciliations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "account_id",
            sa.String(length=36),
            sa.ForeignKey("accounts.id"),
            nullable=False,
        ),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("statement_balance", sa.Numeric(14, 2), nullable=False),
        sa.Column("cleared_balance", sa.Numeric(14, 2), nullable=False),
        sa.Column("difference", sa.Numeric(14, 2), nullable=False),
        sa.Column("transaction_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "adjustment_transaction_id",
            sa.String(length=36),
            sa.ForeignKey("transactions.id"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_reconciliations_account_id", "reconciliations", ["account_id"])
    op.create_index(
        "ix_reconciliations_account_date",
        "reconciliations",
        ["account_id", "statement_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_reconciliations_account_date", table_name="reconciliations")
    op.drop_index("ix_reconciliations_account_id", table_name="reconciliations")
    op.drop_table("reconciliations")
