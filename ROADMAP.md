# Roadmap — The Bass Agency CRM

Status values: `NOT STARTED` · `IN PROGRESS` · `READY FOR REVIEW` · `APPROVED`.
A phase is complete only when every acceptance criterion is met, checks have run, docs are
updated, a review summary is presented, **and the owner has approved**. Every phase also
inherits the standard exit criteria at the bottom of this file.

| # | Phase | Depends on | Status |
|---|-------|-----------|--------|
| 0 | Repository inspection & governance | — | APPROVED (2026-10-14) |
| 1 | Architecture & database foundation | 0 | APPROVED (2026-10-14) |
| 2 | Authentication & security foundation | 1 | APPROVED (2026-10-15) |
| 3 | Contact management | 2 | APPROVED (2026-10-14) |
| 4 | Opportunities & pipelines | 3 | APPROVED (2026-10-15) |
| 5 | Task management & activity history | 4 | APPROVED (2026-10-15) |
| 6 | Automation engine | 5 | APPROVED (2026-10-15) |
| 7 | Dashboard & daily workflow | 6 | APPROVED (2026-10-15) |
| 8 | Renewals & cross selling | 6, 7 | APPROVED (2026-10-15) |
| 9 | Reporting | 8 | APPROVED (2026-10-15) |
| 10 | Mobile experience & PWA | 9 | APPROVED (2026-10-15) |
| 11 | End-to-end testing & security review | 10 | APPROVED (2026-10-16) |
| 12 | Production deployment & handoff | 11 | APPROVED (2026-10-16) — LIVE: owner go-live sign-off 2026-10-16 |
| 13 | Intake form | 12 | APPROVED (2026-10-16) |
| 14 | Intake details (address, vehicles, household) | 13 | APPROVED (2026-10-16) |
| 15 | Import book of business (CSV) + export data | 14 | APPROVED (2026-10-16) |
| 16 | Inactivity sign-out + email/text via device apps | 15 | APPROVED (2026-10-17) |
| 17 | Tags + merge duplicate contacts | 16 | APPROVED (2026-10-17) |
| 18 | Calendar feed for tasks | 17 | APPROVED (2026-10-17) |
| 19 | AI workers (drafts, notes → activity, daily briefing, import clean-up) | 18 | APPROVED (2026-10-17) — built, not connected |

---

## Phase 0 — Repository inspection & governance
**Objective.** Inspect the environment, choose where the project lives, create governance docs.
No application code, no migrations.

**Acceptance criteria**
- [x] Existing repository, tools and Git state inspected; existing work preserved (ProducerIQ untouched).
- [x] CLAUDE.md, ROADMAP.md, PROGRESS.md, DECISIONS.md, README.md, SECURITY.md, CHANGELOG.md created.
- [x] `tests/` and `supabase/migrations/` directories exist (placeholders only).
- [x] Architecture, cost assumptions, deployment candidates and phase gates documented.
- [x] Decisions requiring approval listed.
- [x] Owner approval (2026-10-14).

**Tests.** None applicable (documentation only).

---

## Phase 1 — Architecture & database foundation
**Objective.** Scaffold the app toolchain and create the reviewed database schema, constraints,
initial RLS policies and schema tests. No feature UI.

**Dependencies.** Owner creates the CRM GitHub repo (or authorizes creation) and the new
Supabase project (after confirming cost). Hosting spike needs a free Cloudflare account.

**Scope**
- Next.js (adapter-supported version) + TypeScript strict + Tailwind + ESLint + Vitest scaffold;
  single placeholder page only.
- CI workflow: lint, typecheck, unit tests, schema/RLS tests on a local database.
- **Hosting spike:** build the placeholder with `@opennextjs/cloudflare` and confirm it runs
  locally in workerd (`wrangler dev`) — deploy to `workers.dev` only with owner approval.
- Migrations: `profiles`, `contacts`, `product_lines`, `pipeline_stages`, `opportunities`,
  `tasks`, `activities`, `automation_rules`, `audit_log`, plus enums, indexes, FKs,
  check constraints, `updated_at` triggers, audit triggers, and seed data for the four
  pipelines and default automation rules (rules stored, not yet executed).
