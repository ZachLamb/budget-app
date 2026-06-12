"""scope simplefin unique constraints to household/account

Revision ID: 0008_scope_simplefin_uniques
Revises: 0007_add_fsa_review_items
Create Date: 2026-06-12

Previously ``accounts.simplefin_id`` and
``transactions.simplefin_transaction_id`` were globally unique, which let one
household's SimpleFIN sync resolve (and mutate) another household's rows.
Uniqueness is now scoped to ``(household_id, simplefin_id)`` and
``(account_id, simplefin_transaction_id)`` respectively.

Existing data cannot violate the new scoped indexes because the old global
uniqueness was strictly stronger.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect


revision = "0008_scope_simplefin_uniques"
down_revision = "0007_add_fsa_review_items"
branch_labels = None
depends_on = None


def _existing_indexes(bind, table: str) -> set[str]:
    return {ix["name"] for ix in inspect(bind).get_indexes(table)}


def _existing_uniques(bind, table: str) -> set[str]:
    return {uc["name"] for uc in inspect(bind).get_unique_constraints(table)}


def upgrade() -> None:
    bind = op.get_bind()

    # accounts.simplefin_id: drop the column-level unique (create_all named it
    # accounts_simplefin_id_key on Postgres), then add the scoped index.
    if "accounts_simplefin_id_key" in _existing_uniques(bind, "accounts"):
        op.drop_constraint("accounts_simplefin_id_key", "accounts", type_="unique")
    if "uq_accounts_household_simplefin" not in _existing_indexes(bind, "accounts"):
        op.create_index(
            "uq_accounts_household_simplefin",
            "accounts",
            ["household_id", "simplefin_id"],
            unique=True,
        )

    # transactions.simplefin_transaction_id: replace the global unique index
    # with one scoped to the account.
    txn_indexes = _existing_indexes(bind, "transactions")
    if "ix_transactions_simplefin_id" in txn_indexes:
        op.drop_index("ix_transactions_simplefin_id", table_name="transactions")
    if "uq_transactions_account_simplefin" not in txn_indexes:
        op.create_index(
            "uq_transactions_account_simplefin",
            "transactions",
            ["account_id", "simplefin_transaction_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()

    if "uq_transactions_account_simplefin" in _existing_indexes(bind, "transactions"):
        op.drop_index("uq_transactions_account_simplefin", table_name="transactions")
    op.create_index(
        "ix_transactions_simplefin_id",
        "transactions",
        ["simplefin_transaction_id"],
        unique=True,
    )

    if "uq_accounts_household_simplefin" in _existing_indexes(bind, "accounts"):
        op.drop_index("uq_accounts_household_simplefin", table_name="accounts")
    op.create_unique_constraint("accounts_simplefin_id_key", "accounts", ["simplefin_id"])
