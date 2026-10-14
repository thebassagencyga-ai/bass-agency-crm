# Security — The Bass Agency CRM

Status: **design only (Phase 0).** Nothing below has been implemented or verified yet.
Items move to "Verified" only with test evidence or a recorded manual check.

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
| Mixing with ProducerIQ | Shared keys or DB | Separate repo, Supabase project, hosting (ADR-001/002) |

## 3. Authentication design (Phase 2)
- Supabase Auth, email + password; public signups disabled; users created by invite.
- Sessions via `@supabase/ssr` HTTP-only, Secure, SameSite=Lax cookies; refreshed in middleware.
- Server code authorizes with `supabase.auth.getUser()` (validated with the auth server), never
  trusting an unverified session object for authorization decisions.
- Account recovery via Supabase's password-reset email; owner keeps the Supabase org login
  (with MFA) as the break-glass path.

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
  `search_path` and be listed here with justification.
- Future multi-agent: a later migration can add team membership policies; `owner_id` stays.

## 5. Secret handling
- `.env*` git-ignored; `.env.example` holds placeholder names only.
- Publishable/anon key may reach the browser (protected by RLS). Secret/service-role key:
  server-only, used solely for reviewed admin tasks (e.g. inviting a user), never per request.
- Production secrets stored in Cloudflare's encrypted secrets and the owner's password manager.
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
| RLS enabled on every table (catalog test) | 1 | Not started |
| anon cannot read/write any table | 1–2 | Not started |
| User A cannot read/modify user B's rows (SQL + API) | 1–2 | Not started |
| Protected routes redirect; actions return 401 | 2 | Not started |
| No secret key in client bundle | 2 | Not started |
| Security headers / CSP present | 2 | Not started |
| Input validation on every mutation | 3+ | Not started |
| Audit log written and immutable to app roles | 1, 3+ | Not started |
| Service worker caches no record data | 10 | Not started |
| `npm audit` / secret scan clean or triaged | 11 | Not started |
| Backup restore rehearsed | 11–12 | Not started |
| Owner security review before real client data | 12 | Not started |

## 9. Known risks (open)
- Single owner account with no second admin: losing access to the email and Supabase org
  login could lock the owner out. Mitigation: MFA + recovery codes stored offline.
- Business-day math ignores US holidays (ADR-007).
- Hosting adapter compatibility not yet proven (ADR-004).