- RLS enabled on every table with owner-scoped policies.
- ER diagram + data dictionary in `docs/data-model.md`.

**Acceptance criteria** (status 2026-10-14; ✅ = verified by automated check, ⏳ = pending)
- ✅ Scaffold passes lint, typecheck, build; placeholder runs in workerd (Next pinned 16.3.8, see ADR-004).
- ✅ CI workflow green on GitHub (run #1: checks, PG17 tests, Supabase-image migrations + RLS smoke).
- ✅ Hosting spike (local workerd). Deploy to workers.dev not done — needs a Cloudflare account and approval.
- ✅ All tables, enums, constraints, indexes, triggers, audit and seed data in 4 migrations; `docs/data-model.md`.
- ✅ Referral and Google review data model added at owner request (ADR-013), with tests.
- ✅ Migrations applied to the production CRM Supabase project 2026-10-14 via the deploy workflow (run #2); verified: 30 stages, 4 product lines, 9 tables, RLS on all, no anon grants.

Original criteria:
- Migrations apply cleanly to an empty local database, and re-running the suite from scratch is reproducible.
- Constraints proven by tests: opportunity stage must belong to its product line; outcome/stage
  consistency; contact type rules (individual needs a name, business needs a business name);
  required `owner_id`; FK delete rules (no cascading loss of activity history); unique open
  automation task per `dedupe_key`.
- One contact can hold multiple opportunities across different product lines (test).
- RLS: every public table has RLS enabled (catalog test fails if any table lacks it);
  `anon` cannot read/write; user A cannot read/update/delete user B's rows (SQL-level tests).
- Seeded stages exactly match the spec's four pipelines and order.
- No sensitive-data columns (SSN, DOB-with-health, payment) exist.
- Placeholder app passes lint, typecheck, build, and runs under the Workers adapter locally.

**Tests.** Unit (Vitest), SQL schema/RLS tests (pgTAP or SQL assertions run in CI), build.

---

## Phase 2 — Authentication & security foundation
**Objective.** Secure login/logout, session handling, protected routes and server-side authorization.

**Scope.** Supabase Auth email + password (signups disabled; owner account created by invite);
`@supabase/ssr` cookie sessions with refresh via middleware; protected `(app)` route group;
profile auto-creation; app shell with the seven nav items as empty placeholders;
security headers (CSP, frame-ancestors, referrer policy); password reset flow via Supabase's
built-in auth email (Supabase-sent, not an app email feature).

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action):
- ✅ Signed-out page requests redirect to login (query string kept); server actions return 401 — unit, workerd, CI HTTP tests.
- ✅ Public sign-up refused — CI against Supabase Auth with the project's config. ⏳ Hosted dashboard setting (owner).
- ✅ Logout clears the session; refresh token unusable afterwards — CI API + browser tests.
- ✅ Expired session refreshes automatically with a new HttpOnly cookie — CI HTTP test.
- ✅ Anonymous and cross-account access denied through the real Data API — CI API tests (9).
- ✅ **Mandatory two-step login** (owner decision): aal1 sessions get no data — DB tests, CI API tests, mutation-checked.
- ✅ No secret or Supabase config in browser code — bundle scan (CI uses real key values).
- ✅ Security headers and per-request CSP nonce; no CSP violations in Chromium — unit, workerd, CI.
- ✅ Profiles + default rules created for new users — DB + CI API tests.
- ✅ Full browser journey on an iPhone-sized screen — CI Playwright.
- ✅ Phase 2 migration applied to production 2026-10-14 (deploy run #6; dry run #5 listed only this migration). ⏳ Dashboard settings + owner user — owner.
- ✅ Owner approved Phase 2 (2026-10-15).

**Acceptance criteria**
- Unauthenticated requests to any protected page redirect to login; protected server actions/route handlers return 401.
- Public signup is disabled; only invited users can sign in.
- Logout clears session cookies; back-button does not reveal protected data.
- Session refresh works across expiry (test with short-lived token in local stack).
- Integration tests prove anon and cross-user access are denied through the real Supabase API (not only SQL).
- No secret key appears in any client bundle (automated bundle scan in CI).
- Security headers present (test).
- Owner security review sign-off recorded before Phase 3.

---

## Phase 3 — Contact management
**Objective.** Individual and business contacts: create, edit, view, search, filter, sort, archive.

**Acceptance criteria**
- Quick-add form (minimal required fields) and full form; server-side zod validation with field errors.
- Detail page shows contact info and placeholder sections for opportunities, activities, tasks.
- Search by name, business name, phone, email; filters (type, status, lead source, archived); sort.
- Archive/unarchive (no hard delete from the UI); archived contacts hidden by default.
- "Referred by" picker (own contacts only) and "Google review left on" date (ADR-013).
- Possible-duplicate warning on matching email/phone (warning, not a block).
- Audit log rows written for create/update/archive.
- Tests: validation (valid/invalid), create/edit, search/filter, archive, ownership, IDOR attempt by URL id.
- Loading, empty, error and success states present; usable at 375px width.

**Status 2026-10-14** (✅ verified by automated check; ⏳ owner action):
- ✅ Quick add (essentials first, "More details" collapsed) and full edit form; zod validation on the server mirrors the DB constraints, with field errors — unit + browser tests.
- ✅ Detail page with contact info, referrals, and placeholder sections for opportunities, tasks and activity (Phases 4–5).
- ✅ Search by name (either order), business, email or phone digits; filters for type, status, lead source, archived; sort by name/newest/recently updated; pagination — DB tests (24) + browser test.
- ✅ Archive and restore; archived contacts hidden by default; nothing is deleted — DB + browser tests.
- ✅ Referred-by picker (own contacts only, never itself) and Google review date (not in the future) — DB tests (same-owner FK, not itself), unit tests (review date), browser test (referred by).
- ✅ Possible-duplicate warning on matching email or 10-digit phone, with "Save anyway" — DB + browser tests.
- ✅ Audit log rows for create, update and archive with the acting user — DB + API tests.
- ✅ Ownership and IDOR: another account sees no results and "Contact not found" when visiting the contact's URL — DB, API and browser tests; search function mutation-checked (SECURITY DEFINER → 7 failures).
- ✅ Loading, empty, error and success states; browser journey on an iPhone 13-sized screen (390px) — CI Playwright.
- ✅ Owner approved Phase 3 (2026-10-14); merged to `main`.
- ⏳ Owner: deploy migration `20261016120000_contact_search.sql`, redeploy preview, click through on iPhone.

---

## Phase 4 — Opportunities & pipelines
**Objective.** Four product pipelines, multiple opportunities per contact, stages, outcomes, quote info.

**Acceptance criteria**
- Create opportunity from contact page; one contact can hold several opportunities across lines.
- Pipeline board per product line and a searchable/filterable table.
- Stage changes only to stages of the same product line (server + DB enforced).
- Outcome distinct from stage: won/lost/nurture; lost requires a loss reason; closed records retained.
- Quote fields (quote date, estimated premium, quoted carrier optional), effective date, renewal date.
- Life: "Application Process"/"Decision Pending" never counted as Placed; Placed = won.
- Reopen an opportunity without deleting history.
- Board usable on mobile (list fallback / horizontal scroll with accessible controls).
- Tests for stage validation, outcome rules, reopen, multiple-per-contact, audit entries.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action):
- ✅ Add from the contact page; several opportunities per contact across lines — DB + browser tests.
- ✅ Board per product line and a searchable, filterable table — DB tests (search), browser test.
- ✅ Stage stays within the product line: composite FK + product line locked by trigger + server check — DB, API, unit tests.
- ✅ Outcome separate from stage; Lost requires a reason; closed records kept — DB, unit, browser tests.
- ✅ Quote date, estimated premium, quoted carrier, effective and renewal dates (renewal after effective) — unit + browser tests.
- ✅ Life: Application Process / Decision Pending can never be won; Placed = won — DB test.
- ✅ Reopen keeps history: new cycle, loss reason cleared, old value in audit log — DB, API, browser tests.
- ✅ Board on mobile: stages stacked, labelled "Move to…" control, no sideways scrolling — browser test (iPhone 13 size).
- ✅ Ownership: other accounts see nothing and cannot open by URL — DB (mutation-checked), API, browser tests.
- ✅ Owner approved Phase 4 (2026-10-15); merged to `main`.
- ⏳ Owner: deploy migration `20261017120000_opportunity_lifecycle.sql`, redeploy preview, try on iPhone.

---

## Phase 5 — Task management & activity history
**Objective.** Manual tasks and activity logging.

**Acceptance criteria**
- Create/edit/complete/reopen tasks; priority; optional opportunity link; completion timestamp.
- Views: overdue, due today, upcoming, completed; filters by product line, priority and category.
- Tasks with a future `start_date` are hidden from today's work until that date, then shown
  with their due date (e.g. review/referral requests: visible day after win, due 30 days later).
- Review/referral tasks show the rendered message, a Copy button, and a "Text it" button that
  opens the device's Messages app (`sms:` link). The app itself sends nothing.
- "Today" computed in America/New_York (boundary tests at 23:59/00:00 ET and DST changes).
- Log activities (call, meeting, note, email-logged, text-logged, follow-up outcome) with date and outcome.
- Completed tasks and activities remain visible on the contact timeline.
- Tests: task lifecycle, date boundaries, activity preservation, ownership.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action):
- ✅ Create, edit, complete, reopen (and cancel) tasks; priority; optional opportunity; completion time — DB, API, browser tests.
- ✅ Overdue / Today / Upcoming / Completed with counts; filters by product line, priority, type — DB tests, browser test.
- ✅ Future start date keeps a task off Today until that date, then shows it with its due date — DB + unit tests (midnight New York), browser test.
- ✅ Review/referral tasks show the filled-in message, Copy, and "Text it" (`sms:` link, nothing sent) — unit + browser tests. Name and Google review link set in Settings.
- ✅ Today in America/New_York: 11:59 PM / 12:00 AM and both daylight-saving change days — unit tests.
- ✅ Log activities (call, meeting, note, logged email/text, follow-up, …) with time, outcome, follow-up date, notes — unit + browser tests.
- ✅ Completed tasks and activities stay on the contact's history; nothing can be deleted — DB + browser tests.
- ✅ Ownership: other accounts see and change nothing; task URL shows "not found" — DB (mutation-checked), API, browser tests.
- ✅ Owner approved and merged Phase 5 (2026-10-15).
- ⏳ Owner: deploy migration `20261018120000_task_views.sql`, redeploy preview, set name and review link in Settings, try on iPhone.

