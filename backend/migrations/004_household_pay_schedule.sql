-- Paycheck-cycle settings (observation-first budgeting). Run manually against your DB if you use numbered SQL migrations.
ALTER TABLE households ADD COLUMN IF NOT EXISTS pay_frequency VARCHAR(20);
ALTER TABLE households ADD COLUMN IF NOT EXISTS pay_last_confirmed_date DATE;
ALTER TABLE households ADD COLUMN IF NOT EXISTS budget_framing VARCHAR(20) NOT NULL DEFAULT 'strict';
