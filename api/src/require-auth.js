// Guards for routes.
import { pool } from './db.js';
import { destroySession } from './session.js';

// Only lets signed-in people through. Everyone else gets 401 and the route
// code never runs. Puts the signed-in user's ID on req.userId for convenience.
export async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Please sign in first' });
  const { rows } = await pool.query('SELECT session_version FROM users WHERE id = $1', [userId]);
  if (!sessionIsCurrent(req.session, rows[0])) {
    await destroySession(req);
    return res.status(401).json({ error: 'Please sign in first' });
  }
  req.userId = userId;
  next();
}

// A request still in progress can save a deleted session back, so also require the account and a current session_version (no copy = 0).
export const sessionIsCurrent = (session, user) => Boolean(user) && (session.sessionVersion ?? 0) === user.session_version;

// Requests that send data must send it as JSON. A malicious website can make
// your browser submit a plain HTML form to our API, but it can't send JSON to
// another site without the browser asking our permission first (CORS).
// Together with the SameSite cookie, this blocks CSRF attacks.
export function requireJson(req, res, next) {
  const sendsData = req.headers['transfer-encoding'] !== undefined
    || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && sendsData && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send data as JSON (Content-Type: application/json)' });
  }
  next();
}
