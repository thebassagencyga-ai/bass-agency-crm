# Changelog

All meaningful changes, grouped by milestone.

## Phase 20 — Tag list (2026-10-17, approved)
### Changed
- Tags are now **ticked from a list** on the contact form instead of typed. The list lives in
  Settings → Tags (add, rename, remove). Starter list: VIP, Referral partner, Church, Small
  business, Farm, Family plan, Do not text. Tags already in use were added to the list.
- Migration `20261030120000_tag_options.sql`.

## Phase 19 — AI helpers, not connected (2026-10-17, approved)
### Added
- AI helpers, **off until an API key is added** (runbook §4d): Draft with AI in the message
  composer, Fill in from my notes on Log activity, Daily briefing on the dashboard, Suggest
  matches with AI when importing. Suggestions only; $10/month cap; Settings → AI helpers.
- Migration `20261029120000_ai_usage.sql` (usage ledger, numbers only).

## Phase 18 — Calendar feed (2026-10-17, approved)
### Added
- **Calendar** in Settings: a private link that shows your open tasks in iPhone or Google
  Calendar ("task — client name" on the due date); replace or turn off at any time.
- Migration `20261028120000_calendar_feed.sql`; smoke test gains a calendar check (18 checks).

## Phase 17 — Tags and merging duplicates (2026-10-17, approved)
### Added
- **Tags** on contacts (e.g. VIP, Church): on the contact form, the contact page and list; filter
  the list by tag; rename or remove a tag everywhere in Settings.
- **Merge duplicates:** "Merge…" on a contact (and a "possible duplicate" hint with the same
  email or phone): pick which contact to keep, see the merged result, confirm. Everything moves
  to the kept contact; the duplicate is archived and marked "merged". Nothing is deleted.
- Contacts download includes tags and "merged into".
- Migration `20261027120000_tags_merge.sql`.

## Phase 16 — Inactivity sign-out and text/email (2026-10-17, approved)
### Added
- Signed out after **7 days without use** (with a message on the sign-in page); the
  authenticator code is asked for again **every 12 hours**.
- **Text or email** on the contact page — opened from opportunities, renewals and tasks, and as
  a reply on intake review: ready-made, editable messages that open the phone's Messages or Mail
  app (nothing is sent by the CRM), plus Call, Copy and "Log this text/email".
- Review and referral request messages on tasks also get **Email it**.
### Note
- After deploying, every device is signed out once.

## Phase 15 — Import and export (2026-10-16, approved)
### Added
- **Import clients** from a CSV report: guessed column matching, policy-type mapping, a check
  with problems and existing-contact matches, one-step import, undo for 7 days.
- **Download my data** in Settings: CSV files for contacts, policies, tasks, activities,
  household and vehicles.
- Migration `20261026120000_import_export.sql`; reports ignore imported history.

## Phase 14 — Intake details (2026-10-16, approved)
### Added
- Intake form and quick intake ask for the street address, vehicles (year, make, model; with an
  auto quote) and other drivers / household members (names, relationship).
- Contact page: **Household / other drivers** and **Vehicles** with add, edit and remove
  (archived, never deleted).
- Migration `20261025120000_intake_details.sql` (`household_members`, `vehicles`).
### Not collected (on purpose)
- Dates of birth, driver's license numbers, VINs (ADR-029).

## Phase 13 — Intake form (2026-10-16, approved)
### Added
- Public quote-request form at `/quote/<link>` (no sign-in) with a QR code and on/off/replace
  in Settings; submissions wait in a new **Intake** inbox (dashboard badge).
- Accept creates the contact (or adds to an existing one), a New lead per line, the referral
  link and a quote task 30 days before the current policy renews; Discard erases the details.
- Quick intake for the agent with a duplicate check.
- Opportunities record the prospect's current carrier and renewal (shown on the opportunity).
- Migration `20261024120000_intake.sql`; the only anonymous database function,
  `submit_intake` (validated, rate-limited). Smoke test checks the public form (17 checks).

## Go-live — 2026-10-16
- Owner signed the go-live checklist: "I approve entering real client data." Test records
  removed (clean start); first post-clean-start backup saved.

