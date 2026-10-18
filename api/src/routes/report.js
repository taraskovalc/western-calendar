// POST /report  ->  "Report a problem" from the website, emailed to Slotted's inbox.
//
// Nothing is stored: the report goes straight into an email (through Resend,
// like password resets). No files are accepted. If the person adds their saved
// schedule, the website reads it in their browser and sends only plain text
// (the classes it found, or why it couldn't read them), so nothing that can run
// ever reaches the inbox.
import express from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../validate.js';
import { mailEnabled, sendMail } from '../mail.js';
import { STEPS, buildReportEmail } from '../report-email.js';

export const reportRouter = express.Router();

const REPORT_EMAIL = process.env.REPORT_EMAIL;

// Max 5 reports per hour from one address (stops spam).
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reports from here. Please try again in an hour.' },
});

const text = max => z.string().trim().max(max);

const scheduleSchema = z.object({
  read: z.boolean(),
  year: text(20).optional(),
  error: text(300).optional(),
  notes: z.array(text(300)).max(10).optional(),
  rows: z.array(z.object({
    course: text(20), type: text(10), section: text(10), days: text(30), time: text(30), room: text(60),
  }).strict()).max(60).optional(),
  table: z.string().max(12000).optional(),
}).strict();

const reportSchema = z.object({
  message: z.string().trim().min(10, 'Tell me a little more about what went wrong (at least 10 characters).').max(5000),
  step: z.enum(Object.keys(STEPS)).optional(),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('That email address doesn\'t look right').max(254)]).optional(),
  device: text(200).optional(),
  schedule: scheduleSchema.optional(),
  website: z.string().max(0).optional(),  // a hidden field only bots fill in
}).strict();

reportRouter.post('/', reportLimiter, async (req, res) => {
  const { data, errors } = validate(reportSchema, req.body);
  if (errors) return res.status(400).json({ errors });

  if (!mailEnabled || !REPORT_EMAIL) {
    return res.status(503).json({ error: "Reports can't be sent right now. Please try again later." });
  }

  const { subject, text: body, html } = buildReportEmail(data, Boolean(req.session?.userId));
  try {
    await sendMail({ to: REPORT_EMAIL, subject, text: body, html, replyTo: data.email || undefined });
  } catch (err) {
    console.error('Problem report email failed:', err.message);
    return res.status(502).json({ error: "Your report couldn't be sent right now. Please try again in a few minutes." });
  }
  res.json({ ok: true });
});
