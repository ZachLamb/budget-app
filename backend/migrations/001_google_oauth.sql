-- Run this once if you already have a users table (e.g. before Google OAuth was added).
-- New installs get the schema from the app's create_all; no need to run this.

-- Allow NULL password for Google-only users
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Link users to Google ID (unique per Google account)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
CREATE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id);
