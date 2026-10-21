// Anonymous daily totals ("3 calendar files were downloaded on Oct 21").
// Only a number per day is kept: nothing about who, from where, or on what.
import { pool } from './db.js';

export async function countToday(kind) {
  try {
    await pool.query(
      `INSERT INTO daily_counts (day, kind, count)
       VALUES ((now() AT TIME ZONE 'America/Toronto')::date, $1, 1)
       ON CONFLICT (day, kind) DO UPDATE SET count = daily_counts.count + 1`,
      [kind],
    );
  } catch (err) {
    // A count is never worth failing someone's request over.
    console.error('Could not update daily count:', err.message);
  }
}
