# Maintenance runbook — The Bass Agency CRM

Plain-language steps for running the CRM after go-live. Everything here is done from a web
browser: GitHub (code and the buttons that deploy), Cloudflare (where the app runs) and
Supabase (the database and sign-in). Nothing needs to be installed.

## 1. Where things live

| What | Where | Who can change it |
|---|---|---|
| Code, history, deploy buttons | GitHub → `thebassagencyga-ai/bass-agency-crm` → **Actions** | Owner |
| The running app | Cloudflare → Workers & Pages → `bass-agency-crm` (`https://bass-agency-crm.<subdomain>.workers.dev`) | Owner |
| Data, sign-in, backups | Supabase → the **CRM** project (never ProducerIQ's) | Owner |
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
| Weekly (1 min) | Supabase → Database → **Backups**: today's or yesterday's daily backup is listed. |
| Monthly | Actions → **Smoke test production** → Run. GitHub → Security → Dependabot/alerts if enabled; ask for a dependency update if anything is high. |
| Monthly | Supabase → **Usage** and **Billing**: within plan, spend cap on. Cloudflare → Workers → `bass-agency-crm` → Metrics: no errors, requests far below 100,000/day. |
| Before risky migrations | Supabase → Database → Backups → confirm a recent backup exists. |

## 4. Restoring data (disaster recovery)
Supabase Pro keeps **daily backups for 7 days**.

1. Supabase → CRM project → Database → **Backups** → choose the backup from before the
   problem → **Restore**. This replaces the current database with that day's copy (everything
   since is lost) and the app is unavailable for a few minutes.
2. When Supabase says it is done: Actions → **Deploy database migrations** with *Apply* ticked
   (re-applies any newer migrations and runs the verification).
3. Actions → **Smoke test production**. Sign in on the iPhone; spot-check a few records.

The restore procedure was proven with the **Backup restore drill** workflow (copies
production data into a throwaway database on GitHub's runner, checks every table and the
security rules, deletes it). Run the drill only while the data is fictional; with real
clients, rely on Supabase's restore above (the drill would briefly place client data on a
GitHub runner). Point-in-time recovery is a paid add-on and is **not** enabled.

## 5. Access problems
- **Lost phone / authenticator:** Supabase → Authentication → Users → your user → remove the
  MFA factor. Sign in with your password; the app asks you to set up a new authenticator.
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
| Phone shows "You're offline" | No signal | Nothing is stored on the phone; reconnect and tap Try again. |

## 10. Costs (re-checked 2026-10-16)
| Item | Monthly |
|---|---|
| Supabase Pro (existing org plan) | already paid |
| CRM project compute (Micro; Pro's $10 credit covers one instance, so a second project ≈ $10) | ≈ $10 — confirm on Supabase → Billing |
| Cloudflare Workers Free (100,000 requests/day, 10 ms CPU per request) | $0 |
| GitHub private repo + Actions (free minutes) | $0 |
| Address `*.workers.dev` | $0 |
| **Added total** | **≈ $10** (guardrail: under $25) |

No purchase, plan change or paid add-on without the owner's explicit approval.

## 11. What must never go into the CRM
SSNs, payment cards or bank details, driver's license numbers, medical or underwriting
answers, detailed health information, policy documents. Notes are for relationship
management only.
