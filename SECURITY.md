# Security — The Bass Agency CRM

Status: **Phase 2 — authentication implemented; database authorization live in production
(Phase 1 schema).** Items move to "Verified" only with test evidence or a recorded manual
check. The Phase 2 migration and dashboard settings are applied only after owner approval.

## 1. Assets
- Contact records (names, phones, emails, addresses, business details) of prospects and clients.
- Opportunity data (product lines, quote dates, estimated premiums, renewal dates).
- Notes, activities, tasks, audit log.
- Credentials: Supabase project keys, database password, hosting tokens, owner login.

## 2. Threat model (summary)
| Threat | Example | Primary control |
|--------|---------|-----------------|
| Unauthenticated access | Direct API calls with the publishable key | RLS denies `anon`; protected routes |
| Cross-account access / IDOR | Agent B opens `/contacts/<A's id>` | RLS `owner_id = auth.uid()` on every table; tests |
| Privilege escalation | Browser code using a secret key | Secret key server-only; bundle scan in CI |
| Injection | Malicious search string | Parameterized Supabase queries / RPC args; zod validation; no string-built SQL |
| XSS | Script in a note | React escaping; no `dangerouslySetInnerHTML`; CSP |
| CSRF | Cross-site form post | Server Actions origin check; SameSite cookies |
| Credential compromise | Phished owner password | Strong password, MFA (TOTP) recommended (Phase 2 decision), signups disabled |
| Data loss | Accidental delete, bad migration | Archive not delete; Supabase daily backups (Pro); migration review; restore drill |
| Over-collection | SSNs/health info in notes | Data-minimization rules; UI guidance on note fields |
| Offline leakage | Cached records on a lost phone | Service worker never caches API/record responses |
| Supply chain | Compromised npm package | Minimal deps, lockfile, `npm audit`, Dependabot |
| Malicious link in messages | `javascript:` URL saved as review link | `google_review_url` must be `https://` (DB check); `sms:` links built server-side with encoded text |
| Mixing with ProducerIQ | Shared keys or DB | Separate repo, Supabase project, hosting (ADR-001/002) |

## 3. Authentication design (Phase 2, ADR-015 / ADR-016)
- Supabase Auth, email + password; **public sign-up disabled**; users created by the owner in
  the dashboard. A trigger creates each user's profile and default rules.
- **Two-step login is mandatory** (TOTP authenticator app). Enforced by (1) middleware routing,
  (2) server-side checks in protected layouts/pages/actions, and (3) **restrictive RLS policies
  on every table requiring `aal2`** — a password-only session reads and writes nothing.
- Sessions via `@supabase/ssr` cookies set **HttpOnly**, Secure (production), SameSite=Lax;
  refreshed in middleware; auth responses are `no-store`. No browser Supabase client.
- Identity and assurance level come from `getClaims()` (verified JWT signature), never from
  unverified cookie contents. Any auth error is treated as signed out (fail closed).
- Generic sign-in error ("Email or password is incorrect") — no account discovery. Supabase
  Auth rate-limits sign-in and code attempts; the app shows a "too many attempts" message.
- Redirect targets after sign-in are validated (`safeNextPath`): same-site paths only, never
  back into the sign-in screens. Email-link redirects are built from `SITE_URL`, not the Host
  header.
- Sessions end after **7 days of inactivity** (Supabase Pro setting, owner decision).
- **Break-glass recovery:** if the authenticator is lost, the owner removes the factor in the
  Supabase dashboard (Authentication → Users → user → MFA factors), protected by the owner's
  own Supabase login (which should itself use two-step login). Password reset by email
  requires the login address to be a member of the Supabase organization or a custom SMTP
  provider (ADR-016); otherwise reset the password from the dashboard.

## 4. Database authorization
- RLS enabled (and tested) on every table in exposed schemas.
- Policies: `select/insert/update/delete` limited to `owner_id = (select auth.uid())`;
  `with check` on insert/update so ownership cannot be reassigned.
- Lookup tables (product lines, stage definitions) readable by `authenticated`; writable only
  by owner-scoped config rows or migrations.
- `audit_log`: insert by trigger only (`security definer` function with fixed `search_path`);
  no update/delete grants to application roles.
- `anon` role: no table privileges.
- Functions: `security invoker` by default; any `security definer` function must set
  `search_path` and be listed here with justification. Current list (all in the unexposed
  `crm_private` schema, `search_path = ''`, EXECUTE revoked from API roles):
  - `crm_private.write_audit_log()` — trigger; must append to `audit_log`, which users cannot write.
  - `crm_private.create_default_automation_rules()` — trigger on profile insert; inserts the
    new profile's own default rules only.
- Data API functions in `public` (`search_contacts`, `find_possible_duplicates`,
  `contact_lead_sources`) are SECURITY INVOKER, so RLS applies; EXECUTE is revoked from
  `public`/`anon`. The deploy verification fails if any `public` function is SECURITY DEFINER
  or executable by `anon`, or if the function list changes unexpectedly.
