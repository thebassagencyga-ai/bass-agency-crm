# Go-live checklist — owner sign-off before real client data

Real client data may be entered only after **every box is ticked by the owner** and the owner
has written "I approve entering real client data" in the project conversation (recorded in
PROGRESS.md with the date). Until then: fictional data only.

## A. Supabase (CRM project only — never ProducerIQ's)
- [ ] Authentication → Sign In / Providers: "Allow new users to sign up" **OFF**; Email **ON**;
      minimum password length **12**, lowercase + uppercase + digits; Secure password change **ON**.
- [ ] Authentication → Multi-Factor: TOTP **enabled**.
- [ ] Authentication → Sessions: inactivity timeout **7 days** (168 hours).
- [ ] Authentication → (Attack protection / Passwords): **leaked password protection ON**
      (Pro feature; refuses passwords known from breaches).
- [ ] Authentication → URL Configuration: Site URL = the app address
      (`https://bass-agency-crm.<subdomain>.workers.dev`); Redirect URLs include `<address>/**`.
- [ ] Authentication → Emails → Reset password template links to
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`.
- [ ] Authentication → Users: only your own account (no leftover test users with access).
- [ ] Database → **Backups**: daily backups listed; retention **7 days**.
- [ ] Billing: spend cap **on**; the CRM project's compute cost is as expected (≈ $10/month).

## B. GitHub Actions (each must end green)
- [ ] **Deploy database migrations** (apply) — "✓ Verification passed" (12 tables, 13 functions).
- [ ] **Deploy app (Cloudflare)** — "✓ Smoke test passed".
- [ ] **Backup restore drill** — "✓ Restore drill passed" (run while nobody uses the app).
- [ ] **Smoke test production** — "✓ Smoke test passed".

## C. On the iPhone
- [ ] Sign in with password + authenticator code; the dashboard opens.
- [ ] Add to Home Screen; it opens full screen on the dashboard.
- [ ] Airplane Mode → "You're offline" notice; back online → Try again works.
- [ ] Sign out; opening a page asks you to sign in again.

## D. Clean start (optional, recommended)
- [ ] Remove the fictional test records so reports start at zero: Supabase → **SQL Editor** →
      paste `scripts/sql/reset-test-data.sql`, type your sign-in email where shown, **Run**.
      It removes only your test contacts, opportunities, tasks, activities and renewal
      records (keeps your sign-in, settings and rules), and it **stops without deleting
      anything** if any contact has a real-looking email or phone. Do this only before real
      data is entered.

## E. Accounts and recovery
- [ ] Two-step sign-in on your GitHub, Cloudflare and Supabase accounts; recovery codes
      stored offline.
- [ ] Password manager holds: CRM sign-in, Supabase DB password, Cloudflare and Supabase
      token notes (not in email or chat).
- [ ] You have read `docs/runbook.md` (shipping changes, backups, restore, lost phone).

## F. Review
- [ ] Read `docs/security-review.md`; accept the accepted risks (F-06 dev-only `braces`,
      F-08 no app-level rate limit beyond Supabase's, F-10 audit log growth, F-11 streamed
      not-found status).
- [ ] Confirm with Alfa/compliance any open question about referral thank-yous (ADR-013).
- [ ] Written approval: "I approve entering real client data."
