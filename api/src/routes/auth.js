// Accounts: register, log in, log out, and "who am I?".
import express from 'express';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { validate } from '../validate.js';
import { regenerateSession, destroySession } from '../session.js';
import { requireAuth } from '../require-auth.js';

export const authRouter = express.Router();

/* ---------- what valid input looks like ---------- */
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const registerSchema = z.object({
  email,
  // Long beats complicated: a 10+ character minimum, no forced symbols.
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  displayName: z.string().trim().min(1).max(60).optional(),
});
const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});

/* ---------- rate limits ---------- */
// Max 5 FAILED logins per 15 minutes from one address. Successful ones don't count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
});
// Max 10 new accounts per hour from one address (stops bots mass-creating accounts).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many accounts created. Try again later.' },
});

// Used when someone tries to log in with an email that doesn't exist. Checking
// a password against this takes the same time as a real check, so attackers
// can't tell "no such account" apart from "wrong password" by timing.
const dummyHash = await argon2.hash('this-is-not-a-real-password');

// Only ever send these fields to the browser (never password_hash!).
const publicUser = row => ({ id: row.id, email: row.email, displayName: row.display_name });

/* ---------- routes ---------- */

// POST /auth/register   { email, password, displayName? }
authRouter.post('/register', registerLimiter, async (req, res) => {
  const { data, errors } = validate(registerSchema, req.body);
  if (errors) return res.status(400).json({ errors });

  // argon2id with a random "salt": the same password gives a different hash every time.
  const passwordHash = await argon2.hash(data.password);
  let user;
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [data.email, passwordHash, data.displayName ?? null],
    );
    user = rows[0];
  } catch (err) {
    if (err.code === '23505') {  // PostgreSQL's code for "unique rule broken"
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    throw err;
  }

  await regenerateSession(req);  // fresh session ID (prevents session fixation)
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

// POST /auth/login   { email, password }
authRouter.post('/login', loginLimiter, async (req, res) => {
  const { data, errors } = validate(loginSchema, req.body);
  if (errors) return res.status(400).json({ errors });

  const { rows } = await pool.query(
    'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
    [data.email],
  );
  const user = rows[0];
  const passwordOk = await argon2.verify(user?.password_hash ?? dummyHash, data.password);

  if (!user || !user.password_hash || !passwordOk) {
    // Same message either way, so the form can't be used to discover who has an account.
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

// POST /auth/logout
authRouter.post('/logout', async (req, res) => {
  if (req.session) await destroySession(req);  // deletes the row in the sessions table
  res.clearCookie('wc.sid');
  res.status(204).end();
});

// GET /auth/me   ->  { user: {...} } when signed in, { user: null } when not
authRouter.get('/me', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.json({ user: null });

  const { rows } = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [userId]);
  if (!rows[0]) {  // the account was deleted while this session was still around
    await destroySession(req);
    return res.json({ user: null });
  }
  res.json({ user: publicUser(rows[0]) });
});

// DELETE /auth/account   { password }
// Permanently deletes the account. Thanks to ON DELETE CASCADE in the database,
// all their schedules and subscription links are deleted along with it.
const deleteAccountSchema = z.object({ password: z.string().max(200).optional() });

authRouter.delete('/account', requireAuth, async (req, res) => {
  const { data, errors } = validate(deleteAccountSchema, req.body ?? {});
  if (errors) return res.status(400).json({ errors });

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });

  // Ask for the password again, so someone using a borrowed, signed-in laptop
  // can't delete the account. (Google/Microsoft-only accounts have no password.)
  if (rows[0].password_hash && !(await argon2.verify(rows[0].password_hash, data.password ?? ''))) {
    return res.status(401).json({ error: 'Password is incorrect' });
  }

  await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
  // Also sign them out on every other device.
  await pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [req.userId]);
  await destroySession(req);
  res.clearCookie('wc.sid');
  res.status(204).end();
});
