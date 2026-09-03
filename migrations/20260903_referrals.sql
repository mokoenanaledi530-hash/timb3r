ALTER TABLE users
ADD COLUMN IF NOT EXISTS referred_by UUID
REFERENCES users(id);

CREATE INDEX IF NOT EXISTS users_referred_by_idx
ON users(referred_by);
