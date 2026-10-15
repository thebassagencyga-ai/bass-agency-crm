# Changelog

All meaningful changes, grouped by milestone.

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
