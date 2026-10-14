# The Bass Agency CRM

Private sales and relationship CRM for The Bass Agency (Carrollton, GA): contacts,
home/auto/commercial/life opportunity pipelines, follow-up tasks, renewals, cross-sell
prompts and basic reports.

> **Status: Phase 1 (database foundation).** The app is a placeholder page; the database
> schema, security policies and their tests exist. Sections marked *(planned)* arrive in the
> phase noted. See `ROADMAP.md` and `PROGRESS.md`.

## Architecture
| Layer | Choice | Notes |
|-------|--------|-------|
| App | Next.js 16.3.8 App Router, TypeScript 5.9 strict, Tailwind CSS 4 | Next pinned to a version verified with the Cloudflare adapter (ADR-004) |
| Data | Supabase PostgreSQL (dedicated project in existing Pro org) | RLS on every table |
| Auth | Supabase Auth (email + password, invite only) | `@supabase/ssr` cookie sessions |
| Validation | zod on the server | |
| Tests | Vitest (unit + database), Playwright (E2E, Phase 11) | Database tests run SQL as Supabase's API roles |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Free plan; Vercel Pro fallback needs approval |
| CI | GitHub Actions | lint, typecheck, tests, build |

## Cost assumptions
| Item | Expected monthly cost | Status |
|------|----------------------|--------|
| Supabase Pro plan | already paid by owner | existing |
| Additional Supabase project (Micro compute) | ≈ $10 (third-party sources; confirm on billing page) | needs owner confirmation |
| Cloudflare Workers free plan | $0 | to be verified in Phase 1 spike |
| GitHub private repo + Actions (free minutes) | $0 | |
| Domain | $0 (`*.workers.dev`) — purchase only with approval | |
| **Total added** | **≈ $10/month** (guardrail: < $25) | |

## Prerequisites
- Node.js 22 LTS (≥ 22.12) and npm
- PostgreSQL 16+ server binaries for the database tests (or Docker for the full Supabase stack)
- Supabase CLI — installed as a dev dependency (`npx supabase`)
- A free Cloudflare account — only for deploying (Phase 12); local preview needs none

## Environment variables (planned, Phase 1–2)
Copy `.env.example` to `.env.local`. Never commit real values.
| Name | Exposure | Purpose |
|------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | browser | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | Publishable (anon) key; safe only because RLS is enforced |
| `SUPABASE_SECRET_KEY` | **server only** | Admin tasks (user invites); never per-request |
| `APP_TIME_ZONE` | server | Defaults to `America/New_York` |

## Local development
```bash
npm install
npm run dev                 # http://localhost:3000 (placeholder page in Phase 1)
npm run cf:preview          # build for Cloudflare and serve locally in workerd (:8787)
```
With Docker available, `npx supabase start` runs the full local Supabase stack (Postgres,
Auth, Data API) and applies `supabase/migrations/` — used from Phase 2 onward.

## Database migrations
- Migrations live in `supabase/migrations/` and are applied in filename order. Data model:
  `docs/data-model.md`.
- Create: `npx supabase migration new <name>`. Never edit a migration that has been applied
  to production — add a new one.
- **Applying to the production project — from a phone (recommended, ADR-014):**
  GitHub → Actions → **Deploy database migrations** → Run workflow (branch `main`).
  Leave **apply** unticked first: it checks the project is the CRM and lists what would be
  applied. Run again with **apply** ticked to apply and verify. Needs the three repository
  secrets listed at the top of `.github/workflows/deploy-migrations.yml`.
- **Applying to the production project — from a computer (alternative):**
  ```bash
  npx supabase login                          # opens a browser; token stays on your machine
  npx supabase link --project-ref <CRM project ref>   # Dashboard → Project Settings → General
  npx supabase db push --dry-run              # lists the migrations it would apply
  npx supabase db push                        # applies them
  ```
  Double-check the project ref is the **CRM** project, never ProducerIQ's.

## Testing
```bash
npm run lint
npm run typecheck
npm test                    # unit tests
npm run db:local:start      # disposable local PostgreSQL on 127.0.0.1:54329
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
npm run test:db             # schema, constraint, RLS and audit tests
npm run test:all            # everything
npm run db:local:stop
```
`test:db` creates a throwaway database from the migrations for every run, drops it
afterwards, and refuses to run against any non-local host. CI (`.github/workflows/ci.yml`)
also applies the migrations to Supabase's real Postgres image and runs an RLS smoke test.

## Deployment (planned, Phase 12)
Build with `@opennextjs/cloudflare`, deploy with Wrangler, set secrets with
`wrangler secret put`. Full runbook written in Phase 12.

## Backups and recovery (planned; verified in Phases 11–12)
1. **Automatic:** Supabase Pro daily backups — Dashboard → Database → Backups. Confirm retention.
2. **Manual export (recommended monthly and before risky migrations):**
   `npx supabase db dump --linked -f backup-schema.sql` and
   `npx supabase db dump --linked --data-only -f backup-data.sql`.
   Store encrypted outside Git; files contain client data.
3. **Restore:** dashboard restore of a daily backup (overwrites the project — confirm first),
   or restore dump files into a fresh/local database with `psql`. A restoration drill into a
   non-production database is an acceptance criterion of Phase 11.

## Project control files
`CLAUDE.md` (rules) · `ROADMAP.md` (phases) · `PROGRESS.md` (current state) ·
`DECISIONS.md` (ADRs) · `SECURITY.md` · `CHANGELOG.md`
