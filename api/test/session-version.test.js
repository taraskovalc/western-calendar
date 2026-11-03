// Checks which sessions still count after "sign out everywhere", without a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ??= 'test-only-not-a-real-secret';  // session.js refuses to load without one
const { sessionIsCurrent } = await import('../src/require-auth.js');

test('session version: a matching copy counts, an older one or a deleted account does not', () => {
  assert.equal(sessionIsCurrent({ userId: 'u', sessionVersion: 2 }, { session_version: 2 }), true);
  assert.equal(sessionIsCurrent({ userId: 'u', sessionVersion: 1 }, { session_version: 2 }), false);
  assert.equal(sessionIsCurrent({ userId: 'u', sessionVersion: 0 }, undefined), false);
});

test('session version: sessions from before migration 012 count as version 0', () => {
  assert.equal(sessionIsCurrent({ userId: 'u' }, { session_version: 0 }), true);
  assert.equal(sessionIsCurrent({ userId: 'u' }, { session_version: 1 }), false);
});
