// One shared connection "pool" to PostgreSQL.
// A pool keeps a few connections open and reuses them, instead of
// opening a brand-new connection for every request (which is slow).
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