- No DELETE privilege for `authenticated` on any table (ADR-010).
- Composite foreign keys including `owner_id` stop a user linking their rows to another
  user's contact, opportunity, task or rule, even though FK checks bypass RLS.
- `owner_id`, `id` and `created_at` cannot be changed after insert (triggers).
- Future multi-agent: a later migration can add team membership policies; `owner_id` stays.

## 5. Secret handling
- `.env*` git-ignored; `.env.example` holds placeholder names only.
- Publishable/anon key may reach the browser (protected by RLS). Secret/service-role key:
  server-only, used solely for reviewed admin tasks (e.g. inviting a user), never per request.
- Production secrets stored in Cloudflare's encrypted secrets and the owner's password manager.
- GitHub repository secrets for the manual migration workflow (ADR-014): CRM project ref,
  database password, and a Supabase access token. The token is account-wide (it could also
  manage ProducerIQ's project): give it an expiry, revoke it when not needed, and never use it
  outside that workflow. The workflow refuses any project containing non-CRM tables.
- Never paste secrets into issues, PRs, chat, or logs.

## 6. Data minimization
Do not store: SSNs, payment cards/bank details, driver's license numbers, medical or
underwriting answers, detailed health information, policy documents. No file uploads in the MVP.

## 7. Backups and restoration (details in README)
- Supabase Pro daily backups (retention per plan — owner to confirm in dashboard).
- Point-in-time recovery is a paid add-on; not enabled without approval.
- Supplemental: owner-initiated `pg_dump` (schema + data) stored encrypted, outside Git.
- Restoration drill required in Phase 11 into a local/non-production database.

## 8. Verification checklist
| Check | Phase | Status |
|-------|-------|--------|
| RLS enabled on every table (catalog test) | 1 | Verified: local PG16, CI PG17.11, Supabase's real image (CI), and the **production** project after deploy (2026-10-14) |
| anon cannot read/write any table | 1–2 | SQL level verified locally; API level in Phase 2 |
| User A cannot read/modify user B's rows (SQL + API) | 1–2 | SQL level verified locally; API level in Phase 2 |
| No DELETE privilege for app users; no cross-owner FK links | 1 | Verified locally |
| SECURITY DEFINER functions pin search_path; private schema not usable by API roles | 1 | Verified locally |
| No forbidden sensitive-data columns (SSN, DOB, card, bank, health…) | 1 | Verified locally (column-name scan) |
| Tests deliberately fail when RLS is broken (mutation check) | 1 | Done manually 2026-10-14: 4 mutations, all caught |
| Protected routes redirect; actions return 401 | 2 | Verified locally in workerd; CI HTTP tests against a real Supabase stack |
| Password-only (aal1) session gets no data (SQL + API) | 2 | Verified: DB tests, CI API tests |
| Public sign-up refused | 2 | Verified in CI against Supabase Auth (local config); hosted setting is an owner step |
| Session cookies HttpOnly; expired session refreshes | 2 | CI HTTP + browser tests |
| No secret key in client bundle | 2 | Verified: `check-client-bundle.mjs` (patterns locally; real key values in CI) |
| Security headers / CSP present, nonce on every script, no CSP violations | 2 | Verified locally in workerd + Chromium; CI HTTP tests |
| Open redirect via `next` blocked | 2 | Unit tests + verified in workerd |
| Input validation on every mutation | 3+ | Contacts (Phase 3): zod on the server + DB constraints; unit and browser tests |
| Search cannot leak other accounts' contacts; IDOR by URL id | 3 | Verified: DB tests (mutation-checked), CI API and browser tests |
| Audit log written and immutable to app roles | 1, 3+ | Verified locally at SQL level (`tests/db/audit.test.ts`) |
| Service worker caches no record data | 10 | Not started |
| `npm audit` / secret scan clean or triaged | 11 | Not started |
| Backup restore rehearsed | 11–12 | Not started |
| Owner security review before real client data | 12 | Not started |

## 9. Known risks (open)
- **Preview on the public internet (ADR-017):** the app is reachable at a workers.dev address
  from Phase 2 onward. Protection: invite-only sign-in, mandatory two-step login, RLS. Rule:
  fictional data only until the Phase 11 review and Phase 12 sign-off.
- Single owner account with no second admin: losing access to the email and Supabase org
  login could lock the owner out. Mitigation: MFA + recovery codes stored offline.
- Business-day math ignores US holidays (ADR-007).
- Hosting adapter verified only locally in workerd, not deployed (ADR-004). Next.js 16.4.0
  breaks the adapter at runtime; Next is pinned to 16.3.8.
- The full test suite uses a stand-in for Supabase's `auth` schema; on Supabase's real image
  only the smaller smoke test runs (RLS on, anon blocked, cross-user isolation). API-level
  tests through the real Data API arrive in Phase 2.
- Dev-only dependency advisories (ADR-011) accepted until Phase 11 review.
- Migrations applied to production 2026-10-14 (ADR-014). The Supabase access token in GitHub
  secrets is account-wide; keep its expiry short and revoke it when not deploying.
