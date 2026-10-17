// Reading Western's term dates from the database.
import { pool } from './db.js';

export async function getTerms(academicYear) {
  // $1 is a placeholder: pg sends the value separately from the SQL text,
  // so input can never be treated as SQL (this is what prevents SQL injection).
  // ::text[] sends the list of days off as plain 'YYYY-MM-DD' text. Without it,
  // pg turns each one into a JavaScript Date (our date fix in db.js only
  // covers single dates, not lists of dates).
  const { rows } = await pool.query(
    `SELECT season, starts_on, ends_on, no_class_dates::text[] AS no_class_dates, quarters
       FROM terms
      WHERE academic_year = $1
      ORDER BY starts_on`,
    [academicYear],
  );
  return rows;
}
