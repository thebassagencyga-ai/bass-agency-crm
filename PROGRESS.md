# Progress

**Current phase:** 12 — Production deployment & handoff — **APPROVED by owner 2026-10-16**; go-live (real client data) waits for the owner's signed checklist (`docs/go-live-checklist.md`)
**Last updated:** 2026-10-16
**Branch:** `phase-12-production`, merged to `main` on approval

## Phase 0 — APPROVED 2026-10-14
Governance files created. ProducerIQ untouched (owner reconfirmed: it must not be modified).

## Phase 1 — completed items
- App scaffold: Next.js 16.3.8, React 19.3, TypeScript 5.9 strict, Tailwind 4, ESLint 9,
  Vitest 5. Placeholder page only.
- Cloudflare spike: OpenNext build runs in workerd locally; 821 KiB gzip bundle.
  Next 16.4.0 found incompatible at runtime → pinned 16.3.8 (ADR-004).
- 4 migrations: core schema, audit log, RLS/grants, reference data + default rules.
- Test harness: disposable local Postgres (`scripts/local-db.sh`), Supabase auth/role shim,
  Vitest database project.
- CI workflow: checks, PG17 database tests, migrations on Supabase's real image + RLS smoke.
- Docs: data model, ADRs 003–012, README, SECURITY, CHANGELOG.

