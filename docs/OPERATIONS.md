# Running Slotted

Notes for the maintainer: how the live site is deployed and kept running.
The [README](../README.md) explains what Slotted is.

## Layout

```
 Browser ──► slotted.taraskoval.ca   GitHub Pages: web/ + shared/
    │
    └──────► api.taraskoval.ca  ──Cloudflare Tunnel──►  home server (Docker)
                                                        ├─ api      Node.js + Express
                                                        ├─ db       PostgreSQL 17
                                                        ├─ tunnel   cloudflared
                                                        └─ backup   daily pg_dump
```

- `web/` is published by `.github/workflows/pages.yml`, which runs the tests first.
- `api/migrations/` run in order when the API starts. Never edit one that has already run; add a new numbered file.

## Deploying

Code is written and pushed from the Mac. The server only pulls.

```bash
cd /srv/docker/western-calendar
git pull
docker compose up -d --build
docker compose logs --tail=30 api     # a new migration shows "Applying migration 00X_..."
```

## Settings (`.env` on the server)

Secrets live only in `.env`. It's in `.gitignore`; never commit, share or screenshot it.
`cut -d= -f1 .env` lists the names without the values. `.env.example` has every setting.

| Name | Needed | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | yes | Database password. |
| `SESSION_SECRET` | yes | Signs the sign-in cookie. Changing it signs everyone out. |
| `COOKIE_SECURE` | yes | `true`: the cookie is only sent over HTTPS. |
| `PUBLIC_API_URL` | yes | `https://api.taraskoval.ca`. Used in calendar links and sign-in callbacks. |
| `ALLOWED_ORIGINS` | yes | `https://slotted.taraskoval.ca`. The only site allowed to call the API. |
| `SITE_URL` | yes | `https://slotted.taraskoval.ca`. Where emails and Google sign-in send people back to. |
| `CLOUDFLARE_TUNNEL_TOKEN` | yes | Connects the tunnel. |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Email: password resets and problem reports. Without them, both say they aren't available. |
| `REPORT_EMAIL` | no | Where problem reports go. Default `slotted@taraskoval.ca`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | "Continue with Google". |
| `BACKUP_DIR` | no | Backup folder. Default `/srv/backups/western-calendar`. |

After changing `.env`: `docker compose up -d`.

If a key is ever exposed, replace it and run `docker compose up -d`:
Resend (delete the key, make a new one), Google (*Clients → Slotted website → Add secret*, then delete the old one),
`SESSION_SECRET` (`openssl rand -hex 32`).

## Backups

The `backup` container dumps the database once a day to `BACKUP_DIR` and deletes copies older than 14 days.
Old copies are only deleted after a successful new backup.

```bash
sudo ls -lh /srv/backups/western-calendar     # only root can read them
docker compose logs --tail=5 backup           # "Backup saved: ..."
```

Restore one (replaces everything in the database):

```bash
sudo cat /srv/backups/western-calendar/calendar_2026-10-16_0300.dump \
  | docker compose exec -T db pg_restore -U calendar -d calendar --clean --if-exists
```

The backups live on the same machine, so they protect against mistakes, not a dead drive. Copy the folder elsewhere now and then.

## New school year

Western publishes dates at <https://www.westerncalendar.uwo.ca/sessionaldates.cfm>, usually in spring.

1. `shared/terms.js`: add the year to `TERM_DATES` (first/last day of classes, every no-class weekday with a label, and the `quarters` dates for Q/R/S/T courses). Change `LATEST_YEAR`.
2. New migration `api/migrations/00N_terms_2027_28.sql` with the same dates (copy `002_terms_2026_27.sql` and the `quarters` update from `007_quarter_dates.sql`).
3. Check both files match, push, deploy.

Keep the old year until that school year is over.

## Email (Resend)

Used for password resets and problem reports.

1. resend.com → **Domains → Add domain** → `taraskoval.ca`, region `us-east-1`. **Auto configure** adds the Cloudflare records (`send`, `rsend`, `resend._domainkey`). Wait for **Verified**.
2. **API Keys → Create**: name `Slotted server`, permission **Sending access**, domain `taraskoval.ca`.
3. `.env`: `RESEND_API_KEY=re_...` and `MAIL_FROM="Slotted <slotted@taraskoval.ca>"` (quotes needed).

If an email doesn't arrive, `docker compose logs --tail=20 api` shows why. The Resend dashboard lists every email sent.

## Google sign-in

Google Cloud project **Slotted**.

1. **Google Auth Platform → Get started**: name `Slotted`, audience **External**.
2. **Branding**: home page `https://slotted.taraskoval.ca`, privacy policy `https://slotted.taraskoval.ca/privacy.html`, authorized domain `taraskoval.ca`. No logo (it triggers a review).
3. **Clients → Create client → Web application**, redirect URI `https://api.taraskoval.ca/auth/google/callback`.
4. **Audience → Publish app** ("In production").
5. `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Check: `curl -s https://api.taraskoval.ca/auth/providers` → `{"google":true}`.

Linking Google to an existing account with the same (Google-verified) email removes that account's password and signs out its other sessions, so nobody who registered the email first keeps access.

## Testing locally

```bash
node --test shared/ics.test.js
cp .env.example .env                # set ALLOWED_ORIGINS=http://localhost:8000, COOKIE_SECURE=false, PUBLIC_API_URL=http://localhost:3000
docker compose up -d db api         # API on http://localhost:3000
python3 -m http.server 8000         # from the project folder, then open http://localhost:8000/web/
```

On `localhost` the page talks to `http://localhost:3000` by itself.

## Server upkeep

Every few weeks:

```bash
sudo apt update && sudo apt upgrade
cat /var/run/reboot-required && sudo reboot   # only if a restart is needed
```

Containers come back on their own after a reboot. UptimeRobot watches `https://api.taraskoval.ca/health` and emails if it goes down.
