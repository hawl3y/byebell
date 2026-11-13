# Scam Radar

A mobile-friendly web app (PWA) where neighbors report and confirm local scams. See `PROJECT_BRIEF.md` for scope.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS, Supabase (Postgres + PostGIS + pgvector, Auth), Vercel.

## Local setup (macOS)

1. **Node:** install [nvm](https://github.com/nvm-sh/nvm), then from the repo root:
   ```sh
   nvm install   # reads .nvmrc (Node 24)
   nvm use
   ```
2. **Supabase CLI:**
   ```sh
   brew install supabase/tap/supabase
   supabase login
   ```
3. **Dependencies:**
   ```sh
   npm install
   ```
4. **Environment:**
   ```sh
   cp .env.example .env.local
   ```
   Fill in the **dev** project's URL, publishable key, and secret key (Supabase Dashboard → Project Settings → API Keys). Set `RATE_LIMIT_SALT`, `CRON_SECRET`, and `EMAIL_TOKEN_SECRET` to random strings (`openssl rand -hex 32`), and add a `RESEND_API_KEY` (see [Alerts](#alerts-email)).
5. **Database:** link the dev project and apply migrations:
   ```sh
   supabase link --project-ref <dev-project-ref>
   supabase db push
   ```
6. **Run:**
   ```sh
   npm run dev
   ```
   Open http://localhost:3000.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm test` | Unit tests (Vitest) |

## Supabase projects

Two hosted projects: `scam-radar-dev` and `scam-radar-prod`. No local Docker database.

Zip code centers (`zip_centroids`) come from the US Census Bureau [Gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) (2025 ZCTA, public domain) and are loaded by a migration.

### Matching (clusters and Check)
Text similarity uses Postgres `pg_trgm` behind database functions (`nearest_cluster_candidate`, `match_clusters`). Thresholds live in `src/lib/matching.ts`. To re-tune them, run `node scripts/calibrate-matching.mts` (read-only, uses the linked dev project) and update the numbers and the comment there.

Don't use `supabase migration new` from a script or agent; it waits for SQL on stdin. Create `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` by hand instead.

### Database changes
Only through migrations:
```sh
supabase migration new <name>      # creates supabase/migrations/<timestamp>_<name>.sql
supabase db push                   # applies to the currently linked project
```
Keep the CLI linked to **dev**. Prod gets migrations automatically from the `Migrate prod database` workflow when they merge to `main`. Never push to prod by hand.

Migrations must work with the code already in production (add columns/tables; rename or drop only in a later change), because the prod migration and the Vercel production deploy run at the same time.

### Database tests
pgTAP tests live in `supabase/tests/`. CI's `db-tests` job runs them on every PR against a throwaway local database built from the migrations. To run them yourself against dev: `supabase test db --linked` (the CLI's test runner needs Docker Desktop running). Each test runs in a transaction and rolls back.

### Auth settings (do this in each project's dashboard)
- **Authentication → Sign In / Providers → Email:** enabled. Leave "Confirm email" on.
- **Authentication → URL Configuration:**
  - Site URL: `http://localhost:3000` (dev) or `https://byebell.com` (prod).
  - Redirect URLs:
    - dev: `http://localhost:3000/**` and `https://scam-radar-*-hawleys-projects.vercel.app/**` (preview deploys)
    - prod: `https://byebell.com/**` (keep `https://scam-radar.joechawley.com/**` while the old domain redirects)
