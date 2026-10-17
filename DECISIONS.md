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
**Resolved (owner, 2026-10-16):** the owner confirmed they know the applicable referral
policies; nothing changes in the CRM (it still never suggests or tracks rewards).

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

## ADR-023 — Renewals: policies are won opportunities; outcomes roll the date; cross-sell rules are data
**Status:** Accepted — implemented in Phase 8 (approved with the phase, 2026-10-15)

**Owner decisions (2026-10-15).** Renewed → renewal date rolls forward by the policy term
(auto 6 or 12 months, other lines 12). Re-marketed = client kept with changed terms; recorded
like renewed. Lost → recorded with a reason; the policy leaves renewals; the contact becomes a
former client if no other active policy. A dismissed cross-sell prompt stays hidden 12 months.

**Decision.** No separate policy table: a won opportunity is the policy, with
`policy_term_months` and `policy_ended_on`. Outcomes are an append-only table written by one
SECURITY INVOKER function (`record_renewal_outcome`) so the outcome, task completion, date
roll and status change commit together. The roll-forward is a normal renewal-date change, so
the Phase 6 trigger creates the next review; its key now names the half year for 6-month
policies (two renewals in one calendar year) and is unchanged for yearly ones, so existing
tasks still match. Prospects' renewal dates (open/nurture opportunities) are listed for quote
timing but have no outcome.

**Cross-sell.** Rules are rows (`cross_sell_rules`: holds any of these lines, lacks that
one, optional contact type, reason) evaluated on read by `cross_sell_prompts` from recorded
opportunities only — no inference, no outside data. A line being worked (open/nurture
opportunity) or lost within 365 days is not suggested. Dismissals are rows with
`hidden_until`. Prompts are shown, never acted on automatically (no tasks are created).

**Known limits.** An outcome cannot be undone from the app (append-only; ask before adding
an "undo"). Changing an auto policy between 6 and 12 months mid-year can leave the old
period's open review task in place (the next one gets the new key).

## ADR-024 — Reports: one invoker function per page load; definitions on the page
**Status:** Accepted — implemented in Phase 9 (approved with the phase, 2026-10-15)

**Decision.** `report_summary(start, end, today)` returns every report as one JSON object
(one round trip on a phone), SECURITY INVOKER so RLS (owner + two-step) limits every figure.
Period bounds are calendar dates; instants are converted to the user's time-zone date first
(ADR-007). Periods offered: this month, last month, this quarter, year to date, last 12
months (a current period ends today); at most two years.

**Definitions chosen (owner may change them; each is written on the page and tested).**
New leads = contacts added in the period, by lead source (case and spaces ignored).
Conversion = won ÷ (won + lost) among opportunities closed in the period (latest close if
reopened); open excluded; denominator shown. Quotes = opportunities with a quote date in the
period and where they stand now. Tasks on time = completed on or before the due date.
Requests made = clients asked (completed request task or logged request activity), each
client once. Referrals received = contacts added with a referrer. Premiums are totals of
recorded estimates, with how many had one; no commission figures exist.

**Also.** Cross-sell matching moved to `crm_engine.cross_sell_matches` (no row limit),
shared by the prompt list and the report so their counts cannot disagree.

## ADR-025 — Installable web app; static-only service worker; Lighthouse in CI
**Status:** Accepted — implemented in Phase 10 (approved with the phase, 2026-10-15)

**Decision.** A static web app manifest (`public/manifest.webmanifest`, start URL
`/dashboard`, standalone) plus iPhone tags (apple-touch-icon, `apple-mobile-web-app-*`) make
the app installable from Safari's Share → Add to Home Screen. Icons are PNGs rendered from one
SVG design by `scripts/generate-icons.mts` (committed output).

The service worker (`public/sw.js`, registered in production only) caches **only** hashed
build files under `/_next/static/`, the icons and `public/offline.html`. Page navigations are
network-only and fall back to the offline notice when the network fails; server actions,
React Server Component data, prefetches, other origins and every other request are not
touched. So no client record, page or API response is ever stored on the device, and
signing out leaves nothing personal behind. CSP gains `worker-src 'self'` (needed because
`'strict-dynamic'` makes `script-src` ignore `'self'`) and `manifest-src 'self'`. The
middleware skips `sw.js`, `offline.html` and the manifest so they load before sign-in.

