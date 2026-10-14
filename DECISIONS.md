# Architecture Decision Records

Status values: **Accepted** (owner approved), **Proposed** (awaiting owner approval),
**Superseded**. Each record lists alternatives considered.

---

## ADR-001 — Separate repository from ProducerIQ
**Status:** Accepted (owner, 2026-10-14)

**Context.** The session started in `thebassagencyga-ai/produceriq`, a live multi-tenant
SaaS: JavaScript, Clerk auth, Stripe billing, Resend email, Anthropic AI, Vercel crons.
The CRM spec requires TypeScript strict, Supabase Auth, no email/AI, and private client data.

**Decision.** Build the CRM in a new private repository (proposed name
`thebassagencyga-ai/bass-agency-crm`). ProducerIQ is not modified.

**Alternatives.** `crm/` folder inside ProducerIQ (shared history, CI and Vercel project
coupling); building into ProducerIQ (conflicting auth, language and feature constraints;
risk to a live product). Both rejected.

---

## ADR-002 — Dedicated Supabase project in the existing Pro organization
**Status:** Accepted (owner, 2026-10-14)

**Context.** ProducerIQ's Supabase project uses Clerk as a third-party auth provider and its
server routes hold a service-role key, which bypasses RLS across all schemas.

**Decision.** Create a new Supabase project (production) inside the owner's existing Pro
organization. Do not reuse ProducerIQ's project or keys.

**Cost.** Third-party sources (not yet confirmed on supabase.com, which was unreachable from
the build sandbox) report that Pro includes a $10/month compute credit covering one Micro
instance and each additional project adds roughly $10/month for Micro compute. **Owner must
confirm the exact amount on the Supabase billing page before the project is created (Phase 1).**

**Project settings (owner, 2026-10-14):** Data API **on** (required by supabase-js /
`@supabase/ssr`); "Automatically expose new tables" **off** — every migration must
explicitly `grant` table privileges to `authenticated` only (never `anon`); "Automatic RLS"
**on** as a safety net in addition to explicit `enable row level security` in each migration.
Region East US. Database password held only in the owner's password manager.

**Alternatives.** Separate schema in ProducerIQ's project ($0 extra; rejected due to shared
service-role blast radius and Clerk-wired auth); a second paid organization (rejected:
unnecessary cost); Supabase Free (rejected by spec).

---

## ADR-003 — Development and test databases are local
**Status:** Proposed — implemented in Phase 1 (pending owner review)

**Decision.** Development and automated integration/RLS tests run against a local Supabase
stack (`supabase start`, requires Docker) or, where Docker is unavailable (e.g. cloud agent
sandboxes), a local PostgreSQL 16 instance with the Supabase `auth` primitives
(`auth.uid()`, `authenticated`/`anon` roles) stubbed by a test bootstrap script. The hosted
project is production only.

**Why.** Satisfies "isolated test environment" and "never test against production" without
paying for a second hosted project.

**Alternative.** A hosted staging project (~$10/month extra). Available later if the owner
approves.

