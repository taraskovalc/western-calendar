// Signed-in sessions, stored in the PostgreSQL "sessions" table.
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db.js';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') {
  throw new Error('SESSION_SECRET is missing. Add it to the .env file (see .env.example).');
}

const PgStore = connectPgSimple(session);
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// A function (not created right away) because the store immediately starts
// clearing out expired sessions, and the "sessions" table only exists once the
// migrations have run. server.js calls this after migrate().
export const createSessionMiddleware = () => session({
  store: new PgStore({ pool, tableName: 'sessions', createTableIfMissing: false }),
  name: 'wc.sid',                    // the cookie's name
  secret: process.env.SESSION_SECRET,
  resave: false,                     // don't rewrite unchanged sessions
  saveUninitialized: false,          // no cookie at all until someone signs in
  rolling: true,                     // each visit pushes the expiry 30 days out again
  cookie: {
    httpOnly: true,                  // JavaScript on the page can't read it (stops theft by XSS)
    sameSite: 'lax',                 // not sent along with requests started by other websites
    secure: process.env.COOKIE_SECURE === 'true',  // HTTPS only (once we have HTTPS)
    maxAge: THIRTY_DAYS,
  },
});

// express-session uses old-style callbacks; these let us use await instead.
export const regenerateSession = req =>
  new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
export const destroySession = req =>
  new Promise((resolve, reject) => req.session.destroy(err => (err ? reject(err) : resolve())));
