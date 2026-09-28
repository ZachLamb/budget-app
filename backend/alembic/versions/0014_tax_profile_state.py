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


def _has_column(table: str, column: str) -> bool:
    """The baseline creates every table from `Base.metadata`, so on a
    fresh database this column already exists, while on one stamped
    before the model gained it, it does not. The migration has to work
    on both -- an unguarded ADD COLUMN crashes the whole chain on a
    fresh install."""
    bind = op.get_bind()
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}



def upgrade() -> None:
    if _has_column("tax_profiles", "state"):
        return
    op.add_column(
        "tax_profiles",
        sa.Column("state", sa.String(length=2), nullable=True),
    )


def downgrade() -> None:
    if not _has_column("tax_profiles", "state"):
        return
    op.drop_column("tax_profiles", "state")
