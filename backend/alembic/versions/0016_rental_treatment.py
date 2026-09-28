"""tax_profiles.rental_treatment

Revision ID: 0016_rental_treatment
Revises: 0015_reconciliations
Create Date: 2026-09-28

The projection treated every rental as Schedule E, which owes no
self-employment tax. That is right for most rentals and wrong for a
short-term rental where the owner provides substantial services -- daily
cleaning during the stay, meals, tours -- which is a Schedule C business
and owes about 15% of its profit in self-employment tax.

Nobody was ever asked which it was. The column is nullable and stays
that way: a row with no answer means the question is unanswered, which
the projection reports as a missing input rather than resolving to the
cheaper of the two.
"""
from alembic import op
import sqlalchemy as sa

revision = "0016_rental_treatment"
down_revision = "0015_reconciliations"
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
    if _has_column("tax_profiles", "rental_treatment"):
        return
    op.add_column(
        "tax_profiles",
        sa.Column("rental_treatment", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    if not _has_column("tax_profiles", "rental_treatment"):
        return
    op.drop_column("tax_profiles", "rental_treatment")
