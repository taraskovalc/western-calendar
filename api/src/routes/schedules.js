// Saved schedules. Every route here requires being signed in, and every
// database query includes "AND user_id = <you>", so nobody can ever read or
// change someone else's schedule, even if they know its ID.
import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { validate } from '../validate.js';
import { requireAuth } from '../require-auth.js';
import { getTerms } from '../terms.js';
import { buildCalendar } from '../../../shared/ics.js';
import { feedLinks } from './feeds.js';

export const schedulesRouter = express.Router();
schedulesRouter.use(requireAuth);  // the guard runs before every route below

const MAX_SCHEDULES_PER_USER = 10;

/* ---------- what a valid schedule looks like ---------- */
const text = max => z.string().trim().max(max);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must look like 14:30');

const meetingSchema = z.object({
  days: z.array(z.enum(['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'])).max(7),
  start: time.nullable(),
  end: time.nullable(),
  room: text(40).default(''),
}).strict()
  .refine(m => !m.start || !m.end || m.end > m.start,
    { message: 'End time must be after start time', path: ['end'] });

const courseSchema = z.object({
  subject: z.string().regex(/^[A-Z]{2,10}$/, 'Subject must be capital letters, like COMPSCI'),
  number: z.string().regex(/^\d{4}[A-Z]$/, 'Course number must look like 2211A'),
  component: z.string().regex(/^[A-Z]{2,4}$/, 'Component must look like LEC or LAB'),
  section: z.string().regex(/^[0-9A-Z]{1,4}$/, 'Section must look like 001'),
  title: text(100),
  classNbr: z.string().regex(/^\d{0,6}$/, 'Class number must be digits').default(''),
  instructor: text(60).default(''),
  delivery: text(40).default(''),
  meetings: z.array(meetingSchema).min(1).max(10),
}).strict();  // .strict() = any field we don't know about is an error, not silently kept

const fields = {
  name: text(60).min(1, 'Name cannot be empty'),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, 'School year must look like 2026-27'),
  courses: z.array(courseSchema).min(1, 'Add at least one class').max(40, 'At most 40 classes'),
  includeTerms: z.enum(['fall', 'winter', 'both']),
  alarmMinutes: z.number().int().min(0).max(120),
  calendarApp: z.enum(['apple', 'google', 'outlook']).nullable(),
};
// Creating: name, year and classes are required; settings have defaults.
const createSchema = z.object({
  ...fields,
  name: fields.name.default('My schedule'),
  includeTerms: fields.includeTerms.default('both'),
  alarmMinutes: fields.alarmMinutes.default(0),
  calendarApp: fields.calendarApp.default(null),
}).strict();
// Updating: every field is optional, but at least one must be sent.
const updateSchema = z.object(fields).partial().strict()
  .refine(body => Object.keys(body).length > 0, 'Send at least one field to change');

const idSchema = z.string().uuid();

/* ---------- helpers ---------- */

// Database rows use snake_case; the API speaks camelCase (JavaScript's style).
function toSchedule(row) {
  return {
    id: row.id,
    name: row.name,
    academicYear: row.academic_year,
    includeTerms: row.include_terms,
    alarmMinutes: row.alarm_minutes,
    calendarApp: row.calendar_app,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.course_count !== undefined && { courseCount: row.course_count }),
    ...(row.courses !== undefined && { courses: row.courses }),
  };
}

async function yearExists(academicYear) {
  const { rowCount } = await pool.query('SELECT 1 FROM terms WHERE academic_year = $1 LIMIT 1', [academicYear]);
  return rowCount > 0;
}

// Loads one schedule, only if it belongs to the signed-in user.
// Not yours and doesn't exist look exactly the same from outside: null.
async function findOwnSchedule(id, userId) {
  if (!idSchema.safeParse(id).success) return null;  // not even a valid ID
  const { rows } = await pool.query('SELECT * FROM schedules WHERE id = $1 AND user_id = $2', [id, userId]);
  return rows[0] ?? null;
}

const notFound = res => res.status(404).json({ error: 'Schedule not found' });

/* ---------- routes ---------- */

// GET /schedules  ->  my schedules, newest first (without the classes, to keep it small)
schedulesRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, academic_year, include_terms, alarm_minutes, calendar_app,
            created_at, updated_at, jsonb_array_length(courses) AS course_count
       FROM schedules
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [req.userId],
  );
  res.json({ schedules: rows.map(toSchedule) });
});

