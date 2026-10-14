# Progress

**Current phase:** 1 — Architecture & database foundation — **APPROVED by owner 2026-10-14**
**Last updated:** 2026-10-14
**Branch:** `phase-1-database-foundation`, merged to `main` on approval

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
Owner applies migrations to the CRM Supabase project. Phase 2 (authentication) does not start without the owner's go-ahead.
