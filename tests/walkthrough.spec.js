// A guest goes through all five steps and downloads a calendar file.
// Runs as the light, dark and phone projects in playwright.config.js.
import { test, expect } from '@playwright/test';
import { schedulePage } from './schedule-page.js';

test('guest makes a calendar file', async ({ page, baseURL }, testInfo) => {
  // Only the local site loads: no API, fonts or analytics, so the API counts as down.
  await page.route('**/*', route => (route.request().url().startsWith(baseURL) ? route.continue() : route.abort()));
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  // Every step must fit the screen: no sideways scrolling, on a phone too.
  const step = async (view, label) => {
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    if (label) await expect(page.locator('#page-step')).toContainText(label);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} fits the screen`).toBe(true);
  };

  await page.goto('/web/index.html');
  const theme = testInfo.project.use.colorScheme;
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.click('#open-notebook');

  await step('welcome', 'Step 1 of 5');
  await page.click('#continue-guest');

  await step('app', 'Step 2 of 5');
  await expect(page.locator('#app-next')).toBeDisabled();
  await page.locator('input[name="app"][value="apple"]').check();
  await page.click('#app-next');

  await step('schedule', 'Step 3 of 5');
  await page.setInputFiles('#file-input', { name: 'My Current Schedule.html', mimeType: 'text/html', buffer: Buffer.from(schedulePage()) });
  await expect(page.locator('#read-status')).toContainText('Found 3 courses');
  await page.click('#confirm-schedule');

  await step('customize', 'Step 4 of 5');
  await page.getByRole('button', { name: 'Next: add to calendar →' }).click();

  await step('done', 'Step 5 of 5');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const ics = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('SUMMARY:TEST 1000A');
  expect(ics).toContain('SUMMARY:MOCK 2000B');
  await expect(page.locator('#done-title')).toBeVisible();

  expect(errors).toEqual([]);
});
