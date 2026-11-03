# Security

Slotted is a free tool run by one person, Taras Koval. If you find a security problem, I want to
hear about it and will fix it.

## How to report

Report it privately, not in a public issue:

- **GitHub:** [Report a vulnerability](https://github.com/taraskovalc/western-calendar/security/advisories/new)
  (private, only I can see it), or
- **Email:** slotted@taraskoval.ca, with "Security" in the subject.

Please include what the problem is, where it is (page, API route or file), the steps to show it, and
what someone could do with it. If you come across a real calendar link (`/feeds/...`), don't paste
it in the report: those links work like passwords.

## What happens next

- I reply within 7 days.
- I tell you when it's fixed, and credit you in the fix if you'd like.
- Slotted is free and has no budget, so there's no bug bounty.

## What's covered

- The website: https://slotted.taraskoval.ca
- The API: https://api.taraskoval.ca
- The Slotted Chrome extension
- The code in this repository

Not covered: Western University's systems (including DraftMySchedule), and GitHub, Cloudflare and
Google themselves. Report those to their owners.

## Rules for testing

- Use only accounts you created. Don't access, change or delete anyone else's data. If you reach
  someone else's data by accident, stop, don't keep a copy, and tell me.
- No denial of service, no flooding the sign-in or "Report a problem" forms, and no automated
  scanning that sends a lot of traffic. One person's home server runs the API.
- Give me 90 days to fix a problem before you talk about it publicly.

If you follow these rules in good faith, I consider your testing authorized and won't take legal
action against you for it.
