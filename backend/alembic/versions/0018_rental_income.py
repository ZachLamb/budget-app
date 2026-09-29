"""The whole schema, in one revision.

Revision ID: 0018_rental_income
Revises:
Create Date: 2026-09-29

This replaces the eighteen revisions that came before it. Two things
made that worth doing.

The old `0001_baseline` did not spell the schema out -- it called
``Base.metadata.create_all()``, which builds whatever the models say
TODAY. So a fresh database got today's columns, and a database stamped
years ago got only what the later deltas added. The two were not
guaranteed to be the same schema, and proving they were meant running
the whole chain and diffing it.

It also made every later revision a trap. A delta that added a column
the model already declared would crash on a fresh install, where the
baseline had just created it; one that assumed the column was absent
crashed the other way. Four of the eighteen had to be guarded against
exactly that, after three of them had already been written wrong.

Everything below is explicit. It creates one known schema on an empty
database, and it is the same schema every time.

WHY THIS KEEPS THE OLD HEAD'S REVISION ID
-----------------------------------------
`0018_rental_income` was the head when the squash happened, so every
database that existed at that moment is stamped with it. Reusing the id
means ``alembic upgrade head`` on those databases finds its own revision,
sees it is already applied, and does nothing -- which is exactly right,
because the schema is already there. The deploy runs that command on
every boot (see backend/entrypoint.sh), so anything else would have
stopped the backend from starting.

The consequence, and it is the one thing to watch: a database stamped
EARLIER than 0018 can no longer be upgraded, because the revisions
between it and here are gone. Such a database has to be brought to
0018 on the old chain first -- `git checkout` a commit before this one,
`alembic upgrade head`, then come back. There was no such database when
this was written.
"""
from alembic import op
import sqlalchemy as sa

