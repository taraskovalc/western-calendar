-- 012: "Sign out everywhere" (password reset, linking Google) adds 1 here. A
-- session signed in with an older number no longer counts. Existing sessions
-- have no copy and count as 0, the default, so nobody is signed out by this.
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
