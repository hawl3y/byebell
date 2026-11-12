# CLAUDE.md — scam-radar

## Current status (Oct 2026)
- **Phases 0–6 are complete and merged.** The app is live (Vercel + Supabase prod).
- **The app is ByeBell** (official; tagline "Ring the bell on scams") at **https://byebell.com**. `www.byebell.com` and the old scam-radar.joechawley.com 308-redirect to it (keep the old domain for at least a year). Email: alerts@ and no-reply@byebell.com via Resend; support@byebell.com (DreamHost). Display name, logo (`src/components/logo.tsx`), and app icons are ByeBell.
- **The pilot is starting.** Next steps, open follow-ups, the weekly routine, and the rename checklist are in `PILOT.md`.
- **Unwanted-call trends (updated Oct 24, PRs #12–#14):** markets match only zips in the **same state** within their radius (zip states from the Census ZCTA file). Markets: **NY 845** and **NJ Bergen** (201/551). Every other state gets state-level trends; no data shows "No local trend data for your area yet". Labels name the state and area codes, never "near you".
- **FTC ingest:** the API's burst throttle (~100 requests per run from Vercel, likely per IP) shapes everything. Requests are paced one at a time, markets first (days interleaved across area codes), then market states, then a daily rotation; a 429 stops the run and keeps completed days; repeat runs skip work done in the last 6 hours. **GitHub Actions** (`.github/workflows/ingest.yml`, secret `PROD_CRON_SECRET`) runs it every 15 minutes, 17:00–20:45 UTC, Mon–Fri; **Vercel Cron** at 18:00 UTC is the backup. Ingest emails admins only on real errors; a daily **coverage check** (digest cron, Tue–Sat) emails if a market area code or more than 12 states weren't fetched. Details: README → Unwanted-call trends.
- **Done Oct 26 (PRs #22–#26):**
  - Pilot metrics: `/admin/metrics` target cards and the weekly summary email.
  - One shared email layout for every email (`src/lib/email/layout.ts`).
  - Sign-in by 6-digit one-time code: subject `Your ByeBell one-time code: {{ .Token }}`, template `supabase/templates/sign-in.html`, pasted into Supabase dev and prod.
  - Security review fixes (`SECURITY_REVIEW.md`), HttpOnly auth cookies, and a report-only CSP (violations logged by `/api/csp-report`).
  - Weekly Dependabot (npm and Actions), CodeQL, gitleaks, and `npm audit` in CI.
  - A ruleset protecting `main`.
  - The comment and security-checklist guardrails below, plus the PR template.
- Phase statuses and every decision made during the build (matching, alerts, reputation, limits, pilot targets) are in `PROJECT_BRIEF.md` §8 and §10. Future work is §11; don't start it without the owner.
- Name, tagline, domain, and sender emails are set in `src/lib/site.ts` (plus the outside-the-code places in `PILOT.md`). The repo and infrastructure names keep "scam-radar".

## Start here
1. Read `PROJECT_BRIEF.md` fully before planning or writing code. It is the source of truth.
2. Work **one phase at a time** (see brief §8). Don't start a phase until the previous phase's "Done when" criteria pass.
3. Before writing code for a phase, propose a short plan and wait for approval.

## Rules
- Stay within the MVP scope. Anything in the brief's Non-goals (§5) is out unless the owner says otherwise.
- TypeScript only. Don't add Python or other languages without asking.
- Privacy rules in the brief (§7) are non-negotiable: redact before saving, approximate locations only, row-level security on every table.
- Never commit secrets. Use `.env.local` locally and Vercel environment variables for deploys.
- Database changes only through Supabase migrations. Apply them to dev (`supabase db push`, linked to dev) before testing a preview; never push to prod by hand. CI applies them to prod on merge.
- Migrations must be backward compatible with the code already in production (add, don't rename or drop in the same change), because the prod migration and the Vercel deploy run at the same time.
- Small, focused commits on a feature branch, opened as a PR. CI (lint, typecheck, test) must pass; the owner merges to `main` after checking the Vercel preview.
- Keep `README.md` setup steps current whenever setup changes.
- Code comments explain non-obvious *why* only (security reasons, tricky logic, known limits). No instructions, setup steps, brief or phase references, or comments that restate the code. Setup goes in `README.md`.
- Security checklist for every change. Before pushing, check and briefly report on:
  - input validation and redaction;
  - injection (SQL, XSS, email);
  - auth and RLS on any new table or function;
  - CSRF on new actions or routes;
  - open redirects;
  - rate limits on new public endpoints;
  - no secrets in client code;
  - safe use of new dependencies.

  Note the results in the PR description (the PR template has the list).
- When something in the brief is unclear or conflicts with best practice, ask instead of guessing.
- Keep responses brief: only what's needed.

## Reporting style
- End-of-task summaries in chat: at most 5 short bullets covering what changed, check results, and anything the owner needs to do.
- Skip root-cause narratives, file-by-file detail, and checklist results unless something failed or the owner asks.
- Full detail goes in the PR description, not the chat.

## Environment
- Owner develops on macOS (VS Code + Claude Code). Keep setup reproducible and documented in `README.md`.
- GitHub: https://github.com/hawl3y/scam-radar
- Hosting: Vercel. Previews (dev database) per branch; production (prod database) from `main` at https://byebell.com.
