-- Persist the claimed SimpleFIN access URL on the household record so
-- subsequent syncs reuse it instead of trying to re-claim the setup token.
-- New installs get the schema from create_all; only run this on existing databases.

ALTER TABLE households ADD COLUMN IF NOT EXISTS simplefin_access_url VARCHAR(1024);