## Phase 12 follow-up — Free-plan backups (2026-10-16, approved)
### Added
- **Nightly backup** workflow: encrypted (AES-256) copy of the CRM data and sign-in list, kept
  30 days as a GitHub Actions artifact (ADR-027).
- **Restore backup (into an empty CRM project)** workflow: guarded, one transaction, sign-in ids
  remapped by email, checked afterwards.
### Changed
- **Backup restore drill** restores the latest nightly backup instead of reading production.
- Runbook, go-live checklist, SECURITY and README describe the Supabase Free plan (no Pro
  backups, leaked-password check or inactivity sign-out).

## Phase 12 — Production deployment & handoff (2026-10-16, approved)
### Added
- Production on the free `workers.dev` address; deploy workflow renamed **Deploy app
  (Cloudflare)**.
- `scripts/smoke-test.sh` (16 signed-out checks) after every deploy, in CI, and as the
  **Smoke test production** workflow.
- **Backup restore drill** workflow and `scripts/restore-drill.mts` (row counts per table +
  security verification on the restored copy).
- `docs/runbook.md` (operations, restore, access, secrets, costs) and
  `docs/go-live-checklist.md` (owner sign-off before real data).
- `scripts/sql/reset-test-data.sql`: optional clean start before go-live, guarded.

## Phase 11 — End-to-end testing & security review (2026-10-16, approved)
### Fixed
- Cross-sell "lost in the last 12 months" now counts New York dates (was off by a day for a
  few hours each evening). Migration `20261023120000_review_fixes.sql`.
- Sign-in says the service is unavailable when it is, instead of "incorrect password".
- The local-test cookie switch can no longer weaken cookies on the real site.
- Friendly "Page not found" and last-resort error pages.
- `glob` in build tooling updated to a patched version.
### Added
- Full sales-journey browser test with real two-step sign-in; error-handling browser tests.
- Catalog-driven RLS regression suite; app/database date-handling suite; backup-and-restore
  rehearsal into a fresh local database.
- CI: secret scan of files and full history; production dependency audit gate.
- `docs/security-review.md`: 11 findings with risk ratings.

## Phase 10 — Mobile experience & PWA (2026-10-15, approved)
### Added
- Add to Home Screen on iPhone: app name "Bass CRM", icon, full-screen (standalone) mode,
  opens on the dashboard.
- Offline notice when there is no connection. Only the app's own static files are kept on
  the phone; no client information is ever stored there.
- Larger tap targets (44 px) for list links, back links, phone and email links.
- Checks: responsive audit at 375 / 390 / 430 px, PWA/offline browser test, Lighthouse
  accessibility ≥ 90 on every key page, service-worker unit tests (ADR-025).

## Phase 9 — Reporting (2026-10-15, approved)
### Added
- Reports page with periods (this month, last month, this quarter, year to date, last 12
  months): conversion rate with its denominator, new leads by source, quotes sent and
  outcomes, open opportunities by line and stage, tasks completed (on time / late) vs
  overdue, renewal reviews and outcomes, cross-sell reviews by rule, referral sources,
  review and referral requests vs reviews recorded and referrals received.
- Every report states how it is counted. Premiums are recorded estimates only; no commission.
- Migration `20261022120000_reports.sql` (ADR-024): `report_summary`; cross-sell matching
  shared with the prompt list. Deploy verification expects 13 Data API functions.
- Tests: fixture-based database test per report (6 of 7 mutations caught; the 7th was
  equivalent), API and browser journeys, unit tests for periods and conversion.

## Phase 8 — Renewals & cross selling (2026-10-15, approved)
### Added
- Renewals page: next 30 / 60 / 90 days, by product line; past-due policies, client policies
  (with their review task) and prospects' current renewal dates.
- Retention workflow: record Renewed, Re-marketed or Lost (reason required) for a policy.
  Kept policies roll their renewal date forward by the term and get the next review task;
  lost ones leave renewals and a client with no other active policy becomes a former client.
  Renewal history on the policy.
- Auto policies can renew every 6 or 12 months.
- Cross-sell reviews on Renewals, the renewal page and the contact page, with the reason,
  "Start … opportunity" and "Not now" (hidden 12 months). Rules editable in Settings (4
  defaults; add your own).
