# Producr CRM — Workflow Audit and ProducrIQ Opportunity Assessment

**Date:** 2026-10-19 · **Scope:** read-only audit of `main` at `f272117` (Phase 22 approved; its
app deploy is still pending). No application code, schema, configuration, dependencies or data
were changed. Evidence is cited as `file:line` (migrations shortened, e.g. `automation_engine:107`
= `supabase/migrations/20261019120000_automation_engine.sql` line 107).

**How to read this.** Each workflow section starts with *what good looks like* in a mature
insurance sales workflow (so you can judge the gap yourself), then what Producr does today, then
the gaps. Everything is weighed against a **one-agent agency**: several "standard CRM" features are
deliberately *not* recommended.

**Status labels used in the inventory**

| Label | Meaning |
|---|---|
| ✅ Verified | Built, covered by automated tests in CI, deployed, and either confirmed by you on the iPhone or not needing a manual check |
| 🟡 Built, not verified | Built and tested automatically, but a manual check you were asked to do is not recorded, or it was never exercised against real data / a real service |
| 🟠 Partial | Works, but part of the workflow it implies is missing (explained in the gap register) |
| ❌ Not implemented | Searched for and absent |
| ❔ Unknown | Cannot be determined from the repository |

---

## 1. Current feature inventory

| Area | Feature | Status | Evidence |
|---|---|---|---|
| **Sign-in & security** | Email + password, two-step (TOTP) code required for all data | ✅ | `auth_profiles_and_mfa:45-72` (restrictive aal2 policy on every table); e2e `auth.spec.ts`; owner signed in on production |
| | 7-day inactivity sign-out; code again after 12 h | ✅ | Phase 16, `session-policy.test.ts`, owner: "Phase 16 is done and working" (PROGRESS:655) |
| | Password reset by email | 🟡 | Redirect logic unit-tested only; delivery of the reset email never tested end to end (PROGRESS:88-90) |
| | Row-level security, no delete privilege, audit log | ✅ | Catalog tests `tests/db/rls*.test.ts`; audit triggers on contacts, opportunities, tasks, activities, rules, renewals, household, vehicles, imports, tags (`audit_log:64-73` and later migrations) |
| | Nightly encrypted backup + monthly restore drill | ✅ | Workflows `backup.yml`, `restore-drill.yml` passed (PROGRESS:469-506) |
| | Restore into the hosted project | 🟡 | `restore-backup.yml` exists, never run against the hosted project (DECISIONS:588-589) |
| **Contacts** | Individuals/businesses, status (prospect/client/former client), lead source, referrer, notes, Google-review date, archive | ✅ | `core_schema:138-175`; e2e `contacts.spec.ts` |
| | Search (name, email, phone digits), filters (type, status, source, tag, archived) | ✅ | `search_contacts` (`tags_merge:243`); `src/lib/contacts/params.ts` |
| | Duplicate warning (same email / last 10 phone digits) at entry, intake review, import | ✅ | `find_possible_duplicates` (`tags_merge:306`); `contacts/actions.ts:66-69` |
| | Merge duplicates (nothing deleted, history moves) | ✅ | `merge_contacts` (`tags_merge:128`); owner merged on iPhone (PROGRESS:692) |
| | Tags from a managed list | 🟡 | Built and tested; your "prune the starter list" check is still open (PROGRESS:811) |
| | Household members, vehicles (no VIN) | 🟡 | `intake_details:14,31`; e2e covers it; your intake test with a vehicle/household member not recorded (PROGRESS:587) |
| | Pinned Call · Text · Log bar, search from any page, bottom bar | ✅ | Phase 21; "Very clean" |
| **Opportunities** | Pipeline per line (auto, home, commercial, life), board + table, outcome open/nurture/won/lost | ✅ | Stages `seed_reference_data:11-44`; e2e `opportunities.spec.ts`, `journey.spec.ts` |
| | Quote fields: quote sent date, quoted carrier, estimated annual premium, next action, effective/renewal date | ✅ | `core_schema:195-233`, `opportunity_lifecycle:12` |
| | Required loss reason on Lost | ✅ | CHECK `core_schema:226` |
| | "Quoted" stage linked to the quote date | ❌ | Moving to Quoted does not set `quote_sent_on`; only the date field starts the quote follow-up (`renewals_cross_sell:303`; nothing in `src/lib/opportunities/transitions.ts`) |
| | Current carrier / X-date (prospect's renewal) | 🟠 | Columns exist (`intake:21`) but are set only by intake; not on the edit form (`src/lib/opportunities/schema.ts:80`) |
| | Bound → contact becomes a client | ❌ | No code sets `relationship_status = 'client'` on a win; only import, merge, and renewal-lost (→ former client) change status |
| | Stalled / aging opportunity detection | ❌ | No days-in-stage, last-touch or "no next step" logic anywhere |
| **Tasks & automation** | Tasks with due/start date, priority, category; overdue/today/upcoming views | ✅ | `core_schema:329-367`, `task_views:14`; e2e `tasks.spec.ts` |
| | 12 editable automation rules (new lead, follow-ups, quote follow-up, no-response, won checklist, review & referral asks, renewal review, reopen) | ✅ | Seeds `seed_reference_data:49-122`; engine `automation_engine:107-191`; 23 DB tests |
| | Automation runs instantly when a record is saved (not on a schedule) | ✅ | AFTER triggers `automation_engine:326-331` |
| | Calendar feed of open tasks (iPhone/Google) | ✅ | Owner confirmed on iPhone (PROGRESS:730-731) |
| | Task reminders / time of day | ❌ | Dates only; the calendar feed shows all-day events |
| **Lead capture** | Public quote-request form with consent, rate limits, QR code | 🟡 | `submit_intake` (`intake_details:336`); e2e covers it; your own test submission not recorded (PROGRESS:548-549) |
| | Inbox review → accept into new/existing contact (creates opportunities + first task) | 🟡 | `accept_intake` / `intake_apply` (`intake_details:256-379`) |
| | Quick intake (you fill it in) | ✅ | `/intake/new`, e2e |
| | Alert to you when a web request arrives | ❌ | No email/push/SMS code; you see it only when the app is open (dashboard banner, `dashboard/page.tsx:46`) |
| **Renewals** | Renewals list (30/60/90 days), record renewed / re-marketed / lost with reason and premium, 6- or 12-month roll-forward | ✅ | `record_renewal_outcome` (`renewals_cross_sell:388-450`); e2e `renewals.spec.ts`; "Deployed, working" |
| **Cross-sell** | Rule-based prompts (auto→home, home→auto, auto/home→life, commercial→life), dismiss for 12 months | ✅ | `cross_sell_matches` (`review_fixes:8`) |
| **Referrals & reviews** | Referred-by link, "referrals from this contact", referral report | ✅ | `core_schema:150`, report `referrals` |
| | Review/referral ask tasks after a win, with message templates and Google review link | ✅ | Rules `review_request`, `referral_request` |
| | Referral thank-you workflow | ❌ | Not built; ADR-013 holds it pending a compliance answer on anything of value |
| **Messages** | 7 templates; opens your Messages/Mail app pre-filled; log what was sent | ✅ | `src/lib/messages/templates.ts:22`; owner verified (PROGRESS:655) |
| **Reports** | 9 sections (conversion, leads by source, quotes, pipeline, tasks, renewals, cross-sell, referral sources, review/referral asks) for 5 period choices | 🟡 | `report_summary` (`import_export:233`); fixture test per report; you reported it working, figures not explicitly checked (ROADMAP:325) |
| | Loss-reason, lead-response-time, retention-rate % reporting | ❌ | Not computed (see gaps) |
| **Data in/out** | CSV import of a carrier book (clients + policies), undo within 7 days | 🟡 | `import_book` (`import_export:74`); tested with a fictional 500-client file; **never tried on your real Alfa report** (PROGRESS:590-591, 622-623) |
| | CSV export of 6 datasets | ✅ | `src/lib/import/export.ts`; e2e `import.spec.ts` |
| **AI helpers** | Draft message, notes→activity, daily briefing, import clean-up | 🟡 | Built (`src/lib/ai/*`), **not connected** by your decision; never called against the real API (PROGRESS:764) |
| **App** | Installable iPhone app, offline notice, light/dark, Producr brand | ✅ / 🟡 | Phases 10, 21 verified; Phase 22 approved, deploy pending |
| **Other** | `src/components/placeholder.tsx` | — | Unused leftover file (dead code), harmless |

---

## 2. End-to-end workflow map

### 1. Lead capture and immediate response
**What good looks like.** Every lead lands in one place within seconds, the agent is alerted
immediately, and first contact happens within minutes to an hour. In personal lines, the first
agent to call usually wins, so *speed to lead* is the single biggest lever.

**Today.**
- Four ways in:
  - manual entry (contact, then opportunity)
  - the public quote form (`/quote/<token>`) → Intake inbox → you accept
  - Quick intake
  - CSV import (for existing clients, not leads)
- On accept, each requested line becomes a New Lead opportunity. Automation creates **"Make initial
  contact"**, due today, high priority (`automation_engine:228-234`).
- A **"Quote request received"** reply template is ready in the composer.
- **Fields:** `intake_submissions.created_at`, `status`; `contacts.created_at`, `lead_source`.
- **Manual steps:** open the app, notice the banner, review, accept, call or text.

**Gaps.**
- **No alert.** A request submitted at 7 pm is invisible until you next open the app.
- Nothing measures how fast you responded.
- Your own end-to-end test of the public form is not recorded.

### 2. Lead qualification and source tracking
**What good looks like.** Each lead has a source, a line of business, and enough information to
quote (current carrier, renewal date, drivers/vehicles or property). Unqualified leads are
closed with a reason, so the pipeline stays honest.

**Today.**
- **Fields:**
  - `lead_source` is free text with suggestions (`contact_lead_sources()`).
  - The intake form collects current carrier and renewal month per line, household and vehicles.
- **Stages:** "Contacted" / "Info Needed" / "Discovery" / "Appointment Set".
- **Unqualified:** Lost with a reason such as "not eligible".

**Gaps.**
- Current carrier / X-date can't be entered or edited outside intake. This matters for leads you
  meet in person.
- Free-text sources fragment over time ("Facebook", "FB", "facebook ad"). Reports normalise case
  and spaces only.

### 3. Quote preparation, delivery and follow-up
**What good looks like.**
- Every quote has a sent date and a scheduled follow-up (typically 1–3 days later, then again).
- A quote never sits without a next step.
- Win/loss reasons are captured.

**Today.**
- **Fields:** `quote_sent_on`, `quoted_carrier`, `estimated_annual_premium`, `next_action`.
- **Automation:**
  - Setting the quote date → **"Follow up on quote"** at +3 days, high priority.
  - Completing first contact without a quote → follow-up at +2 business days.
  - A "no answer / no response" activity offers a +5-day follow-up (you confirm).
- The message composer has a "Quote follow-up" template.

**Gaps.**
- **Moving a card to "Quoted" (or "Proposal Presented") does not record the quote date**, so the
  quote follow-up never gets created unless you also fill the date field. This is the most likely
  way a quote silently drops.
- Only one follow-up is automatic. After it's done, nothing schedules the next touch unless you
  log a "no response" activity.

### 4. Stalled opportunity detection and re-engagement
**What good looks like.**
- The CRM flags any open opportunity with **no next step** (no open task) or **no touch in N
  days**.
- Nurtured leads get a "check back on" date, ideally the prospect's X-date.

**Today.**
- **Nurture** is an outcome you can toggle.
- **Reopen** creates a "Re-engage" task.
- Intake with a renewal month creates a manual "Quote before the current policy renews" task,
  30 days before.

**Gaps.**
- **No stalled detection at all.** An open opportunity whose last task you completed or
  cancelled simply disappears from every task list.
- Nurture has no date, so nurtured leads are invisible until you go looking.
- The X-date task exists only for intake leads.

### 5. Policy binding and post-sale follow-up
**What good looks like.** Bind → the contact becomes a client, an onboarding checklist starts, and
review/referral asks happen 1–4 weeks later when goodwill is high.

**Today.**
- Marking Bound (won) does the following automatically:
  - closes open prospecting tasks
  - creates a 3-task onboarding checklist (thank the client, confirm documents received, review
    other coverage needs)
  - creates a Google-review ask and a referral ask (+1 day, due within 30; once a year per
    contact)
- **Fields:** `closed_at`, `effective_date`, `renewal_date`, `policy_term_months`.

**Gaps.**
- **The contact stays a "Prospect"** after binding (badge, list filter, merge ranking). Renewals and
  cross-sell still work because they look at won policies, but the contact list is misleading.
- Logging an activity outcome "review left" doesn't set the contact's review date. The review ask
  could repeat next year for someone who already left one.

### 6. Policy and household relationship management
**What good looks like.** One record per household showing every policy, household member and
vehicle, with history, so you can serve and round the account.

**Today.**
- The contact page shows:
  - details
  - household members and vehicles
  - every opportunity/policy
  - open tasks
  - full history
  - referrals
  - cross-sell prompts
- **Business accounts** are their own contact type.

**Gaps.**
- Each household is one contact. A spouse with their own policy is either a household member (no
  policies) or a separate contact (no link). This is acceptable for now; see "not recommended".

### 7. Renewal preparation and retention
**What good looks like.**
- A review 45–60 days out, earlier for at-risk accounts.
- Re-market when the premium jumps.
- Record the outcome and loss reason.
- Track retention %.

**Today.**
- **"Renewal review"** task 60 days before each renewal (every 6 months for 6-month auto).
- **Renewals page:**
  - 30/60/90-day window
  - past-due items with no outcome
  - prospects' current policies (X-dates)
- **Outcome form:** renewed / re-marketed / lost, with reason and premium. The date rolls forward
  and the next review is scheduled.

**Gaps.**
- Retention is shown as counts, not a percentage.
- Renewal loss reasons are recorded but never reported.
- Real Alfa import untried, so live renewal dates depend on manual entry until then.

### 8. Cross-selling and account rounding
**What good looks like.** For every monoline client, a visible prompt to quote the missing line,
worked at natural moments (bind, renewal review).

**Today.**
- 4 editable rules.
- Prompts show on the contact page and Renewals.
- Dismiss hides a prompt for 12 months.
- The onboarding checklist includes "Review other coverage needs".

**Gaps.**
- Prompts never become tasks, so if you don't visit Renewals or that contact, they wait
  unnoticed.
- There's no one-tap "Start opportunity" from a prompt. (The contact page does show a "Start Life
  opportunity" link according to an e2e test; ❔ whether every prompt surface has it.)

### 9. Referral tracking and referral follow-up
**What good looks like.**
- Know who refers you.
- Thank them promptly, within your carrier's rules.
- Ask happy clients at the right moment.

**Today.**
- **Referred-by link,** "Referrals from this contact", and a top-25 referrers report.
- **Automatic referral ask** after a win.
- **The intake form's "Referred by"** is free text, linked by hand when you accept.

**Gaps.**
- No "thank the referrer" task when a referred lead arrives. ADR-013 is waiting on whether
  anything of value is allowed; a plain thank-you note needs no compliance answer.

### 10. Daily task prioritisation
**What good looks like.** One screen in the morning, in order: new leads → overdue → due today →
quotes awaiting follow-up → renewals → everything else.

**Today.**
- **Dashboard:**
  - new-request banner
  - overdue (top 5) and due-today (top 10) with one-tap Done
  - next 7 days count
  - pipeline by line
  - renewals in 60 days
  - recent activity
- **Calendar feed** puts tasks on your iPhone calendar.

**Gaps.**
- The dashboard only knows about **tasks**. Stalled opportunities (workflow 4) and unworked
  cross-sell never appear.
- No reminder at a time of day. The calendar feed partly covers this: you can set a default alert
  for all-day events on the iPhone.

### 11. Production, conversion and lead-source reporting
**What good looks like.**
- Leads by source → quote rate → close rate.
- Premium written per month.
- Retention %.
- Why you lose.
- Response time.

**Today.**
- Conversion (won ÷ closed) by line.
- New leads by source, with how many reached an opportunity and how many were won.
- Quotes sent and their outcomes.
- Open pipeline.
- Task on-time rate.
- Renewal outcomes.
- Cross-sell.
- Referral sources.
- Review/referral asks.

**Gaps.**
- No loss-reason breakdown, even though it's captured on every lost deal and renewal.
- No premium written per month.
- No retention %.
- No response time.
- The "quotes" report counts opportunities by `quote_sent_on`, so it undercounts whenever the
  Quoted stage was used without the date (see workflow 3).

### 12. Data quality, duplicates, audit history and privacy
**What good looks like.**
- Duplicates caught at entry.
- Every change traceable.
- Only necessary data stored.
- Backups proven.

**Today.**
- Duplicate warnings at every entry point, plus merge.
- An audit log on all business tables.
- No deletes.
- Data minimisation enforced:
  - no SSN, DOB, licence or VIN
  - intake personal data erased after review
- Nightly encrypted backups with restore drills.
- Two-step sign-in.

**Gaps (operational, not features).**
- Password-reset delivery is untested.
- Hosted restore is unexercised.
- The free Supabase plan can pause after 7 quiet days. The nightly backup likely keeps it awake;
  ❔ not proven.
- Some docs are stale (section 7).

---

## 3. Prioritised gap register

Priorities:
- **P0:** risks a missed lead or quote now.
- **P1:** clear revenue or retention value, small effort.
- **P2:** worthwhile, do after P0/P1.
- **P3:** nice to have.

Complexity: S ≈ a day or less, M ≈ 2–4 days, L ≈ a week or more.

| # | Gap | Current behaviour and evidence | Recommended improvement | Business outcome | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|---|---|
| G1 | No alert when a web quote request arrives | Inbox visible only on app open (`dashboard/page.tsx:46`); no notification code | Notify **you** (not the client) the moment a request arrives. Web Push to the installed iPhone app is the zero-cost, no-new-vendor option; it is triggered by the quote form's own server action. | Faster first contact = more quotes won | M | Your OK (decision Q1); re-add home-screen app; iOS 16.4+ | **P0** |
| G2 | Quote follow-up can silently not happen | "Quoted" / "Proposal Presented" stages don't set `quote_sent_on`; only the date triggers "Follow up on quote" (`renewals_cross_sell:303`) | When moving to a quote stage, ask for the quote date (default today) and save it, which fires the existing rule | Every quote gets a follow-up; quote report becomes accurate | S | Decision Q4 | **P0** |
| G3 | Unverified lead-capture path | Your own public-form test (submit → accept → task) not recorded (PROGRESS:548-549) | You send one test request from your phone and accept it (10 minutes, no code) | Confidence that real leads arrive | — | None | **P0** (manual) |
| G4 | Open opportunities can fall out of sight | No stalled detection; finishing or cancelling the last task leaves a deal with no next step | "Needs attention" list: open or nurture opportunities with **no open task**, or no activity for N days; shown on the dashboard with one tap to add a task | Fewer abandoned quotes; honest pipeline | M | Decision Q3 (N days) | **P1** |
| G5 | Bound doesn't make the contact a client | No status write on win; contact list and badge stay "Prospect" | Automatically set prospect/former client → client when a policy is bound; one-time fix for existing contacts | Accurate client list, filters and exports | S | Decision Q2 | **P1** |
| G6 | Nurture and X-dates have no "check back" date | Nurture is a toggle; current carrier / X-date editable only via intake (`schema.ts:80`) | Add current carrier + X-date to the opportunity form; rule: X-date − 30 days → "Re-quote" task; "check back on" date when setting Nurture | Turns "not now" leads into scheduled re-quotes, the classic P&C win-back | S–M | Decision Q5 | **P1** |
| G7 | Only one automatic quote follow-up | After "Follow up on quote" is done, nothing schedules the next touch | Optional second step: when a quote follow-up is completed and the deal is still open with no other open task, offer (not force) another follow-up in N days | Persistence without nagging | S | G2 | P2 |
| G8 | Loss reasons captured but never reported | `loss_reason` and renewal `loss_reason` not in `report_summary` | Add "Why we lose" (new business and renewals) to Reports | Learn whether price, coverage or timing loses deals | S | — | P2 |
| G9 | Speed to lead not measured | No first-response metric | Report median time from lead created to first logged call/text/email | Shows whether G1 worked | S–M | G1 | P2 |
| G10 | Cross-sell prompts never become work | Prompts only on Renewals / contact page | "Add task" on a prompt; optionally show a count on the dashboard | Account rounding actually gets done | S | — | P2 |
| G11 | No thank-you for referrers | Referral received → nothing (ADR-013 pending) | Task "Thank <referrer>" when a contact is created with a referrer (a note or call, no gift; that part waits for compliance) | Referrers feel valued and refer again | S | Decision Q6 | P2 |
| G12 | Retention shown as counts only | `renewals` report has counts | Add retention % (renewed + re-marketed ÷ outcomes) for the period | One number to watch | S | — | P3 |
| G13 | "Review left" activity doesn't set the review date | Separate field (`core_schema:159`); rule skips only on that field | Set `google_review_left_on` when an activity with outcome "review left" is logged | No awkward repeat review ask | S | — | P3 |
| G14 | Calendar feed uses server UTC "today" and includes archived contacts' tasks | `calendar_feed:109` | Use your time zone; skip archived/merged contacts | Edge-case tidiness | S | — | P3 |
| G15 | Verification backlog | Password-reset delivery, real Alfa import, hosted restore, tags prune, dashboard iPhone check (section 6) | Work through the owner checks; do the Alfa trial with a small export | Proven, not assumed | — | You | P1 (Alfa import, reset email) / P3 (rest) |

**Deliberately not recommended (feature bloat for a one-agent agency):**
- hard-blocking duplicates (warnings + merge are enough)
- multi-user assignment
- per-agent pipelines
- policy numbers / bound carrier / commission fields (Alfa is the policy system of record)
- spouse-level household linking
- email or SMS sending from the CRM (ADR-030 keeps your own apps as the sender)
- drip campaigns
- lead purchasing
- task time-of-day reminders (the calendar feed plus an iPhone default alert covers this)

---

## 4. ProducrIQ feasibility assessment

**Recommendation:** make ProducrIQ a **feature inside Producr**, not a separate companion
interface.

**Why inside, not separate:**
- One sign-in with your two-step code.
- Row-level security applies automatically.
- It can read the same data the CRM already computes.
- No client data leaves for a second app (ProducerIQ runs on Vercel + Clerk + its own Supabase).

**Key finding:** most of what "ProducrIQ inside the CRM" should do **does not need AI at all**.
Deciding *what needs attention* is a database question the CRM can answer exactly. AI adds value
only in *wording*: drafting messages and explaining trends in plain English.

| Capability | Data required | Exists today? | AI needed? | Safeguards |
|---|---|---|---|---|
| Daily priority briefing | Overdue/today tasks, new requests, renewals ≤30 days, stalled deals | Tasks, intake, renewals: yes. Stalled deals: **no** (G4) | No for the list; optional for a plain-English summary | Existing AI helper sends first names + task titles only (`src/lib/ai/jobs.ts:111-130`); $10 cap; nothing saved |
| Leads and quotes needing attention | Open opps, last activity date, open tasks, `quote_sent_on`, intake inbox | Yes, except the "no next step / no touch in N days" query | **No**: a deterministic query is more reliable than a model | Read-only; one tap to create a task you choose |
| Summarise a contact's CRM activity | Activities incl. **notes**, opportunities, tasks | Yes | Yes | **Highest privacy risk:** notes can hold anything. Requires a privacy review, the existing sensitive-data guard, first name only, an on-demand button (never automatic), nothing stored. Defer. |
| Draft personalised follow-up messages | Purpose, first name, line, renewal date | **Built** (Phase 19, off) | Yes | Already designed: you edit and send from your own Messages/Mail; nothing is sent by the CRM |
| Suggest next actions | Stage, last activity, open tasks, rules | Rules exist | No: rule-based ("quote sent 5 days ago, no follow-up → call") | Suggestions only; you approve before any task is created |
| Explain production and conversion trends | `report_summary` aggregates | Yes | Optional | Safest AI use: **aggregates only, no client names**. Still needs the API key and cap. |
| Renewal and cross-sell opportunities | Renewals view, cross-sell matcher | **Built** (deterministic) | No | Already read-only prompts |

**Hard limits (true today, must stay true unless you decide otherwise):**
- No AI model can see your database. The only path is the server-side helper code in
  `src/lib/ai/run.ts`, which sends only the fields listed in `jobs.ts`.
- The AI is **not connected** (no `ANTHROPIC_API_KEY`).
- Nothing AI-generated is ever saved or sent without your tap.
- Client data must not go to an external AI service without the privacy review you asked for.

**Smallest useful first version:** **"Focus", ProducrIQ v0, no AI.** A read-only section at the top
of the dashboard, one tap per item:

1. New quote requests waiting (exists)
2. Overdue and due-today tasks (exists)
3. **Quotes sent with no follow-up done** (new query)
4. **Open deals with no next step / no touch in N days** (new query = G4)
5. Renewals in 30 days with no review done (exists, reshaped)
6. Cross-sell prompts count (exists)

It costs nothing, sends no data anywhere, and every item is exact. The optional AI layer (a
one-paragraph plain-English briefing over the same list, first names only) can follow once you
choose to connect the key. The helper for that is already built.

---

## 5. Recommended roadmap: next three improvements

### Step 1: Never miss or stall a quote (G2 + G5 + G3)
- **Benefit:** every quote gets its follow-up task, the quote report becomes accurate, and bound
  clients show as clients.
- **Scope:**
  - When an opportunity moves to a quote stage (`quoted`, `marketing_quoting`,
    `proposal_presented`), ask for the quote date (default today) and save it. The existing
    "Follow up on quote" rule then fires.
  - On bind, set the contact to client.
  - A one-time migration fixes existing contacts with a bound policy.
  - Tests. No change to rules, RLS or auth.
  - You do the 10-minute public-form test (G3).
- **Success metric:**
  - 100% of opportunities in a quote stage have a quote date.
  - 0 bound contacts still marked "Prospect".
- **Prerequisites:** decisions Q2 and Q4. Phase 22 deployed first.

### Step 2: Instant new-lead alert (G1, with G9 as its measure)
- **Benefit:** you hear about a web quote request within seconds, wherever you are.
- **Scope:**
  - Web Push to the installed iPhone app, triggered when the public form saves a request.
  - A "Notify me" switch in Settings.
  - The notification text carries **no client details** ("New quote request: open Producr");
    the details stay behind your sign-in.
  - Keys are stored as Cloudflare secrets. $0.
  - Add the response-time measure to Reports.
- **Success metric:**
  - First contact on web requests within 1 business hour.
  - Median response time visible in Reports.
- **Prerequisites:**
  - Decision Q1, since it is an agent-facing notification and ADR-030 only covers messages to
    clients.
  - iPhone on iOS 16.4+ with the app re-added to the home screen.

### Step 3: "Focus", ProducrIQ v0, read-only and no AI (G4 + G6, foundation for ProducrIQ)
- **Benefit:** one morning list of everything that needs you, including deals with no next step.
  X-dates become scheduled re-quotes.
- **Scope:**
  - A read-only query and dashboard section (section 4).
  - X-date / current carrier on the opportunity form.
  - An X-date − 30 days re-quote rule.
  - A "check back on" date for Nurture.
- **Success metric:**
  - The open-deals-with-no-next-step count trends to 0 each week.
  - Every nurtured lead has a check-back task.
- **Prerequisites:** decisions Q3 and Q5.

After these, in order: G8 loss reasons and G12 retention in Reports; G10 cross-sell → task;
G11 referrer thank-you; then the optional AI layer for Focus (needs Q7).

All three steps fit the current architecture:
- Next.js server actions.
- Postgres triggers or functions for anything multi-step.
- RLS and two-step sign-in unchanged.
- No new paid services.

---

## 6. Questions that need your decision

1. **New-lead alert (G1).** OK to send a notification to *your own* iPhone when a quote request
   arrives?
   - Recommended: Web Push. Free, no new vendor, no client details in the notification.
   - Alternative: email to yourself via a free email service, which adds a third-party vendor.
2. **On bind (G5).** Automatically mark the contact as a client (recommended), or ask each time?
3. **"Needs attention" (G4).** How many days without a touch before an open deal is flagged? Can be
   different for quoted vs. not-yet-quoted (suggest: 3 days quoted, 7 days otherwise, 30 days
   nurture).
4. **Quote stages (G2).** When moving to Quoted/Proposal, should the quote date be required or
   default to today with an option to change (recommended: default today)?
5. **X-dates (G6).** How far before a prospect's current renewal do you want the re-quote task: 30,
   45 or 60 days?
6. **Referrer thank-you (G11).** Fine to create a "thank the referrer" task (a note or call only)?
   Has Alfa/compliance answered about anything of value (ADR-013 still lists it open)?
7. **ProducrIQ AI layer (later).** Keep AI off until Focus v0 proves useful? When you do turn it
   on, may contact notes ever be sent to the AI (for "summarise this contact"), or only first
   names and aggregates (recommended)?
8. **Housekeeping.**
   - Deploy Phase 22 (approved).
   - Work through the open owner checks:
     - password-reset email
     - a small real Alfa import
     - public-form test
     - tag list
     - dashboard check on the iPhone
   - OK for me to refresh the stale docs listed below as a docs-only change?

---

## 7. Appendix: documentation found out of date (not changed in this audit)

- `PROGRESS.md:3-4` header still says "Current phase: 15 … Last updated 2026-10-16".
- `SECURITY.md:162` still lists the owner security review as pending (signed off 2026-10-16), and
  `:183-187` describes pre-deploy status.
- `docs/data-model.md` has no sections for `intake_links`, `intake_submissions`,
  `household_members`, `vehicles`, `import_batches`.
- `CLAUDE.md` and ADR-002 say "Supabase Pro"; production runs on **Free** (ADR-027).
- ADR-016 still describes idle sign-out as a Supabase Pro setting (replaced by ADR-027/032). ADRs
  003–009, 011, 015 and 016 still say "Proposed" though their phases were approved.
- `docs/runbook.md` §4c calls the calendar "CRM tasks" (now "Producr tasks").
- `DECISIONS.md` open question 7 (referral thank-you compliance) is listed open but marked resolved
  in ADR-013 and the go-live checklist. Your answer to Q6 settles it.
