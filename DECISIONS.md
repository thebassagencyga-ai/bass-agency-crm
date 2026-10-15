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

## ADR-013 — Referral and Google review requests
**Status:** Accepted (owner, 2026-10-14) — data model in Phase 1; automation in Phase 6;
UI in Phases 3/5; reporting in Phase 9

**Request.** Automate asking clients for referrals and Google reviews.

**Decisions (owner answers 2026-10-14).**
- **Delivery:** the CRM sends nothing (MVP rule). It creates a reminder task with a
  ready-to-copy message containing the agent's Google review link, plus a "Text it" button
  that opens the phone's own Messages app pre-filled (`sms:` link); the agent presses send.
- **Timing:** on a won opportunity, a review task and a referral task each **start 1 day
  after the win and are due 30 days later** (overdue only after the window). Implemented with
  `tasks.start_date` and `automation_rules.completion_window_days`.
- **Tracking:** `contacts.referred_by_contact_id` (who referred whom; must be the same agent's
  contact, never itself); `contacts.google_review_left_on` (recorded by the agent — there is no
  Google integration); activity types `review_request` / `referral_request` with outcomes
  `review_left`, `referral_received`, `declined`.
- **Frequency:** one request per contact (not per opportunity), not repeated within 365 days
  (`cooldown_days`); review requests stop once a review is recorded.

**Compliance guardrails built in.** Google's review policy prohibits incentives and
selectively soliciting positive reviews ("review gating"), so every newly won client gets the
same request regardless of satisfaction, and templates offer nothing in return (a test fails
if a template mentions gifts, discounts, rewards, etc.). The CRM tracks referrals but does not
suggest referral rewards: insurance inducement/rebating rules (Georgia, and possibly Alfa
policy) may restrict them — **owner to confirm with Alfa/compliance before offering any
referral thank-you of value.**

**Also added.** `tasks.category` (prospecting, onboarding, renewal, review_request,
referral_request, other) so win/loss automation closes only prospecting tasks. "Ask for
referrals" was removed from the onboarding checklist because the referral rule replaces it.

---

## ADR-014 — Applying migrations with a manual GitHub workflow
**Status:** Accepted (owner chose this option, 2026-10-14)

**Context.** The owner works mainly from an iPhone, so running the Supabase CLI locally is
impractical, and pasting SQL into the dashboard skips Supabase's migration history.

