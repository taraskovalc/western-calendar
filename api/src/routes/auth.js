// Accounts: register, log in, log out, and "who am I?".
import crypto from 'node:crypto';
import express from 'express';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { validate } from '../validate.js';
import { regenerateSession, destroySession } from '../session.js';
import { requireAuth } from '../require-auth.js';
import { mailEnabled, sendMail } from '../mail.js';

export const authRouter = express.Router();

/* ---------- what valid input looks like ---------- */
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const registerSchema = z.object({
  email,
  // Long beats complicated: a 10+ character minimum, no forced symbols.
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  displayName: z.string().trim().max(60).optional().transform(v => v || undefined),  // blank = no name
  theme: z.enum(['light', 'dark']).optional(),
});
const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(200),
});

/* ---------- rate limits ---------- */
// Max 5 FAILED logins per 15 minutes for one email from one address. Successful
// ones don't count. Counting per email too means students sharing a campus
// network don't lock each other out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: req => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
});
// Max 50 new accounts per hour from one address (stops bots mass-creating
// accounts, while leaving room for many students on one campus network).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many accounts created. Try again later.' },
});

// Used when someone tries to log in with an email that doesn't exist. Checking
// a password against this takes the same time as a real check, so attackers
// can't tell "no such account" apart from "wrong password" by timing.
const dummyHash = await argon2.hash('this-is-not-a-real-password');

// Only ever send these fields to the browser (never password_hash!).
const publicUser = row => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  theme: row.theme,
  // Accounts made with Google may have no password. The page uses
  // this to decide whether to ask for one before deleting the account.
  hasPassword: row.has_password ?? Boolean(row.password_hash),
});

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
      `INSERT INTO users (email, password_hash, display_name, theme)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, theme, true AS has_password`,
      [data.email, passwordHash, data.displayName ?? null, data.theme ?? 'light'],
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
    'SELECT id, email, display_name, theme, password_hash FROM users WHERE email = $1',
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

  const { rows } = await pool.query('SELECT id, email, display_name, theme, (password_hash IS NOT NULL) AS has_password FROM users WHERE id = $1', [userId]);
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
  // can't delete the account. (Google-only accounts have no password.)
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

// PATCH /auth/me   { theme }   ->  save settings for the signed-in user
const settingsSchema = z.object({ theme: z.enum(['light', 'dark']) }).strict();

authRouter.patch('/me', requireAuth, async (req, res) => {
  const { data, errors } = validate(settingsSchema, req.body);
  if (errors) return res.status(400).json({ errors });
  const { rows } = await pool.query(
    'UPDATE users SET theme = $1 WHERE id = $2 RETURNING id, email, display_name, theme, (password_hash IS NOT NULL) AS has_password',
    [data.theme, req.userId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Account not found' });
  res.json({ user: publicUser(rows[0]) });
});

/* ---------- forgot / reset password ---------- */
const SITE_URL = (process.env.SITE_URL || 'https://slotted.taraskoval.ca').replace(/\/+$/, '');
const RESET_MINUTES = 60;
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

// Max 10 reset emails per hour from one address (stops someone flooding inboxes).
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again later.' },
});

// Choosing a new password from an emailed link has its own limit, so someone
// locked out by failed logins can still reset (bad links count, good ones don't).
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

// POST /auth/forgot   { email }
// Always answers the same way, whether or not the email has an account, so
// this form can't be used to find out who uses Slotted.
authRouter.post('/forgot', forgotLimiter, async (req, res) => {
  if (!mailEnabled) {
    return res.status(503).json({ error: "Password reset emails aren't set up yet. Please try again later." });
  }
  const { data, errors } = validate(z.object({ email }), req.body);
  if (errors) return res.status(400).json({ errors });

  const { rows } = await pool.query('SELECT id, email FROM users WHERE email = $1', [data.email]);
  const user = rows[0];
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await pool.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [sha256(token), user.id, RESET_MINUTES],
    );
    const link = `${SITE_URL}/?reset=${token}`;
    // Send in the background: waiting for the email service here would make the
    // reply slower only when the account exists, which would give that away.
    sendMail({
      to: user.email,
      subject: 'Reset your Slotted password',
      text: `Someone (hopefully you) asked to reset the password for your Slotted account.\n\n`
        + `Choose a new password here: ${link}\n\n`
        + `This link works once and expires in ${RESET_MINUTES} minutes. `
        + `If you didn't ask for this, you can ignore this email; your password hasn't changed.`,
      html: `<p>Someone (hopefully you) asked to reset the password for your Slotted account.</p>`
        + `<p><a href="${link}">Choose a new password</a></p>`
        + `<p>This link works once and expires in ${RESET_MINUTES} minutes. `
        + `If you didn't ask for this, you can ignore this email; your password hasn't changed.</p>`,
    }).catch(err => console.error('Reset email failed:', err.message));
  }
  res.json({ ok: true });
});

// POST /auth/reset   { token, password }  ->  sets the new password and signs in
const resetSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'This reset link is not valid'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

authRouter.post('/reset', resetLimiter, async (req, res) => {
  const { data, errors } = validate(resetSchema, req.body);
  if (errors) return res.status(400).json({ errors });

  // Marking the token used in the same statement that checks it means a link
  // can only ever work once, even if it's clicked twice at the same moment.
  const { rows } = await pool.query(
    `UPDATE password_resets SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(data.token)],
  );
  if (!rows[0]) {
    return res.status(400).json({ error: 'This reset link has expired or was already used. Ask for a new one.' });
  }
  const userId = rows[0].user_id;
  const { rows: users } = await pool.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2
     RETURNING id, email, display_name, theme, true AS has_password`,
    [await argon2.hash(data.password), userId],
  );
  // Sign out everywhere else: whoever knew the old password is now locked out.
  await pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [userId]);
  await regenerateSession(req);
  req.session.userId = userId;
  res.json({ user: publicUser(users[0]) });
});
