// POST /report  ->  "Report a problem" from the website, emailed to Taras.
//
// Nothing is stored: the report goes straight into an email (through Resend,
// like password resets). If the person attaches their saved schedule page, it
// rides along as an email attachment so the problem can be reproduced.
import express from 'express';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { validate } from '../validate.js';
import { mailEnabled, sendMail } from '../mail.js';

export const reportRouter = express.Router();

const REPORT_EMAIL = process.env.REPORT_EMAIL;
const MAX_FILE_BYTES = 700 * 1024;  // a real schedule page is about 70 KB

// Max 5 reports per hour from one address (stops spam).
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reports from here. Please try again in an hour.' },
});

const STEPS = {
  'sign-in': 'Signing in or creating an account',
  'calendar-app': 'Choosing a calendar app',
  schedule: 'Adding the schedule file',
  'add-to-calendar': 'Adding classes to a calendar',
  'calendar-link': 'The calendar link',
  other: 'Something else',
};

const reportSchema = z.object({
  message: z.string().trim().min(10, 'Tell me a little more about what went wrong (at least 10 characters).').max(5000),
  step: z.enum(Object.keys(STEPS)).optional(),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('That email address doesn\'t look right').max(254)]).optional(),
  device: z.string().trim().max(200).optional(),
  file: z.object({
    name: z.string().trim().max(120).regex(/\.html?$/i, 'Only the saved .html schedule page can be attached'),
    content: z.string().regex(/^[A-Za-z0-9+/]+=*$/, 'The attached file could not be read'),
  }).strict().optional(),
  website: z.string().max(0).optional(),  // a hidden field only bots fill in
}).strict();

reportRouter.post('/', reportLimiter, async (req, res) => {
  const { data, errors } = validate(reportSchema, req.body);
  if (errors) return res.status(400).json({ errors });

  if (!mailEnabled || !REPORT_EMAIL) {
    return res.status(503).json({ error: "Reports can't be sent right now. Please try again later." });
  }
  // base64 is 4 characters for every 3 bytes.
  if (data.file && data.file.content.length * 0.75 > MAX_FILE_BYTES) {
    return res.status(400).json({ error: 'That file is too large to be a saved schedule page.' });
  }

  const lines = [
    `Where: ${data.step ? STEPS[data.step] : 'Not given'}`,
    `Reply to: ${data.email || 'No email given'}`,
    `Device: ${data.device || 'Not given'}`,
    `Signed in: ${req.session?.userId ? 'yes' : 'no'}`,
    `Attachment: ${data.file ? data.file.name : 'none'}`,
    '',
    data.message,
  ];
  try {
    await sendMail({
      to: REPORT_EMAIL,
      subject: `Slotted problem report: ${data.step ? STEPS[data.step] : 'general'}`,
      text: lines.join('\n'),
      replyTo: data.email || undefined,
      attachments: data.file ? [{ filename: data.file.name, content: data.file.content }] : undefined,
    });
  } catch (err) {
    console.error('Problem report email failed:', err.message);
    return res.status(502).json({ error: "Your report couldn't be sent right now. Please try again in a few minutes." });
  }
  res.json({ ok: true });
});
