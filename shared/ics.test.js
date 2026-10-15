// Automated tests for ics.js. Run from the project folder with:  node --test shared/ics.test.js
// Uses made-up classes so no real schedule is ever committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, seasonsFor } from './ics.js';

const terms = [
  { season: 'fall', starts_on: '2026-09-09', ends_on: '2026-12-09',
    no_class_dates: ['2026-09-30', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'] },
  { season: 'winter', starts_on: '2027-01-04', ends_on: '2027-04-09',
    no_class_dates: ['2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', '2027-02-19', '2027-03-26'] },
];
const fallClass = {
  subject: 'TEST', number: '1000A', component: 'LEC', section: '001', title: 'Testing, Part I',
  instructor: 'Staff', delivery: 'In Person',
  meetings: [{ days: ['M', 'W'], start: '14:30', end: '15:30', room: 'MC-110' }],
};
const winterClass = { ...fallClass, number: '2000B', meetings: [{ days: ['F'], start: '08:30', end: '10:30', room: 'NSC-1' }] };
const onlineClass = { ...fallClass, number: '3000G', delivery: 'Online', meetings: [{ days: [], start: null, end: null }] };
const fixedNow = new Date('2026-10-15T12:00:00Z');

test('course letters map to the right terms', () => {
  assert.deepEqual(seasonsFor('1000A'), ['fall']);
  assert.deepEqual(seasonsFor('2000B'), ['winter']);
  assert.deepEqual(seasonsFor('1026E'), ['fall', 'winter']);
});

test('first class is the first matching weekday of the term', () => {
  // Sep 9 2026 is a Wednesday, so a Mon/Wed class starts that day.
  const { ics } = buildCalendar({ courses: [fallClass], terms, now: fixedNow });
  assert.match(ics, /DTSTART;TZID=America\/Toronto:20260909T143000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261210T035959Z/);
});

test('days off are skipped only on days the class meets', () => {
  const { ics } = buildCalendar({ courses: [fallClass], terms, now: fixedNow });
  const exdates = ics.match(/EXDATE[^\r]*/g);
  // Mon Oct 12 + Wed Sep 30 + Wed Oct 14 — but not Tue/Thu/Fri.
  assert.equal(exdates.length, 3);
});

test('"include" picks one term', () => {
  const both = buildCalendar({ courses: [fallClass, winterClass], terms, now: fixedNow });
  const fallOnly = buildCalendar({ courses: [fallClass, winterClass], terms, include: 'fall', now: fixedNow });
  assert.equal(both.added.length, 2);
  assert.deepEqual(fallOnly.added.map(a => a.season), ['fall']);
});

test('online classes with no time are reported, not added', () => {
  const { added, skipped } = buildCalendar({ courses: [onlineClass], terms, now: fixedNow });
  assert.equal(added.length, 0);
  assert.equal(skipped[0].reason, 'Online');
});

test('special characters are escaped and long lines folded', () => {
  const { ics } = buildCalendar({ courses: [fallClass], terms, alarmMinutes: 10, now: fixedNow });
  assert.match(ics, /Testing\\, Part I/);
  assert.match(ics, /TRIGGER:-PT10M/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
});

test('the same class always gets the same UID', () => {
  const a = buildCalendar({ courses: [fallClass], terms, now: fixedNow }).ics.match(/UID:\S+/)[0];
  const b = buildCalendar({ courses: [fallClass], terms, now: new Date() }).ics.match(/UID:\S+/)[0];
  assert.equal(a, b);
});
