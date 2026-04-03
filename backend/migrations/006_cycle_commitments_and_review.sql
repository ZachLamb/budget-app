-- Phase 4: pay-cycle commitments + review step (resets when pay cycle anchor changes).
ALTER TABLE households ADD COLUMN IF NOT EXISTS cycle_review_step SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE households ADD COLUMN IF NOT EXISTS cycle_review_cycle_start DATE;

CREATE TABLE IF NOT EXISTS cycle_commitments (
    id VARCHAR(36) PRIMARY KEY,
    household_id VARCHAR(36) NOT NULL REFERENCES households(id),
    cycle_start_date DATE NOT NULL,
    cycle_end_date DATE NOT NULL,
    title VARCHAR(300) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    payload JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_cycle_commitments_household_cycle ON cycle_commitments (household_id, cycle_start_date);
