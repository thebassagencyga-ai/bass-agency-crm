# Maintenance runbook — The Bass Agency CRM

Plain-language steps for running the CRM after go-live. Everything here is done from a web
browser: GitHub (code and the buttons that deploy), Cloudflare (where the app runs) and
Supabase (the database and sign-in). Nothing needs to be installed.

## 1. Where things live

| What | Where | Who can change it |
|---|---|---|
| Code, history, deploy buttons | GitHub → `thebassagencyga-ai/bass-agency-crm` → **Actions** | Owner |
| The running app | Cloudflare → Workers & Pages → `bass-agency-crm` (`https://bass-agency-crm.<subdomain>.workers.dev`) | Owner |
| Data, sign-in | Supabase → the **CRM** project (never ProducerIQ's), Free plan | Owner |
| Backups (encrypted, 30 days) | GitHub → Actions → **Nightly backup** → a run → *Artifacts* | Owner |
| Secrets | GitHub → Settings → Secrets and variables → Actions; copies in your password manager | Owner |

The Worker itself holds **no secrets**: only the database address, the publishable key
(designed to be public; row level security protects the data) and the site address.

## 2. Shipping a change (each phase or fix)
1. The change is merged to `main` (after its review). CI must be green.
2. If it includes a database change: Actions → **Deploy database migrations** → Run workflow
   with *Apply* **unticked** (dry run). Check it lists only the expected file. Run again with
   *Apply* ticked. The run ends with "✓ Verification passed".
3. Actions → **Deploy app (Cloudflare)** → Run workflow (branch `main`). The run ends with
   "✓ Smoke test passed".
4. Open the app on the iPhone and check the changed screen.

Rollback: Cloudflare → Workers & Pages → `bass-agency-crm` → **Deployments** → pick the
previous version → *Rollback*. Database changes are never rolled back by hand; a fix is a new
migration.

## 3. Regular checks
| How often | Check |
|---|---|
| Weekly (1 min) | GitHub → Actions → **Nightly backup**: last night's run is green (a failed run also emails you). |
| Monthly | Actions → **Backup restore drill** → Run: ends "✓ Restore check passed". |
| Monthly | Actions → **Smoke test production** → Run. GitHub → Security → Dependabot/alerts if enabled; ask for a dependency update if anything is high. |
| Monthly | Supabase → **Usage** and **Billing**: within plan, spend cap on. Cloudflare → Workers → `bass-agency-crm` → Metrics: no errors, requests far below 100,000/day. |
| Before risky migrations | Actions → **Nightly backup** → Run workflow (a fresh backup first). |

## 4. Backups and restoring data (disaster recovery)
The CRM's Supabase project is on the **Free** plan, which keeps no backups, so GitHub does
(ADR-027): **Nightly backup** runs every night (about 4 am), copies the CRM data and the list of
sign-ins (emails only — no passwords), **encrypts** it with your backup passphrase, and keeps
each night's copy for **30 days** under that run's *Artifacts*. Without the passphrase nobody
can read a backup — keep it in your password manager; if it is lost, the backups are useless.

**If data is lost or the project is gone:**
1. Use the existing project if it still works and only the data is wrong; otherwise create a new
   Supabase project and update the GitHub secrets `SUPABASE_PROJECT_REF` and
   `SUPABASE_DB_PASSWORD` (and, for a new project, `CRM_SUPABASE_PUBLISHABLE_KEY`, then the
   auth settings of checklist section A).
2. The restore only goes into a project **without client records**. In the old project, the
   bad records must be removed first — ask the developer; never delete in Supabase by hand.
3. Supabase → Authentication → Users: make sure exactly the same sign-ins exist (same emails).
   Add any that are missing (Add user → Auto Confirm).
4. Actions → **Deploy database migrations** with *Apply* ticked.
5. Actions → **Restore backup (into an empty CRM project)** → type `RESTORE`; leave the run ID
   empty for last night's backup, or paste the ID from an older Nightly backup run's address
   (`…/actions/runs/<ID>`). It ends "✓ Restore check passed".
6. For a new project: Actions → **Deploy app (Cloudflare)**. Then sign in on the iPhone (you
   will set up the authenticator again) and spot-check a few records.

Everything entered after the backup you restore is lost. A **Backup restore drill** proves the
latest backup restores, on a throwaway database (production is not touched); run it monthly.

## 4a. Intake form (quote requests)
- **Your link:** Settings → *Intake form*: copy the link, or screenshot the QR code for cards,
  the office or a website. Requests appear in **Intake** (and as a badge on the dashboard).
- **Review:** open a request → *Accept and add to CRM* (pick an existing contact if it is the
  same person, and the referrer if they named one) or *Discard*. Either way the request's
  details are erased from the inbox afterwards.
- **Spam:** discard it. If it keeps coming, Settings → *New link* (the old link stops at once)
  and share the new one; or *Turn off* the form for a while. Each link takes at most 10
  requests an hour and 50 a day.
- **On a call:** Intake → *Quick intake* creates the contact and leads directly.
- **Household and vehicles** (names/relationship; year/make/model) arrive with the request and
  are kept on the contact page, where you can edit or remove them. Never add dates of birth,
  license numbers or VINs; those stay in your quoting system.

## 4c. Calendar
- **Set up:** Settings → *Calendar* → *Create calendar link* → *Add to iPhone Calendar* (or copy
  the link into Google Calendar: Other calendars → + → From URL). The link is shown only once.
- **Lost the link / new phone / link may have leaked:** *Replace link* (the old one stops at once),
  remove the old "CRM tasks" calendar from the phone, subscribe again.
- **Stop:** *Turn off*. Tasks disappear from the calendar at its next refresh.

## 4b. Importing and downloading
- **Import:** run your client/policy report in Alfa's system, save it as CSV, then Contacts →
  *Import*. Check the column matches, choose a line for any policy type it doesn't recognise
  (or Skip), press *Check the file*, review the problems and matches, then *Import*. Imported
  policies show in Renewals; they are not counted as new business in Reports.
- **Undo:** Import → *Recent imports* → *Undo* (7 days; refused if you've changed anything
  from that import — then fix records by hand).
- **Download:** Settings → *Your data*. The files contain client details: keep them private
  and delete them when done.

## 5. Access problems
- **Lost phone / authenticator:** Supabase → Authentication → Users → your user → remove the
  MFA factor. Sign in with your password; the app asks you to set up a new authenticator.
  A signed-in phone is signed out after 7 days without use and asks for the code again every
  12 hours (ADR-032) — but if the phone is lost or stolen also change your password and, if Supabase offers it on the user's page,
  **ban** the user for a day (blocks the lost phone's session from renewing within the hour),
  then lift the ban once the new phone is set up.
- **"You were signed out because the CRM wasn't used for 7 days":** expected; sign in again.
  Right after the Phase 16 deploy every device is signed out once (the new "last visit" cookie
  does not exist yet).
- **"The CRM asks for your code again every 12 hours":** expected; enter the code from the app.
- **Forgot password:** "Forgot password?" on the sign-in page (email link, valid 1 hour).
- **Too many attempts:** wait a few minutes (Supabase rate limit), then try again.
- Keep two-step sign-in and recovery codes on your **GitHub, Cloudflare and Supabase**
  accounts, stored offline. Losing those accounts is the main lock-out risk.

## 6. Rotating secrets (yearly, or at once if one may have leaked)
| Secret | Make a new one | Then |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers" template | Update the GitHub secret; delete the old token. |
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens | Update the GitHub secret; revoke the old one. |
| `SUPABASE_DB_PASSWORD` | Supabase → Project Settings → Database → Reset password | Update the GitHub secret. |
| `BACKUP_PASSPHRASE` | A new 30+ character password from your password manager | Update the GitHub secret, keep the **old** one too until its backups expire (30 days) — older backups only open with it. |
| `CRM_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → new publishable key | Update the GitHub secret, run **Deploy app**, then disable the old key. |

Never paste secrets into chat, email or the code. Never use the secret (service-role) key in
the app.

## 7. Adding another agent later
Supabase → Authentication → Users → Add user (Auto Confirm). They sign in, set up their own
authenticator, and get their own default rules. Every record is private to its owner by the
database's rules; agents never see each other's contacts. (Shared/team views would be a new
feature.)

## 8. Keeping software up to date
- Ask for a dependency update roughly monthly or when GitHub flags one. CI runs every test.
- **Next.js and the Cloudflare adapter** are pinned on purpose: upgrade them only together
  with a check that pages load on the Cloudflare build (Next 16.4.0 once built fine but broke
  at runtime). See CLAUDE.md.
- Known accepted finding: `braces` in the lint tooling (docs/security-review.md F-06).

## 9. When something is wrong
| Symptom | Likely cause | What to do |
|---|---|---|
| Page shows "Sign-in is unavailable right now" | Supabase outage | Check status.supabase.com; wait. |
| Cloudflare error **1102** | A page exceeded the free plan's 10 ms CPU limit | Tell the developer; the fix may be Workers Paid ($5/month) — needs your approval. |
| "Something went wrong" page | App or database error | Retry; check Cloudflare → Workers → Logs (Observability) for the time; tell the developer with the time and the reference shown. |
| Data looks wrong after a change | Bug | Don't edit data in Supabase directly; tell the developer. If needed, restore (section 4). |
| "Sign-in is unavailable" after a quiet week or more | Supabase Free paused the project (it emails you first) | Supabase → the CRM project → **Restore project**; data is kept. Wait a few minutes. |
| Phone shows "You're offline" | No signal | Nothing is stored on the phone; reconnect and tap Try again. |

## 10. Costs (re-checked 2026-10-16; Supabase Free)
| Item | Monthly |
|---|---|
| Supabase Free plan (CRM project) | $0 |
| Backups in GitHub Actions (a few KB per night, 30 days) | $0 |
| Cloudflare Workers Free (100,000 requests/day, 10 ms CPU per request) | $0 |
| GitHub private repo + Actions (free minutes) | $0 |
| Address `*.workers.dev` | $0 |
| **Added total** | **$0** (guardrail: under $25). Supabase Pro ($25/month) would add daily backups, no pausing, leaked-password protection and inactivity sign-out — needs your approval. |

No purchase, plan change or paid add-on without the owner's explicit approval.

## 11. What must never go into the CRM
SSNs, payment cards or bank details, driver's license numbers, medical or underwriting
answers, detailed health information, policy documents. Notes are for relationship
management only.
