// Entry point of the API: creates the Express app and starts listening.
import fs from 'node:fs/promises';
import express from 'express';
import helmet from 'helmet';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { getTerms } from './terms.js';
import { buildCalendar } from '../../shared/ics.js';
import { createSessionMiddleware } from './session.js';
import { authRouter } from './routes/auth.js';
import { schedulesRouter } from './routes/schedules.js';
import { feedsRouter } from './routes/feeds.js';
import { requireJson } from './require-auth.js';

// Bring the database up to date before accepting any requests.
await migrate();

const app = express();
const CURRENT_YEAR = '2026-27';

app.use(helmet());                          // standard security headers on every response
app.use(requireJson);                       // data must be sent as JSON (blocks CSRF via forms)
app.use(express.json({ limit: '100kb' }));  // read JSON request bodies; refuse anything huge
app.use(createSessionMiddleware());         // know who is signed in (from the cookie)
app.use('/auth', authRouter);               // /auth/register, /auth/login, /auth/logout, /auth/me, /auth/account
app.use('/schedules', schedulesRouter);     // saved schedules (signed-in only)
app.use('/feeds', feedsRouter);             // public subscription links (the token is the key)

// GET /  ->  proves the API itself is running.
app.get('/', (req, res) => {
  res.json({ message: 'Hello from the Western Calendar API' });
});

// GET /health  ->  proves the API can reach the database.
app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT now() AS time');
    res.json({ status: 'ok', database: 'connected', time: rows[0].time });
  } catch (err) {
    console.error('Database check failed:', err.message);
    // 503 = "Service Unavailable": the API is up, but something it needs isn't.
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

// GET /terms/2026-27  ->  the term dates stored in the database.
app.get('/terms/:year', async (req, res) => {
  const terms = await getTerms(req.params.year);
  if (!terms.length) return res.status(404).json({ error: 'No dates for that year' });
  res.json(terms);
});

// GET /demo.ics  ->  a calendar made from a made-up example schedule,
// using the real term dates from the database. Proves all the pieces connect.
app.get('/demo.ics', async (req, res) => {
  const courses = JSON.parse(await fs.readFile(new URL('../examples/sample-schedule.json', import.meta.url)));
  const terms = await getTerms(CURRENT_YEAR);
  const { ics } = buildCalendar({ courses, terms, calendarName: 'Western Calendar Demo' });
  res.type('text/calendar').attachment('demo.ics').send(ics);
});

// If any route throws, answer with a clean error instead of crashing.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

// When Docker stops the container it sends SIGTERM.
// Finish open requests and close database connections cleanly.
process.on('SIGTERM', () => {
  server.close(() => pool.end().then(() => process.exit(0)));
});