- Migration `20261021120000_renewals_cross_sell.sql` (ADR-023): 3 tables, 4 functions; deploy
  verification expects 12 tables and 12 functions.
- Tests: database (31 new, 7 mutations caught), API, browser journey, unit.

## Phase 7 — Dashboard & daily workflow (2026-10-15, approved)
### Added
- Dashboard (first screen after sign-in): overdue, due today and next-7-days counts;
  overdue and due-today tasks with Done buttons; open opportunities and estimated annual
  premium by product line; renewals in the next 60 days; recent activity.
- Quick actions: Add contact, Log activity (pick a contact first), Add task.
- Migration `20261020120000_dashboard.sql`: `dashboard_summary` (one call per page load).
- Tests: database counts against fixture data (2 mutations caught), API and browser journey.

## Phase 6 — Automation engine (2026-10-15, approved)
### Added
- Automatic tasks from 12 rules: first contact for new leads; follow-up 2 business days after
  first contact without a quote; quote follow-up after 3 days; prospect-requested date; no
  response follow-up (asks first); on win close prospecting tasks, onboarding checklist,
  Google review and referral requests (once per contact per year, review skipped if already
  left); on loss close prospecting tasks; renewal review 60 days before renewal; re-engage on
  reopen.
- Never duplicates; changing a quote or renewal date moves the existing task; dates you
  change yourself are kept.
- Settings: turn rules off and edit their title, timing, priority, windows, checklist and
  messages (incentives refused).
- "No response" follow-up offer after logging a call; opportunity page lists its tasks.
- Migration `20261019120000_automation_engine.sql` (ADR-022); deploy verification checks
  the engine schema.
### Fixed
- Settings rule forms each have unique field ids (labels pointed at the wrong field).

## Phase 5 — Task management & activity history (2026-10-15, approved)
### Added
- Tasks page with Overdue, Today, Upcoming and Completed tabs (with counts) and filters for
  product line, priority and type; "today" in New York time.
- Add a task from a contact or by picking a contact; edit, complete, reopen and cancel
  (nothing is deleted); optional opportunity link and "don't show before" date.
- Google review and referral request tasks show the filled-in message with Copy and Text it
  (opens Messages; the CRM sends nothing).
- Log activity from a contact: call, meeting, note, logged email/text, follow-up and more,
  with time, outcome, requested follow-up date and notes.
- Contact page: open tasks and a history of activities and finished tasks.
- Settings: your name and Google review link for messages.
- Migration `20261018120000_task_views.sql`: `search_tasks`, `task_counts` (ADR-021).
- Tests: unit (New York midnight and daylight-saving boundaries, task tabs, messages,
  validation), database (task views, lifecycle, ownership; 2 mutations caught), API and
  browser journeys.

## Phase 4 — Opportunities & pipelines (2026-10-15, approved)
### Added
- Opportunities board per product line (Auto, Home, Commercial, Life) with a move-to-stage
  control on each card, and a searchable, filterable table across all lines.
- Add an opportunity from a contact (product line, starting stage, description, next action,
  quoted carrier, quote date, estimated premium, effective and renewal dates); edit details.
- Stage changes within the pipeline; won at Bound/Placed; lost with a reason; reopen at an
  active stage (history kept, new cycle); nurture on/off.
- Contact page lists the contact's opportunities.
- Migration `20261017120000_opportunity_lifecycle.sql`: `quoted_carrier`, lifecycle trigger,
  `search_opportunities` (ADR-020).
- Tests: unit (validation, stage rules, money, parameters), database (lifecycle, search,
  ownership; 4 mutations caught), API and browser journeys.
### Fixed
- Forms no longer lose a chosen dropdown value (contact status, preferred contact method,
  starting stage) after a validation message (React 19 form reset).

## Phase 3 follow-up — owner testing on iPhone (2026-10-14)
### Fixed
- "Referred by" explains that it picks from your contacts; text typed without tapping a contact
  now stops the save with a message instead of being silently dropped.
- "Google review left on" date box no longer overflows the screen in iPhone Safari.
- A business contact no longer flips to Individual after a form error (React 19 resets the
  form after each action; the type radios now keep their choice).
- Deploy verification allows Supabase's `rls_auto_enable` event-trigger function by name and
  prints every `public` function.

