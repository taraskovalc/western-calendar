// POST /stats/calendar-file  ->  the website made a calendar file (guests
// included). Adds 1 to today's total. No body, nothing about the person.
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { countToday } from '../stats.js';

export const statsRouter = express.Router();

// Max 25 per hour from one address, so one person can't inflate the count.
const statsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

statsRouter.post('/calendar-file', statsLimiter, async (req, res) => {
  await countToday('calendar_file');
  res.status(204).end();
});