**Checks.** Browser tests audit key pages at 375 / 390 / 430 px for sideways scroll and
44 × 44 px tap targets (links inside a sentence exempt, as WCAG 2.5.8 allows), and Lighthouse
(dev dependency, runs locally in CI, no external service) requires an accessibility score ≥ 90
on every key page, signed in.

## ADR-026 — Production on the free workers.dev address; signed-out smoke test; restore drill
**Status:** Accepted — implemented in Phase 12 (approved with the phase, 2026-10-16)

**Owner decisions (2026-10-16).** Keep `https://bass-agency-crm.<subdomain>.workers.dev`
(no domain purchase); stay on Cloudflare Workers **Free**; smoke-test production signed out
(no stored test login) with the owner checking signed-in behaviour on the iPhone; run the
backup restore drill now, while production data is fictional.

**Decision.** The preview deployment (ADR-017) becomes production: same Worker, same project;
the workflow is renamed **Deploy app (Cloudflare)** and its smoke test moved into
`scripts/smoke-test.sh` (also run in CI against the Cloudflare build on every push, and as the
manual **Smoke test production** workflow). The Worker gets no secrets — only the database
address, the publishable key and the site address — so there is nothing secret to configure in
Cloudflare; all secrets stay in GitHub's encrypted secrets.

**Restore drill.** `.github/workflows/restore-drill.yml` (manual, main only): counts rows on
production (Management API, counts only), dumps schema `public` data with `supabase db dump`
(read-only), aborts if counts changed meanwhile, builds a local Supabase database from the
migrations in Git, loads the data with triggers paused, then `scripts/restore-drill.mts`
requires every table's count to match and the deploy verification to pass. Files are
deleted; nothing is uploaded. Auth accounts are not copied (restored by Supabase's own backup
restore in a real disaster). Rehearsed locally end to end (12 tables, 425 fixture rows) and
mutation-checked (a missing row fails).