---

## Phase 6 — Automation engine
**Objective.** Configurable rule-driven follow-up tasks.

**Acceptance criteria (each covered by tests)**
- New lead → initial contact task due today.
- Contact completed without quote → follow-up in 2 business days.
- Quote sent → follow-up in 3 calendar days.
- Prospect-requested date → task on that date.
- No response after follow-up → another task 5 days later (owner confirms when appropriate).
- Won → open **prospecting-category** tasks closed (status `cancelled`), onboarding checklist created where configured; onboarding, renewal, review and referral tasks untouched.
- Won → one review-request task and one referral-request task **per contact**, starting the day after the win, due 30 days later; skipped if one was created for that contact in the last 365 days; review request skipped if a Google review is already recorded (ADR-013).
- Lost → prospecting tasks closed; loss reason required.
- Known renewal date → renewal review task 60 days prior.
- Reopen → new sequence; history kept.
- Retried/repeated events never duplicate tasks; changing a date updates the existing task.
- Owner can override dates and disable rules in Settings; overridden dates are not clobbered.
- No prospecting reminders after win/loss unless manually created.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action). Every line below has a
database test in `tests/db/automation.test.ts`; API and browser tests cover the main flow.
- ✅ New lead → "Make initial contact" due today (when the opportunity starts at its first stage).
- ✅ First contact done without a quote → follow-up in 2 business days (Mon–Fri).
- ✅ Quote sent → follow-up 3 days later; a corrected quote date moves the same task.
- ✅ Prospect-requested date → task on that date.
- ✅ No response → asks first by default ("Add follow-up task"), then a task 5 days later; can be set to automatic.
- ✅ Won → open prospecting tasks cancelled (manual ones too); onboarding checklist; renewal/other tasks untouched.
- ✅ Won → one review and one referral request per contact, start next day, due 30 days later; not repeated within 365 days; no review request once a review is recorded.
- ✅ Lost → prospecting tasks closed; loss reason still required.
- ✅ Renewal date → review 60 days before (today if closer); date change moves the task; a new year adds a new one.
- ✅ Reopen → new "Re-engage" task in a new cycle; history kept.
- ✅ Repeated events never duplicate; owner-changed dates are never overwritten.
- ✅ Settings: turn rules off; edit timing/title/priority/windows/checklist/messages (incentives refused).
- ✅ No prospecting tasks for won/lost opportunities (quote date or requested follow-up afterwards creates nothing).
- ✅ Owner approved Phase 6 (2026-10-15); merged to `main`.
- ⏳ Owner: deploy migration `20261019120000_automation_engine.sql`, redeploy preview, try on iPhone.

