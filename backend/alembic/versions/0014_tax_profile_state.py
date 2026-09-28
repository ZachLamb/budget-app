"""tax_profiles.state

Revision ID: 0014_tax_profile_state
Revises: 0013_tax_projection_engine
Create Date: 2026-09-27

Every projection resolved to Colorado, because the rate registry hardcoded
it. A filer anywhere else was charged 4.4% of their taxable income by a
state that may not tax income at all, and nothing on the page suggested
the figure was invented.

The column is nullable and stays that way. A row with no state means the
state is unknown, which the projection reports as missing rather than
guessing -- including for every row that existed before this migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_tax_profile_state"
down_revision = "0013_tax_projection_engine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tax_profiles",
        sa.Column("state", sa.String(length=2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tax_profiles", "state")