**Terms re-checked (2026-10-16, Cloudflare docs; Supabase pricing via search).** Workers Free:
100,000 requests/day, 10 ms CPU per request, no request charge. Supabase Pro: $25/month per
organization with $10 compute credit (one Micro instance); daily backups, 7-day retention;
spend cap on by default. Added cost ≈ $10/month (second project's Micro compute) — owner to
confirm on the Billing page.

**Update (2026-10-16).** The CRM project turned out to be on Supabase Free; backups and the drill
were reworked in ADR-027 (the drill now restores the latest nightly backup).

**Clean start.** `scripts/sql/reset-test-data.sql` lets the owner remove their fictional test
records before go-live (one transaction; refuses if any contact looks real). The app still
never deletes.

## ADR-027 — Supabase Free plan: nightly encrypted backups in GitHub Actions

**Status:** Accepted — built and approved by the owner 2026-10-16

**Context.** At go-live the owner found the CRM's Supabase project is on the **Free** plan, not in
the Pro organization ADR-002 assumed. Free has no backups, pauses a project after 7 days of low
activity, and lacks leaked-password protection and the inactivity sign-out (ADR-016 setting).
Owner decision (2026-10-16): stay on Free; build backups ($0).

**Decision.**
- **Nightly backup** (`.github/workflows/backup.yml`, 08:23 UTC daily + on demand): the CRM data
  (schema `public`, `supabase db dump --data-only`, read-only), row counts and the list of
  sign-ins (**id + email only** — no password hashes or authenticator secrets) are packed and
  encrypted with AES-256 (`gpg --symmetric`, passphrase in the `BACKUP_PASSPHRASE` secret and the
  owner's password manager), checked to decrypt, and kept as a GitHub Actions artifact for
  **30 days** (private repo; a few KB per night, inside the free storage). Nothing unencrypted is
  kept; logs show counts only. GitHub emails the owner when a scheduled run fails.
- **Restore** (`restore-backup.yml`, manual, typed confirmation): only into a project with the
  current CRM schema, **no client records**, and the **same sign-ins** (by email) re-created by
  hand. The copy's sign-in ids are replaced with the new ones; the CRM tables are emptied and
  refilled in **one transaction** with triggers paused; then counts, owners (no orphan rows) and
  the deploy verification are checked. It cannot overwrite live work.
- **Drill** (`restore-drill.yml`, monthly): the same restore path into a throwaway Supabase
  database on the runner, from the latest backup; it no longer reads production.
- After a restore the owner sets up the authenticator again (factors are not copied).

**Tests.** Unit (`tests/unit/backup.test.ts`: manifest, sign-in matching, target checks, id
remapping). Database (`tests/db/backup-tool.test.ts`): copy from one snapshot → encrypt → decrypt
→ fresh database with new sign-in ids → prepare → load → check; owners remapped, RLS and two-step
still enforced, wrong passphrase / short passphrase / target with client records / non-local
database refused. The production restore's own connection step (pooler address from
`supabase link`) is not exercised until a real restore or a rehearsal on a scratch project.

**Accepted on Free (owner).** No leaked-password protection (mitigation: a unique
password-manager password + required authenticator); no inactivity sign-out (a signed-in phone stays signed in until
Sign out; mitigation: the phone's own passcode/Face ID; if the phone is lost, block the account in
Supabase — runbook §5); an app-level idle sign-out could be added later; possible pausing after 7 quiet days (data kept; Supabase emails first;
restore from the dashboard). Upgrading to Pro ($25/month) later removes these; the backups can
then stay as an extra copy or be switched off.

**Alternatives.** Supabase Pro ($25/month — over the < $25 guardrail; declined for now); no
backups (rejected: a mistake or outage could lose everything); storing dumps elsewhere (another
service and account to secure).

## ADR-028 — Intake form: public link, review inbox, quick intake

**Status:** Accepted — built in Phase 13, approved by the owner 2026-10-16

**Owner decisions (2026-10-16).** Both a public link for prospects and a quick in-app intake;
public submissions go to a review inbox first; fields: contact details, lines wanted, current
carrier + renewal month per line, how they heard about the agency / who referred them.

**Decision.**
- **Public page** `/quote/<token>` (no sign-in, `noindex`). The token is 32 hex characters
  from a random UUID (122 random bits), one enabled link per agent; **Turn off** and **New
  link** (the old link stops at once) in Settings, with a copyable URL and a QR code drawn
  server-side as plain SVG.
- **The only anonymous capability** is `public.submit_intake(token, form, consent)`:
  SECURITY DEFINER (anon has no table privileges at all), `search_path` pinned, executable by
  `anon` only. It accepts an enabled link only, requires consent, re-validates every field
  (`crm_engine.intake_clean`: names, phone or email, ZIP, contact method, 1–4 known lines,
  coverage per chosen line, length limits, 6 KB form cap), limits each link to **10 per hour
  and 50 per day**, inserts one row into the inbox and returns nothing. It cannot read
  anything. Anyone can call it directly with the publishable key, so the database checks are
  the security boundary; the form's checks and a hidden bot-trap field are for usability and
  cheap spam only.
- **Inbox** (`intake_submissions`, owner + two-step RLS; no INSERT grant for users; not
  audited, because the audit log would keep erased details). **Accept** (`accept_intake`,
  invoker, one transaction): creates the contact — or fills only the empty details of a chosen
  existing contact — with the agent-picked referrer, a *New lead* opportunity per line with
  `current_carrier` / `current_policy_renews_on`, and a *Quote <line> before the current policy
  renews* task due 30 days before that month (never in the past); the existing automation adds
  *Make initial contact*. **Discard** (`discard_intake`). Either way the personal details are
  **erased** from the inbox row (DB check); only status, dates, consent time/version and the
  contact link remain.
- **Quick intake** (`quick_intake`, invoker): the same questions and rules for the agent, with
  a duplicate check (add to the existing contact or create a new one).
- **Consent** text v1 shown on the form; time and version stored per submission and noted on
  the contact when accepted.
- Public server action: the page posts to `/quote/…` (a public path in the middleware). Server
  actions are global in Next.js, but every other action re-checks the two-step session on the
  server (`requireFullSession`), so a public path cannot reach them.
- Deploy verification and the catalog tests allow **exactly** this one anonymous function
  (definer, pinned path, anon-only); any other anonymous or definer function still fails.
- Dependency: `qrcode` (core encoder only; no PNG or file code is imported).

**Alternatives.** Straight into the pipeline (rejected by the owner: spam and duplicates in
real data); Cloudflare Turnstile (free, but adds a secret to the Worker and a third-party
script; can be added later if spam gets through); service-role key in the Worker (rejected:
a secret in the Worker and a far wider privilege than one narrow function).

## ADR-029 — Intake details: address, vehicles, household (no DOB, license or VIN)

**Status:** Accepted — built in Phase 14, approved by the owner 2026-10-16

**Owner decisions (2026-10-16).** Add the street address, vehicles (year, make, model) and
other drivers / household members (names and relationship). Not collected: dates of birth
(recommended against and not chosen), driver's license numbers (forbidden, CLAUDE.md), VINs.

**Decision.**
- Address: street, city, state (pre-filled GA), ZIP on the public form and quick intake, into
  the contact's existing address fields. Into an existing contact the address is taken only
  when that contact has no street address, and then as a whole (no mixing of two addresses).
- `household_members` (first name required, last name, relationship: spouse / child / parent /
  other; up to 6 on the form) and `vehicles` (year 1900 … this year + 2, make required,
  model; up to 4, only with an auto quote) belong to the **contact**. Owner-only RLS with the
  two-step requirement, audited, archived instead of deleted; the contact page lists them with
  add, edit and remove.
- The intake submission carries them as validated JSON (size-capped) and erases them on review
  with everything else. `crm_engine.intake_clean` keeps only the known keys of each row, so
  anything else sent (e.g. a date of birth or VIN) is dropped, never stored.
- The catalog test that blocks columns named like birth/dob/license/… still applies to the
  new tables.

**Alternatives.** Dates of birth (rejected: name + address + DOB from a public page is an
identity-theft risk, and the CRM is not a quoting engine); details on the opportunity instead
of the contact (rejected: people and vehicles outlive any one quote).

## ADR-030 — Scope update: device mail/text, AI workers, next phases

**Status:** Accepted (owner, 2026-10-16)

**Context.** The owner considers the original MVP rules a starting point.

**Decision.**
- Email/text: open the device's Mail / Messages app with a pre-filled message; the CRM sends
  nothing itself.
- AI workers (Phase 19): draft messages; notes → activity; daily briefing; import clean-up.
  Human approval before anything is saved or sent. Anthropic API, server-side; $10/month cap
  (AI pauses when reached); minimum data; the Worker will hold its first secret (API key) —
  to be designed and reviewed in Phase 19.
- Next phases in order: 15 import/export, 16 inactivity sign-out + mail/text, 17 tags + merge,
  18 calendar feed, 19 AI workers.
- Unchanged: dates of birth and license numbers excluded (tabled); no Alfa integrations; no
  policy document uploads; cost under $25/month.

## ADR-031 — Import a book of business (CSV) and download data

**Status:** Accepted — built in Phase 15, approved by the owner 2026-10-16

**Decision.**
- **Import** (`/import`, also from Contacts and Settings): the CSV is read in the browser (max
  2 MB / 5,000 rows / 1,000 clients); columns are matched to CRM fields by guessing common
  report headings (editable); every distinct policy type is mapped to a line or "skip". The
  check shows clients, policies, rows left out with reasons, and contacts already in the CRM
  (same email or phone) — ticked by default to add the policies to the existing contact, which
  is not changed. Nothing is kept of the file itself.
- `public.import_book` (invoker, one transaction) creates contacts and **won** opportunities
  (policies: carrier, premium, effective/renewal dates, term) tagged with `import_batch_id`.
  Renewal dates already passed are moved forward by the term; renewal reviews the automation
  would make overdue are due today. Imported history is excluded from the new-lead, conversion
  and referral reports.
- **Undo** (7 days, all or nothing, only while nothing from the import was changed or used):
  the user sets the batch to "undone"; a private trigger (`crm_private.undo_import`, like the
  audit trigger) deletes the batch's records. Users still have no DELETE privilege. Deletions
  are audited.
- **Download my data** (Settings): CSV per dataset (contacts, opportunities/policies, tasks,
  activities, household, vehicles), the user's rows only, UTF-8 with BOM for Excel; text that a
  spreadsheet would run as a formula is prefixed with `'` (CSV-injection guard).

**Alternatives.** Server-side file upload and parsing (rejected: the file would pass through
and possibly persist on the server; browser parsing keeps it local); a staging table for the
preview (unnecessary: the preview is computed in the browser and re-checked on the server).

---

## ADR-032 — Inactivity sign-out, code every 12 hours, and text/email via the phone's apps

**Status:** Proposed — built in Phase 16, awaiting owner review

**Context.** Supabase's own inactivity timeout and session time-box are Pro features; the CRM
project stays on Free (ADR-027). The owner asked for an app-level sign-out after 7 days unused
and for email/text to open the device's own apps (ADR-030).

**Decision.**
- **7 days unused → signed out.** The middleware keeps an HttpOnly, Secure, SameSite=Lax cookie
  `crm_seen` (Unix time of the last visit, renewed at most once an hour). A signed-in request with
  the cookie missing, malformed, more than 7 days old or more than 5 minutes in the future ends
  the session (`signOut({ scope: "local" })`, which also revokes that session's refresh token at
  Supabase) and sends the user to `/login?expired=1` with an explanation. The cookie is set on
  sign-in (password, code, set-up, email link) and removed on sign out.
- **Code again every 12 hours.** The latest `totp` entry in the verified token's `amr` claim
  must be at most 12 hours old; otherwise the app treats the session as password-only and sends
  the user to `/mfa?again=1` (same rule in the middleware and in `requireFullSession`). Entering
  the code refreshes `amr`.
- **Text / email.** A composer on the contact page (opened from opportunities, renewals, tasks
  and with a reply on intake review) offers ready-made messages (check-in, quote follow-up,
  renewal, current-policy renewing, thank you, quote request received, blank), editable, and
  builds `sms:` / `mailto:` / `tel:` links. The user presses send in Messages or Mail. Nothing
  typed is saved; after opening an app, "Log this text/email" opens the activity form pre-filled
  (type, opportunity, a one-line note naming the template — not the message text).
- No database change.

**Limits (accepted).** The 7-day and 12-hour rules are enforced by the app, not the database:
the Data API still accepts a valid aal2 token until it expires (1 hour) and RLS still sees aal2
after 12 hours. Someone holding a copy of all the session cookies could keep them fresh by
visiting within 7 days — the same exposure as before; "Sign out" and the lost-phone steps
(runbook §5) still apply. After the first deploy, existing sessions have no `crm_seen` cookie and
are signed out once.

**Alternatives.** Supabase Pro inactivity timeout (rejected by the owner: cost); a `last_seen`
column in the database (rejected: a write on every visit and no stronger guarantee than the
cookie plus refresh-token revocation); sending email/SMS from the server (out of scope, ADR-030).

---

## Open questions for the owner (do not block Phase 1 start)

- **Tabled (owner, 2026-10-16): collecting dates of birth and driver's license numbers on the
  intake form.** Possible design if revisited: encrypted in the prospect's browser with the
  agent's public key, revealed only on the agent's device with a separate vault passphrase,
  every reveal logged, auto-erased ~30 days after acceptance. Prerequisites: owner changes the
  CLAUDE.md data rule in writing; Alfa/compliance confirms storage outside Alfa systems is
  allowed; GLBA / Georgia breach-law obligations reviewed. Until then: not collected.

1. US holidays in business-day calculations? (Default: weekends only.)
2. Custom domain later? (Default: free `workers.dev` URL; no purchase.)
3. Error monitoring (e.g. Sentry free tier)? (Default: none in MVP; Cloudflare logs only.)
4. ~~Tasks without a contact (ADR-012)?~~ Answered: no.
5. ~~No deleting from the app (ADR-010)?~~ Answered: acceptable.
6. ~~Referral and Google review automation design~~ — answered, see ADR-013.
7. Confirm with Alfa/compliance whether any referral thank-you of value is permitted (ADR-013).
