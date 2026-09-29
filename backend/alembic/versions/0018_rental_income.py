"""categories.rental_income, tax_profiles.rental_active_participation

Revision ID: 0018_rental_income
Revises: 0017_prior_year_state
Create Date: 2026-09-28

The engine has handled Schedule E -- rental income, allowable expenses
and the passive activity loss limitation -- since the projection engine
landed, and none of it has ever run: the assembler passed
`schedule_e=None` because nothing in the data said which income was
rent. The expense side was already identifiable (deduction_kind ==
"business_expense"); the income side had no marker at all.

`rental_income` is that marker. `rental_active_participation` decides
whether a rental LOSS is usable against wages this year; it is nullable
and only asked when there is a loss, because it makes no difference to a
profit.

The revision id is kept short deliberately: `alembic_version.version_num`
is varchar(32) on Postgres, and a longer id fails at the moment of
stamping -- after the DDL has already run. SQLite does not enforce
varchar length, so the migration test cannot catch it.

Both are guarded: `0001_baseline` builds from the current models, so a
fresh database already has these columns while a migrated one does not.
See test_migrations_match_models.py.
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_rental_income"
down_revision = "0017_prior_year_state"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    if not _has_column("categories", "rental_income"):
        op.add_column(
            "categories",
            sa.Column(
                "rental_income",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    if not _has_column("tax_profiles", "rental_active_participation"):
        op.add_column(
            "tax_profiles",
            sa.Column("rental_active_participation", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("tax_profiles", "rental_active_participation"):
        op.drop_column("tax_profiles", "rental_active_participation")
    if _has_column("categories", "rental_income"):
        op.drop_column("categories", "rental_income")
