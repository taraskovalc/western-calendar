// Checks the email-sending limits, the other-website check and the report email, without a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ??= 'test-only-not-a-real-secret';  // session.js refuses to load without one
process.env.ALLOWED_ORIGINS = 'https://slotted.taraskoval.ca';
const { forgotLimiter, forgotEmailLimiter } = await import('../src/routes/auth.js');
const { reportLimiter } = await import('../src/routes/report.js');
const { cors } = await import('../src/cors.js');
const { buildReportEmail } = await import('../src/report-email.js');

// Runs one middleware with a fake request; resolves to the status it answered with, or 'next'.
const run = (mw, req) => new Promise(resolve => {
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json() { resolve(this.statusCode); }, send() { resolve(this.statusCode); }, end() { resolve(this.statusCode); },
  };
  mw({ ip: '203.0.113.1', method: 'POST', headers: {}, app: { get: () => 1 }, ...req }, res, () => resolve('next'));
});

test('forgot: new addresses inside one IPv6 /64 share one limit of 10', async () => {
  const results = [];
  for (let i = 1; i <= 11; i++) results.push(await run(forgotLimiter, { ip: `2001:db8:1:2::${i.toString(16)}` }));
  assert.deepEqual(results.slice(0, 10), Array(10).fill('next'));
  assert.equal(results[10], 429);
});

test('forgot: one email gets at most 5 per hour, whatever the address', async () => {
  const results = [];
  for (let i = 1; i <= 6; i++) results.push(await run(forgotEmailLimiter, { ip: `198.51.100.${i}`, body: { email: ' Victim@Example.test ' } }));
  assert.deepEqual(results.slice(0, 5), Array(5).fill('next'));
  assert.equal(results[5], 429);
  assert.equal(await run(forgotEmailLimiter, { body: { email: 'someone-else@example.test' } }), 'next');
});

test('report: new addresses inside one IPv6 /64 share one limit of 5', async () => {
  const results = [];
  for (let i = 1; i <= 6; i++) results.push(await run(reportLimiter, { ip: `2001:db8:9:9::${i}` }));
  assert.deepEqual(results.slice(0, 5), Array(5).fill('next'));
  assert.equal(results[5], 429);
});

test('other websites: writes refused, our site and non-browsers allowed, reads untouched', async () => {
  assert.equal(await run(cors, { headers: { origin: 'https://evil.taraskoval.ca' } }), 403);
  assert.equal(await run(cors, { method: 'DELETE', headers: { origin: 'null' } }), 403);
  assert.equal(await run(cors, { headers: { origin: 'https://slotted.taraskoval.ca' } }), 'next');
  assert.equal(await run(cors, {}), 'next');
  assert.equal(await run(cors, { method: 'GET', headers: { origin: 'https://evil.example' } }), 'next');
});

test('report email: a schedule marked read but with no rows does not crash', () => {
  const email = buildReportEmail({ message: 'It did not work at all', schedule: { read: true } }, false);
  assert.match(email.text, /read 0 meeting times/);
  assert.match(email.html, /read 0 classes/);
});
