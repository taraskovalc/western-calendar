// Checks what the API accepts and rejects, without a database.
// Run with `npm test` in api/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SESSION_SECRET ??= 'test-only-not-a-real-secret';  // session.js refuses to load without one
const { validate } = await import('../src/validate.js');
const { registerSchema, loginSchema, settingsSchema, resetSchema } = await import('../src/routes/auth.js');
const { createSchema, updateSchema, idSchema } = await import('../src/routes/schedules.js');
const { reportSchema } = await import('../src/routes/report.js');

const courses = JSON.parse(fs.readFileSync(new URL('../examples/sample-schedule.json', import.meta.url)));
const messages = r => r.errors.map(e => e.message);
const fields = r => r.errors.map(e => e.field);

/* ---------- accounts ---------- */

test('register: trims and lowercases the email, blank name becomes no name', () => {
  const { data } = validate(registerSchema, { email: '  Taras@Example.COM ', password: 'long enough pw', displayName: '' });
  assert.equal(data.email, 'taras@example.com');
  assert.equal(data.displayName, undefined);
});

test('register: bad email and short password give our messages', () => {
  const r = validate(registerSchema, { email: 'not-an-email', password: 'short' });
  assert.deepEqual(fields(r).sort(), ['email', 'password']);
  assert.ok(messages(r).includes('Enter a valid email address'));
  assert.ok(messages(r).includes('Password must be at least 10 characters'));
});

test('register: missing fields and a wrong theme are rejected', () => {
  assert.deepEqual(fields(validate(registerSchema, {})).sort(), ['email', 'password']);
  assert.ok(validate(registerSchema, { email: 'a@b.ca', password: 'long enough pw', theme: 'pink' }).errors);
});

test('login: empty password says so', () => {
  assert.deepEqual(messages(validate(loginSchema, { email: 'a@b.ca', password: '' })), ['Enter your password']);
});

test('settings: only theme, no unknown fields', () => {
  assert.deepEqual(validate(settingsSchema, { theme: 'dark' }).data, { theme: 'dark' });
  assert.ok(validate(settingsSchema, { theme: 'dark', isAdmin: true }).errors);
});

test('reset: token must be 43 URL-safe characters', () => {
  const password = 'long enough pw';
  assert.ok(validate(resetSchema, { token: 'a'.repeat(43), password }).data);
  assert.deepEqual(messages(validate(resetSchema, { token: 'a'.repeat(42), password })), ['This reset link is not valid']);
  assert.ok(validate(resetSchema, { token: `${'a'.repeat(42)}/`, password }).errors);
});

/* ---------- saved schedules ---------- */

test('create: the sample schedule passes and gets the default settings', () => {
  const { data, errors } = validate(createSchema, { academicYear: '2026-27', courses });
  assert.equal(errors, undefined);
  assert.equal(data.name, 'My schedule');
  assert.equal(data.includeTerms, 'both');
  assert.equal(data.includeParts, 'all');
  assert.equal(data.alarmMinutes, 0);
  assert.equal(data.calendarApp, null);
  assert.equal(data.calendarColor, null);
});

test('create: missing course fields get their defaults', () => {
  const course = { subject: 'COMPSCI', number: '1026A', component: 'LAB', section: '002', title: 'Lab',
    meetings: [{ days: ['F'], start: '09:30', end: '10:30' }], repeat: {} };
  const { data } = validate(createSchema, { academicYear: '2026-27', courses: [course] });
  const c = data.courses[0];
  assert.equal(c.classNbr, '');
  assert.equal(c.instructor, '');
  assert.equal(c.meetings[0].room, '');
  assert.deepEqual(c.repeat, { every: 1, first: null, last: null });
});

