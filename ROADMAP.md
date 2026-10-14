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
| 3 | Contact management | 2 | NOT STARTED |
| 4 | Opportunities & pipelines | 3 | NOT STARTED |
| 5 | Task management & activity history | 4 | NOT STARTED |
| 6 | Automation engine | 5 | NOT STARTED |
| 7 | Dashboard & daily workflow | 6 | NOT STARTED |
| 8 | Renewals & cross selling | 6, 7 | NOT STARTED |
| 9 | Reporting | 8 | NOT STARTED |
| 10 | Mobile experience & PWA | 9 | NOT STARTED |
| 11 | End-to-end testing & security review | 10 | NOT STARTED |
| 12 | Production deployment & handoff | 11 | NOT STARTED |

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
- ⏳ Phase 2 migration applied to production + dashboard settings — owner, after approval.
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

---

## Phase 7 — Dashboard & daily workflow
**Acceptance criteria.** Dashboard shows overdue, due today, open opportunities by line,
recent activity, upcoming renewals, quick actions (add contact, log activity, add task);
counts validated by tests against fixture data; fast on mobile.

---

## Phase 8 — Renewals & cross selling
**Acceptance criteria.** Renewals view (next 30/60/90 days) with retention workflow
(review task → outcome: renewed/re-marketed/lost). Cross-sell rules are configurable data
(e.g. auto-only client → review home/life) evaluated only from recorded opportunities/policies;
shown as "review" prompts with the reason, dismissible; tests per rule.

---

## Phase 9 — Reporting
**Acceptance criteria.** Reports: open opportunities by product/stage; new leads by source;
quotes sent and outcomes; conversion rate = won ÷ (won + lost) for closed opportunities
in the period (open excluded; denominator shown); tasks completed vs overdue; upcoming
renewal reviews; cross-sell opportunities; referral sources (contacts who referred others,
and referred leads' outcomes); review and referral requests made vs reviews recorded /
referrals received. Every metric has a written definition on the page
and a fixture-based test. Premiums shown only where recorded; no commission figures.

---

## Phase 10 — Mobile experience & PWA
**Acceptance criteria.** Web app manifest and icons; installable on iPhone home screen;
service worker caches only static assets and an offline notice page — **never** API
responses or client records; responsive audit at 375/390/430px; touch targets ≥44px;
Lighthouse accessibility ≥ 90 on key pages.

---

## Phase 11 — End-to-end testing & security review
**Acceptance criteria.** Playwright journeys (login → add contact → opportunity → quote →
automated task → win → renewal); RLS regression suite; date-handling suite; error handling;
dependency audit (`npm audit`), secret scan; backup restoration rehearsed into a local
database; findings fixed or documented with risk rating.

---

## Phase 12 — Production deployment & handoff
**Acceptance criteria.** Hosting compatibility and commercial terms re-verified; production
secrets configured in Cloudflare (never in Git); deployed; smoke tests pass on production;
Supabase backups confirmed and a restoration procedure tested; maintenance runbook written;
owner sign-off required before entering real client data.

---

## Standard exit criteria (every phase)
1. Lint, typecheck and all existing tests pass (or failures documented with cause).
2. New logic has tests; fixtures fictional.
3. Security implications reviewed and noted in SECURITY.md where relevant.
4. ROADMAP.md, PROGRESS.md, CHANGELOG.md updated.
5. Phase Report presented; owner approval recorded here before the next phase begins.
