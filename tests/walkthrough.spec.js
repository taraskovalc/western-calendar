// A guest goes through all five steps and downloads a calendar file.
// Runs as the light, dark and phone projects in playwright.config.js.
import { test, expect } from '@playwright/test';
import { schedulePage } from './schedule-page.js';
import { localSiteWithCsp } from './csp.js';

test('guest makes a calendar file', async ({ page, baseURL }, testInfo) => {
  // Only the local site loads (so the API counts as down), under the site's CSP.
  const errors = await localSiteWithCsp(page, baseURL);

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

test('privacy and report pages load under the CSP', async ({ page, baseURL }) => {
  const errors = await localSiteWithCsp(page, baseURL);
  for (const path of ['/web/privacy.html', '/web/report.html']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
  }
  await expect(page.locator('form.report-form')).toBeVisible();
  // The report form reads an attached schedule file and lists what it found.
  const preview = page.locator('.file-preview');
  await page.setInputFiles('input[name="file"]', { name: 'My Current Schedule.html', mimeType: 'text/html', buffer: Buffer.from(schedulePage()) });
  await expect(preview).toContainText('Slotted read');
  await expect(preview.locator('li')).not.toHaveCount(0);
  await page.setInputFiles('input[name="file"]', { name: 'other.html', mimeType: 'text/html', buffer: Buffer.from('<p>not a schedule</p>') });
  await expect(preview).toContainText("Slotted couldn't read this file:");
  await preview.getByRole('button', { name: 'Remove it' }).click();
  await expect(preview).toBeHidden();
  expect(errors).toEqual([]);
});

test('a message from the Chrome extension shows its note', async ({ page, baseURL }) => {
  const errors = await localSiteWithCsp(page, baseURL);
  await page.goto('/web/index.html');
  await page.evaluate(() => postMessage({ source: 'slotted-extension', type: 'expired' }, location.origin));
  await expect(page.locator('#extension-note b')).toHaveText('Send to Slotted');
  expect(errors).toEqual([]);
});

test('a schedule kept through the Google sign-in trip shows its note', async ({ page, baseURL }) => {
  const errors = await localSiteWithCsp(page, baseURL);
  await page.addInitScript(() => sessionStorage.setItem('slotted-pending-schedule', '<p>made-up schedule</p>'));
  await page.goto('/web/index.html');
  await expect(page.locator('#extension-note b')).toHaveText('Your schedule from DraftMySchedule is still here.');
  await expect(page.locator('#extension-note')).not.toContainText('<b>');
  expect(errors).toEqual([]);
});

test('a reset link shows which account it is for before asking for a password', async ({ page, baseURL }) => {
  const errors = await localSiteWithCsp(page, baseURL);
  let reply = { json: { email: 'owner@example.com' } };
  const headers = { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' };
  await page.route('http://localhost:3000/auth/reset/check', route => route.fulfill({ headers, ...reply }));
  const password = page.locator('#reset-form input[name="password"]');

  await page.goto(`/web/index.html?reset=${'a'.repeat(43)}`);
  await expect(page.locator('#reset-email')).toHaveText('owner@example.com');
  await expect(password).toBeVisible();

  reply = { status: 400, json: { error: 'This reset link has expired or was already used. Ask for a new one.' } };
  await page.goto(`/web/index.html?reset=${'b'.repeat(43)}`);
  await expect(page.locator('#reset-form .form-status')).toHaveText(/expired or was already used/);
  await expect(password).toBeHidden();
  await expect(page.locator('#reset-for')).toBeHidden();
  expect(errors).toEqual([]);
});