// POST /schedules  ->  save a new schedule
schedulesRouter.post('/', async (req, res) => {
  const { data, errors } = validate(createSchema, req.body);
  if (errors) return res.status(400).json({ errors });
  if (!(await yearExists(data.academicYear))) {
    return res.status(400).json({ errors: [{ field: 'academicYear', message: 'No term dates for that school year yet' }] });
  }

  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM schedules WHERE user_id = $1', [req.userId]);
  if (count >= MAX_SCHEDULES_PER_USER) {
    return res.status(400).json({ error: `You can save up to ${MAX_SCHEDULES_PER_USER} schedules. Delete one first.` });
  }

  const { rows } = await pool.query(
    `INSERT INTO schedules (user_id, name, academic_year, courses, include_terms, alarm_minutes, calendar_app)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    // JSON.stringify: pg would otherwise send a JavaScript array as a
    // PostgreSQL array, not as JSON, and the insert would fail.
    [req.userId, data.name, data.academicYear, JSON.stringify(data.courses),
      data.includeTerms, data.alarmMinutes, data.calendarApp],
  );
  res.status(201).json({ schedule: toSchedule(rows[0]) });
});

// GET /schedules/:id  ->  one schedule, with its classes
schedulesRouter.get('/:id', async (req, res) => {
  const schedule = await findOwnSchedule(req.params.id, req.userId);
  if (!schedule) return notFound(res);
  res.json({ schedule: toSchedule(schedule) });
});

// PATCH /schedules/:id  ->  change some fields (rename, settings, or new classes)
schedulesRouter.patch('/:id', async (req, res) => {
  if (!(await findOwnSchedule(req.params.id, req.userId))) return notFound(res);
  const { data, errors } = validate(updateSchema, req.body);
  if (errors) return res.status(400).json({ errors });
  if (data.academicYear && !(await yearExists(data.academicYear))) {
    return res.status(400).json({ errors: [{ field: 'academicYear', message: 'No term dates for that school year yet' }] });
  }

  // Build "SET name = $1, alarm_minutes = $2, ..." from only the fields that were sent.
  // Column names come from this fixed list, never from the request, so it stays safe.
  const columns = {
    name: 'name', academicYear: 'academic_year', courses: 'courses',
    includeTerms: 'include_terms', alarmMinutes: 'alarm_minutes', calendarApp: 'calendar_app',
  };
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(columns)) {
    if (data[field] === undefined) continue;
    values.push(field === 'courses' ? JSON.stringify(data[field]) : data[field]);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(req.params.id, req.userId);
  const { rows } = await pool.query(
    `UPDATE schedules
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
      RETURNING *`,
    values,
  );
  res.json({ schedule: toSchedule(rows[0]) });
});

// DELETE /schedules/:id
schedulesRouter.delete('/:id', async (req, res) => {
  if (!idSchema.safeParse(req.params.id).success) return notFound(res);
  const { rowCount } = await pool.query('DELETE FROM schedules WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (rowCount === 0) return notFound(res);
  res.status(204).end();
});

// GET /schedules/:id/calendar.ics  ->  download this schedule as a calendar file
schedulesRouter.get('/:id/calendar.ics', async (req, res) => {
  const schedule = await findOwnSchedule(req.params.id, req.userId);
  if (!schedule) return notFound(res);
  const terms = await getTerms(schedule.academic_year);
  const { ics } = buildCalendar({
    courses: schedule.courses,
    terms,
    include: schedule.include_terms,
    alarmMinutes: schedule.alarm_minutes,
    calendarName: schedule.name,
  });
  res.type('text/calendar').attachment('western-classes.ics').send(ics);
});

/* ---------- subscription links ---------- */

// 32 random bytes from the operating system's cryptographic random generator,
// written in URL-safe base64: 43 characters, 2^256 possibilities. Unguessable.
const newToken = () => crypto.randomBytes(32).toString('base64url');

const toFeed = row => ({ ...feedLinks(row.token), createdAt: row.created_at, lastFetchedAt: row.last_fetched_at });

// GET /schedules/:id/feed  ->  the current link, or null if there isn't one
schedulesRouter.get('/:id/feed', async (req, res) => {
  if (!(await findOwnSchedule(req.params.id, req.userId))) return notFound(res);
  const { rows } = await pool.query('SELECT * FROM calendar_feeds WHERE schedule_id = $1', [req.params.id]);
  res.json({ feed: rows[0] ? toFeed(rows[0]) : null });
});

// POST /schedules/:id/feed  ->  create the link (or return the existing one)
schedulesRouter.post('/:id/feed', async (req, res) => {
  if (!(await findOwnSchedule(req.params.id, req.userId))) return notFound(res);
  // ON CONFLICT DO NOTHING: if this schedule already has a link, keep it.
  const inserted = await pool.query(
    `INSERT INTO calendar_feeds (schedule_id, token) VALUES ($1, $2)
     ON CONFLICT (schedule_id) DO NOTHING
     RETURNING *`,
    [req.params.id, newToken()],
  );
  if (inserted.rows[0]) return res.status(201).json({ feed: toFeed(inserted.rows[0]) });
  const { rows } = await pool.query('SELECT * FROM calendar_feeds WHERE schedule_id = $1', [req.params.id]);
  res.json({ feed: toFeed(rows[0]) });
});

// POST /schedules/:id/feed/reset  ->  new link; the old one stops working immediately
schedulesRouter.post('/:id/feed/reset', async (req, res) => {
  if (!(await findOwnSchedule(req.params.id, req.userId))) return notFound(res);
  const { rows } = await pool.query(
    `UPDATE calendar_feeds
        SET token = $1, created_at = now(), last_fetched_at = NULL
      WHERE schedule_id = $2
      RETURNING *`,
    [newToken(), req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'This schedule has no subscription link yet' });
  res.json({ feed: toFeed(rows[0]) });
});

// DELETE /schedules/:id/feed  ->  turn the subscription off
schedulesRouter.delete('/:id/feed', async (req, res) => {
  if (!(await findOwnSchedule(req.params.id, req.userId))) return notFound(res);
  await pool.query('DELETE FROM calendar_feeds WHERE schedule_id = $1', [req.params.id]);
  res.status(204).end();
});
