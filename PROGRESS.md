# Progress

**Current phase:** 1 — Architecture & database foundation — **READY FOR REVIEW**
**Last updated:** 2026-10-14
**Branch:** `phase-1-database-foundation` (not merged to `main`)

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
| `npm run test:db` (PostgreSQL 16.15) | 91 passed |
| `npm run build` | pass |
| `npx opennextjs-cloudflare build` + `wrangler dev` | pass: `/` 200, unknown route 404, no runtime errors |
| `wrangler deploy --dry-run` | 3947 KiB raw / 821 KiB gzip |
| RLS mutation check (4 deliberate breaks) | all 4 detected by tests |
| `tests/db/supabase-smoke.sql` on local shim DB | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Not run locally
- Migrations on Supabase's real Postgres image: Docker images are blocked by the sandbox
  network proxy. Covered by the CI `supabase` job.
- Tests on PostgreSQL 17 (production version): local server is 16. Covered by the CI `database` job.

## Owner actions needed
1. Review the migrations (`supabase/migrations/`) and `docs/data-model.md`.
2. Answer open questions in DECISIONS.md (ADR-010 no deletes, ADR-012 tasks need a contact).
3. After approval: apply migrations to the CRM project (README → Database migrations), or
   ask Claude to walk through it.
4. Approve Phase 1 → merge branch to `main`.

## Next action
Await owner review of Phase 1. Phase 2 (authentication) does not start without approval.
