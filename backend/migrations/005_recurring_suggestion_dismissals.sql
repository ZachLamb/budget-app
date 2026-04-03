-- Dismissals for recurring suggestions (Phase 2 paycheck / subscription flow).
CREATE TABLE IF NOT EXISTS recurring_suggestion_dismissals (
    id VARCHAR(36) PRIMARY KEY,
    household_id VARCHAR(36) NOT NULL REFERENCES households(id),
    dedupe_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recurring_suggestion_household_key UNIQUE (household_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS ix_recurring_suggestion_dismissals_household ON recurring_suggestion_dismissals (household_id);