---

## Phase 7 — Dashboard & daily workflow
**Acceptance criteria.** Dashboard shows overdue, due today, open opportunities by line,
recent activity, upcoming renewals, quick actions (add contact, log activity, add task);
counts validated by tests against fixture data; fast on mobile.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action).
- ✅ Overdue, due today and next-7-days counts, plus the first 5 overdue / 10 due-today tasks
  with "Mark complete" in place (`tests/db/dashboard.test.ts`, browser journey).
- ✅ Open opportunities by product line with nurture count and estimated annual premium.
- ✅ Recent activity (8 newest) with contact names.
- ✅ Upcoming renewals: count in the next 60 days (lost excluded) and the 5 soonest.
- ✅ Quick actions: Add contact, Log activity (with contact picker), Add task.
- ✅ Counts validated against fixture data; another agent's data never counted; empty for
  password-only sessions, refused to anonymous callers (DB + API tests).
- ✅ Mobile: one database call for the summary plus two task lists; no sideways scroll at
  iPhone 13 width (browser test).
- ⏳ Owner: open the dashboard on the iPhone after the preview deploy.

---

## Phase 8 — Renewals & cross selling
**Acceptance criteria.** Renewals view (next 30/60/90 days) with retention workflow
(review task → outcome: renewed/re-marketed/lost). Cross-sell rules are configurable data
(e.g. auto-only client → review home/life) evaluated only from recorded opportunities/policies;
shown as "review" prompts with the reason, dismissible; tests per rule.

