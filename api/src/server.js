// Entry point of the API: creates the Express app and starts listening.
import express from 'express';
import { pool } from './db.js';
import { migrate } from './migrate.js';

// Bring the database up to date before accepting any requests.
await migrate();

const app = express();

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

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

// When Docker stops the container it sends SIGTERM.
// Finish open requests and close database connections cleanly.
process.on('SIGTERM', () => {
  server.close(() => pool.end().then(() => process.exit(0)));
});
