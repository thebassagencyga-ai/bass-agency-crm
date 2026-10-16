# Security review — Phase 11 (2026-10-16)

Scope: the whole application as merged through Phase 10 (Next.js app, middleware, server
actions, database migrations, service worker, CI/deploy workflows, dependencies, Git history).
Method: code review against SECURITY.md's threat model, automated suites added in this phase,
mutation checks (deliberately breaking a rule to prove the test notices), and CI on a real
Supabase stack. Ratings: **High** (could expose client data), **Medium** (could mislead or
weaken a control), **Low** (hardening / correctness), **Info** (no action needed in code).

## Findings

| # | Finding | Rating | Status |
|---|---------|--------|--------|
| F-01 | Cross-sell "lost in the last 12 months" compared a loss timestamp with the user's New York date taken at the server's UTC midnight, so for a few hours each evening the window was off by one day. Found when CI ran just after midnight UTC. | Low (correctness) | **Fixed** — migration `20261023120000_review_fixes.sql`; regression test in `tests/db/date-handling.test.ts` (fails without the fix). |
| F-02 | When Supabase Auth was unreachable, sign-in and code entry said "Email or password is incorrect" / "That code didn't work". | Low | **Fixed** — `src/lib/auth/errors.ts` distinguishes outages (status 0/5xx, retryable fetch errors) from rejections; unit tests. Account-existence wording unchanged. |
| F-03 | `INSECURE_COOKIES_FOR_LOCAL_TESTS=1` (used only for the local workerd test run) would have dropped the Secure flag from session cookies if ever set on the real site. | Low | **Fixed** — honoured only when `SITE_URL` is `http://127.0.0.1` or `http://localhost`; unit tests. |
| F-04 | No app-wide "page not found" or root error page (Next.js defaults shown for unknown URLs and root-layout failures). | Low | **Fixed** — `src/app/not-found.tsx`, `src/app/global-error.tsx` (no error details shown, reference only); browser test checks 404s, including someone else's record id (same answer as a missing one). |
| F-05 | `npm audit`: `glob` 10.3.3 (command injection in its CLI, GHSA-5j98-mcp5-4vw2) inside `@opennextjs` build tooling. | High (per npm) → Low in context | **Fixed** — `overrides` pins `glob` 10.5.0. |
| F-06 | `npm audit`: `braces` ≤ 3.0.3 (stack exhaustion on deeply nested patterns, GHSA-vfj7-8cjw-p6xm) via `eslint-config-next` → `fast-glob` → `micromatch`. No patched version is published. | High (per npm) → **Low accepted** | Dev-only lint tool, run on our own code and config; never shipped to users or the Worker; no untrusted input. CI now fails on any high/critical finding in **production** dependencies (`npm audit --omit=dev`): currently 0. Re-check when `braces` publishes a fix. |
| F-07 | No secret scanning of Git history in CI. | Medium (process) | **Fixed** — `scripts/secret-scan.mjs` scans tracked files and every line ever committed (keys, tokens, private keys, remote database URLs with passwords, tracked `.env` files, SSN-like numbers); runs in CI with full history; mutation-checked with 5 planted problems. Result: clean (79 commits at the time). |
| F-08 | No application-level rate limiting on server actions. | Info | Accepted: sign-in and code entry are rate-limited by Supabase Auth (429 handled with a clear message); all data actions need a full two-step session and touch only the caller's rows through RLS. |
| F-09 | Supabase dashboard settings (sign-ups off, MFA, 7-day idle session, leaked-password protection, backup retention) are configuration, not code. | Info | Re-verify on the production project in Phase 12 (checklist in ROADMAP). |
| F-10 | Audit log grows without limit. | Info | Acceptable for one agent; revisit if storage approaches the plan limit. |

## Checks that passed without findings
- Every server action re-checks the full two-step session on the server, validates input with
  zod, and writes through the user's own Supabase client (RLS applies). The only actions
  without a session check are the sign-in steps, by design.
- No secret/service key in application code or the browser bundle; no `dangerouslySetInnerHTML`;
  no logging of request data; internal error text is never shown to users.
- Open redirects: `next`/`back` parameters go through `safeNextPath`; email-link redirects are
  built from `SITE_URL`, never the Host header; only known link types are accepted.
- Security headers and a nonce-based CSP on every response; service worker and manifest
  limited to this origin; service worker stores no pages or data (Phase 10).
- Database: RLS and the restrictive two-step policy on every table; no anon privileges; no
  DELETE/TRUNCATE for app users; every Data API and engine function runs as the caller with a
  pinned search_path — all now enforced by the catalog-driven `tests/db/rls-regression.test.ts`
  (5 deliberate holes injected, all caught).
- Backup: a full dump restored into a fresh local database keeps every row, every policy,
  function, trigger and grant, still blocks other accounts and password-only sessions, and
  still runs the automation (`tests/db/backup-restore.test.ts`; restoring without grants is
  caught).

## Before real client data (Phase 12)
1. Confirm Supabase Auth settings on production (F-09) and enable leaked-password protection.
2. Confirm daily backups and retention in the Supabase dashboard; perform one restore of a
   production backup into a non-production database following the documented procedure.
3. Owner sign-off on this review.
