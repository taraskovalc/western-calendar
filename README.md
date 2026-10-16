# Slotted

Turns a saved Western University DraftMySchedule page into calendar events for the whole term, skipping reading weeks and holidays.

- Website: https://slotted.taraskoval.ca
- API: https://api.taraskoval.ca

Copyright © 2026 Taras Koval. All rights reserved. The code is public to read, but it isn't licensed for reuse.

## How it fits together

```
 Browser ──► slotted.taraskoval.ca  (GitHub Pages: web/ + shared/)
    │
    └──────► api.taraskoval.ca  ──Cloudflare Tunnel──►  home server (Docker)
                                                        ├─ api      Node.js + Express
                                                        ├─ db       PostgreSQL 17
                                                        ├─ tunnel   cloudflared
                                                        └─ backup   daily pg_dump
```

| Folder | What's in it |
| --- | --- |
| `web/` | The webpage. Reads the saved schedule in the browser (`parser.js`), so a guest's file never leaves their computer. |
| `shared/` | Code used by both the webpage and the API: the `.ics` builder and Western's term dates. |
| `api/` | The Express API: accounts, saved schedules, private calendar links. `migrations/` holds the database changes, applied in order on start-up. |
| `ops/` | `backup.sh`, run by the `backup` container. |
| `.github/workflows/pages.yml` | Runs the tests, then publishes `web/` + `shared/` to GitHub Pages. |

## Updating the server

Code is written and pushed from the Mac. The server only pulls.

```bash
cd /srv/docker/western-calendar
git pull
docker compose up -d --build
docker compose logs --tail=30 api     # a new migration shows "Applying migration 00X_..."
```

Secrets live only in `.env` on the server. It is in `.gitignore` and must never be committed. `.env.example` lists every setting.

## Settings (`.env`)

| Name | Needed? | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | Database password. |
| `SESSION_SECRET` | yes | Signs the sign-in cookie. Changing it signs everyone out. |
| `COOKIE_SECURE` | yes (`true`) | Cookie only sent over HTTPS. |
| `PUBLIC_API_URL` | yes | `https://api.taraskoval.ca`. Used in calendar links and sign-in callbacks. |
| `ALLOWED_ORIGINS` | yes | `https://slotted.taraskoval.ca`. The only site allowed to call the API with cookies. |
| `SITE_URL` | yes | `https://slotted.taraskoval.ca`. Where emails and Google/Microsoft sign-in send people back to. |
| `CLOUDFLARE_TUNNEL_TOKEN` | yes | Connects the tunnel. |
| `BACKUP_DIR` | no | Folder on the server for backups. Default `/srv/backups/western-calendar`. |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Turn on "Forgot your password?" emails. Without them the page says resets aren't set up yet. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Turn on "Continue with Google". |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | no | Turn on "Continue with Microsoft". |

After changing `.env`: `docker compose up -d` (it recreates only the containers whose settings changed).

## Backups

The `backup` container saves the whole database once a day to `BACKUP_DIR` as `calendar_YYYY-MM-DD_HHMM.dump` and deletes copies older than 14 days.

```bash
ls -lh /srv/backups/western-calendar          # see the copies
docker compose logs --tail=5 backup           # "Backup saved: ..."
```

Restore one (this replaces what's in the database now):

```bash
docker compose exec -T db pg_restore -U calendar -d calendar --clean --if-exists \
  < /srv/backups/western-calendar/calendar_2026-10-16_0300.dump
```

The backups are on the same machine as the database, so they protect against mistakes and bad updates, not a dead drive. For that, copy the folder somewhere else now and then.

## New school year dates

Western publishes the next year's dates at https://www.westerncalendar.uwo.ca/sessionaldates.cfm, usually in the spring. When they're out:

1. **`shared/terms.js`**: add the new year to `TERM_DATES` (first and last day of classes for fall and winter, plus every no-class weekday) and change `LATEST_YEAR`.
2. **New migration** `api/migrations/00N_terms_2027_28.sql`, copying the format of `002_terms_2026_27.sql`, with the same dates.
3. Check that both files have the same dates, push, then update the server as above.

Keep the old year in both places until that school year is over.

## Optional: password reset emails (Resend)

1. Make a free account at resend.com and add the domain `taraskoval.ca`.
2. Add the DNS records Resend shows in Cloudflare (DNS → Records). Wait for Resend to say "Verified".
3. Create an API key with "Sending access" only.
4. In `.env`: `RESEND_API_KEY=re_...` and `MAIL_FROM=Slotted <noreply@taraskoval.ca>`, then `docker compose up -d`.

## Optional: Google and Microsoft sign-in

**Google:** console.cloud.google.com → new project → *APIs & Services* → *OAuth consent screen* (External; scopes `openid`, `email`) → *Credentials* → *Create OAuth client ID* → *Web application*.
- Authorised redirect URI: `https://api.taraskoval.ca/auth/google/callback`
- Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Publish the consent screen ("In production") so people outside the test list can sign in.

**Microsoft:** entra.microsoft.com → *App registrations* → *New registration*.
- Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
- Redirect URI: platform *Web*, `https://api.taraskoval.ca/auth/microsoft/callback`
- *Certificates & secrets* → new client secret (copy the **Value**). Note its expiry date: sign-in stops working when it expires.
- Put the Application (client) ID and the secret value in `.env` as `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.

The buttons appear on the site by themselves once the settings are there. If someone signs in with Google and an account with that email already exists, the two are linked only when Google has confirmed the email. Microsoft emails are never linked automatically.

## Testing on your own computer

```bash
node --test shared/ics.test.js      # .ics builder tests
cp .env.example .env               # fill in the required values
docker compose up -d db api        # API on http://localhost:3000
cd web && python3 -m http.server 8000   # webpage on http://localhost:8000
```

For local testing, add `http://localhost:8000` to `ALLOWED_ORIGINS` and set `COOKIE_SECURE=false`.

## Server upkeep

Every few weeks:

```bash
sudo apt update && sudo apt upgrade
sudo reboot            # only if it says a restart is required
```

The containers start again by themselves after a reboot (`restart: unless-stopped`). Check with `docker compose ps`.