**Owner decisions (2026-10-15):** renewed → date rolls forward by the term (auto 6 or 12
months); re-marketed = kept with changed terms; lost → reason, policy ends, contact becomes a
former client if no other active policy; dismissed prompts hidden 12 months (ADR-023).

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action).
- ✅ Renewals view: next 30 / 60 / 90 days and by line; past-due policies always shown; ended
  and lost excluded — `tests/db/renewals.test.ts`, browser journey.
- ✅ Retention workflow: review task → outcome renewed / re-marketed / lost in one transaction
  (review task completed, date rolled by term with the next review, or policy ended + former
  client) — DB tests per outcome, API test, browser journey.
- ✅ 6-month auto terms get both reviews in a year; outcomes are append-only (no edit/delete).
- ✅ Cross-sell rules are data (4 defaults, editable, add your own) evaluated only from
  recorded opportunities; each default rule has its own test; open/nurture or recently lost
  lines not suggested — `tests/db/cross-sell.test.ts`.
- ✅ Prompts show the reason, "Start … opportunity", and "Not now" (hidden 12 months, then
  back) on Renewals, the renewal page and the contact page.
- ✅ New tables have RLS, two-step policies, owner-only grants (no delete); functions are
  SECURITY INVOKER and refused to anonymous callers — DB + API tests, deploy verification.
- ⏳ Owner: deploy the migration and preview, then try a renewal and a cross-sell prompt on the iPhone.

---

