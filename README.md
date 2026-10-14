# The Bass Agency CRM

Private sales and relationship CRM for The Bass Agency (Carrollton, GA): contacts,
home/auto/commercial/life opportunity pipelines, follow-up tasks, renewals, cross-sell
prompts and basic reports.

> **Status: Phase 0 (governance only).** There is no application code yet. Sections marked
> *(planned)* describe the intended setup and will be completed in the phase noted.
> See `ROADMAP.md` and `PROGRESS.md`.

## Architecture (planned)
| Layer | Choice | Notes |
|-------|--------|-------|
| App | Next.js App Router, TypeScript strict, Tailwind CSS | Version pinned in Phase 1 to one the hosting adapter supports |
| Data | Supabase PostgreSQL (dedicated project in existing Pro org) | RLS on every table |
| Auth | Supabase Auth (email + password, invite only) | `@supabase/ssr` cookie sessions |
| Validation | zod on the server | |
| Tests | Vitest (unit), SQL/pgTAP (schema + RLS), Playwright (E2E, Phase 11) | |
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

## Prerequisites (planned, Phase 1)
- Node.js 22 LTS and npm
- Supabase CLI (`npx supabase`) and Docker for the local stack — or local PostgreSQL 16 for SQL tests
- A free Cloudflare account (for the Workers runtime/deploy)

## Environment variables (planned, Phase 1–2)
Copy `.env.example` to `.env.local`. Never commit real values.
| Name | Exposure | Purpose |
|------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | browser | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | Publishable (anon) key; safe only because RLS is enforced |
| `SUPABASE_SECRET_KEY` | **server only** | Admin tasks (user invites); never per-request |
| `APP_TIME_ZONE` | server | Defaults to `America/New_York` |

## Local development (planned, Phase 1)
```bash
npm install
npx supabase start          # local Postgres + Auth (Docker)
npx supabase db reset       # apply supabase/migrations + seed
npm run dev
```

## Database migrations (planned, Phase 1)
- Migrations live in `supabase/migrations/` and are applied in filename order.
- Create: `npx supabase migration new <name>`; never edit a migration that has been applied
  to production — add a new one.
- Apply to production only after review: `npx supabase db push` (linked to the CRM project,
  never ProducerIQ's).

## Testing (planned, Phase 1+)
```bash
npm run lint
npm run typecheck
npm test              # unit
npm run test:db       # schema + RLS against a local database
npm run test:e2e      # Phase 11
```

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
