-- 003: where signed-in sessions are stored.
-- The browser only holds a random session ID in a cookie; this table maps that
-- ID to who is signed in. Deleting a row signs that person out instantly.
-- (Column names are the ones the connect-pg-simple package expects.)
CREATE TABLE sessions (
  sid    varchar PRIMARY KEY,
  sess   json NOT NULL,          -- what we remember, e.g. {"userId": "..."}
  expire timestamp(6) NOT NULL   -- when it stops working
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
