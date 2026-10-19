# Producr CRM

Private sales and relationship CRM (formerly "The Bass Agency CRM", ADR-038), built for The Bass
Agency (Carrollton, GA): contacts,
home/auto/commercial/life opportunity pipelines, follow-up tasks, renewals, cross-sell
prompts and basic reports.

> **Status: Phase 1 (database foundation).** The app is a placeholder page; the database
> schema, security policies and their tests exist. Sections marked *(planned)* arrive in the
> phase noted. See `ROADMAP.md` and `PROGRESS.md`.

## Architecture
| Layer | Choice | Notes |
|-------|--------|-------|
| App | Next.js 16.3.8 App Router, TypeScript 5.9 strict, Tailwind CSS 4 | Next pinned to a version verified with the Cloudflare adapter (ADR-004) |
| Data | Supabase PostgreSQL (dedicated CRM project, Free plan — ADR-027) | RLS on every table |
| Auth | Supabase Auth (email + password, invite only) | `@supabase/ssr` cookie sessions |
| Validation | zod on the server | |
| Tests | Vitest (unit + database), Playwright (E2E, Phase 11) | Database tests run SQL as Supabase's API roles |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` | Free plan; Vercel Pro fallback needs approval |
| CI | GitHub Actions | lint, typecheck, tests, build |

## Cost assumptions
| Item | Expected monthly cost | Status |
|------|----------------------|--------|
| Supabase Free plan (CRM project) | $0 | backups in GitHub Actions, $0 |
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

## Environment variables
Copy `.env.example` to `.env.local` (`next dev`) or `.dev.vars` (`cf:preview`). Never commit
real values. **None are `NEXT_PUBLIC_`**: the browser never talks to Supabase directly.
| Name | Purpose |
|------|---------|
| `SUPABASE_URL` | CRM project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key. Not secret — RLS protects the data — but kept server-side |
| `SITE_URL` | Public URL of the app, used in password-reset links |
| `INSECURE_COOKIES_FOR_LOCAL_TESTS` | Local http testing only; never in production |

No secret/service-role key is used by the app (Phase 2).

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
Unit and database tests run anywhere; integration and browser tests need the local Supabase
stack (Docker) and run in CI (`.github/workflows/ci.yml`, job "Sign-in and security").
```bash
npm run lint
npm run typecheck
npm test                    # unit tests
npm run db:local:start      # disposable local PostgreSQL on 127.0.0.1:54329
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
npm run test:db             # schema, constraint, RLS and audit tests
npm run test:all            # unit + database
npm run db:local:stop
npm run check:bundle        # after a build: no secrets/Supabase config in browser code
# With `npx supabase start` running and the app in `npm run cf:preview`:
npm run test:integration    # Auth API + app HTTP tests (real Supabase)
npm run test:e2e            # Playwright: sign in, two-step setup, sign out
```
`test:db` creates a throwaway database from the migrations for every run, drops it
afterwards, and refuses to run against any non-local host. CI (`.github/workflows/ci.yml`)
also applies the migrations to Supabase's real Postgres image and runs an RLS smoke test.

## Supabase dashboard settings (owner, CRM project only)
Authentication settings live in the dashboard, not in migrations. Apply these after Phase 2
is approved (they mirror `supabase/config.toml`):

1. **Authentication → Sign In / Providers**
   - "Allow new users to sign up": **OFF** (invite-only).
   - **Email** provider: **ON** (turning it off disables password sign-in entirely).
   - Password requirements: minimum **12** characters, "lowercase, uppercase letters and digits".
   - Secure password change: **ON**.
2. **Authentication → Multi-Factor**: TOTP (authenticator app) **enabled**.
3. **Authentication → Sessions**: inactivity timeout **7 days** (168 hours).
4. **Authentication → Emails → Reset password**: replace the link with
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
   (template text in `supabase/templates/recovery.html`).
5. **Authentication → URL Configuration**: Site URL = the app's address (set in Phase 12).
6. **Create your user:** Authentication → Users → Add user → *Create new user* → your email
   and a strong password, tick **Auto Confirm User**. Your profile and the 12 default rules are
   created automatically. On first sign-in the app asks you to set up your authenticator.
7. **Lost authenticator:** Authentication → Users → your user → remove the MFA factor; sign in
   again and set up a new one.

## Deployment (Phase 12, ADR-026)
Production runs on Cloudflare Workers (free plan) at
`https://bass-agency-crm.<subdomain>.workers.dev` against the CRM Supabase project.
GitHub → Actions:
- **Deploy database migrations** — dry run, then apply; ends with a schema verification.
- **Deploy app (Cloudflare)** — builds, scans the browser bundle, deploys, smoke-tests.
- **Smoke test production** — signed-out, read-only checks of the live site (18 checks,
  including the public intake form).
- **Nightly backup** — every night: encrypted copy of the CRM data, kept 30 days (ADR-027).
- **Backup restore drill** — restores the latest backup into a throwaway database and checks it.
- **Restore backup (into an empty CRM project)** — disaster recovery (runbook §4).

Needs repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`CRM_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `BACKUP_PASSPHRASE`. The Worker itself holds no secrets.

Day-to-day operation, restore, access problems, secret rotation and costs:
**[docs/runbook.md](docs/runbook.md)**. Before any real client data:
**[docs/go-live-checklist.md](docs/go-live-checklist.md)** (owner sign-off).

## Backups and recovery
Supabase Free keeps no backups, so **Nightly backup** (`.github/workflows/backup.yml`) copies the
CRM data and sign-in list every night, encrypts it (`BACKUP_PASSPHRASE`) and keeps it 30 days as
an Actions artifact. **Restore backup** puts one into a project without client records;
**Backup restore drill** proves the latest one restores, on a throwaway database. Steps:
`docs/runbook.md` §4; design: DECISIONS ADR-027. The full schema restore is also rehearsed in CI
(`tests/db/backup-restore.test.ts`, `tests/db/backup-tool.test.ts`).

## Project control files
`CLAUDE.md` (rules) · `ROADMAP.md` (phases) · `PROGRESS.md` (current state) ·
`DECISIONS.md` (ADRs) · `SECURITY.md` · `CHANGELOG.md`
