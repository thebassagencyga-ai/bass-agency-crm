# CLAUDE.md — The Bass Agency CRM

Permanent instructions for any Claude session working in this repository. Read this file,
`ROADMAP.md`, `PROGRESS.md` and `DECISIONS.md` before doing anything else.

## What this is

A private sales and relationship CRM for The Bass Agency (insurance, Carrollton, GA).
One user today; must support additional agents later without a redesign.

It is **not** a policy administration system, quoting engine, underwriting tool, or a
replacement for Alfa systems. No Alfa integrations.

This repository is **separate from ProducerIQ** (`thebassagencyga-ai/produceriq`). Never
import code, credentials, Supabase projects, Clerk config, or deployments from ProducerIQ.
See DECISIONS.md ADR-001 and ADR-002.

## Phase gates (non-negotiable)

1. Work on exactly one phase at a time — the one marked `IN PROGRESS` in ROADMAP.md.
2. Do not build anything belonging to a later phase, even if its requirements are known.
3. At the start of a phase, state: objective, files expected to change, dependencies,
   acceptance criteria.
4. After implementing: run lint, typecheck, unit, integration and security tests that exist.
5. Fix failures you introduced. Never skip, disable or fake a test. Never claim a test ran
   when it did not. Never mark manual checks as passed unless a person performed them.
6. Update ROADMAP.md, PROGRESS.md, CHANGELOG.md (and other affected docs) before review.
7. End with the Phase Report (template below), then **stop**. Wait for explicit owner
   approval before starting the next phase.
8. Ask a focused question when a high-impact requirement is ambiguous.
9. Never overwrite existing work, migrations, env config or user changes without inspecting
   impact first. Never run destructive commands against production.

### Phase Report template

```
PHASE STATUS
Completed items
Files created or modified
Database changes
Commands executed
Tests passed
Tests failed
Tests not run and why
Security considerations
Manual verification required
Known limitations
Documentation updated
Git commit recommendation
Next phase proposed
```

## Architecture rules

- Next.js App Router, TypeScript `strict: true` (plus `noUncheckedIndexedAccess`), Tailwind CSS.
- Supabase PostgreSQL + Supabase Auth in a **dedicated CRM project** in the owner's existing
  Supabase Pro organization. Postgres row level security on every exposed table.
- No ORM and no second backend. Data access via `@supabase/ssr` / `@supabase/supabase-js`
  using the signed-in user's session so RLS always applies. Multi-step business operations
  (stage change + task creation, etc.) are Postgres functions called via RPC so they are
  transactional.
- Server-first: Server Components and Server Actions/Route Handlers for mutations. Validate
  every untrusted input on the server with a schema (zod).
- The service role / secret key is used **only** in explicitly reviewed server-only modules
  (`import "server-only"`), never for ordinary user requests, never in browser bundles,
  never with a `NEXT_PUBLIC_` prefix.
- All schema changes are SQL migrations in `supabase/migrations/`, committed to Git. Never
  edit an applied migration; add a new one.
- Every business table has `id uuid`, `owner_id uuid` (references the profile/auth user),
  `created_at`, `updated_at`. Closed records are preserved, not deleted. Prefer archiving.
- Every new table needs, in its migration: RLS enabled, explicit grants to `authenticated`
  only, owner-scoped policies, and coverage in `tests/db/rls.test.ts`. The catalog tests fail
  if a table lacks RLS or grants anything to `anon`.
- Pipeline stage ≠ outcome. Stages are configurable data; outcome is `open | won | lost | nurture`.
- Time zone: `America/New_York` for everything user-facing. Store instants as `timestamptz`;
  store calendar dates (due dates, effective/renewal dates) as `date`. Compute "today" in
  America/New_York, never from server UTC.
- No scheduler in the MVP: tasks appear based on their dates when the app is opened.
- Hosting target: Cloudflare Workers via `@opennextjs/cloudflare` (ADR-004). Do not use
  features the adapter does not support without recording a decision. Do not upgrade
  Next.js or the adapter without re-running `npm run cf:preview` and checking pages load
  (Next 16.4.0 broke the adapter at runtime while still building successfully).

## Out of scope for the MVP (do not add)

Email sending, SMS, paid automation platforms, AI features/prospecting, purchased leads,
Alfa integrations, file uploads of policy documents, unnecessary third-party services.

## Data minimization

Never store SSNs, payment credentials, bank details, medical/underwriting answers, detailed
health information, driver's license numbers, or policy documents. Notes are for relationship
management only. Tests and fixtures use fictional data only (e.g. `@example.com`,
555-01xx phone numbers).

## Coding standards

- TypeScript strict; no `any` without a comment explaining why.
- Small modules; pure business logic (date math, rule evaluation, metrics) lives in
  `src/lib/` and is unit tested independently of React and the database.
- Accessible UI: labelled inputs, keyboard reachable, visible focus, ≥44px touch targets,
  readable text on iPhone widths.
- Every form: server validation, field errors, loading state, empty state, success feedback.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Secrets

Never commit `.env*` (except `.env.example` with placeholder values), tokens, passwords,
service-role keys, DB connection strings, client data, or backups. Never print secrets in
logs or tool output. Development and automated tests run against a **local** Supabase stack
(Supabase CLI) or a local PostgreSQL instance — never against production. Production keys
exist only in the hosting provider's secret store and the owner's password manager.

## Cost guardrail

Keep added infrastructure < $25/month. Do not purchase a domain, enable a paid service, or
change a plan without the owner's explicit approval.