revision = "0018_rental_income"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('households',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('simplefin_access_url', sa.String(length=1024), nullable=True),
    sa.Column('sync_interval_hours', sa.Integer(), nullable=False),
    sa.Column('ai_enabled', sa.Boolean(), nullable=False),
    sa.Column('prefer_local_server', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('debt_strategy', sa.String(length=20), nullable=True),
    sa.Column('debt_extra_monthly', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('pay_frequency', sa.String(length=20), nullable=True),
    sa.Column('pay_last_confirmed_date', sa.Date(), nullable=True),
    sa.Column('budget_framing', sa.String(length=20), server_default='strict', nullable=False),
    sa.Column('cycle_observed_at', sa.Date(), nullable=True),
    sa.Column('cycle_diagnosed_at', sa.Date(), nullable=True),
    sa.Column('cycle_decide_ack', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('cycle_review_cycle_start', sa.Date(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('llm_audit',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('feature', sa.String(length=64), nullable=False),
    sa.Column('tier', sa.Integer(), nullable=False),
    sa.Column('prompt_tokens', sa.Integer(), nullable=True),
    sa.Column('completion_tokens', sa.Integer(), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('status', sa.Integer(), nullable=False),
    sa.Column('model', sa.String(length=64), nullable=True),
    sa.Column('cache_hit', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_audit_created_at'), 'llm_audit', ['created_at'], unique=False)
    op.create_index(op.f('ix_llm_audit_user_id'), 'llm_audit', ['user_id'], unique=False)
    op.create_table('accounts',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('account_type', sa.String(length=50), nullable=False),
    sa.Column('institution', sa.String(length=255), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('is_budget_account', sa.Boolean(), nullable=False),
    sa.Column('simplefin_id', sa.String(length=255), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('interest_rate', sa.Numeric(precision=6, scale=4), nullable=True),
    sa.Column('minimum_payment', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('sync_enabled', sa.Boolean(), nullable=False),
    sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('available_balance', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_accounts_household_id'), 'accounts', ['household_id'], unique=False)
    op.create_index('ix_accounts_household_type', 'accounts', ['household_id', 'account_type'], unique=False)
    op.create_index('uq_accounts_household_simplefin', 'accounts', ['household_id', 'simplefin_id'], unique=True)
    op.create_table('category_groups',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_income', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_category_groups_household_id'), 'category_groups', ['household_id'], unique=False)
    op.create_index('ix_category_groups_household_sort', 'category_groups', ['household_id', 'sort_order'], unique=False)
    op.create_table('cycle_commitments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('cycle_start_date', sa.Date(), nullable=False),
    sa.Column('cycle_end_date', sa.Date(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_cycle_commitments_household_cycle', 'cycle_commitments', ['household_id', 'cycle_start_date'], unique=False)
    op.create_index(op.f('ix_cycle_commitments_household_id'), 'cycle_commitments', ['household_id'], unique=False)
    op.create_table('paystubs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('pay_date', sa.Date(), nullable=False),
    sa.Column('gross', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('pretax_401k', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('pretax_hsa', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('pretax_other', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('federal_withheld', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('state_withheld', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('ss_withheld', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('medicare_withheld', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('gross_ytd', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('pretax_401k_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('pretax_hsa_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('pretax_other_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('federal_withheld_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('state_withheld_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('ss_withheld_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('medicare_withheld_ytd', sa.Numeric(precision=14, scale=2), server_default=sa.text("0.00"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_paystubs_household_id'), 'paystubs', ['household_id'], unique=False)
    op.create_index('uq_paystubs_household_pay_date', 'paystubs', ['household_id', 'pay_date'], unique=True)
    op.create_table('prior_year_returns',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('filing_status', sa.String(length=40), nullable=True),
    sa.Column('state', sa.String(length=2), nullable=True),
    sa.Column('agi', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('taxable_income', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('total_tax', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('total_withheld', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('itemized', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('itemized_amount', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('schedule_e_net', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('passive_loss_carryforward', sa.Numeric(precision=14, scale=2), server_default='0.00', nullable=False),
    sa.Column('capital_loss_carryforward', sa.Numeric(precision=14, scale=2), server_default='0.00', nullable=False),
    sa.Column('qbi_carryforward', sa.Numeric(precision=14, scale=2), server_default='0.00', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_prior_year_returns_household_id'), 'prior_year_returns', ['household_id'], unique=False)
    op.create_index('uq_prior_year_returns_household_year', 'prior_year_returns', ['household_id', 'year'], unique=True)
    op.create_table('recurring_suggestion_dismissals',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('dedupe_key', sa.String(length=128), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('household_id', 'dedupe_key', name='uq_recurring_suggestion_household_key')
    )
    op.create_index(op.f('ix_recurring_suggestion_dismissals_dedupe_key'), 'recurring_suggestion_dismissals', ['dedupe_key'], unique=False)
    op.create_index(op.f('ix_recurring_suggestion_dismissals_household_id'), 'recurring_suggestion_dismissals', ['household_id'], unique=False)
    op.create_table('sync_log',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('accounts_synced', sa.Integer(), nullable=False),
    sa.Column('transactions_imported', sa.Integer(), nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sync_log_household_id'), 'sync_log', ['household_id'], unique=False)
    op.create_index('uq_sync_log_household_in_progress', 'sync_log', ['household_id'], unique=True, postgresql_where=sa.text("status = 'in_progress'"), sqlite_where=sa.text("status = 'in_progress'"))
    op.create_table('tax_profiles',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('filing_status', sa.String(length=40), nullable=True),
    sa.Column('state', sa.String(length=2), nullable=True),
    sa.Column('walkthrough_answers', sa.JSON(), nullable=True),
    sa.Column('walkthrough_completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('de_minimis_election', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('rental_treatment', sa.String(length=20), nullable=True),
    sa.Column('rental_active_participation', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_tax_profiles_household_id'), 'tax_profiles', ['household_id'], unique=True)
    op.create_table('users',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('google_id', sa.String(length=255), nullable=True),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('session_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_google_id'), 'users', ['google_id'], unique=True)
    op.create_table('account_snapshots',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('balance', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_account_snapshots_account_date', 'account_snapshots', ['account_id', 'date'], unique=True)
    op.create_index(op.f('ix_account_snapshots_account_id'), 'account_snapshots', ['account_id'], unique=False)
    op.create_table('categories',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('group_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('goal_type', sa.String(length=30), nullable=False),
    sa.Column('goal_amount', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('goal_target_date', sa.Date(), nullable=True),
    sa.Column('deductible', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('deduction_pct', sa.Numeric(precision=5, scale=2), server_default='100.00', nullable=False),
    sa.Column('tax_line', sa.String(length=255), nullable=True),
    sa.Column('deduction_kind', sa.String(length=30), server_default='personal_itemized', nullable=False),
    sa.Column('rental_income', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['category_groups.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_categories_group_id'), 'categories', ['group_id'], unique=False)
    op.create_table('financial_goals',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('goal_type', sa.String(length=50), nullable=False),
    sa.Column('target_amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('current_amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('monthly_contribution', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('account_id', sa.String(length=36), nullable=True),
    sa.Column('is_completed', sa.Boolean(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_financial_goals_household_id'), 'financial_goals', ['household_id'], unique=False)
    op.create_table('import_batches',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('filename', sa.String(length=500), nullable=True),
    sa.Column('transaction_count', sa.Integer(), nullable=False),
    sa.Column('imported_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_import_batches_account_id'), 'import_batches', ['account_id'], unique=False)
    op.create_table('llm_consent',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('feature', sa.String(length=64), nullable=False),
    sa.Column('tier', sa.Integer(), nullable=False),
    sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_consent_expires_at'), 'llm_consent', ['expires_at'], unique=False)
    op.create_index('ix_llm_consent_user_feature', 'llm_consent', ['user_id', 'feature'], unique=False)
    op.create_index(op.f('ix_llm_consent_user_id'), 'llm_consent', ['user_id'], unique=False)
    op.create_table('magic_links',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('requested_from_ip', sa.String(length=45), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_magic_links_expires_at'), 'magic_links', ['expires_at'], unique=False)
    op.create_index(op.f('ix_magic_links_token_hash'), 'magic_links', ['token_hash'], unique=True)
    op.create_index('ix_magic_links_user_created', 'magic_links', ['user_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_magic_links_user_id'), 'magic_links', ['user_id'], unique=False)
    op.create_table('webauthn_credentials',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('credential_id', sa.LargeBinary(), nullable=False),
    sa.Column('public_key', sa.LargeBinary(), nullable=False),
    sa.Column('sign_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_webauthn_credentials_credential_id'), 'webauthn_credentials', ['credential_id'], unique=True)
    op.create_index(op.f('ix_webauthn_credentials_user_id'), 'webauthn_credentials', ['user_id'], unique=False)
    op.create_table('auto_categorization_rules',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('match_field', sa.String(length=20), nullable=False),
    sa.Column('match_type', sa.String(length=20), nullable=False),
    sa.Column('match_value', sa.String(length=500), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=False),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_auto_categorization_rules_household_id'), 'auto_categorization_rules', ['household_id'], unique=False)
    op.create_index('ix_rules_household_priority', 'auto_categorization_rules', ['household_id', 'priority'], unique=False)
    op.create_table('budget_assignments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('assigned_amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_budget_assignments_household_id'), 'budget_assignments', ['household_id'], unique=False)
    op.create_index('ix_budget_category_month', 'budget_assignments', ['category_id', 'month'], unique=True)
    op.create_index('ix_budget_household_month', 'budget_assignments', ['household_id', 'month'], unique=False)
    op.create_table('payees',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('default_category_id', sa.String(length=36), nullable=True),
    sa.Column('transfer_account_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['default_category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.ForeignKeyConstraint(['transfer_account_id'], ['accounts.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payees_household_id'), 'payees', ['household_id'], unique=False)
    op.create_index('ix_payees_household_name', 'payees', ['household_id', 'name'], unique=True)
    op.create_table('recurring_transactions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('payee_id', sa.String(length=36), nullable=True),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=True),
    sa.Column('frequency', sa.String(length=20), nullable=False),
    sa.Column('next_date', sa.Date(), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=True),
    sa.Column('is_subscription', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.ForeignKeyConstraint(['payee_id'], ['payees.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_recurring_transactions_household_id'), 'recurring_transactions', ['household_id'], unique=False)
    op.create_table('transactions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('payee_id', sa.String(length=36), nullable=True),
    sa.Column('amount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('category_id', sa.String(length=36), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('deduction_pct_override', sa.Numeric(precision=5, scale=2), nullable=True),
    sa.Column('cleared', sa.Boolean(), nullable=False),
    sa.Column('reconciled', sa.Boolean(), nullable=False),
    sa.Column('is_split', sa.Boolean(), nullable=False),
    sa.Column('parent_transaction_id', sa.String(length=36), nullable=True),
    sa.Column('transfer_pair_id', sa.String(length=36), nullable=True),
    sa.Column('import_id', sa.String(length=36), nullable=True),
    sa.Column('simplefin_transaction_id', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ),
    sa.ForeignKeyConstraint(['import_id'], ['import_batches.id'], ),
    sa.ForeignKeyConstraint(['parent_transaction_id'], ['transactions.id'], ),
    sa.ForeignKeyConstraint(['payee_id'], ['payees.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_transactions_account_date', 'transactions', ['account_id', 'date'], unique=False)
    op.create_index(op.f('ix_transactions_account_id'), 'transactions', ['account_id'], unique=False)
    op.create_index('ix_transactions_category', 'transactions', ['category_id'], unique=False)
    op.create_index(op.f('ix_transactions_date'), 'transactions', ['date'], unique=False)
    op.create_index('ix_transactions_parent', 'transactions', ['parent_transaction_id'], unique=False)
    op.create_index('ix_transactions_transfer_pair', 'transactions', ['transfer_pair_id'], unique=False)
    op.create_index('uq_transactions_account_simplefin', 'transactions', ['account_id', 'simplefin_transaction_id'], unique=True)
    op.create_table('fsa_review_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('household_id', sa.String(length=36), nullable=False),
    sa.Column('transaction_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('fsa_category', sa.String(length=50), nullable=True),
    sa.Column('confidence', sa.String(length=10), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['household_id'], ['households.id'], ),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('household_id', 'transaction_id', name='uq_fsa_household_txn')
    )
    op.create_index(op.f('ix_fsa_review_items_household_id'), 'fsa_review_items', ['household_id'], unique=False)
    op.create_index(op.f('ix_fsa_review_items_transaction_id'), 'fsa_review_items', ['transaction_id'], unique=False)
    op.create_table('reconciliations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('account_id', sa.String(length=36), nullable=False),
    sa.Column('statement_date', sa.Date(), nullable=False),
    sa.Column('statement_balance', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('cleared_balance', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('difference', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('transaction_count', sa.Integer(), server_default=sa.text("0"), nullable=False),
    sa.Column('adjustment_transaction_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ),
    sa.ForeignKeyConstraint(['adjustment_transaction_id'], ['transactions.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_reconciliations_account_date', 'reconciliations', ['account_id', 'statement_date'], unique=False)
    op.create_index(op.f('ix_reconciliations_account_id'), 'reconciliations', ['account_id'], unique=False)


def downgrade() -> None:
    """Drop everything. Only ever right on a throwaway database."""

    op.drop_index(op.f('ix_reconciliations_account_id'), table_name='reconciliations')
    op.drop_index('ix_reconciliations_account_date', table_name='reconciliations')
    op.drop_table('reconciliations')
    op.drop_index(op.f('ix_fsa_review_items_transaction_id'), table_name='fsa_review_items')
    op.drop_index(op.f('ix_fsa_review_items_household_id'), table_name='fsa_review_items')
    op.drop_table('fsa_review_items')
    op.drop_index('uq_transactions_account_simplefin', table_name='transactions')
    op.drop_index('ix_transactions_transfer_pair', table_name='transactions')
    op.drop_index('ix_transactions_parent', table_name='transactions')
    op.drop_index(op.f('ix_transactions_date'), table_name='transactions')
    op.drop_index('ix_transactions_category', table_name='transactions')
    op.drop_index(op.f('ix_transactions_account_id'), table_name='transactions')
    op.drop_index('ix_transactions_account_date', table_name='transactions')
    op.drop_table('transactions')
    op.drop_index(op.f('ix_recurring_transactions_household_id'), table_name='recurring_transactions')
    op.drop_table('recurring_transactions')
    op.drop_index('ix_payees_household_name', table_name='payees')
    op.drop_index(op.f('ix_payees_household_id'), table_name='payees')
    op.drop_table('payees')
    op.drop_index('ix_budget_household_month', table_name='budget_assignments')
    op.drop_index('ix_budget_category_month', table_name='budget_assignments')
    op.drop_index(op.f('ix_budget_assignments_household_id'), table_name='budget_assignments')
    op.drop_table('budget_assignments')
    op.drop_index('ix_rules_household_priority', table_name='auto_categorization_rules')
    op.drop_index(op.f('ix_auto_categorization_rules_household_id'), table_name='auto_categorization_rules')
    op.drop_table('auto_categorization_rules')
    op.drop_index(op.f('ix_webauthn_credentials_user_id'), table_name='webauthn_credentials')
    op.drop_index(op.f('ix_webauthn_credentials_credential_id'), table_name='webauthn_credentials')
    op.drop_table('webauthn_credentials')
    op.drop_index(op.f('ix_magic_links_user_id'), table_name='magic_links')
    op.drop_index('ix_magic_links_user_created', table_name='magic_links')
    op.drop_index(op.f('ix_magic_links_token_hash'), table_name='magic_links')
    op.drop_index(op.f('ix_magic_links_expires_at'), table_name='magic_links')
    op.drop_table('magic_links')
    op.drop_index(op.f('ix_llm_consent_user_id'), table_name='llm_consent')
    op.drop_index('ix_llm_consent_user_feature', table_name='llm_consent')
    op.drop_index(op.f('ix_llm_consent_expires_at'), table_name='llm_consent')
    op.drop_table('llm_consent')
    op.drop_index(op.f('ix_import_batches_account_id'), table_name='import_batches')
    op.drop_table('import_batches')
    op.drop_index(op.f('ix_financial_goals_household_id'), table_name='financial_goals')
    op.drop_table('financial_goals')
    op.drop_index(op.f('ix_categories_group_id'), table_name='categories')
    op.drop_table('categories')
    op.drop_index(op.f('ix_account_snapshots_account_id'), table_name='account_snapshots')
    op.drop_index('ix_account_snapshots_account_date', table_name='account_snapshots')
    op.drop_table('account_snapshots')
    op.drop_index(op.f('ix_users_google_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_tax_profiles_household_id'), table_name='tax_profiles')
    op.drop_table('tax_profiles')
    op.drop_index('uq_sync_log_household_in_progress', table_name='sync_log', postgresql_where=sa.text("status = 'in_progress'"), sqlite_where=sa.text("status = 'in_progress'"))
    op.drop_index(op.f('ix_sync_log_household_id'), table_name='sync_log')
    op.drop_table('sync_log')
    op.drop_index(op.f('ix_recurring_suggestion_dismissals_household_id'), table_name='recurring_suggestion_dismissals')
    op.drop_index(op.f('ix_recurring_suggestion_dismissals_dedupe_key'), table_name='recurring_suggestion_dismissals')
    op.drop_table('recurring_suggestion_dismissals')
    op.drop_index('uq_prior_year_returns_household_year', table_name='prior_year_returns')
    op.drop_index(op.f('ix_prior_year_returns_household_id'), table_name='prior_year_returns')
    op.drop_table('prior_year_returns')
    op.drop_index('uq_paystubs_household_pay_date', table_name='paystubs')
    op.drop_index(op.f('ix_paystubs_household_id'), table_name='paystubs')
    op.drop_table('paystubs')
    op.drop_index(op.f('ix_cycle_commitments_household_id'), table_name='cycle_commitments')
    op.drop_index('ix_cycle_commitments_household_cycle', table_name='cycle_commitments')
    op.drop_table('cycle_commitments')
    op.drop_index('ix_category_groups_household_sort', table_name='category_groups')
    op.drop_index(op.f('ix_category_groups_household_id'), table_name='category_groups')
    op.drop_table('category_groups')
    op.drop_index('uq_accounts_household_simplefin', table_name='accounts')
    op.drop_index('ix_accounts_household_type', table_name='accounts')
    op.drop_index(op.f('ix_accounts_household_id'), table_name='accounts')
    op.drop_table('accounts')
    op.drop_index(op.f('ix_llm_audit_user_id'), table_name='llm_audit')
    op.drop_index(op.f('ix_llm_audit_created_at'), table_name='llm_audit')
    op.drop_table('llm_audit')
    op.drop_table('households')
