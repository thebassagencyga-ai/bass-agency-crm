# Progress

**Current phase:** 3 — Contact management — **READY FOR REVIEW** (owner approval pending)
**Last updated:** 2026-10-14
**Branch:** `phase-3-contacts` (merge to `main` on approval)

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
- Run #26 (commit 939e926): see the Phase 3 report.

**Owner actions after approval**
1. Merge to `main`.
2. Run "Deploy database migrations" as a dry run — it should list only
   `20261016120000_contact_search.sql` — then apply. The verify step now also checks the new
   items above.
3. Run "Deploy app preview (Cloudflare)", then try contacts on the iPhone (fictional data only).