## Tests run (2026-10-14, local)
| Command | Result |
|---|---|
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npm test` (unit) | 19 passed |
| `npm run test:db` (PostgreSQL 16.15) | 103 passed (91 + 12 referral/review) |
| `npm run build` | pass |
| `npx opennextjs-cloudflare build` + `wrangler dev` | pass: `/` 200, unknown route 404, no runtime errors |
| `wrangler deploy --dry-run` | 3947 KiB raw / 821 KiB gzip |
| RLS mutation check (4 deliberate breaks) + referrer-FK removal | all 5 detected by tests |
| `tests/db/supabase-smoke.sql` on local shim DB | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

## CI (GitHub Actions run #4, commit 4277277, 2026-10-14, includes ADR-013 schema) — all 3 jobs passed
| Job | Result |
|---|---|
| Lint, typecheck, unit tests, builds (incl. OpenNext build + dry-run) | pass |
| Schema and RLS tests on PostgreSQL 17.11 | pass |
| Migrations on Supabase's real Postgres image (`supabase db start`), `supabase db lint`, RLS smoke test with the real `auth.uid()` | pass |

These two could not run locally (sandbox network blocks Docker images; local server is
PostgreSQL 16), so CI is the evidence for them.

## Owner actions needed
1. Review the migrations (`supabase/migrations/`) and `docs/data-model.md`.
2. ~~Answer ADR-010 / ADR-012~~ — answered 2026-10-14 (both accepted as designed).
   New request 2026-10-14: referral and Google review requests — design agreed (ADR-013);
   data model added to Phase 1; automation in Phase 6.
   Owner to confirm with Alfa/compliance whether any referral thank-you of value is allowed.
3. After approval: apply migrations to the CRM project (README → Database migrations), or
   ask Claude to walk through it.
4. ~~Approve Phase 1~~ — approved 2026-10-14; merged to `main`.

## Next action
## Production database (2026-10-14)
Owner added the three repository secrets and ran "Deploy database migrations":
- Run #1 (dry run): guard confirmed an empty project; would push exactly the 4 migrations.
- Run #2 (apply): all 4 applied; verification on production returned
  `{"stages":30,"product_lines":4,"tables_without_rls":0,"anon_grants":0,"crm_tables":9}`.
No users or business data exist yet (profiles and default rules are created at first sign-in, Phase 2).

## Phase 2 — Authentication & security foundation (branch `phase-2-auth`)
Owner decisions: mandatory two-step login (TOTP); sign-in email differs from the Supabase
account email; sign out after 7 days idle.

### Tests run (2026-10-15)
| Where | Command / job | Result |
|---|---|---|
| Local | `npm run lint`, `npm run typecheck` | pass |
| Local | `npm test` (unit) | 83 passed |
| Local | `npm run test:db` (PostgreSQL 16) | 110 passed |
| Local | Cloudflare build + `wrangler dev`: redirects, 401, headers, nonce on all 11 scripts, open-redirect, forged cookie | pass |
| Local | Chromium (iPhone size): no CSP violations or page errors, 44 px button, email kept after a failed attempt | pass |
| Local | Mutation: dropped one aal2 policy | 3 tests failed as expected |
| CI run #17 | checks, PG17 DB tests, Supabase-image migrations + smoke | pass |
| CI run #17 | Integration on real Supabase stack: `test:integration` | 21 passed |
| CI run #17 | Playwright browser journey | 1 passed |

### Issues found and fixed during the phase
- `proxy.ts` is experimental on OpenNext Cloudflare → use `middleware.ts` (ADR-015).
- `[auth.email] enable_signup = false` disables password sign-in entirely → only the global
  sign-up switch is off (dashboard steps updated).
- React 19 form reset wiped the email after a wrong password → actions echo non-secret values.
- Query string dropped on sign-in redirect; `/auth/confirm` used the Host header → fixed.

### Not run / limitations
- Password-reset **email delivery** not tested end to end (needs the hosted mailer and the
  login address in the Supabase organization, or custom SMTP). The link-handling route is
  covered by code review and unit-tested redirect logic only.
- Supabase prints an informational warning about `getSession()` from the MFA level check; the
  app does not use that data for authorization (identity comes from `getClaims()`, and the
  database enforces aal2).
- Nothing deployed: the owner cannot click through the app yet (Phase 12, or an earlier
  preview deploy if approved).

## Next action
Phase 2 approved and merged to `main`. Deploy run #5 (dry run) listed only
`20261015120000_auth_profiles_and_mfa.sql`; run #6 applied it without errors and the base-schema
verification passed. The verify step does not yet check the aal2 policies or the profile trigger
(owner given a read-only SQL check; automated check planned). Owner next: dashboard settings and
creating the owner user (README). Note: deploy runs #3–#4 (2026-10-14, before the merge) applied nothing ("Remote
database is up to date") and re-verified the Phase 1 schema. Phase 3 waits for the owner's go-ahead.

## Preview deployment (owner request 2026-10-15)
Workflow "Deploy app preview (Cloudflare)" added (ADR-017), using the owner's existing
Cloudflare account with a narrow custom token (Workers Scripts edit, Account Settings read, no zone
access). Run #1 failed safely at the secrets check (secret names misspelled "CLOUDFARE"); run #2
(2026-10-14) deployed: **https://bass-agency-crm.thebassagencyga.workers.dev**. Live smoke test
passed (sign-in 200, protected page redirects, security headers). Bundle 1.83 MiB gzip; worker
startup 22 ms. Owner next: Supabase Site URL + redirect URL, then first sign-in and authenticator
setup on iPhone. Fictional data only until Phases 11–12.

## Phase 3 — Contact management (branch `phase-3-contacts`)
Started 2026-10-14 after the owner signed in on the preview ("Signed in, start Phase 3").

**Completed**
- Contacts list (`/contacts`): search, filters, sort, pagination, empty/loading/error states.
- Add (`/contacts/new`), detail (`/contacts/[id]`), edit, archive/restore; duplicate warning;
  referred-by picker; Google review date; referrals list on the referrer's page.
- Migration `20261016120000_contact_search.sql` (three SECURITY INVOKER functions, ADR-018).
- Deploy verification extended: aal2 policies (9), sign-up trigger (1), `public` functions
  (3), none SECURITY DEFINER or executable by `anon`; tied to the migrations by a DB test.

**Tests run (2026-10-14, local, PostgreSQL 16)**
| Command | Result |
|---|---|
| `npm run lint` / `npm run typecheck` | pass |
| unit + database (`vitest --project unit --project db`) | 261 passed (126 unit, 135 DB) |
| Mutation check: `search_contacts` made SECURITY DEFINER | 7 DB tests failed (caught), reverted |
| Cloudflare build | 1889 KiB gzip of the 3 MiB free limit |

**CI**
- Run #25 (commit 44cb978): 2 real failures, both fixed in 939e926:
  `contact_lead_sources` spelling depended on collation (reproduced locally with ICU en-US);
  integration helper re-enrolled an authenticator for a user who already had one.
- Run #26 (commit 939e926): DB, migration and integration jobs green; browser journey failed —
  with "More details" open the address row overflowed the 390px screen (page rendered 511px
  wide), so "Save contact" was covered. Reproduced locally in Chromium (iPhone 13), fixed, and
  the journey now asserts no sideways scrolling.
- Run #27 (docs only) superseded.
- **Run #28 (commit 1c0dcb5): all 4 jobs passed** — lint, typecheck, unit, Next + OpenNext
  builds, bundle scans; DB tests on PostgreSQL 17; migrations + `supabase db lint` + RLS smoke on
  Supabase's image; 26 integration tests (12 app HTTP, 9 auth API, 5 contacts API) and 2 browser
  journeys (sign-in; full contacts journey) on an iPhone 13-sized screen.

**Production deploy (2026-10-14)**
- Run #7 (dry run): would push only `20261016120000_contact_search.sql`.
- Run #8 (apply): migration applied without errors; all earlier checks passed. The new function
  check failed: 4 `public` functions, 1 SECURITY DEFINER/anon. Owner's read-only query showed it
  is Supabase's `rls_auto_enable()` event trigger (automatic RLS setting) — not callable,
  harmless. Fix on branch `phase-3-verify-detail`: verify counts callable functions only, allows
  that one platform trigger function by name, prints every `public` function; tests and
  mutation checks added. Pending owner approval to merge, then re-run apply (nothing to apply)
  to re-verify.

**Owner testing on iPhone (2026-10-14)**
- "Referred by" seemed not to save: with one contact there was nobody to pick, and typed text
  was silently dropped. Fixed: the picker explains itself and refuses unpicked text. Owner
  decided referrers stay contacts-only (ADR-019).
- Found while testing that fix: a business contact flipped to Individual after any form error
  (React 19 form reset). Fixed; the browser journey covers it.
- Date box overflowed in iPhone Safari; fixed (`appearance-none`). Not covered by CI (Chromium
  only) — owner to confirm on the phone.
- CI run #36 (commit 902a2a6): all 4 jobs passed.
- Preview redeployed: deploy-preview run #4 (commit c29f122) — build, bundle scan, deploy and
  live smoke test passed. Owner to confirm the referrer flow and date box on iPhone.

**Owner actions after approval**
1. Merge to `main`.
2. Run "Deploy database migrations" as a dry run — it should list only
   `20261016120000_contact_search.sql` — then apply. The verify step now also checks the new
   items above.
3. Run "Deploy app preview (Cloudflare)", then try contacts on the iPhone (fictional data only).

## Phase 4 — Opportunities & pipelines (branch `phase-4-opportunities`)
Started 2026-10-15 on the owner's go-ahead ("Referred by works now, start Phase 4").

**Completed**
- Migration `20261017120000_opportunity_lifecycle.sql`: `quoted_carrier`; lifecycle trigger
  (product line fixed, `cycle` database-owned, loss reason cleared on reopen);
  `search_opportunities` (SECURITY INVOKER). Deploy verification now expects 4 functions.
- `/opportunities` board (per line) and table; `/opportunities/new` (from a contact);
  `/opportunities/[id]` (move stage, won, lost with reason, reopen, nurture); edit page;
  contact page lists opportunities.
- Found and fixed while testing: React 19 reset forms after a server response, so a chosen
  dropdown value (starting stage, contact status, preferred contact method) silently reverted
  after any validation message. Contact, opportunity and stage forms no longer reset; browser
  tests check choices survive an error.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 158 passed |
| Local: database (PostgreSQL 16) | 157 passed |
| Mutation checks (lifecycle trigger ×3, search made SECURITY DEFINER) | all caught (1, 1, 1, 7 failures), reverted |
| CI run #43 (commit 6e8220e): all 4 jobs | pass — incl. PostgreSQL 17, Supabase image + db lint, 31 API tests, 3 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261017120000_opportunity_lifecycle.sql`;
   then apply (verify expects 4 Data API functions plus Supabase's `rls_auto_enable`).
3. Deploy app preview; try opportunities on the iPhone (fictional data only).

**Production deploy (2026-10-15):** migrations dry run #12 listed only
`20261017120000_opportunity_lifecycle.sql`; apply run #13 applied it and verification passed;
preview run #5 deployed commit 37b7a56. Owner verified on iPhone ("All verified").

## Phase 5 — Task management & activity history (branch `phase-5-tasks-activities`)
Started 2026-10-15 on the owner's go-ahead ("All verified move to phase 5").

**Completed**
- Migration `20261018120000_task_views.sql`: `search_tasks`, `task_counts` (SECURITY INVOKER;
  today passed from the app in the user's zone). Deploy verification now expects 6 functions.
- `/tasks` tabs and filters; `/tasks/new` (from a contact or with a contact picker);
  `/tasks/[id]` with complete / reopen / cancel and, for review/referral tasks, the message
  with Copy and Text it; edit page.
- Contact page: open tasks, "Log activity", and a history of activities and finished tasks.
- Settings: display name and Google review link (used in messages).
- New York date helpers (typed times, daylight saving) with boundary tests.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 187 passed |
| Local: database (PostgreSQL 16) | 172 passed |
| Mutation checks (search_tasks made SECURITY DEFINER; Today including overdue) | caught (4 and 3 failures), reverted |
| CI runs #48–#49 (commits 0298014, dde9a25): all 4 jobs | pass — PostgreSQL 17, Supabase image + db lint, API tests (incl. 6 new), 4 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261018120000_task_views.sql`; then apply
   (verify expects 6 Data API functions plus Supabase's `rls_auto_enable`).
3. Deploy app preview. In Settings, add your name and Google review link. Try tasks and
   activity logging on the iPhone, including "Text it" (fictional contact, your own number).

**Production deploy (2026-10-15):** migrations dry run #14; apply run #15 applied
`20261018120000_task_views.sql` and verification passed; preview run #6 deployed commit
0e854e3. Owner completed the iPhone checks ("All complete").

## Phase 6 — Automation engine (branch `phase-6-automation`)
Started 2026-10-15 on the owner's go-ahead ("start Phase 6").

**Completed**
- Migration `20261019120000_automation_engine.sql`: `crm_engine` schema (invoker-only), event
  triggers on opportunities / tasks / activities, `confirm_no_response_follow_up`. Deploy
  verification now expects 7 Data API functions and checks the engine schema is safe.
- Settings: the 12 rules with plain-English descriptions, on/off and editable details.
- Contact page offers the "no response" follow-up; opportunity page lists its tasks.
- Found and fixed while testing: Settings rule forms shared field ids (labels pointed at the
  wrong field); browser test now fails on duplicate ids.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 206 passed |
| Local: database (PostgreSQL 16) | 198 passed (26 automation) |
| Mutation checks (prospecting guard, cooldown, overridden dates, close only prospecting, recorded review, SECURITY DEFINER in engine) | all 6 caught, reverted |
| CI runs #56–#57 (commits fdcede5, 1086753): all 4 jobs | pass — PostgreSQL 17, Supabase image + db lint, API tests (incl. 4 new), 5 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261019120000_automation_engine.sql`; then
   apply (verify expects 7 Data API functions, the automation engine safe, plus `rls_auto_enable`).
3. Deploy app preview. Note: automation applies from now on; existing opportunities get tasks
   only when something changes (e.g. a quote date or stage).

**Production deploy (2026-10-15):** migrations dry run #16; apply run #17 applied
`20261019120000_automation_engine.sql` and verification passed (engine schema safe); preview
run #7 deployed commit d92a7ee. Owner completed the iPhone checks ("All complete").

## Phase 7 — Dashboard & daily workflow (branch `phase-7-dashboard`)
Started 2026-10-15 on the owner's go-ahead ("Start phase 7").

**Completed**
- Migration `20261020120000_dashboard.sql`: `public.dashboard_summary(p_today)` (SECURITY
  INVOKER, empty search_path; anon and public revoked). Deploy verification now expects 8
  Data API functions.
- `/dashboard`: greeting, quick actions, task count tiles, overdue and due-today lists with
  complete-in-place, open opportunities by line, upcoming renewals, recent activity.
- `/activities/new`: log an activity from anywhere, choosing the contact from a picker.
- Found while testing: a renewal date within 60 days creates its "Renewal review" task due
  today (Phase 6 rule), so the browser journey now expects it alongside the first-contact task.
  The sign-in journey now expects the dashboard greeting instead of the old "Dashboard" heading.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 206 passed |
| Local: database (PostgreSQL 16) | 204 passed (6 dashboard) |
| Mutation checks (SECURITY DEFINER on summary, counting lost renewals) | both caught, reverted |
| CI run #66 (commit ec95a7e): all 4 jobs | pass — PostgreSQL 17, Supabase image + db lint, API tests, 6 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261020120000_dashboard.sql`; then
   apply (verify expects 8 Data API functions).
3. Deploy app preview, then open the dashboard on the iPhone.

**Production deploy (2026-10-15):** migrations dry run #18; apply run #19 applied
`20261020120000_dashboard.sql` and verification passed (8 Data API functions, engine safe, no
anonymous access); preview run #8 deployed commit 43230b2. iPhone dashboard checks: not yet
confirmed by the owner.

## Phase 8 — Renewals & cross selling (branch `phase-8-renewals`)
Started 2026-10-15 on the owner's go-ahead ("Move to 8"). Owner decisions recorded in ADR-023.

**Completed**
- Migration `20261021120000_renewals_cross_sell.sql`: policy term (auto 6/12 months) and end
  date on opportunities; `renewal_outcomes`, `cross_sell_rules` (4 defaults per agent,
  backfilled), `cross_sell_dismissals`; `search_renewals`, `record_renewal_outcome`,
  `cross_sell_prompts`, `dismiss_cross_sell`; renewal review keys per half year for 6-month
  policies; dashboard excludes ended policies. Deploy verification now expects 12 tables and
  12 Data API functions.
- Renewals page (30/60/90 days, by line), renewal page with outcome form, cross-sell prompts,
  renewal history; cross-sell on the contact page; cross-sell rules in Settings; policy term
  on the opportunity form; "Start … opportunity" preselects the suggested line.
- Found while testing: browser tests picked product lines by label text, which the new
  "Not now: Home…" buttons also match; they now select the radio button.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 247 passed (41 new) |
| Local: database (PostgreSQL 16) | 244 passed (15 renewals, 16 cross-sell) |
| Mutation checks (recent-loss exclusion, review task not completed, former client regardless, ended policies listed, SECURITY DEFINER, dismissal boundary, half-year key) | all 7 caught, reverted |
| CI run #75 (commit 2caa58b): all 4 jobs | pass — PostgreSQL 17, Supabase image + db lint, API tests (incl. renewals/cross-sell), 7 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261021120000_renewals_cross_sell.sql`;
   then apply (verify expects 12 tables, 12 Data API functions).
3. Deploy app preview, then on the iPhone: mark a test policy won with a renewal date, record
   an outcome on Renewals, and try "Not now" on a cross-sell prompt.

**Production deploy (2026-10-15):** migrations dry run #20; apply run #21 applied
`20261021120000_renewals_cross_sell.sql` and verification passed (12 tables, 12 Data API
functions, engine safe, no anonymous access); preview run #9 deployed commit a42123a. Owner
reported it working ("Deployed, working").

## Phase 9 — Reporting (branch `phase-9-reporting`)
Started 2026-10-15 on the owner's go-ahead ("move to 9"). Metric definitions in ADR-024.

**Completed**
- Migration `20261022120000_reports.sql`: `report_summary(start, end, today)`; cross-sell
  matching moved to `crm_engine.cross_sell_matches` (shared, no row limit). Deploy
  verification now expects 13 Data API functions.
- Reports page: period picker; nine reports, each with "How it's counted".

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 263 passed (16 new) |
| Local: database (PostgreSQL 16) | 256 passed (12 reports, one per report plus access and input) |
| Mutation checks (UTC dates for leads, on-time boundary, double-counted asks, premium count, dismissals ignored, SECURITY DEFINER; plus one equivalent mutation that could not change results) | 6 caught, reverted |
| CI run #81 (commit 2ccbd08): all 4 jobs | pass — PostgreSQL 17, Supabase image + db lint, API tests (incl. reports), 8 browser journeys |

**Owner actions after approval**
1. Merge to `main`.
2. Deploy database migrations: dry run should list only `20261022120000_reports.sql`; then
   apply (verify expects 12 tables, 13 Data API functions).
3. Deploy app preview, then open Reports on the iPhone.

**Production deploy (2026-10-15):** migrations dry run #22; apply run #23 applied
`20261022120000_reports.sql` and verification passed (12 tables, 13 Data API functions,
engine safe, no anonymous access); preview run #10 deployed commit 8c3df82. Owner reported
it working.

## Phase 10 — Mobile experience & PWA (branch `phase-10-mobile-pwa`)
Started 2026-10-15 on the owner's go-ahead ("move to 10"). Design in ADR-025.

**Completed**
- Manifest, icons (`scripts/generate-icons.mts`), iPhone home-screen tags, theme colour.
- Service worker (`public/sw.js`, production only): static files, icons and the offline
  notice only. CSP adds `worker-src 'self'` and `manifest-src 'self'`; the middleware skips
  `sw.js`, `offline.html` and the manifest; Cloudflare serves `offline.html` at that exact
  path (`html_handling: "none"`).
- 44 px tap targets for list title links, back links, phone/email links and links in detail
  rows and tables; "Done" buttons' accessible names start with "Done" (voice control).
- New dev dependencies (exact versions, ≥ 2 weeks old, no external service): `lighthouse`
  13.5.0, `chrome-launcher` 1.2.2. `npm audit` still reports 9 high findings in existing
  build/lint tooling (`eslint-config-next`, `@opennextjs/*` via `glob`/`braces`), none in
  production dependencies — for the Phase 11 security review.

**Tests (2026-10-15)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build | pass |
| Local: unit | 282 passed (19 service worker) |
| Local: production build + Chromium (signed-out pages) | Lighthouse 100; tap targets and widths OK; service worker caches only static files; offline notice shown |
| Mutation checks on the service worker (pages, POST, RSC data, other origins, error responses, any path cached) | 6 caught (3 needed new test cases, added) |
| CI run #86 | failed: `offline.html` redirected on Cloudflare; "See all" and a "Home" link 43 px wide — fixed |
| CI run #87 (commit da17cd6): all 4 jobs | pass — 12 browser journeys incl. responsive audit, PWA/offline, Lighthouse (all 16 pages 100) |

**Owner actions after approval**
1. Merge to `main`; no database migration this phase.
2. Deploy app preview. On the iPhone in Safari: Share → Add to Home Screen; open "Bass CRM"
   from the home screen (full screen, opens on the dashboard); turn on Airplane Mode and
   open a page to see the offline notice.

**Production deploy (2026-10-15):** no migration this phase; preview run #11 deployed commit
e6049ad. Owner confirmed on the iPhone ("Deployed, done").

## Phase 11 — End-to-end testing & security review (branch `phase-11-e2e-security`)
Started 2026-10-16 on the owner's go-ahead ("move to 11"). Findings: `docs/security-review.md`.

**Completed**
- Browser: full sales journey with real two-step sign-in; error handling (404s, someone
  else's record, bad input).
- Database: catalog-driven RLS regression suite; date-handling suite (app vs database);
  backup → restore rehearsal into a fresh local database.
- Fixes: F-01 cross-sell window time zone (migration `20261023120000_review_fixes.sql`), F-02
  outage vs wrong password, F-03 test cookie switch, F-04 404/error pages, F-05 `glob`.
- CI: secret scan (files + history), production `npm audit` gate, PostgreSQL 17 client tools
  for the restore rehearsal.

**Tests (2026-10-16)**
| Where | Result |
|---|---|
| Local: lint, typecheck | pass |
| Local: unit | 298 passed |
| Local: database (PostgreSQL 16) | 316 passed (11 RLS regression, 45 date handling, 4 backup/restore) |
| Local: secret scan | clean (247 files, 86 commits); 5 planted problems all caught |
| Mutation checks | RLS regression: 5 injected holes caught; backup: restore without grants caught; date: F-01 test fails without the fix |
| CI runs #91–#97 | failed: the cross-sell time-zone bug (F-01) surfaced when CI ran after midnight UTC; record 404 status (F-11, streamed pages) — both resolved |
| CI run #98 (commit ffcb42d): all 4 jobs | pass — secret scan, audit gate, PostgreSQL 17 incl. restore rehearsal, Supabase image + lint, API tests, 15 browser tests (journey, errors, Lighthouse all 100) |

**Owner actions after approval**
1. Read `docs/security-review.md`.
2. Merge to `main`; deploy database migrations (dry run lists only
   `20261023120000_review_fixes.sql`; verify expects 12 tables, 13 Data API functions);
   deploy app preview.

**Production deploy (2026-10-16):** migrations dry run #27; apply run #28 applied
`20261023120000_review_fixes.sql` and verification passed (12 tables, 13 Data API functions,
engine safe, no anonymous access); preview run #12 deployed commit 9a4296e.

## Phase 12 — Production deployment & handoff (branch `phase-12-production`)
Started 2026-10-16 on the owner's go-ahead ("start 12"). Owner decisions: keep workers.dev,
Workers Free, signed-out smoke test + iPhone check, restore drill now (ADR-026).

**Completed**
- Hosting and commercial terms re-checked (ADR-026); cost unchanged (≈ $10/month added).
- `scripts/smoke-test.sh` — 16 signed-out, read-only checks; in the deploy workflow, in CI
  against the Cloudflare build, and as **Smoke test production**.
- **Backup restore drill** workflow + `scripts/restore-drill.mts` + row-count checks in
  `src/lib/deploy-checks.ts`; `supabase-remote.mts counts`.
- `docs/runbook.md`, `docs/go-live-checklist.md`, `scripts/sql/reset-test-data.sql`; README,
  SECURITY, DECISIONS (ADR-026) updated.

**Tests (2026-10-16)**
| Where | Result |
|---|---|
| Local: lint, typecheck, build, secret scan | pass |
| Local: unit | 300 passed (2 new: row-count comparison) |
| Local: database (PostgreSQL 16) | 317 passed (1 new: row-count query covers every table) |
| Local: smoke test against a production build | 16/16 checks pass |
| Local: restore drill rehearsal (fixture DB → dump → fresh DB from migrations → check) | pass: 12 tables, 425 rows match, security verification passes; a deleted row is caught; a non-local target is refused |
| Local: reset-test-data.sql | removes only the named user's test records; stops on a real-looking contact; stops on the placeholder email |
| CI run #104 (commit 83c4cab): all 4 jobs | pass — incl. smoke test against the Cloudflare build, secret scan, audit gate, 15 browser tests |
| Restore-drill workflow file | first push rejected by GitHub (`runner.temp` in job env) — fixed in 83c4cab; workflow not yet run on production (owner) |

**Production verification (2026-10-16, commit f042cf7, logs checked)**
| Workflow run | Result |
|---|---|
| Deploy app (Cloudflare) #13 | success — "✓ Smoke test passed" |
| Backup restore drill #3 | success — "✓ Restore drill passed: 12 tables, 137 rows, all matching production; security checks pass on the copy" (12 tables with RLS + aal2 policy, 13 functions, 0 anon grants, 0 definer functions) |
| Smoke test production #1 | success — 16/16 checks, "✓ Smoke test passed for https://bass-agency-crm.thebassagencyga.workers.dev" |

**Free-plan backups (2026-10-16, ADR-027 — APPROVED by owner 2026-10-16).** The owner found the CRM
project is on Supabase **Free** (no backups; no leaked-password protection or inactivity
sign-out) and chose "stay Free, build backups". Added: **Nightly backup** (encrypted, 30 days),
**Restore backup (into an empty CRM project)**, the **Backup restore drill** now restores the
latest backup (production untouched); `src/lib/backup.ts`, `scripts/backup-tool.mts`,
`scripts/backup-archive.sh`, `scripts/fetch-backup.sh`, `scripts/restore-load.sh`,
`scripts/supabase-api.mts`; `scripts/restore-drill.mts` removed. Runbook §3–6, §9–10, checklist,
SECURITY, README updated.

| Where | Result |
|---|---|
| Local: lint, typecheck, secret scan | pass |
| Local: unit | 310 passed (10 new: manifest, sign-in matching, target checks, id remap) |
| Local: database (PostgreSQL 16) | 325 passed (8 new: snapshot copy → encrypt → decrypt → fresh DB with new sign-in ids → restore → check; RLS holds; wrong/short passphrase, non-empty target, non-local DB refused) |
| GitHub: Nightly backup, drill on a real backup | not run yet — needs the owner's `BACKUP_PASSPHRASE` secret |
| GitHub: Restore backup into a hosted project | not run (only for a disaster, or a rehearsal on a scratch project) |

**Owner actions after approval** — in order; details in `docs/go-live-checklist.md`
1. ~~Merge to `main`; **Deploy app (Cloudflare)**~~ — done.
2. ~~**Backup restore drill** and **Smoke test production** — both green~~ — done.
3. Supabase dashboard checks (auth settings, leaked-password protection, backups, billing).
4. iPhone checks; optional clean start; sign-off: "I approve entering real client data."
