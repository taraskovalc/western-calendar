// Tests for web/parser.js. It needs a browser (DOMParser), so it runs in one.
import { test, expect } from '@playwright/test';
import { schedulePage, COURSES } from './schedule-page.js';

// Runs readSchedule in the page; errors come back as { error, complete }.
const read = (page, html) => page.evaluate(async html => {
  const { readSchedule, ScheduleReadError } = await import('/web/parser.js');
  try { return readSchedule(html); } catch (e) {
    return { error: e.message, complete: !!e.complete, readError: e instanceof ScheduleReadError };
  }
}, html);

test.beforeEach(async ({ page }) => { await page.goto('/web/robots.txt'); });

test('reads every course with its times, rooms and school year', async ({ page }) => {
  const { courses, academicYear, notes } = await read(page, schedulePage());
  expect(academicYear).toBe('2026-27');
  expect(notes).toEqual([]);
  expect(courses).toHaveLength(4);
  expect(courses[0]).toEqual({
    subject: 'TEST', number: '1000A', component: 'LEC', section: '001', title: 'Intro To Testing II',
    classNbr: '1111', instructor: 'Staff', delivery: 'In Person',
    meetings: [
      { days: ['M', 'W'], start: '14:30', end: '15:30', room: 'MC-110' },
      { days: ['F'], start: '09:30', end: '10:30', room: 'MC-110' },
    ],
  });
  expect(courses[1].meetings[0]).toEqual({ days: ['Th'], start: '11:30', end: '13:30', room: 'NSC-7' });
});

test('a class without set times keeps empty times', async ({ page }) => {
  const { courses } = await read(page, schedulePage());
  expect(courses[3].meetings).toEqual([{ days: [], start: null, end: null, room: '' }]);
});

test('the heading, not the term menu, decides the school year', async ({ page }) => {
  // The menu lists Fall/Winter 2025 first; the heading says 2027.
  const { academicYear } = await read(page, schedulePage({ term: 'Fall/Winter 2027' }));
  expect(academicYear).toBe('2027-28');
});

test('a Summer schedule is refused with a complete message', async ({ page }) => {
  const result = await read(page, schedulePage({ term: 'Summer 2026' }));
  expect(result).toMatchObject({ readError: true, complete: true });
  expect(result.error).toContain('Summer 2026');
});

test('a page without a class list is refused', async ({ page }) => {
  const result = await read(page, '<html><body><table><tr><td>Build Draft</td></tr></table></body></html>');
  expect(result).toEqual({ error: "This file doesn't contain a DraftMySchedule class list.", complete: false, readError: true });
});

test('an empty class list is refused', async ({ page }) => {
  const result = await read(page, schedulePage({ courses: [] }));
  expect(result.error).toBe('The class list in this file is empty.');
});

test('waitlisted and odd rows are noted', async ({ page }) => {
  const courses = [
    { ...COURSES[0], status: 'Waitlisted' },
    { ...COURSES[2], status: 'Dropped' },
    { ...COURSES[2], number: 'XYZ' },
  ];
  const result = await read(page, schedulePage({ courses }));
  expect(result.courses).toHaveLength(2);
  expect(result.notes).toEqual([
    'TEST 1000A LEC is waitlisted, not enrolled. It\'s included for now; make a new file if you don\'t get in.',
    'MOCK 2000B LEC is marked "Dropped", not enrolled. It\'s still included.',
    'Skipped a row that didn\'t look like a course (MOCK XYZ).',
  ]);
});

test('page text never runs as code', async ({ page }) => {
  const evil = { ...COURSES[0], description: '<img src=x onerror="window.ran=1">TRAP', instructor: '<script>window.ran=1</script>Staff' };
  const { courses } = await read(page, schedulePage({ courses: [evil] }));
  expect(courses[0].title).toBe('Trap');
  expect(await page.evaluate(() => window.ran)).toBeUndefined();
});
