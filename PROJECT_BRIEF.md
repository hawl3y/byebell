# ByeBell — Project Brief (MVP)

> **Status (Oct 2026):** Phases 0–6 are built, merged, and live at **https://byebell.com**. The app is **ByeBell** ("Ring the bell on scams"; formerly the working title Scam Radar). The pilot is starting; see `PILOT.md`. Decisions made during the build are in §10.
>
> This brief is the source of truth for the MVP. Read it fully before planning or writing code. When a decision here conflicts with a default you'd otherwise choose, follow this brief and flag the conflict.

## 1. What we're building

A mobile-friendly web app (PWA) that acts as a **local scam radar**. Residents report suspicious texts, calls, emails, websites, and in-person visits. Neighbors corroborate ("I got this too"), and the app alerts people nearby by email and in-app notices. Public scam data (BBB, FTC) provides a baseline so the feed is useful before local reports build up.

- **Test market:** a single town (the owner's). Design for one area first; don't build multi-region admin tooling.
- **Positioning:** complements the BBB and FTC, doesn't compete with them.
- **Tone:** calm, factual, useful. A radar, not a fear feed.

## 2. Users and core jobs

| User | Core job |
|---|---|
| Resident | "Is this message a scam?" and "What's going around near me?" |
| Reporter | Report a scam in under a minute |
| Neighbor | Confirm "I got this too" |
| Victim | Know who to call and what to do first |
| Admin (owner) | Remove wrong or harmful posts |

## 3. MVP feature set

### Access
- PWA: works in any mobile browser; optional "Add to Home Screen."
- No account needed to browse the feed or use "Check."
- Email magic-link account required to report, corroborate, rate, or receive alerts.
- Setup: zip code or location, alert radius, alert preferences.

### What users see
- **Local feed:** nearby reports, newest first, with distance ("2.3 mi away") and time.
- **Trending near you:** national scams active in the area (public data).
- **Alert cards:** what the scam looks like, report count, what to do.
- **"New near you" notices:** badge and banner on open.
- **Map view:** post-MVP (MVP+).

### What users do
- **Check:** paste a message or describe a call or visit and get a plain-English read based on matching reports and patterns.
- **Report:** short form (type, channel, description, approximate location). Personal info is redacted automatically before saving.
- **Corroborate:** "I got this too."
- **Rate:** helpful / not helpful.
- **Share:** copy a link to an alert to send to family.

### What users get
- **Email alerts:** daily digest by default; instant email when a local cluster crosses a threshold.
- **In-app notices** on open.
- **Optional web push** for home-screen users.
- **Next steps pages:** who to call and what to do first if they've been scammed.

## 4. Trust model (community-rated, no review queue)

- Labels describe the crowd, never a verdict: "Reported by 12 neighbors." Never "Confirmed scam."
- Reputation weighting: established users count more than new accounts.
- Hard rules: no naming private individuals; personal info redacted automatically.
- Flag / takedown path with a simple admin screen. This is occasional removal, not pre-approval.

## 5. Non-goals (do not build)

- Training, courses, quizzes, or general "awareness" content
- Social feed, comments, or chat
- SMS alerts
- Native iOS/Android apps
- Sponsors, payments, or donations
- Small business features
- Multi-region admin tooling

## 6. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router), TypeScript | Front end and API routes in one codebase |
| Hosting / CI | Vercel + GitHub | Preview deploy per branch; production on `main` |
| Database | Supabase Postgres | PostGIS for radius queries; pgvector enabled but unused (reserved for §11) |
| Auth | Supabase Auth, email magic link | No passwords |
| Email | Resend | Sign-in emails (Supabase custom SMTP) and alerts |
| Web push | Web Push API with VAPID keys | Deferred (§11) |
| Scheduled jobs | Vercel Cron | Digests, public data ingestion |
| Matching | Postgres `pg_trgm` text similarity | Clustering and "Check" matching. No AI in the MVP so far; see §11 |
| Styling | Tailwind CSS | Mobile-first |

**Language policy:** TypeScript everywhere for the MVP. Python may be added later only for a clear need (e.g., data ingestion); don't introduce it without asking.

**Environments:** separate Supabase projects for dev and prod. Secrets in Vercel environment variables and a local `.env.local` (never committed).

**Dev setup:** owner works on a MacBook Pro (VS Code + Claude Code). Keep setup reproducible: document every step in `README.md`, pin Node version (`.nvmrc`), use the Supabase CLI for migrations.

## 7. Data model (starting sketch — refine in Phase 0/1)

- **profiles:** id (auth user), email, home_zip, home_point (approximate, geography), radius_miles, alert_mode (`digest` | `instant` | `off`), reputation, created_at
- **reports:** id, user_id, scam_type, channel (`text` | `call` | `email` | `website` | `visit` | `other`), description_redacted, point (approximate, geography), zip, cluster_id, embedding (vector), status (`active` | `removed`), created_at
- **clusters:** id, title, summary, report_count, corroboration_count, centroid (geography), first_seen, last_seen
- **corroborations:** user_id, cluster_id, created_at (unique per user + cluster)
- **ratings:** user_id, report_id, helpful (bool), created_at (unique per user + report)
- **flags:** id, report_id, user_id, reason, status, created_at
- **push_subscriptions:** user_id, endpoint, keys, created_at
- **alerts_sent:** user_id, cluster_id, channel, sent_at (dedupe and throttling)
- **public_scams:** id, source, title, summary, region, published_at, url

### Privacy rules (non-negotiable)
- Never store raw, unredacted report text. Redact before insert.
- Never store exact addresses. Snap locations to an approximate grid or zip centroid.
- Never show reporter identity publicly.
- Use Supabase row-level security on every table.

## 8. Build phases

Each phase ends with a working deploy. Don't start the next phase until the "Done when" criteria pass.

### Phase 0 — Foundation
**Status:** ✅ Complete (PR #1; CI/CD and automatic prod migrations in PRs #2–#3).

- Repo, Vercel connection, preview deploys.
- Supabase dev and prod projects; enable PostGIS and pgvector; migrations via Supabase CLI.
- Next.js PWA scaffold: manifest, service worker, installable.
- Magic-link login; profile setup (zip, radius).
- `README.md` with full local setup.
- **Done when:** PWA deployed, login works, profile saves, database connected in dev and prod.

### Phase 1 — Report and feed
**Status:** ✅ Complete (PR #4).

- Report form with validation.
- Redaction step (phone numbers, emails, names, account/card numbers, street addresses) before saving. Unit tests for redaction.
- Approximate location handling.
- Local feed by radius with distance and time; alert card view.
- **Done when:** a user reports a scam and a second test user within the radius sees it, redacted, with correct distance.

### Phase 2 — Check and corroborate
**Status:** ✅ Complete (PR #5).

- Text similarity on reports with Postgres `pg_trgm` (no AI). Matching sits behind database functions so embeddings can replace it later (§11).
- "Check": paste text, return matching local clusters with fixed plain-English guidance and tips. Never claim certainty. Per-IP rate limit.
- Clustering: new reports join an existing cluster when similar enough.
- "I got this too" with counts on cards.
- **Done when:** a pasted message finds the matching cluster, and corroboration counts update correctly.

### Phase 3 — Alerts
**Status:** ✅ Complete (PR #6). Web push and the home-screen icon badge were deferred (§11); "new near you" is a banner plus labels.

- Alert preferences UI.
- Daily digest via Vercel Cron.
- Instant email when a local cluster crosses a configurable threshold.
- Throttling and dedupe via `alerts_sent`.
- "New near you" badge and banner.
- Optional web push for home-screen users. *(Deferred.)*
- SPF, DKIM, DMARC configured on the sending domain.
- Emails link to the alert in the app and never ask users to log in from the email.
- **Done when:** test users receive correct digests and instant alerts in the inbox (not spam), with no duplicates.

### Phase 4 — Trust and safety
**Status:** ✅ Complete (PR #7).

- Reputation scoring (account age, corroborated reports, helpful ratings).
- Helpful / not-helpful ratings.
- Flagging and an admin takedown screen (owner-only role).
- Rate limiting on report, check, and corroborate endpoints.
- Terms of use, privacy policy, and community rules pages.
- **Done when:** flagged posts can be removed, low-reputation spam doesn't surface, and rate limits hold.

### Phase 5 — Trending near you
**Status:** ✅ Complete (PRs #8–#9; state-correct matching and state-level trends added after launch). FTC Do Not Call complaints and FBI IC3 announcements are ingested; FTC Consumer Alerts have no feed and were skipped; BBB Scam Tracker is link-only (its terms bar aggregation).

- **First:** confirm what BBB and FTC data can legally be used. Don't scrape without confirming terms.
- Ingestion job via Vercel Cron into `public_scams`.
- "Trending near you" section.
- "Next steps" pages (bank, local police, FTC ReportFraud, BBB Scam Tracker, IC3).
- **Done when:** a new user in the test town sees a useful feed with zero local reports.

### Phase 6 — Pilot launch
**Status:** 🟡 Engineering complete (PR #10); the 4–8 week pilot is starting. "Email opens" is measured as visits from email links (no open tracking). See `PILOT.md`.

- Seed 10–20 real local reports.
- Recruit early users (local groups, library, senior center, neighbors).
- Privacy-respecting analytics: sign-ups, reports per week, corroboration rate, email opens, return visits.
- **Done when:** 4–8 weeks of real usage data to decide whether to continue, adjust, or stop.

## 9. Engineering conventions

- Small PRs, one feature per branch; verify on the preview deploy before merging to `main`.
- Database changes only through migrations.
- Unit tests for redaction, clustering thresholds, reputation scoring, and alert throttling.
- Accessibility: large tap targets, readable fonts, high contrast. Many users will be older.
- Plain-English UI copy. No jargon, no fear language.
- Treat all user-submitted text as untrusted (sanitize output; never pass it as instructions to an LLM without clear separation).

## 10. Decisions log

Settled during the build (the former open questions plus later decisions). Change them only with the owner.

| Topic | Decision |
|---|---|
| Name and domain | **ByeBell** (tagline "Ring the bell on scams"), official. Production domain **byebell.com** (registered at DreamHost); www and the old scam-radar.joechawley.com 308-redirect to it. The repo, Supabase/Vercel project names, and internal identifiers keep "scam-radar". |
| Matching | Postgres `pg_trgm` text similarity, **no AI**. Join a cluster at score ≥ 0.45; Check shows matches at ≥ 0.32 (calibrated with `scripts/calibrate-matching.mts`). Clustering ignores scam type; 50-mile, 90-day window. An alert's type is the most common type among its visible reports ("Something else" never wins over a specific type; ties go to the most recent), recalculated when reports are added or hidden. |
| Redaction | Rules only. The reporter sees and edits a redacted preview before posting; the server redacts again on post. Links are kept but always shown defanged and never clickable. |
| Location | Zip code centers only (US Census ZCTA). Default radius 10 miles (choices 5, 10, 25). |
| Email provider | **Resend**, for Supabase sign-in emails (custom SMTP) and alerts. Alert emails stop at `EMAIL_DAILY_BUDGET` (default 90/day) because of Resend's free-plan limit. |
| Alerts | Daily digest by default; instant mode adds instant emails. Instant threshold: weighted support ≥ 3 (established accounts 1, newer 0.5); max 3 instant emails per person per day. Digest at 12:00 UTC. |
| SMS | Not built (stays a non-goal). |
| Web push | Deferred (§11). |
| Reputation | +1/week of account age (max 4), +2 per report others joined or corroborated (max 10), ±1 per helpful/not-helpful rating (max +10), −5 per admin removal. **Limited below −2**: posts hidden from others and not counted toward alerts. |
| Flags | Auto-hide a report at 3 flags from accounts in good standing, pending admin review. Ratings are private. |
| Report flow | Message first; sign-in at Post inside the flow (code entry), draft (redacted only) kept on the device up to 24h and cleared on post/sign-out/discard; 7 scam groups with a confident-only keyword suggestion; first report's zip becomes the home zip. |
| Rate limits | Report 5/hour and 20/day; report previews 30/hour per IP; "I got this too" 30/hour; ratings 60/hour; flags 20/hour; Check 20/hour per IP. |
| Public data | FTC Do Not Call API (stored as daily counts only; no phone numbers or cities) and FBI IC3 RSS. Markets (rows in `markets`, seeded NY 845 and NJ Bergen 201/551) match zips in the **same state** within their radius. Every other state gets state-level trends (read newest-first, 3 days deep daily; no backfill). Labels name the state and area codes and never claim town-level precision; complaints without a state are excluded. The API's burst throttle allows ~100 requests per run, so ingest runs every 15 minutes on weekday afternoons via GitHub Actions (free for this public repo), skipping work already done; Vercel Cron at 18:00 UTC is the backup. |
| Legal | Terms (18+), privacy policy, and community rules drafted; contact `support@byebell.com`. Lawyer review pending before wide launch. |
| Pilot metrics | First-party only: aggregate daily counts and signed-in activity days. No analytics providers, tracking cookies, or email open tracking. |
| Pilot success criteria | 50+ sign-ups in the test area; 5+ reports/week by week 4; 30%+ alerts corroborated; 40%+ users returning in a later week; under 10% turning off emails. |

## 11. Future roadmap

Not planned for the MVP. Revisit only if the pilot continues, and with the owner's approval (several are non-goals in §5).

- **AI matching and redaction:** embeddings for clustering and Check (replacing the `pg_trgm` function bodies; pgvector is already enabled), an AI redaction pass after the rules, and generated plain-English Check answers. Trigger: paraphrased reports of the same scam don't cluster, or Check misses obvious matches. Only rules-redacted text would be sent to an AI provider.
- **Web push** for home-screen users, plus the home-screen icon badge for "new near you".
- **Renaming / new domain:** done: ByeBell at byebell.com (checklist in `PILOT.md`).
- **More areas:** add rows to `markets` (no code change); multi-region admin tooling stays a non-goal until needed.
- **Sponsors, payments, or donations** (currently a non-goal).
- **Native iOS/Android apps** (currently a non-goal).
- **Small business tier** (currently a non-goal).
