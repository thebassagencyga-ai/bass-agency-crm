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

**Alternatives.** Separate schema in ProducerIQ's project ($0 extra; rejected due to shared
service-role blast radius and Clerk-wired auth); a second paid organization (rejected:
unnecessary cost); Supabase Free (rejected by spec).

---

## ADR-003 — Development and test databases are local
**Status:** Proposed

**Decision.** Development and automated integration/RLS tests run against a local Supabase
stack (`supabase start`, requires Docker) or, where Docker is unavailable (e.g. cloud agent
sandboxes), a local PostgreSQL 16 instance with the Supabase `auth` primitives
(`auth.uid()`, `authenticated`/`anon` roles) stubbed by a test bootstrap script. The hosted
project is production only.

**Why.** Satisfies "isolated test environment" and "never test against production" without
paying for a second hosted project.

**Alternative.** A hosted staging project (~$10/month extra). Available later if the owner
approves.

---

## ADR-004 — Hosting: Cloudflare Workers via OpenNext
**Status:** Proposed (compatibility spike in Phase 1, final verification in Phase 12)

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

**Fallback.** Vercel Pro ($20/month) — requires owner approval; total added cost would then be
about $30/month including ADR-002, exceeding the $25 guardrail.

**Alternatives.** Vercel Hobby (rejected: commercial use not permitted); Netlify, Render,
Fly.io (not yet evaluated; considered only if the Workers spike fails).

---

## ADR-005 — Data access: Supabase client + Postgres functions, no ORM
**Status:** Proposed

**Decision.** Use `@supabase/ssr` with the signed-in user's session for all reads/writes so
RLS is always enforced. Multi-step operations (stage change + task generation, win/loss
closure, reopen) are `security invoker` Postgres functions called via RPC, executed in one
transaction. Generated TypeScript types from the schema (`supabase gen types`). No ORM.

**Alternatives.** Drizzle/Prisma with a direct connection (bypasses RLS unless carefully
configured; adds a second data layer) — rejected per spec.

---

## ADR-006 — Pipeline stages as configurable data; outcome as a separate column
**Status:** Proposed

**Decision.** `pipeline_stages` table keyed by product line (auto, home, commercial, life)
seeded with the spec's stages, each flagged with a `stage_kind` (`active`, `won`, `lost`).
`opportunities.outcome` (`open | won | lost | nurture`) is separate from `stage_id`.
A constraint/trigger keeps them consistent (e.g. outcome `won` requires a won-kind stage) and
prevents an opportunity from using another product line's stage.

---

## ADR-007 — Dates and time zone
**Status:** Proposed

**Decision.** User-facing zone `America/New_York` (stored on the profile for future agents).
Instants → `timestamptz` (UTC). Calendar values (task due date, quote date, effective date,
renewal date) → `date`. "Today" is computed in the user's zone. Business-day math skips
Saturday/Sunday; US holidays are **not** skipped in the MVP (documented limitation; owner may
request a holiday list).

---

## ADR-008 — Duplicate-safe task automation
**Status:** Proposed

**Decision.** Automation-created tasks carry a deterministic `dedupe_key`
(e.g. `opp:<id>:rule:<rule_id>:seq:<n>`) with a partial unique index over open tasks.
Generation uses `insert … on conflict do update` so retries and repeated events update the
existing task rather than creating a duplicate. Owner-edited dates are preserved
(`due_date_overridden` flag).

---

## ADR-009 — Audit trail
**Status:** Proposed

**Decision.** An `audit_log` table populated by Postgres triggers on contacts, opportunities,
tasks and automation rules (actor, table, record id, action, changed fields as JSONB
before/after, timestamp). Readable only by the record owner; not writable or deletable by
application users.

---

## Open questions for the owner (do not block Phase 1 start)

1. US holidays in business-day calculations? (Default: weekends only.)
2. Custom domain later? (Default: free `workers.dev` URL; no purchase.)
3. Error monitoring (e.g. Sentry free tier)? (Default: none in MVP; Cloudflare logs only.)
