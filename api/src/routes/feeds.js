// Public subscription feeds: GET /feeds/<token>.ics
//
// Calendar apps can't log in, so the long random token in the link IS the key
// (a "capability URL", like Google Calendar's secret address). No cookies, no
// sign-in: whoever has the link can read this one calendar, nothing else.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';
import { getTerms } from '../terms.js';
import { buildCalendar } from '../../../shared/ics.js';

export const feedsRouter = express.Router();

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;
const REFRESH_HOURS = 6;

// The links shown to the student. webcal:// tells phones and computers
// "open this in the calendar app as a subscription".
export function feedLinks(token) {
  const url = `${PUBLIC_API_URL}/feeds/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:/, 'webcal:') };
}

// Only FAILED lookups count toward the limit. Real calendar apps (even many
// students sharing one campus network) are never slowed down, but anyone
// guessing tokens is cut off after 20 misses.
const guessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Too many invalid requests',
});

const notFound = res => res.status(404).type('text/plain').send('Not found');

// GET /feeds/<token>.ics
feedsRouter.get('/:file', guessLimiter, async (req, res) => {
  const match = TOKEN_FILE.exec(req.params.file);
  if (!match) return notFound(res);

  const { rows } = await pool.query(
    `SELECT f.id AS feed_id, s.name, s.academic_year, s.courses,
            s.include_terms, s.alarm_minutes, s.updated_at
       FROM calendar_feeds f
       JOIN schedules s ON s.id = f.schedule_id
      WHERE f.token = $1`,
    [match[1]],
  );
  const feed = rows[0];
  if (!feed) return notFound(res);

  await pool.query('UPDATE calendar_feeds SET last_fetched_at = now() WHERE id = $1', [feed.feed_id]);

  const terms = await getTerms(feed.academic_year);
  const { ics } = buildCalendar({
    courses: feed.courses,
    terms,
    include: feed.include_terms,
    alarmMinutes: feed.alarm_minutes,
    calendarName: feed.name,
    refreshHours: REFRESH_HOURS,
    // Use the schedule's last-change time (not "right now") so the file is
    // identical until something actually changes. Then the ETag stays the same
    // and repeat checks get a tiny "304 Not Modified" instead of the whole file.
    now: new Date(feed.updated_at),
  });

  // "no-cache" = you may keep a copy, but always ask us if it's still current.
  res.set('Cache-Control', 'private, no-cache');
  res.type('text/calendar').send(ics);
});
