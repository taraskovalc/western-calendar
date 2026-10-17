// One shared connection "pool" to PostgreSQL.
// A pool keeps a few connections open and reuses them, instead of
// opening a brand-new connection for every request (which is slow).
import pg from 'pg';

// PostgreSQL "date" columns (like 2026-09-09) have no time or time zone.
// By default pg turns them into JavaScript Date objects at midnight in the
// SERVER's time zone, which can quietly shift them a day. Keep them as text.
const DATE_TYPE_ID = 1082;
pg.types.setTypeParser(DATE_TYPE_ID, value => value);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// If the database restarts, idle connections in the pool break. Without this
// listener Node treats that as an unhandled error and the whole API exits.
// The pool simply opens fresh connections on the next request.
pool.on('error', err => console.error('Idle database connection failed:', err.message));
