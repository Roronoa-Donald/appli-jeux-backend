-- Add authentication columns to users table
-- Migration 004: Support email/password authentication

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Note: Existing users without email/password can still use the app
-- They will need to register to use auth-protected features
