// Checks how the login limit groups client addresses. Run with `npm test` in api/.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ??= 'test-only-not-a-real-secret';  // session.js refuses to load without one
const { ipKey } = await import('../src/routes/auth.js');

test('ipKey: every way of writing addresses in one IPv6 /56 gives one key', () => {
  const forms = [
    '2001:db8:abcd:1200::1',
    '2001:0DB8:ABCD:1200:0000:0000:0000:0001',
    '2001:db8:abcd:1234:5678:9abc:def0:1',
    '2001:db8:abcd:12ff::',
    '2001:db8:abcd:1200::1.2.3.4',
    '2001:db8:abcd:1200::1%eth0',
  ];
  assert.equal(new Set(forms.map(ipKey)).size, 1);
});

test('ipKey: different /56 prefixes give different keys', () => {
  const keys = ['2001:db8:abcd:1200::1', '2001:db8:abcd:1300::1', '2001:db8:abce:1200::1', '2001:db9:abcd:1200::1', '2001:db8:abcd:11ff::1', '::1']
    .map(ipKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('ipKey: IPv4 stays exact, and IPv4-mapped IPv6 counts as that IPv4 address', () => {
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::FFFF:cb00:7107'), '203.0.113.7');
  assert.equal(ipKey('0:0:0:0:0:ffff:203.0.113.7'), '203.0.113.7');
  assert.notEqual(ipKey('203.0.113.8'), ipKey('203.0.113.7'));
});

test('ipKey: anything that is not an IP address is passed through', () => {
  assert.equal(ipKey(undefined), undefined);
  assert.equal(ipKey('not-an-ip'), 'not-an-ip');
});
