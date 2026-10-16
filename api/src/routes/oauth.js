// "Continue with Google" and "Continue with Microsoft".
//
// How it works (the OAuth 2.0 "authorization code" flow, with PKCE):
//  1. /auth/google/start sends the browser to Google's sign-in page, with a
//     random "state" (stops forged callbacks) and a PKCE challenge (stops a
//     stolen code from being used by anyone else).
//  2. Google sends the browser back to /auth/google/callback with a one-time code.
//  3. Our server swaps that code for an access token, server-to-server, using
//     our secret. The browser never sees the secret.
//  4. We ask Google who the person is (their ID and email), find or create the
//     matching Slotted account, and sign them in.
//
// A provider only switches on once its client ID and secret are in .env.
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../db.js';
import { regenerateSession } from '../session.js';

export const oauthRouter = express.Router();

const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://slotted.taraskoval.ca').replace(/\/+$/, '');

const PROVIDERS = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    // Google tells us whether it has verified the email address.
    trustEmail: info => info.email_verified === true || info.email_verified === 'true',
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    // "common" = both personal Microsoft accounts and work/school accounts.
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    // Microsoft doesn't promise the email was verified, so we never use it to
    // attach a Microsoft sign-in to an existing password account.
    trustEmail: () => false,
  },
};
const enabled = name => Boolean(PROVIDERS[name]?.clientId && PROVIDERS[name]?.clientSecret);
const callbackUrl = name => `${PUBLIC_API_URL}/auth/${name}/callback`;
const random = () => crypto.randomBytes(32).toString('base64url');

// GET /auth/providers  ->  which sign-in buttons the page should show
oauthRouter.get('/providers', (req, res) => {
  res.json({ google: enabled('google'), microsoft: enabled('microsoft') });
});

// Sends the browser back to Slotted, with a short reason if something failed.
const backToSite = (res, error) =>
  res.redirect(error ? `${SITE_URL}/?signin_error=${encodeURIComponent(error)}#welcome` : `${SITE_URL}/?signed_in=1#app`);

// GET /auth/google/start, /auth/microsoft/start
oauthRouter.get('/:provider/start', (req, res) => {
  const name = req.params.provider;
  if (!enabled(name)) return res.status(404).json({ error: 'That sign-in option is not available' });
  const provider = PROVIDERS[name];

  const state = random();
  const verifier = random();
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  req.session.oauth = { name, state, verifier, startedAt: Date.now() };

  const url = new URL(provider.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: callbackUrl(name),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(url.href);
});

// GET /auth/google/callback, /auth/microsoft/callback
oauthRouter.get('/:provider/callback', async (req, res) => {
  const name = req.params.provider;
  const saved = req.session?.oauth;
  if (req.session) delete req.session.oauth;

  if (!enabled(name)) return backToSite(res, 'unavailable');
  if (req.query.error) return backToSite(res, 'cancelled');  // they pressed Cancel
  if (!saved || saved.name !== name || saved.state !== req.query.state
      || Date.now() - saved.startedAt > 10 * 60 * 1000 || typeof req.query.code !== 'string') {
    return backToSite(res, 'expired');
  }
  const provider = PROVIDERS[name];

  try {
    // Swap the one-time code for an access token (server to server).
    const tokenResponse = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: provider.clientId,
        client_secret: provider.clientSecret,
        code: req.query.code,
        redirect_uri: callbackUrl(name),
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error(`token: ${JSON.stringify(tokens).slice(0, 200)}`);

    // Ask the provider who this is.
    const infoResponse = await fetch(provider.userinfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const info = await infoResponse.json();
    if (!infoResponse.ok || !info.sub) throw new Error(`userinfo: ${JSON.stringify(info).slice(0, 200)}`);
    const email = typeof info.email === 'string' ? info.email.trim().toLowerCase() : null;

    const userId = await findOrCreateUser(name, info.sub, email, provider.trustEmail(info), info.name);
    if (!userId) return backToSite(res, email ? 'email_taken' : 'no_email');

    await regenerateSession(req);
    req.session.userId = userId;
    backToSite(res);
  } catch (err) {
    console.error(`${name} sign-in failed:`, err.message);
    backToSite(res, 'failed');
  }
});

// Returns the Slotted user ID for this Google/Microsoft account, creating or
// linking an account when needed. Returns null when it can't safely do either.
async function findOrCreateUser(provider, providerUserId, email, emailTrusted, name) {
  const linked = await pool.query(
    'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
    [provider, providerUserId],
  );
  if (linked.rows[0]) return linked.rows[0].user_id;
  if (!email) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    let userId = existing.rows[0]?.id;
    if (userId && !emailTrusted) {
      // An account already uses this email, and we can't be sure this person
      // owns it, so don't attach them to it.
      await client.query('ROLLBACK');
      return null;
    }
    if (!userId) {
      const created = await client.query(
        'INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id',
        [email, typeof name === 'string' ? name.slice(0, 60) : null],
      );
      userId = created.rows[0].id;
    }
    await client.query(
      'INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES ($1, $2, $3)',
      [userId, provider, providerUserId],
    );
    await client.query('COMMIT');
    return userId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
