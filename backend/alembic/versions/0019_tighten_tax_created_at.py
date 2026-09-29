"""created_at on the tax tables is NOT NULL, as the models always said

Revision ID: 0019_tighten_tax_created_at
Revises: 0018_rental_income
Create Date: 2026-09-29

0013 created `tax_profiles`, `paystubs` and `prior_year_returns` with a
nullable `created_at`, because it was copying rows across from the old
`tax_settings` table and could not promise every one of them had a
timestamp. The models have declared it non-optional the whole time.

Nothing depended on the difference, which is why it survived. It only
surfaced when the migrations were squashed and the schema a fresh
install gets was diffed against the schema a migrated one has -- the
whole point of that squash being that the two should be the same. Left
alone it would have meant new databases getting NOT NULL and old ones
keeping NULL, which is the drift the squash exists to end.

The backfill is not cosmetic: the constraint cannot be added while a
NULL is present, and a row with no creation time still has to get one.
CURRENT_TIMESTAMP is the honest choice -- the real value is
unrecoverable, and it is only ever used for ordering.

Written to run on SQLite as well as Postgres. Not because anyone
deploys on SQLite, but because the migration test replays the whole
chain against a throwaway SQLite file, and a migration it cannot run is
a migration nothing checks. Hence CURRENT_TIMESTAMP over `now()`, and
`batch_alter_table`, which SQLite needs to change a column at all and
which emits an ordinary ALTER everywhere else.
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_tighten_tax_created_at"
down_revision = "0018_rental_income"
branch_labels = None
depends_on = None

_TABLES = ("tax_profiles", "paystubs", "prior_year_returns")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(
            f"UPDATE {table} SET created_at = CURRENT_TIMESTAMP "
            "WHERE created_at IS NULL"
        )
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "created_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=False,
            )


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "created_at",
                existing_type=sa.DateTime(timezone=True),
                nullable=True,
            )
