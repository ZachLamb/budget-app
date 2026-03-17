-- Add sync control and available balance fields to accounts,
-- and per-household sync interval.
-- New installs get the schema from create_all; only run this on existing databases.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS available_balance NUMERIC(14,2);
ALTER TABLE households ADD COLUMN IF NOT EXISTS sync_interval_hours INTEGER NOT NULL DEFAULT 4;