- **Authentication → Emails → SMTP Settings:** custom SMTP via [Resend](https://resend.com).
  - Host `smtp.resend.com`, port `465`, username `resend`, password: a Resend API key.
  - Sender: `no-reply@byebell.com`, name `ByeBell` (domain verified in Resend). Password: a Resend key with sending access for byebell.com.
- **Authentication → Emails → Templates:** paste `supabase/templates/sign-in.html` into both **Magic Link** and **Confirm signup** (subject: `Your ByeBell one-time code: {{ .Token }}`), in both the dev and prod projects. Re-paste after any change to the file; it copies the look of `src/lib/email/layout.ts` by hand. Custom templates require custom SMTP.
  - **Both** templates matter: brand-new emails get **Confirm signup**, returning ones get **Magic Link**. If Confirm signup keeps Supabase's default (`{{ .ConfirmationURL }}`, no code), first-time links only work in the browser that asked for them, so they fail in Gmail's in-app browser and show "That sign-in link didn't work."

The email has a link (to `/auth/confirm?token_hash=…`, works in any browser) and a sign-in code. The code is for people using the app from their iPhone home screen, which doesn't share sign-ins with Safari. The code entry is controlled by `SIGN_IN_CODE_ENABLED` in `src/app/login/login-form.tsx`; it must stay in sync with the template.

## Deploys (Vercel)

- Import the GitHub repo in Vercel (framework: Next.js; defaults are fine).
- Environment variables (Project Settings → Environment Variables):
  - **Production:** prod project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`; `NEXT_PUBLIC_SITE_URL=https://byebell.com`; plus its own `RATE_LIMIT_SALT`, `CRON_SECRET`, `EMAIL_TOKEN_SECRET`, `RESEND_API_KEY`, and `FTC_API_KEY`
  - **Preview:** the dev project's values; `NEXT_PUBLIC_SITE_URL=https://scam-radar-git-<branch>-hawleys-projects.vercel.app` is fine for testing (links in preview emails need Vercel sign-in); different random secrets
  - Mark every secret (`SUPABASE_SECRET_KEY`, `RATE_LIMIT_SALT`, `CRON_SECRET`, `EMAIL_TOKEN_SECRET`, `RESEND_API_KEY`, `FTC_API_KEY`) as **Sensitive**.
- Every branch push gets a preview deploy; `main` deploys to production at **https://byebell.com** (DNS at DreamHost: A record for the apex, CNAME for `www`). `www.byebell.com` and the old **scam-radar.joechawley.com** 308-redirect to byebell.com; keep the old domain attached in Vercel for at least a year (old emails and flyers link to it).
- Preview deploys are behind Vercel Authentication (Deployment Protection). Sign in to Vercel to view them, including on a phone.
- **Content-Security-Policy** (`next.config.ts`) is in **report-only** mode: nothing is blocked; browsers report violations to `/api/csp-report`, which logs them without query strings. Review them in Vercel → Logs, searching `csp-violation`. To enforce, rename the header to `Content-Security-Policy` once the logs are clean (previews also allow `vercel.live` for Vercel's toolbar). Production builds only.

## Alerts (email)

- **Sending:** [Resend](https://resend.com) API, from `alerts@byebell.com` (display name ByeBell). Create an API key with **Sending access** for byebell.com; use separate keys for Preview and Production. SPF and DKIM come from the Resend domain verification (`resend._domainkey`, `send`); DMARC is a TXT record at DreamHost (`_dmarc`, `v=DMARC1; p=none;`). Support mail: `support@byebell.com` (DreamHost, forward-only).
- **Instant alerts:** sent right after a report or "I got this too" pushes a cluster to `ALERT_INSTANT_THRESHOLD` (default 3), to users in **instant** mode within their radius. Max 3 per person per day.
- **Daily digest:** Vercel Cron calls `/api/cron/digest` at 12:00 UTC (8 am Eastern in summer, 7 am in winter). Crons only run on production. To run it on a preview:
  ```sh
  curl -H "Authorization: Bearer $CRON_SECRET" https://<preview-url>/api/cron/digest
  ```
  Previews are behind Vercel Authentication, so run that from a browser session or add a [protection bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection) header. Re-running sends nothing new: one digest per person per Eastern day.
- **No duplicates:** each email is recorded in `alerts_sent` before it's sent and released if sending fails.
- **Unsubscribe:** every email has one-click unsubscribe headers and a signed link to `/email-preferences` that works without signing in.

## Report flow

- `/report` is public. The message comes first; a keyword matcher (`src/lib/classify.ts`) suggests one of 7 groups ("Looks like: …") only when confident, otherwise "Something else or not sure". Channels, redaction, and the editable preview are unchanged.
- Sign-in happens at **Post**, inside the page (email → 6-digit code), then the report posts. If someone taps the emailed link instead, a short-lived `byebell_return_to` cookie brings them back to `/report`.
- The **redacted** draft is kept in the browser (`localStorage`, `byebell:report-draft`) for up to 24 hours so it survives sign-in or a reload. It's cleared on post, sign-out, account deletion, and "Discard draft". Raw text is never stored.
- New users' first report zip becomes their home zip ("We'll use this zip for your alerts").
- Limits: previews 30/hour per IP (public); posts unchanged (5/hour, 20/day per user).
- Scam groups (`src/lib/scam-types.ts`): fake fee or delivery, impersonation, family emergency, too good to be true, tech support, home repair or in-person, something else. Older finer-grained values are shown as their group (`LEGACY_SCAM_TYPES`) until the data remap migration.

## Trust and safety

- **Admin access:** `/admin` is owner-only. Add yourself once per Supabase project (dev and prod) in **SQL Editor**:
  ```sql
  insert into public.admins (user_id)
  select id from auth.users where email = '<your email>';
  ```
  Admins get an email when a report is flagged. Don't commit admin emails to the repo.
- **Flags:** 3 open flags from accounts in good standing auto-hide a report until an admin removes it or dismisses the flags.
- **Reputation:** computed live by `public.reputation()` (formula in the migration `*_trust_and_safety.sql`). Accounts below −2 are limited: their reports and "got this too" are hidden from others and don't count toward alerts. Newer accounts (below 3) count half toward the instant-alert threshold.
- **Rate limits:** in `src/lib/rate-limits.ts`. `node scripts/check-rate-limit.mts` verifies the database limiter on the linked dev project.
- **Account deletion:** Settings → Delete my account removes the user and cascades to their reports, corroborations, ratings, flags, and alert history.
- **Legal pages:** `/terms`, `/privacy`, `/rules`. The contact address is `SUPPORT_EMAIL` in `src/lib/site.ts`. Update `/privacy` whenever data collection or service providers change.

## Unwanted-call trends (public data)

- **Sources:** FTC Do Not Call complaints API (`api.ftc.gov/v0/dnc-complaints`, needs `FTC_API_KEY` from [api.data.gov](https://api.data.gov/signup)) and the FBI IC3 announcements feed (`ic3.gov/PSA/RSS`, filtered to scam/fraud items). FTC content is public domain; show attribution and never imply endorsement. **BBB Scam Tracker is link-only**: its terms prohibit aggregation.
- **Privacy:** only daily counts are stored: per market area code and subject (`dnc_daily_counts`) and per state and subject (`dnc_state_daily_counts`). Phone numbers and cities from the FTC data are dropped during ingestion.
- **What the data means:** the complainant's state and their phone's area code, not where the caller is or the viewer's town. Labels say "reported in New Jersey (201 and 551 area codes)", never "near you". Complaints with no state listed (about 1 in 7) are excluded.
- **What a visitor sees:** their market (same state as their zip **and** within the market's radius) if it has data; otherwise their state's trends; otherwise "No local trend data for your area yet" plus national FBI headlines. Zip states come from the Census ZCTA-to-county file (`zip_centroids.state`).
- **Ingestion schedule:** a **Supabase pg_cron** job (`ingest-ftc`, migration `20261113140000_ingest_pg_cron.sql`) calls `/api/cron/ingest?background=1` on prod **every 15 minutes, 17:00–22:45 UTC, Monday–Friday** (after the FTC's weekday update, ~noon Eastern). With `background=1` the endpoint replies 202 at once and finishes the run itself, so pg_net's short timeout doesn't matter. The job reads two **Vault** secrets in the prod project (Dashboard → Integrations → Vault): `ingest_url` (`https://byebell.com/api/cron/ingest`) and `ingest_cron_secret` (the prod `CRON_SECRET`). Without them it does nothing, which is why dev never calls prod. If `CRON_SECRET` changes, update the Vault secret too. Backups: GitHub Actions (`.github/workflows/ingest.yml`, at :07/:22/:37/:52, 17:00–20:59 UTC; GitHub drops many scheduled runs) and Vercel Cron daily at 18:00 UTC. Check the job with `select * from cron.job_run_details order by start_time desc limit 20;` and the calls with `select * from net._http_response order by created desc limit 20;`. Each run skips market days and states fetched in the last 6 hours (days with zero complaints are re-checked, since zero usually means "not published yet"), so repeat runs are cheap. The workflow needs the repo secret `PROD_CRON_SECRET` (the prod `CRON_SECRET`). Run it by hand from GitHub → Actions → **Ingest FTC data** → Run workflow, or with curl:
  ```sh
  curl -H "Authorization: Bearer $CRON_SECRET" https://<url>/api/cron/ingest
  ```
  - **Markets:** area code + date queries (the API supports both together), limited to complaints from the market's state. Fills missing days in the last 14 and re-fetches the last 3.
  - **States:** the API ignores date filters when filtering by state, so each state is read newest-first, 3 days deep, every run. There is no backfill beyond that; state trends say "N days of data so far" until a week is collected, and week-over-week comparisons appear after two weeks.
  - **Rate limits:** besides the key's hourly quota (20,000), a stricter burst throttle sits in front of the API. It appears to be per IP (Vercel shares IPs), rejects rapid requests with a 429 that reports "remaining 0", and takes ~10 minutes to recover; retrying sooner doesn't help. So requests go one at a time, paced (~400 ms apart), within a 4-minute run budget (plus a 15-second timeout per request and a hard stop at 270 s, so a run never exceeds the 300 s function limit): market area codes first (newest day for every code before any backfill), then market states, then the other states least recently fetched first (so states one day's runs didn't reach go first the next day). On a 429 the run stops and keeps every fully read day, and no run calls the FTC for the next 20 minutes, since requests during the throttle's recovery keep it locked. Only one run fetches at a time: overlapping triggers (pg_cron, GitHub Actions, Vercel Cron) find the lease taken and skip; the lease and cooldown live in `dnc_ingest_control` (`dnc_claim_run`, `dnc_finish_run`). Ingest runs email admins only on real errors. A daily coverage check (in the digest cron, Tue–Sat) emails if any market area code or more than 12 states weren't fetched in the last day.
  - **Actions minutes:** the repo is public, so GitHub-hosted runners are free. If it went private, the worst case is 16 runs × ~22 weekdays × 5 billed minutes = 1,760 minutes/month (runs that skip finish in under a minute), within the Free plan's 2,000.
- **Markets:** areas with area-code trends live in the `markets` table (state, area codes, center zip, radius, police contact). The center zip must be in the market's state. Add or change them in Supabase **SQL Editor**; no code change or deploy needed, and the next ingest picks up new area codes:
  ```sql
  insert into public.markets (name, state, area_codes, center_zip, radius_miles)
  values ('NY 914', 'NY', '{914}', '10601', 25);

  -- Police contact shown on /next-steps (null = "your local police non-emergency line"):
  update public.markets set police_contact = 'the Town Police non-emergency line at (555) 555-0100' where name = 'NY 845';
  ```

## Pilot (Phase 6)

See [PILOT.md](PILOT.md) for the launch checklist, weekly routine, and success criteria. Metrics are first-party only: aggregate daily counts (`usage_daily`) and signed-in activity days (`user_activity_days`), shown at `/admin/metrics` and emailed to admins on Mondays. Alert emails stop at `EMAIL_DAILY_BUDGET` per day (default 90). The printable flyer is at `/flyer`.

## Making changes

1. Branch from `main`: `git checkout -b <feature>`.
2. If the change includes a migration, apply it to dev: `supabase db push` (CLI linked to dev).
3. Push the branch and open a pull request. This runs:
   - **CI** (GitHub Actions): `npm audit` (fails on high severity), lint, typecheck, unit tests.
   - **Security scans**: CodeQL (TypeScript and workflow files; results under Security → Code scanning) and gitleaks (secrets anywhere in git history). Also run weekly. Keep GitHub's CodeQL "default setup" off, since this workflow replaces it.
   - **Vercel preview** using the dev database.
4. Test on the preview. When CI is green, merge the PR.
5. Merging to `main`:
   - Vercel deploys production.
   - If `supabase/migrations/` changed, the **Migrate prod database** workflow applies them to prod. Check it passed under the repo's **Actions** tab.

### One-time GitHub setup
- **Settings → Secrets and variables → Actions → New repository secret:**
  - `SUPABASE_PROD_DB_URL`: prod project → **Connect** → **Session pooler** connection string (port `5432`), with `[YOUR-PASSWORD]` replaced by the prod database password. Percent-encode special characters in the password (e.g. `@` → `%40`, `#` → `%23`, `/` → `%2F`). Don't use the direct connection string; GitHub runners can't reach it (IPv6 only).
- **Settings → General → Pull Requests:** turn on **Automatically delete head branches**.
- **Settings → Rules → Rulesets → New branch ruleset** for `main`:
  - Require a pull request before merging.
  - Require status checks to pass: `checks` and `db-tests`.
  - Block force pushes.