**Decision.** `.github/workflows/deploy-migrations.yml`, started only by hand from the Actions
tab, only from `main`. Default is a **dry run** that lists pending migrations and changes
nothing; ticking **apply** runs `supabase db push`. Before anything else, a read-only guard
(`scripts/supabase-remote.mts guard`, logic in `src/lib/deploy-checks.ts`) lists the target
project's public tables via the Supabase Management API and **refuses if any table is not a
CRM table** (e.g. ProducerIQ's). After applying, `verify` checks 30 stages, 4 product lines,
RLS on every table and no anon privileges.

**Secrets** (GitHub repository secrets, encrypted, never in Git): `SUPABASE_PROJECT_REF`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.

**Risk.** A Supabase personal access token can manage **every project in the owner's account,
including ProducerIQ's**. Mitigations: it is used only in this manually started workflow,
which only runs on `main` of a private, single-owner repository; the guard refuses non-CRM
projects; the owner sets an expiry on the token and can revoke it at any time
(supabase.com → Account → Access Tokens). If the owner prefers, the token can be deleted
from GitHub after each deploy and re-added when the next phase has migrations.

---

## ADR-015 — Request gate: `middleware.ts` (Edge) plus server-side checks
**Status:** Proposed — implemented in Phase 2 (pending owner review)

**Context.** Next.js 16 renamed `middleware.ts` to `proxy.ts`. A Phase 2 spike showed that
`@opennextjs/cloudflare` 1.20.11 builds `proxy.ts` as Node.js middleware and warns it is
"experimental … not officially maintained … use at your own risk"; `middleware.ts` (Edge
runtime) is the officially supported path and was verified in workerd (redirects, headers).

**Decision.** Use `src/middleware.ts` and accept Next's deprecation warning. Route decisions
live in `src/lib/auth/routing.ts` (pure, unit tested). Protected layouts, pages and Server
Actions **also** check the session on the server (`requireFullSession()`), so security does
not depend on the middleware alone. Revisit when OpenNext officially supports `proxy.ts`.

---

## ADR-016 — Authentication design
**Status:** Proposed — implemented in Phase 2 (owner decisions 2026-10-15; pending review)

- **Invite-only:** public sign-up disabled (Supabase setting); the owner creates users in the
  dashboard. Profiles (and default rules) are created by a trigger on `auth.users`.
- **Mandatory two-step login (owner decision):** TOTP authenticator app. Enforced in three
  places: middleware routing, server-side page/action checks, and **restrictive RLS policies on
  every table requiring `auth.jwt()->>'aal' = 'aal2'`**, so a stolen password alone reads
  nothing even through the raw Data API.
- **Sessions:** `@supabase/ssr` cookies set **HttpOnly**, Secure (production), SameSite=Lax;
  no browser Supabase client (CSP `connect-src 'self'`). Identity comes from `getClaims()`
  (verified JWT), never from unverified cookie contents. Auth responses carry no-store cache
  headers. Owner decision: **sign out after 7 days of inactivity** (Supabase Pro setting).
- **Passwords:** ≥ 12 characters with lower, upper case and a digit (Supabase setting and app
  validation); "secure password change" on. Generic sign-in error (no account discovery).
- **Password reset:** Supabase's built-in email with a `token_hash` link to `/auth/confirm`;
  after the link, the user must still pass the authenticator step before choosing a password.
  Supabase's built-in mailer only delivers to members of the owner's Supabase organization;
  the owner signs in with a different address, so either add that address to the
  organization or approve a custom SMTP provider later. If neither, password resets are done
  from the Supabase dashboard.
- **Security headers:** per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`),
  `frame-ancestors 'none'`, HSTS, nosniff, no-referrer, Permissions-Policy, COOP; pages are
  `private, no-store`.
- **Lost authenticator:** recovery path is the owner's Supabase dashboard (Authentication →
  Users → remove the MFA factor), protected by the owner's own Supabase login. Documented in
  README.

**Alternatives considered.** Magic links (depend on email delivery; rejected); browser
Supabase client (exposes session to scripts; rejected); passkeys/WebAuthn (good future option
once Supabase support matures).

---

## ADR-017 — Early preview deployment on Cloudflare Workers (free plan)
**Status:** Accepted (owner requested, 2026-10-15)

**Decision.** Ahead of Phase 12, a manually started workflow
(`.github/workflows/deploy-preview.yml`, main only) builds the app with OpenNext and deploys it
to `https://bass-agency-crm.<subdomain>.workers.dev` so the owner can test each phase on an
iPhone. It derives `SUPABASE_URL` from the same `SUPABASE_PROJECT_REF` the migration workflow
guards (so the app cannot be pointed at another project), scans the browser bundle with the
real publishable key and URL, deploys with `wrangler deploy --var …`, then smoke-tests the
live site (sign-in page 200, protected page redirects, security headers present).

**Constraints.**
- Uses the production CRM Supabase project. **No real client data** until the Phase 11
  security review and Phase 12 checks are complete (spec §6.16, §15).
- Workers **Free** plan: 100,000 requests/day and a 10 ms CPU limit per request. If pages
  exceed the CPU limit (error 1102), the fix is Workers Paid ($5/month) — owner approval
  required. Bundle at Phase 2: 9.5 MiB raw / **1.83 MiB gzip** of the 3 MiB free limit.
- Cloudflare API token from the "Edit Cloudflare Workers" template, stored only as a GitHub
  secret; owner can revoke it any time.

Phase 12 remains responsible for the full production checklist (commercial terms re-check,
custom domain decision, backups/restore drill, monitoring).

---

## ADR-018 — Contact search as SECURITY INVOKER database functions
**Status:** Accepted — implemented in Phase 3 (approved with the phase, 2026-10-14)

**Context.** The contact list needs a single search box over names (either order), business
name, email and phone digits, plus filters, sorting and pagination. Building this with
PostgREST filter strings in the app would mean string-building `or=(…)` filters from user
input, with awkward escaping of `,`, `.`, `%` and `_`.

**Decision.** `search_contacts`, `find_possible_duplicates` and `contact_lead_sources` are SQL
functions in `public`, called through RPC with the user's session. They are **SECURITY
INVOKER** with `search_path = ''`, so RLS (owner + aal2) filters every row exactly as for a
direct table read; the query text is a parameter and LIKE wildcards are escaped; page size is
capped at 100. EXECUTE is granted to `authenticated` only. The deploy verification fails if a
`public` function is SECURITY DEFINER, executable by `anon`, or the function count changes.

**Consequences.** Search logic is tested directly in SQL (24 DB tests, mutation-checked).
Verification counts only callable functions; trigger-only functions
Supabase adds (today `rls_auto_enable`, found on the first production verify, deploy run #8)
are allowed by name and any other one fails.
Matching uses `ILIKE` without an index: fine for one agent's few thousand contacts; a trigram
index can be added later if the list grows (no decision needed now).

---

## ADR-019 — Referrers are always contacts
**Status:** Accepted — owner decision 2026-10-14

"Referred by" links only to another of the agent's contacts; there is no free-text referrer.
A referrer is a relationship worth keeping in the CRM, and only a linked contact shows their
referrals and can drive referral thank-you follow-ups (ADR-013, Phase 6). The form explains
this, and text typed without choosing a contact stops the save with a message.

---

## ADR-020 — Opportunity lifecycle in the database; board without drag-and-drop
**Status:** Accepted — implemented in Phase 4 (approved with the phase, 2026-10-15)

**Lifecycle.** A trigger fixes the product line after creation, owns `cycle` (+1 only when a
won/lost opportunity is reopened) and clears the loss reason on reopen. Stage changes are plain
updates checked by the existing composite FK and CHECK constraints (ADR-006), so no RPC is
needed; the app computes the new outcome with a pure, unit-tested function. Phase 6
automation will hang off these same transitions.

**Board.** Each card has a labelled "Move to…" select and button instead of drag-and-drop:
works with touch, keyboard and screen readers, and needs no client JavaScript. Phones show
stages one under another; wider screens show columns that scroll sideways. Moving to Lost
from the board opens the opportunity to ask for a reason. The board lists open and nurture
opportunities plus those closed in the last 30 days (max 200; the table shows everything).

---

## ADR-021 — Task views, "today", and review/referral messages
**Status:** Accepted — implemented in Phase 5 (approved with the phase, 2026-10-15)

**Today.** The app computes today's date in the user's time zone (`profiles.time_zone`,
default America/New_York) and passes it to `search_tasks` / `task_counts`; the database never
uses the server's UTC date. Unit tests cover 11:59 PM / 12:00 AM and both daylight-saving
change days. Activity times typed on a phone are converted from New York wall-clock time
(the repeated 1 AM hour in November uses the first occurrence).

**Views.** Overdue / Today / Upcoming / Completed. A task whose start date is in the future
can only be upcoming (start ≤ due is a database constraint), so review and referral tasks
appear on Today only once they start.

**Messages.** Review and referral tasks render the template stored on the user's automation
rule with the contact's first name, the user's display name and Google review link (set in
Settings). Copy uses the clipboard; "Text it" is an `sms:` link that opens Messages pre-filled.
The CRM sends nothing (ADR-013, spec: no SMS sending).

**Forms.** Forms that post to a server action no longer use React 19's automatic reset (it
silently reverted dropdowns after a validation message); see `useActionForm`.

---

## ADR-022 — Automation engine: database triggers, invoker-only engine schema
**Status:** Accepted — implemented in Phase 6 (approved with the phase, 2026-10-15)

**Decision.** Automation runs in AFTER triggers on opportunities, tasks and activities, so an
event and the tasks it creates or closes commit together (CLAUDE.md: multi-step business
operations are transactional). No scheduler is needed (spec: tasks appear by date). Shared
logic lives in schema `crm_engine`: SECURITY INVOKER only, so RLS (owner + two-step) applies
to every read and write; USAGE/EXECUTE for `authenticated` only (triggers run as the user);
not exposed by the Data API. `crm_private` stays closed to API roles.

**Behaviour.** Rule timing is anchor + offset (calendar or Mon–Fri business days), never
before today, then `completion_window_days` to the due date. Idempotency via `dedupe_key`
(ADR-008): a repeated event updates the open task's dates unless `due_date_overridden`.
Cooldown per contact for review/referral (365 days). Prospecting rules skip won/lost
opportunities. "New lead" fires only when the opportunity starts at its pipeline's first
stage. "Contact made without a quote" fires when the automatic first-contact (or re-engage)
task is completed and no quote date is set. "No response" (outcomes no response / no answer)
asks the owner first by default (`confirm_before_creating`), via
`confirm_no_response_follow_up`.

**Settings.** The owner can turn any rule off and edit title, timing, priority, completion
window, cooldown, checklist items and message text; messages offering an incentive are
refused (ADR-013). Changes apply to new tasks only.

---

## Open questions for the owner (do not block Phase 1 start)

1. US holidays in business-day calculations? (Default: weekends only.)
2. Custom domain later? (Default: free `workers.dev` URL; no purchase.)
3. Error monitoring (e.g. Sentry free tier)? (Default: none in MVP; Cloudflare logs only.)
4. ~~Tasks without a contact (ADR-012)?~~ Answered: no.
5. ~~No deleting from the app (ADR-010)?~~ Answered: acceptable.
6. ~~Referral and Google review automation design~~ — answered, see ADR-013.
7. Confirm with Alfa/compliance whether any referral thank-you of value is permitted (ADR-013).