## Phase 9 — Reporting
**Acceptance criteria.** Reports: open opportunities by product/stage; new leads by source;
quotes sent and outcomes; conversion rate = won ÷ (won + lost) for closed opportunities
in the period (open excluded; denominator shown); tasks completed vs overdue; upcoming
renewal reviews; cross-sell opportunities; referral sources (contacts who referred others,
and referred leads' outcomes); review and referral requests made vs reviews recorded /
referrals received. Every metric has a written definition on the page
and a fixture-based test. Premiums shown only where recorded; no commission figures.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action). Definitions: ADR-024.
- ✅ Open opportunities by product/stage; new leads by source; quotes sent and outcomes;
  conversion = won ÷ (won + lost) closed in the period, open excluded, denominator shown;
  tasks completed (on time / late) vs overdue; upcoming renewal reviews; cross-sell
  opportunities; referral sources with referred leads' outcomes; review/referral requests vs
  reviews recorded / referrals received — one fixture test each in `tests/db/reports.test.ts`
  (time-zone boundaries included).
- ✅ Every report has its written definition on the page (unit + browser test).
- ✅ Premiums only where recorded (with "n of m have a premium"); no commission data exists.
- ✅ Owner-only: another agent, password-only sessions and anonymous callers get nothing
  (DB + API tests).
- ⏳ Owner: deploy, then open Reports on the iPhone and check the figures look right.

---

## Phase 10 — Mobile experience & PWA
**Acceptance criteria.** Web app manifest and icons; installable on iPhone home screen;
service worker caches only static assets and an offline notice page — **never** API
responses or client records; responsive audit at 375/390/430px; touch targets ≥44px;
Lighthouse accessibility ≥ 90 on key pages.

**Status 2026-10-15** (✅ verified by automated check; ⏳ owner action). Design: ADR-025.
- ✅ Web app manifest and icons (192, 512, maskable 512, Apple 180); iPhone home-screen tags —
  browser test `tests/e2e/pwa.spec.ts`.
- ⏳ Installable on the iPhone home screen — Safari Share → Add to Home Screen; needs the owner.
- ✅ Service worker caches only hashed static files, icons and the offline notice; never pages,
  server actions, page data or other origins — unit tests run `public/sw.js` (6 mutations
  caught); browser test lists the real cache and shows the offline notice when offline.
- ✅ Responsive audit at 375 / 390 / 430 px: 15 signed-in pages + 3 signed-out, no sideways
  scrolling — `tests/e2e/responsive.spec.ts`.