## Phase 3 — Contact management (2026-10-14, approved)
### Added
- Contacts list with search (name, business, email, phone), filters (type, status, lead
  source, archived), sorting and pagination; empty and loading states.
- Quick add / full form with server-side validation and field errors; contact detail page;
  edit; archive and restore (nothing is deleted).
- Possible-duplicate warning (same email or phone) with "Save anyway"; referred-by picker;
  Google review date; referrals shown on the referrer's page.
- Migration `20261016120000_contact_search.sql`: `search_contacts`,
  `find_possible_duplicates`, `contact_lead_sources` (SECURITY INVOKER, ADR-018).
- Deploy verification also checks the two-step policies, the sign-up trigger and the Data
  API functions.
- Tests: unit (validation, formatting, list parameters, dates), database (search, duplicates,
  ownership), API and browser journeys.
### Fixed
- Integration test helpers reuse an existing authenticator factor when a user signs in again.
- Contact form no longer overflows an iPhone screen when "More details" is open (the address
  row could not shrink, so the page zoomed out); the browser test now checks for sideways
  scrolling.

## Preview deployment (2026-10-15)
### Added
- Manual "Deploy app preview (Cloudflare)" workflow: CRM-only Supabase target, bundle scan with
  real values, deploy, live smoke test (ADR-017).
### Deployed
- Preview live at https://bass-agency-crm.thebassagencyga.workers.dev (deploy run #2).

## Phase 2 — Authentication & security foundation (2026-10-15, approved)
### Deployed
- Migration `20261015120000_auth_profiles_and_mfa.sql` applied to production (deploy run #6).
### Added
- Sign-in, mandatory two-step login (authenticator app), sign out, forgot/reset password.
- `middleware.ts`: session refresh, route decisions, per-request CSP nonce, security headers.
- Protected app shell with the seven menu items (placeholders) and a Settings page.
- Migration `20261015120000_auth_profiles_and_mfa.sql`: profiles created on sign-up; every
  table requires a two-step (aal2) session.
- Tests: 47 unit, 7 database, 21 integration (real Supabase), 1 browser journey; browser
  bundle secret scan in CI.
### Fixed
- Email kept after a failed sign-in; sign-in redirect keeps the query string; email links use
  `SITE_URL`.

## Post-Phase 1 — migration deployment (2026-10-14)
### Deployed
- Phase 1 migrations applied to the production CRM Supabase project and verified.
### Added
- Manual "Deploy database migrations" GitHub workflow: dry run by default, wrong-project
  guard, verification after apply (ADR-014). 17 unit tests for the safety checks.

## Phase 1 — Architecture & database foundation (2026-10-14, approved)
### Added
- Next.js 16.3.8 + TypeScript strict + Tailwind 4 + ESLint 9 + Vitest 5 scaffold with a placeholder page.
- Cloudflare Workers build via `@opennextjs/cloudflare` (`wrangler.jsonc`, `open-next.config.ts`).
- Migrations: profiles, product_lines, pipeline_stages, contacts, opportunities, tasks,
  activities, automation_rules, audit_log; RLS and grants; seeded pipelines and default rules.
- `src/lib/pipelines.ts` canonical pipeline definitions.
- 19 unit tests and 91 database tests (constraints, RLS, audit, reference data).
- GitHub Actions CI; `scripts/local-db.sh`; `docs/data-model.md`; Supabase CLI config.
- Referral and Google review request support (owner request): referred-by link, review-left
  date, review link on profile, task category and start date, rule completion window and
  cooldown, two new default rules (12 total), 12 new database tests.
### Decided
- Next.js pinned to 16.3.8 (16.4.0 fails at runtime on the Cloudflare adapter).
- No deletes through the app; dedupe keys unique across all task statuses; tasks require a contact.

## Phase 0 — Governance (2026-10-14, approved)
### Added
- Project control files: CLAUDE.md, ROADMAP.md, PROGRESS.md, DECISIONS.md, README.md,
  SECURITY.md, CHANGELOG.md.
- Placeholder `tests/` and `supabase/migrations/` directories.
- `.gitignore` and `.env.example` (placeholder names only).
### Decided
- Separate repository and Supabase project from ProducerIQ; Cloudflare Workers hosting target.