**Phase 1 implementation.** `tests/db/global-setup.ts` builds a throwaway database from the
migrations for every run and refuses non-local hosts. `tests/db/supabase-shim.sql` stands in
for Supabase's `auth` schema and API roles (tests only). Local runs use PostgreSQL 16; CI uses
PostgreSQL 17 (the hosted project's major version) and additionally applies the migrations
to Supabase's real Postgres image (`supabase db start`) and runs an RLS smoke test against
the real `auth.uid()`.

---

## ADR-004 — Hosting: Cloudflare Workers via OpenNext
**Status:** Proposed — local spike passed in Phase 1; deploy and final verification in Phase 12

**Context.** The owner has Vercel **Hobby**, which Vercel's fair-use guidelines restrict to
non-commercial personal use; an agency's sales CRM is commercial use. Cloudflare Pages does
not support every Next.js feature.

**Decision.** Target Cloudflare Workers (free plan) with the `@opennextjs/cloudflare` adapter
(Node.js runtime on workerd with `nodejs_compat`). Pin a Next.js version the adapter
officially supports (search results indicate Next.js 15 and 16; to be confirmed against the
adapter's docs/repo in Phase 1). Use the free `*.workers.dev` subdomain until the owner
decides on a custom domain.

**Risks to verify.** Worker bundle size limit on the free plan; middleware/proxy support for
Supabase session refresh; Server Actions; cold start.

**Phase 1 spike result (2026-10-14).** `@opennextjs/cloudflare` 1.20.11 declares support
for Next `>=15.5.27 <16 || >=16.3.8`. With Next **16.4.0** the worker built but every request
failed at runtime in workerd (`Unexpected loadManifest(/.next/server/preview-props.json)`):
16.4.0 is newer than the adapter handles. With Next **16.3.8** the placeholder served
200 / 404 correctly in workerd (`wrangler dev`). Dry-run bundle: 3.9 MiB raw, **821 KiB gzip**
(free-plan limit 3 MiB gzip). Nothing was deployed: no Cloudflare account was used.
**Rule:** do not upgrade Next.js past a version the adapter has been verified with; re-run
`npm run cf:preview` after any Next or adapter upgrade.

**Fallback.** Vercel Pro ($20/month) — requires owner approval; total added cost would then be
about $30/month including ADR-002, exceeding the $25 guardrail.

**Alternatives.** Vercel Hobby (rejected: commercial use not permitted); Netlify, Render,
Fly.io (not yet evaluated; considered only if the Workers spike fails).

---

## ADR-005 — Data access: Supabase client + Postgres functions, no ORM
**Status:** Proposed — schema side implemented in Phase 1 (pending owner review)

**Decision.** Use `@supabase/ssr` with the signed-in user's session for all reads/writes so
RLS is always enforced. Multi-step operations (stage change + task generation, win/loss
closure, reopen) are `security invoker` Postgres functions called via RPC, executed in one
transaction. Generated TypeScript types from the schema (`supabase gen types`). No ORM.

**Alternatives.** Drizzle/Prisma with a direct connection (bypasses RLS unless carefully
configured; adds a second data layer) — rejected per spec.

---

## ADR-006 — Pipeline stages as configurable data; outcome as a separate column
**Status:** Proposed — implemented in Phase 1 (pending owner review)

**Decision.** `pipeline_stages` table keyed by product line (auto, home, commercial, life)
seeded with the spec's stages, each flagged with a `kind` (`active`, `won`, `lost`).
`opportunities.outcome` (`open | won | lost | nurture`) is separate from `stage_id`.

**Implementation.** A trigger copies the stage's kind into `opportunities.stage_kind`; a
composite FK `(stage_id, product_line, stage_kind) → pipeline_stages (id, product_line, kind)`
guarantees the stage exists, belongs to the opportunity's product line, and has that kind; a
CHECK constraint then allows `open`/`nurture` only on active stages, `won` only on the won
stage and `lost` only on Lost. All declarative, no application code involved. Stages are
global (shared by all agents) and changed by migration; per-agent stage customization is not
in scope.

---

## ADR-007 — Dates and time zone
**Status:** Proposed — column types implemented in Phase 1; date logic arrives in Phases 5–6

**Decision.** User-facing zone `America/New_York` (stored on the profile for future agents).
Instants → `timestamptz` (UTC). Calendar values (task due date, quote date, effective date,
renewal date) → `date`. "Today" is computed in the user's zone. Business-day math skips
Saturday/Sunday; US holidays are **not** skipped in the MVP (documented limitation; owner may
request a holiday list).

---

## ADR-008 — Duplicate-safe task automation
**Status:** Proposed — constraint implemented in Phase 1 (pending owner review)

**Decision.** Automation-created tasks carry a deterministic `dedupe_key`
(e.g. `opp:<id>:rule:<rule_key>:cycle:<n>`) with a unique index on `(owner_id, dedupe_key)`
across **all** statuses — not only open tasks, so retrying an event after the task was
completed cannot recreate it. Reopening an opportunity increments `opportunities.cycle`, which
produces new keys for the new sequence.
Generation uses `insert … on conflict do update` so retries and repeated events update the
existing task rather than creating a duplicate. Owner-edited dates are preserved
(`due_date_overridden` flag).

---

## ADR-009 — Audit trail
**Status:** Proposed — implemented in Phase 1 (pending owner review)

**Decision.** An `audit_log` table populated by Postgres triggers on contacts, opportunities,
tasks and automation rules (actor, table, record id, action, changed fields as JSONB
before/after, timestamp). Readable only by the record owner; not writable or deletable by
application users.

---

## ADR-010 — No deletes through the application
**Status:** Accepted (owner, 2026-10-14) — implemented in Phase 1

**Decision.** The `authenticated` role has no DELETE privilege on any table. Contacts are
archived, opportunities closed, tasks completed or cancelled, activities kept. Foreign keys
never cascade. A user who owns records cannot be removed from `auth.users` until their data
is dealt with.

**Why.** Spec: preserve history, completed tasks and activities; prefer archiving. Mistakes
are corrected by editing; every change is in the audit log.

**Trade-off.** A record entered by mistake cannot be removed from the app. If the owner wants
hard delete for, e.g., a duplicate contact with no history, a later phase can add a narrowly
scoped, audited delete function.

---

## ADR-011 — Toolchain versions (Phase 1)
**Status:** Proposed (pending owner review)

Pinned exact versions (`--save-exact`): Next.js **16.3.8** (see ADR-004), React 19.3,
TypeScript **5.9.3** (TypeScript 7.0 is the new native compiler; typescript-eslint supports
`<6.1`, so 5.9 is the newest fully supported), Tailwind CSS 4.3, ESLint 9.39 with
`eslint-config-next`, Vitest 5, `@supabase/ssr` 0.12 / `@supabase/supabase-js` 2.117, zod 4.6,
`@opennextjs/cloudflare` 1.20.11, wrangler 4.151, Supabase CLI 2.120. Node.js 22 LTS.

`npm audit --omit=dev` (production dependencies): 0 vulnerabilities. `npm audit` (all) reports
9 high findings, all in build/lint tooling (`glob` CLI command injection — the CLI is never
invoked; `braces` ReDoS — processes only our own build patterns). The only offered fix
downgrades the Cloudflare adapter to an older release, so they are accepted for now and
re-reviewed in Phase 11.

---

## ADR-012 — Every task belongs to a contact
**Status:** Accepted (owner, 2026-10-14: "I can't think of any general to-dos")

**Decision.** Follows spec §8 literally: `tasks.contact_id` is required. Personal or
administrative to-dos with no contact are not supported.

**Alternative.** Make `contact_id` optional for general agency tasks. Small change if wanted;
must be decided before Phase 5.

---

## Open questions for the owner (do not block Phase 1 start)

1. US holidays in business-day calculations? (Default: weekends only.)
2. Custom domain later? (Default: free `workers.dev` URL; no purchase.)
3. Error monitoring (e.g. Sentry free tier)? (Default: none in MVP; Cloudflare logs only.)
4. ~~Tasks without a contact (ADR-012)?~~ Answered: no.
5. ~~No deleting from the app (ADR-010)?~~ Answered: acceptable.
6. Referral and Google review request automation — requested by owner 2026-10-14; design
   questions pending (see PROGRESS.md).