test('create: colour is uppercased, bad values give our messages with the right field', () => {
  assert.equal(validate(createSchema, { academicYear: '2026-27', courses, calendarColor: '#c9562e' }).data.calendarColor, '#C9562E');
  const bad = structuredClone(courses);
  bad[0].subject = 'compsci';
  bad[0].meetings[0].end = '09:00';  // before the 10:30 start
  const r = validate(createSchema, { academicYear: '2026', courses: bad, calendarColor: 'red' });
  assert.deepEqual(r.errors.sort((a, b) => a.field.localeCompare(b.field)), [
    { field: 'academicYear', message: 'School year must look like 2026-27' },
    { field: 'calendarColor', message: 'Colour must look like #C9562E' },
    { field: 'courses.0.meetings.0.end', message: 'End time must be after start time' },
    { field: 'courses.0.subject', message: 'Subject must be capital letters, like COMPSCI' },
  ]);
});

test('create: end before start is reported on the end time', () => {
  const bad = structuredClone(courses);
  bad[0].meetings[0].end = '09:00';
  assert.deepEqual(validate(createSchema, { academicYear: '2026-27', courses: bad }).errors,
    [{ field: 'courses.0.meetings.0.end', message: 'End time must be after start time' }]);
});

test('create: repeat dates must be in order', () => {
  const c = structuredClone(courses[1]);
  c.repeat = { every: 2, first: '2026-10-01', last: '2026-09-15' };
  assert.deepEqual(validate(createSchema, { academicYear: '2026-27', courses: [c] }).errors,
    [{ field: 'courses.0.repeat.last', message: 'The last date must be on or after the first' }]);
});

test('create: unknown fields, too many or no classes are rejected', () => {
  assert.ok(validate(createSchema, { academicYear: '2026-27', courses, userId: 'someone-else' }).errors);
  assert.ok(validate(createSchema, { academicYear: '2026-27', courses: [{ ...courses[0], extra: 1 }] }).errors);
  assert.deepEqual(messages(validate(createSchema, { academicYear: '2026-27', courses: [] })), ['Add at least one class']);
  const many = Array(41).fill(courses[0]);
  assert.deepEqual(messages(validate(createSchema, { academicYear: '2026-27', courses: many })), ['At most 40 classes']);
});

test('update: needs at least one field and adds no defaults', () => {
  assert.deepEqual(messages(validate(updateSchema, {})), ['Send at least one field to change']);
  assert.deepEqual(validate(updateSchema, { name: 'Fall' }).data, { name: 'Fall' });
  assert.deepEqual(messages(validate(updateSchema, { name: '  ' })), ['Name cannot be empty']);
  assert.ok(validate(updateSchema, { name: 'Fall', id: 'x' }).errors);
});

test('ids must be UUIDs', () => {
  assert.ok(idSchema.safeParse(crypto.randomUUID()).success);
  assert.ok(!idSchema.safeParse('1 OR 1=1').success);
});

/* ---------- report a problem ---------- */

test('report: a normal report passes, empty email allowed', () => {
  const { data } = validate(reportSchema, { message: 'The download button did nothing.', step: 'schedule', email: '', device: 'Mac, Safari' });
  assert.equal(data.step, 'schedule');
  assert.equal(data.email, '');
  assert.equal(validate(reportSchema, { message: 'The download button did nothing.', email: ' Me@X.CA ' }).data.email, 'me@x.ca');
});

test('report: short message, bad email, unknown step and the bot field are rejected', () => {
  assert.deepEqual(messages(validate(reportSchema, { message: 'broken' })),
    ['Tell me a little more about what went wrong (at least 10 characters).']);
  assert.ok(validate(reportSchema, { message: 'long enough message', email: 'nope' }).errors);
  assert.ok(validate(reportSchema, { message: 'long enough message', step: 'admin' }).errors);
  assert.ok(validate(reportSchema, { message: 'long enough message', website: 'http://spam' }).errors);
});

test('report: schedule summary is limited', () => {
  const row = { course: 'COMPSCI 1026A', type: 'LEC', section: '001', days: 'M W', time: '10:30-11:30', room: 'MC-110' };
  assert.ok(validate(reportSchema, { message: 'long enough message', schedule: { read: true, rows: [row] } }).data);
  assert.ok(validate(reportSchema, { message: 'long enough message', schedule: { read: true, rows: Array(61).fill(row) } }).errors);
  assert.ok(validate(reportSchema, { message: 'long enough message', schedule: { read: true, script: 'x' } }).errors);
});
