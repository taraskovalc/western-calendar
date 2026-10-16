-- 005: "Forgot your password?" links.
-- We store only a SHA-256 hash of each reset token, never the token itself, so
-- even someone who could read the database couldn't use a pending reset link.
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