- ✅ Touch targets ≥ 44 × 44 px on the same pages (links inside sentences exempt).
- ✅ Lighthouse accessibility ≥ 90 on 16 key pages, signed in — every page scored 100
  (`tests/e2e/lighthouse.spec.ts`, CI run #87).

---

## Phase 11 — End-to-end testing & security review
**Acceptance criteria.** Playwright journeys (login → add contact → opportunity → quote →
automated task → win → renewal); RLS regression suite; date-handling suite; error handling;
dependency audit (`npm audit`), secret scan; backup restoration rehearsed into a local
database; findings fixed or documented with risk rating.

**Status 2026-10-16** (✅ verified by automated check; ⏳ owner action). Findings:
`docs/security-review.md`.
- ✅ Playwright journey: real sign-in (password + authenticator code) → add contact →
  opportunity → automatic first-contact task → follow-up → quote → quote follow-up → win
  (onboarding, review, referral, renewal tasks) → renewal recorded → reports → sign out
  (`tests/e2e/journey.spec.ts`).
- ✅ RLS regression suite driven by the catalog, so new tables and functions are covered
  automatically (`tests/db/rls-regression.test.ts`; 5 injected holes caught).
- ✅ Date-handling suite: app and database agree on New York "today" across midnight, DST and
  New Year, day/month arithmetic, business days, renewal roll-forward; found and fixed one
  time-zone bug (F-01) with a regression test.
- ✅ Error handling: app-wide 404 and last-resort error page; outages no longer reported as
  a wrong password; someone else's record looks exactly like a missing one
  (`tests/e2e/errors.spec.ts`, unit tests).
- ✅ Dependency audit: production dependencies 0 findings (CI gate); `glob` fixed; dev-only
  `braces` accepted as Low (no fix published).
- ✅ Secret scan of every tracked file and the full Git history, in CI on every push; clean.
- ✅ Backup restoration rehearsed into a fresh local database on every CI run: every row,
  policy, function, trigger and grant restored; access rules and automation still work
  (`tests/db/backup-restore.test.ts`).
- ✅ Findings fixed or documented with a risk rating (11 findings: 6 fixed, 5 accepted/info).
- ⏳ Owner: read `docs/security-review.md`; Phase 12 covers the production backup restore and
  Supabase settings check.

---

## Phase 12 — Production deployment & handoff
**Acceptance criteria.** Hosting compatibility and commercial terms re-verified; production
secrets configured in Cloudflare (never in Git); deployed; smoke tests pass on production;
Supabase backups confirmed and a restoration procedure tested; maintenance runbook written;
owner sign-off required before entering real client data.

**Owner decisions (2026-10-16):** keep the free workers.dev address; Workers Free plan;
signed-out automated smoke test + owner's iPhone check; restore drill now (fictional data).

**Status 2026-10-16** (✅ verified by automated check; ⏳ owner action). Design: ADR-026.
- ✅ Hosting and terms re-verified: Workers Free limits (100,000 requests/day, 10 ms CPU) and
  Supabase Pro ($25/org, $10 compute credit, daily backups 7 days); app builds and runs on
  the Cloudflare runtime in CI on every push; added cost ≈ $10/month.
- ✅ No secrets in Git or in the Worker (vars only: database address, publishable key, site
  address); secret scan of full history in CI. ⏳ Owner keeps GitHub secrets current (runbook §6).
- ⏳ Deployed: run **Deploy app (Cloudflare)** from `main` after this phase merges.
- ✅ Smoke test script (16 signed-out checks) passes against the Cloudflare build in CI and a
  local production build; runs after every deploy and on demand. ⏳ Passes on production.
- ⏳ Supabase backups confirmed in the dashboard; ✅ restoration procedure written (runbook §4)
  and the **Backup restore drill** rehearsed locally end to end; ⏳ drill run on production.
- ✅ Maintenance runbook: `docs/runbook.md`.
- ⏳ Owner sign-off before real client data: `docs/go-live-checklist.md`.

---

## Phase 13 — Intake form
**Objective.** A way to pull prospects' details straight into the CRM: a public quote-request
link (with QR code) whose submissions wait in a review inbox, and a quick intake for the agent.

**Owner decisions (2026-10-16):** both public link and quick intake; review inbox first;
fields: contact details, lines wanted, current carrier + renewal month, referral source.

**Acceptance criteria** (design: ADR-028)
- Public form opens signed out on an iPhone, validates, and a submission appears in the
  agent's inbox; nothing else is possible anonymously (one function, reads nothing).
- Accept creates (or adds to) the contact, a New lead per line, the referral link and a quote
  task before each known renewal; duplicates are offered; Discard erases the details.
- A turned-off or replaced link is refused; rate limit, field validation and bot trap work.
- Quick intake creates the same records directly, with the duplicate check.
- Deploy verification, RLS catalog tests and backups cover the two new tables.
- All existing tests stay green; docs updated.

**Status 2026-10-16:** built and APPROVED by the owner; see PROGRESS.md for test results. ⏳ Deploy.

---

## Phase 14 — Intake details
**Objective.** The intake form and quick intake also collect the street address, vehicles
(year, make, model) and other drivers / household members (names, relationship); the contact
page shows and edits them. No dates of birth, license numbers or VINs (ADR-029).

**Acceptance criteria**
- A prospect sends address, vehicles and household from the iPhone form; accept and quick
  intake put them on the contact; they can be edited and removed on the contact page.
- Owner-only, two-step, audited, archived not deleted; another agent cannot see them.
- Bad input refused (year 1850, more than 4 vehicles / 6 people, over-long names); unknown keys
  such as a birth date are dropped; details erased from the inbox after review.
- Backups and deploy verification include the new tables; all tests green.

**Status 2026-10-16:** built and APPROVED by the owner; see PROGRESS.md. ⏳ Deploy.

---

## Phase 15 — Import and export
**Objective.** Bring the client list in from an Alfa report (CSV) and let the owner download
all data (ADR-031).

**Acceptance criteria**
- A 500-client report imports in one step on the iPhone with guessed column matches; unknown
  policy types must be chosen; bad rows explained and left out; existing contacts matched.
- Imported clients appear in Contacts, Renewals and cross-sell; not counted as new leads/wins.
- Undo within 7 days removes everything, or nothing if anything was changed.
- Downloads open in Excel/Numbers; formulas neutralised; owner's rows only.
- All tests green.

**Status 2026-10-16:** built and APPROVED by the owner; see PROGRESS.md. ⏳ Deploy.

---

## Phase 16 — Inactivity sign-out and text/email via the phone's apps
**Objective.** End sessions unused for 7 days, ask for the authenticator code again every 12
hours, and let the owner text or email clients from the CRM through the phone's own Messages and
Mail apps with ready-made messages (ADR-030, ADR-032).

**Acceptance criteria**
- A session not used for 7 days is signed out (and revoked) with a clear message; normal use
  keeps it going; after 12 hours the code is asked for again.
- Contact, opportunity, renewal, task and intake pages offer Text / Email / Call with an
  editable ready-made message; nothing is sent or stored by the CRM; the text can be logged as an
  activity in one step.
- No database change. All tests green; phone widths and Lighthouse clean.

**Status 2026-10-17:** built, APPROVED and deployed (smoke test 17/17); see PROGRESS.md.

---

## Phase 17 — Tags and merging duplicate contacts
**Objective.** Label contacts with tags and filter by them; merge duplicate contacts without
losing anything (ADR-033).

**Acceptance criteria**
- Tags can be added on the contact form, shown on the contact and list, filtered by, renamed and
  removed in Settings; bad tags are refused by the server and the database.
- Merge moves every linked record in one transaction, fills blanks, archives the duplicate with
  a link; the preview shows the result first; only the owner's contacts; nothing deleted.
- An import cannot be undone after one of its contacts was merged.
- All tests green; phone widths and Lighthouse clean.

**Status 2026-10-17:** built, APPROVED and deployed (migration applied, smoke test 17/17); see PROGRESS.md.

---

## Phase 18 — Calendar feed for tasks
**Objective.** Open tasks appear in the owner's phone calendar through a private subscription
link (ADR-034). Owner decisions: "task — client name"; open tasks only.

**Acceptance criteria**
- Settings creates, replaces and turns off the link; iPhone (webcal) and Google (URL) work.
- The feed lists only the owner's open tasks as all-day events; done tasks drop off; unknown,
  replaced or turned-off links get 404; the token is stored only as a hash.
- All tests green; deploy verification knows exactly two anonymous functions.

**Status 2026-10-17:** built, APPROVED and deployed (migration applied, smoke test 18/18); see PROGRESS.md.

---

## Phase 19 — AI helpers (built, not connected)
**Objective.** Four AI helpers that only suggest — draft messages, notes → activity, a daily
briefing, import clean-up — under a $10/month cap, sending the minimum data (ADR-035). Owner
decision: build now, hold off on connecting.

**Acceptance criteria**
- With no API key everything AI is hidden and nothing calls Anthropic; Settings explains how to
  connect.
- Each helper returns a suggestion the user reviews; no helper writes CRM records.
- The cap is checked before every call; usage (numbers only) is recorded; refusals and errors
  are handled; sensitive typed text is refused; only the listed fields are sent.
- All tests green; the key cannot reach the browser bundle.

**Status 2026-10-17:** built, APPROVED and deployed (migration applied, smoke test 18/18); not connected by owner decision; see PROGRESS.md.
Connecting is a later owner step (runbook §4d).

---

## Standard exit criteria (every phase)
1. Lint, typecheck and all existing tests pass (or failures documented with cause).
2. New logic has tests; fixtures fictional.
3. Security implications reviewed and noted in SECURITY.md where relevant.
4. ROADMAP.md, PROGRESS.md, CHANGELOG.md updated.
5. Phase Report presented; owner approval recorded here before the next phase begins.
