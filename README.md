# Slotted

**Your Western timetable, in your calendar, in about five minutes.**

Slotted turns a saved DraftMySchedule page into a full term of calendar events: every lecture, lab
and tutorial on the right day, at the right time, in the right room, with reading weeks and
holidays already taken out. It works with Apple Calendar, Google Calendar, Outlook, and anything
else that opens `.ics` files.

### → [slotted.taraskoval.ca](https://slotted.taraskoval.ca)

<p align="center">
  <img src="docs/screenshots/cover.jpg" alt="The Slotted cover: a closed notebook on a wooden desk" height="320">
  &nbsp;
  <img src="docs/screenshots/done.jpg" alt="The finished page: 335 classes added, 31 skipped for reading weeks and holidays, and your next class" height="320">
</p>

## Why it exists

A lot of students I know type every class into their calendar by hand. I always went looking for
a tool to do it for me instead, but the one I found felt sketchy: it had me do things I didn't
understand, and I ended up with a calendar that worked and no idea how it got there.

So I built the opposite. Slotted is free, it explains every step, and it's for anyone who just
wants their courses in their calendar each year, with no strings attached: no account needed,
nothing to install, and instructions for the calendar app you actually use.

## How it works

1. Pick your calendar app. Every step after that is written for it.
2. Slotted shows you where to find your **My Current Schedule** page in DraftMySchedule and how to
   save it.
3. Drop the file in. It's read in your browser and never uploaded.
4. Download your calendar file and follow the steps to add it. Or, if you want, sign in for a
   private link that keeps your calendar up to date when your classes change.

## Under the hood

- **Your file stays on your device.** The schedule page is parsed in the browser. Without an
  account, nothing is sent anywhere.
- **One calendar engine.** [`shared/ics.js`](shared/ics.js) builds both the downloaded file and
  the live calendar link, so they can't disagree. It follows Western's course-number rules
  (full-year, half-term, six-week quarter and accelerated courses) and the official term dates.
- **Self-hosted.** The API and database run in Docker on a home server, reachable only through a
  Cloudflare Tunnel.
- **Accounts done properly.** Argon2 password hashes, Google sign-in with PKCE, one-time reset
  links, rate limits, and daily backups.
- **Tested against real and tricky schedules.** Online courses, quarter courses, affiliate
  colleges, waitlists, and summer files that shouldn't be accepted.

**Built with** JavaScript (no framework) · Node.js + Express · PostgreSQL · Docker ·
Cloudflare Tunnel · GitHub Pages

| Folder | What's in it |
| --- | --- |
| [`web/`](web) | The website |
| [`shared/`](shared) | Calendar builder and term dates, used by both the website and the API |
| [`api/`](api) | Accounts, saved schedules, calendar links, problem reports |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | How the live server is run |

## Status

Live for the 2026–27 Fall/Winter terms. Next year's dates go in once Western publishes them.
Found something wrong? [Report a problem](https://slotted.taraskoval.ca/report.html).

Made by [Taras Koval](https://taraskoval.ca), a Computer Science student at Western. Slotted isn't
affiliated with Western University.

## License

**© 2026 Taras Koval. All rights reserved.** The code is public so you can read it. You may not
copy, modify, reuse or redistribute any part of it without written permission. See
[LICENSE](LICENSE).
