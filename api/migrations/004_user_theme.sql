-- 004: remember each signed-in user's light/dark choice.
ALTER TABLE users
  ADD COLUMN theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark'));
