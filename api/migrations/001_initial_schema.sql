-- 001: the first version of the database.
-- Each table below is explained in the chat walkthrough. Never edit this file
-- after it has run on the server; make a new numbered file instead.

-- People who created an account.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text,                          -- NULL for people who only sign in with Google/Microsoft
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Links an account to Google or Microsoft sign-in. One person can have several.
CREATE TABLE oauth_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_user_id text NOT NULL,              -- the ID Google/Microsoft gives that person
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX oauth_accounts_user_id_idx ON oauth_accounts (user_id);

-- Western's term dates. Updating these each year is now a database row, not a code change.
CREATE TABLE terms (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  academic_year  text NOT NULL,                -- e.g. '2026-27'
  season         text NOT NULL CHECK (season IN ('fall', 'winter')),
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  no_class_dates date[] NOT NULL DEFAULT '{}', -- holidays and reading-week days
  UNIQUE (academic_year, season),
  CHECK (ends_on > starts_on)
);

-- A saved schedule. The classes themselves are stored as JSON (see the walkthrough for why).
CREATE TABLE schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  name          text NOT NULL DEFAULT 'My schedule',
  courses       jsonb NOT NULL,
  include_terms text NOT NULL DEFAULT 'both' CHECK (include_terms IN ('fall', 'winter', 'both')),
  alarm_minutes integer NOT NULL DEFAULT 0 CHECK (alarm_minutes BETWEEN 0 AND 120),
  calendar_app  text CHECK (calendar_app IN ('apple', 'google', 'outlook')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedules_user_id_idx ON schedules (user_id);

-- Subscription links. One per schedule; "Reset link" just replaces the token.
CREATE TABLE calendar_feeds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     uuid NOT NULL UNIQUE REFERENCES schedules (id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,        -- the random secret part of the link
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_fetched_at timestamptz                  -- when a calendar app last checked it
);
