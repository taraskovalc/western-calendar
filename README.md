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
| `SITE_URL` | yes | `https://slotted.taraskoval.ca`. Where emails and Google sign-in send people back to. |
| `CLOUDFLARE_TUNNEL_TOKEN` | yes | Connects the tunnel. |
| `BACKUP_DIR` | no | Folder on the server for backups. Default `/srv/backups/western-calendar`. |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Turn on "Forgot your password?" emails. Without them the page says resets aren't set up yet. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Turn on "Continue with Google". |

After changing `.env`: `docker compose up -d` (it recreates only the containers whose settings changed).

## Backups

The `backup` container saves the whole database once a day to `BACKUP_DIR` as `calendar_YYYY-MM-DD_HHMM.dump` and deletes copies older than 14 days.

```bash
sudo ls -lh /srv/backups/western-calendar     # see the copies (only root can read them)
docker compose logs --tail=5 backup           # "Backup saved: ..."
```

Restore one (this replaces what's in the database now):

```bash
sudo cat /srv/backups/western-calendar/calendar_2026-10-16_0300.dump \
  | docker compose exec -T db pg_restore -U calendar -d calendar --clean --if-exists
```

The backups are on the same machine as the database, so they protect against mistakes and bad updates, not a dead drive. For that, copy the folder somewhere else now and then.

## New school year dates

Western publishes the next year's dates at https://www.westerncalendar.uwo.ca/sessionaldates.cfm, usually in the spring. When they're out:

1. **`shared/terms.js`**: add the new year to `TERM_DATES` (first and last day of classes for fall and winter, every no-class weekday, and the `quarters` dates for 6-week Q/R/S/T courses) and change `LATEST_YEAR`.
2. **New migration** `api/migrations/00N_terms_2027_28.sql`, copying the format of `002_terms_2026_27.sql` plus the `quarters` column from `007_quarter_dates.sql`, with the same dates.
3. Check that both files have the same dates, push, then update the server as above.

Keep the old year in both places until that school year is over.

## Optional: password reset emails (Resend)

1. Sign up at resend.com. **Domains → Add domain** → `taraskoval.ca`, region North Virginia (`us-east-1`).
2. **Auto configure** connects to Cloudflare and adds the records itself: CNAMEs `send` and `rsend` (pointing to `*.forge.rmta.net`) and a TXT `resend._domainkey`. No MX record on `taraskoval.ca` itself is needed, since Slotted only sends email. Wait for the domain to say **Verified**.
3. **API Keys → Create API key**: name `Slotted server`, permission **Sending access**, domain `taraskoval.ca`. The key is only shown once.
4. In `.env`, then `docker compose up -d`:
   ```
   RESEND_API_KEY=re_...
   MAIL_FROM="Slotted <noreply@taraskoval.ca>"
   ```
   `MAIL_FROM` needs the quotes because of the space.

If a reset email doesn't arrive, `docker compose logs --tail=20 api` shows the reason ("Reset email failed: ..."). The Resend dashboard also lists every email sent.

**Never screenshot or share `.env`.** If a key is ever exposed, make a new one (Resend: delete the key and create another; Google: *Clients → Slotted website → Add secret*, then delete the old one; `SESSION_SECRET`: `openssl rand -hex 32`) and run `docker compose up -d`. To check which settings exist without showing values: `cut -d= -f1 .env`.

## Optional: Google sign-in

Set up in the Google Cloud project **Slotted** (console.cloud.google.com).

1. **Google Auth Platform → Get started**: app name `Slotted`, audience **External**, your Gmail as the contact.
2. **Branding**: home page `https://slotted.taraskoval.ca`, privacy policy `https://slotted.taraskoval.ca/privacy.html`, authorized domain `taraskoval.ca`. No logo (a logo makes Google review the app first).
3. **Clients → Create client → Web application**, with the redirect URI `https://api.taraskoval.ca/auth/google/callback`. Google shows the secret only once.
4. **Audience → Publish app**, so it says "In production". Otherwise only test users can sign in.
5. In `.env`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then `docker compose up -d`. `curl -s https://api.taraskoval.ca/auth/providers` should say `{"google":true}`.

The button appears on the site by itself once the settings are there. If someone signs in with Google and an account with that email already exists, the two are linked, because Google has confirmed the email. When that happens the account's password is removed and every other signed-in session is ended, in case someone else had registered that email first. The owner can set a password again with "Forgot your password?".

## Testing on your own computer

```bash
node --test shared/ics.test.js      # .ics builder tests
cp .env.example .env               # fill in the required values (see below)
docker compose up -d db api        # API on http://localhost:3000
python3 -m http.server 8000        # run from the project folder, then open http://localhost:8000/web/
```

Run the web server from the project folder (not `web/`), because the page loads `../shared/`. On `localhost` the page talks to the API at `http://localhost:3000` by itself. In the local `.env`, set `ALLOWED_ORIGINS=http://localhost:8000`, `COOKIE_SECURE=false` and `PUBLIC_API_URL=http://localhost:3000`.

## Server upkeep

Every few weeks:

```bash
sudo apt update && sudo apt upgrade
sudo reboot            # only if it says a restart is required
```

The containers start again by themselves after a reboot (`restart: unless-stopped`). Check with `docker compose ps`.
