"""prior_year_returns.state -- the half that was missed

Revision ID: 0017_prior_year_state
Revises: 0016_rental_treatment
Create Date: 2026-09-28

0014 added `state` to the TaxProfile and PriorYearReturn models but
created the column on `tax_profiles` only. Every read of a prior-year
return has failed since, which is every load of the Taxes page, with an
UndefinedColumnError behind a generic 404.

Nothing caught it: the test suite builds SQLite from the model metadata,
so the column is always there under test. Only a database that was
actually migrated is missing it. See test_migrations_match_models.py,
added with this fix, which compares the two.
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_prior_year_state"
down_revision = "0016_rental_treatment"
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
    if _has_column("prior_year_returns", "state"):
        return
    op.add_column(
        "prior_year_returns",
        sa.Column("state", sa.String(length=2), nullable=True),
    )


def downgrade() -> None:
    if not _has_column("prior_year_returns", "state"):
        return
    op.drop_column("prior_year_returns", "state")
