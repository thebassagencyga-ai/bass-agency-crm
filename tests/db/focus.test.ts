import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, stageId, type Db } from "./helpers";

// Phase 27 (ADR-045): ProducrIQ Focus. focus_list is read-only and computed from the agent's own
// records; nurture check-back, re-quote and referrer thank-you tasks are created by the
// automation engine, once each. "Today" is passed in, so later days are tested by asking for
// the list as of a later date. Fictional data only.

let db: Db;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Item = { opportunity_id: string; contact_id: string; days_quiet: number; last_touch_on: string; first_name: string; title?: string; task_id?: string };
type Focus = { quiet_quotes: Item[]; quiet_open: Item[]; nurture: Item[]; requote: Item[]; thanks: Item[] };

const focus = (user: string, on: string) =>
  asUser(db, user, async (q) => (await q.query<{ f: Focus }>("select public.focus_list($1) as f", [on])).rows[0]!.f);
const ids = (items: Item[]) => items.map((i) => i.opportunity_id);

const update = (user: string, id: string, set: Record<string, unknown>) =>
  asUser(db, user, async (q) => {
    const cols = Object.keys(set);
    await q.query(`update public.opportunities set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`, [id, ...Object.values(set)]);
  });
const logActivity = (user: string, contact: string, type: string, at: string) =>
  asUser(db, user, (q) => q.query("insert into public.activities (contact_id, activity_type, occurred_at) values ($1, $2, $3)", [contact, type, at]));
const ruleTasks = (user: string, rule: string, where = "true", params: unknown[] = []) =>
  asUser(db, user, async (q) =>
    (await q.query<{ id: string; status: string; due: string; title: string; category: string; contact_id: string; opportunity_id: string | null }>(
      `select t.id, t.status::text, t.due_date::text as due, t.title, t.category::text, t.contact_id, t.opportunity_id
         from public.tasks t join public.automation_rules r on r.id = t.automation_rule_id
        where r.rule_key = $1 and ${where} order by t.created_at, t.id`, [rule, ...params],
    )).rows,
  );
const setRule = (user: string, rule: string, enabled: boolean) =>
  asUser(db, user, (q) => q.query("update public.automation_rules set enabled = $2 where rule_key = $1", [rule, enabled]));

beforeAll(async () => {
  db = await connect();
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("Focus: deals gone quiet (owner decision 3)", () => {
  it("shows a quote after 3 quiet days and any other open deal after 7", async () => {
    const agent = await createUser(db, "focus-quiet");
    const c = await insertContact(db, agent, { first_name: "Jordan", phone: "404-555-0101" });
    const quote = await insertOpportunity(db, agent, c, "auto", "quoted", { quote_sent_on: today });
    const open = await insertOpportunity(db, agent, await insertContact(db, agent, { first_name: "Morgan" }), "home", "contacted");

    expect(ids((await focus(agent, addDays(today, 2))).quiet_quotes)).toEqual([]);
    const day3 = await focus(agent, addDays(today, 3));
    expect(ids(day3.quiet_quotes)).toEqual([quote]);
    expect(day3.quiet_quotes[0]).toMatchObject({ days_quiet: 3, last_touch_on: today, first_name: "Jordan" });
    expect(ids(day3.quiet_open)).toEqual([]);
    expect(ids((await focus(agent, addDays(today, 6))).quiet_open)).toEqual([]);
    expect(ids((await focus(agent, addDays(today, 7))).quiet_open)).toEqual([open]);
  });

  it("a logged call, text, email, meeting or note resets the clock; review and referral asks do not", async () => {
    const agent = await createUser(db, "focus-touch");
    const c = await insertContact(db, agent);
    const deal = await insertOpportunity(db, agent, c, "auto", "quoted", { quote_sent_on: today });
    await logActivity(agent, c, "review_request", `${addDays(today, 2)}T15:00:00Z`);
    await logActivity(agent, c, "referral_request", `${addDays(today, 2)}T15:00:00Z`);
    expect(ids((await focus(agent, addDays(today, 3))).quiet_quotes)).toEqual([deal]);
    await logActivity(agent, c, "text_message", `${addDays(today, 2)}T15:00:00Z`);
    expect(ids((await focus(agent, addDays(today, 3))).quiet_quotes)).toEqual([]);
    expect((await focus(agent, addDays(today, 5))).quiet_quotes[0]).toMatchObject({ days_quiet: 3, last_touch_on: addDays(today, 2) });
  });

  it("a later quote date counts as activity", async () => {
    const agent = await createUser(db, "focus-quote-date");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "quoted", { quote_sent_on: addDays(today, -10) });
    expect((await focus(agent, today)).quiet_quotes).toEqual([]); // added today
    expect((await focus(agent, addDays(today, 3))).quiet_quotes[0]).toMatchObject({ opportunity_id: deal, days_quiet: 3 });
  });

  it("the stage-change time is set by the database only", async () => {
    const agent = await createUser(db, "focus-stage-time");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    const before = (await db.query("select stage_changed_at from public.opportunities where id = $1", [deal])).rows[0].stage_changed_at as Date;
    await update(agent, deal, { stage_changed_at: "2020-01-01T00:00:00Z", next_action: "Call back" });
    const after = (await db.query("select stage_changed_at from public.opportunities where id = $1", [deal])).rows[0].stage_changed_at as Date;
    expect(after.toISOString()).toBe(before.toISOString());
    // A stage move sets it again (to the time of the move).
    await update(agent, deal, { stage_id: await stageId(db, "auto", "info_needed", agent) });
    const moved = (await db.query("select stage_changed_at, now() as n from public.opportunities where id = $1", [deal])).rows[0];
    expect((moved.stage_changed_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("snooze hides a deal until the snooze date; it comes back if still quiet", async () => {
    const agent = await createUser(db, "focus-snooze");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "home", "contacted");
    await update(agent, deal, { focus_snoozed_until: addDays(today, 10) });
    expect(ids((await focus(agent, addDays(today, 9))).quiet_open)).toEqual([]);
    expect(ids((await focus(agent, addDays(today, 10))).quiet_open)).toEqual([deal]);
  });

  it("won, lost, nurture and archived contacts' deals are never shown as quiet", async () => {
    const agent = await createUser(db, "focus-closed");
    const won = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    const lost = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    const archivedContact = await insertContact(db, agent);
    await insertOpportunity(db, agent, archivedContact, "auto", "contacted");
    await update(agent, won, { stage_id: await stageId(db, "auto", "bound", agent), outcome: "won" });
    await update(agent, lost, { stage_id: await stageId(db, "auto", "lost", agent), outcome: "lost", loss_reason: "price" });
    await asUser(db, agent, (q) => q.query("update public.contacts set archived_at = now() where id = $1", [archivedContact]));
    const f = await focus(agent, addDays(today, 30));
    expect([...f.quiet_quotes, ...f.quiet_open]).toEqual([]);
  });

  it("snooze and check-back dates are cleared when a deal stops being open or nurtured", async () => {
    const agent = await createUser(db, "focus-clear");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    await update(agent, deal, { focus_snoozed_until: addDays(today, 3) });
    await update(agent, deal, { outcome: "nurture", nurture_check_back_on: addDays(today, 30) });
    let row = (await db.query("select focus_snoozed_until, nurture_check_back_on::text as cb from public.opportunities where id = $1", [deal])).rows[0];
    expect(row).toEqual({ focus_snoozed_until: null, cb: addDays(today, 30) });
    await update(agent, deal, { outcome: "open" });
    row = (await db.query("select nurture_check_back_on from public.opportunities where id = $1", [deal])).rows[0];
    expect(row.nurture_check_back_on).toBeNull();
  });
});

describe("Focus: nurture check-backs (owner decision 3)", () => {
  it("one task on the chosen date; a new date moves it; leaving nurture cancels it", async () => {
    const agent = await createUser(db, "focus-nurture");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    await update(agent, deal, { outcome: "nurture", nurture_check_back_on: addDays(today, 30) });
    let tasks = await ruleTasks(agent, "nurture_check_back");
    expect(tasks).toMatchObject([{ status: "open", due: addDays(today, 30), category: "prospecting", opportunity_id: deal }]);

    await update(agent, deal, { nurture_check_back_on: addDays(today, 90) });
    await update(agent, deal, { nurture_check_back_on: addDays(today, 90) }); // repeated: no change
    tasks = await ruleTasks(agent, "nurture_check_back");
    expect(tasks).toMatchObject([{ status: "open", due: addDays(today, 90) }]);

    await update(agent, deal, { outcome: "open" });
    expect((await ruleTasks(agent, "nurture_check_back")).map((t) => t.status)).toEqual(["cancelled"]);

    // Nurtured again: a new task for the new period; the old one stays closed.
    await update(agent, deal, { outcome: "nurture", nurture_check_back_on: addDays(today, 14) });
    expect((await ruleTasks(agent, "nurture_check_back")).map((t) => [t.status, t.due])).toEqual([["cancelled", addDays(today, 90)], ["open", addDays(today, 14)]]);
  });

  it("a date in the past is due today, never earlier", async () => {
    const agent = await createUser(db, "focus-nurture-past");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    await update(agent, deal, { outcome: "nurture", nurture_check_back_on: addDays(today, -5) });
    expect((await ruleTasks(agent, "nurture_check_back"))[0]).toMatchObject({ due: today });
  });

  it("Focus lists undated nurture deals and dated ones from their date; completing the task does not hide the deal", async () => {
    const agent = await createUser(db, "focus-nurture-list");
    const undated = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    const dated = await insertOpportunity(db, agent, await insertContact(db, agent), "home", "contacted");
    await update(agent, undated, { outcome: "nurture" });
    await update(agent, dated, { outcome: "nurture", nurture_check_back_on: addDays(today, 20) });
    expect(ids((await focus(agent, today)).nurture)).toEqual([undated]);
    expect(ids((await focus(agent, addDays(today, 20))).nurture)).toEqual([dated, undated]);

    const [task] = await ruleTasks(agent, "nurture_check_back");
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'completed' where id = $1", [task!.id]));
    expect(ids((await focus(agent, addDays(today, 20))).nurture)).toContain(dated);
    // A new date takes it off the list until then.
    await update(agent, dated, { nurture_check_back_on: addDays(today, 60) });
    expect(ids((await focus(agent, addDays(today, 20))).nurture)).toEqual([undated]);
  });

  it("does nothing when the rule is turned off", async () => {
    const agent = await createUser(db, "focus-nurture-off");
    await setRule(agent, "nurture_check_back", false);
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted");
    await update(agent, deal, { outcome: "nurture", nurture_check_back_on: addDays(today, 30) });
    expect(await ruleTasks(agent, "nurture_check_back")).toEqual([]);
  });
});

describe("Focus: re-quote before the current policy renews (owner decision 5)", () => {
  it("one task 45 days before; a corrected date moves it; Focus shows it when due", async () => {
    const agent = await createUser(db, "focus-requote");
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted", {
      current_carrier: "Example Mutual", current_policy_renews_on: addDays(today, 100),
    });
    expect(await ruleTasks(agent, "prospect_requote")).toMatchObject([{ status: "open", due: addDays(today, 55), category: "other", opportunity_id: deal }]);
    expect((await focus(agent, today)).requote).toEqual([]);

    await update(agent, deal, { current_policy_renews_on: addDays(today, 101) });
    const open = (await ruleTasks(agent, "prospect_requote")).filter((t) => t.status === "open");
    expect(open.map((t) => t.due)).toEqual([addDays(today, 56)]);

    const due = await focus(agent, addDays(today, 56));
    expect(due.requote).toMatchObject([{ opportunity_id: deal, current_carrier: "Example Mutual", current_policy_renews_on: addDays(today, 101) }]);
  });

  it("never in the past: due today when closer than 45 days, none once the date has passed", async () => {
    const agent = await createUser(db, "focus-requote-near");
    const near = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted", { current_policy_renews_on: addDays(today, 10) });
    expect(await ruleTasks(agent, "prospect_requote")).toMatchObject([{ due: today, opportunity_id: near }]);
    await insertOpportunity(db, agent, await insertContact(db, agent), "home", "contacted", { current_policy_renews_on: addDays(today, -1) });
    expect((await ruleTasks(agent, "prospect_requote")).length).toBe(1);
    // Moving the known date into the past (or clearing it) cancels the open task.
    await update(agent, near, { current_policy_renews_on: addDays(today, -3) });
    expect((await ruleTasks(agent, "prospect_requote")).map((t) => t.status)).toEqual(["cancelled"]);
  });

  it("lost deals are re-quoted too; a loss does not close the task; a win cancels it", async () => {
    const agent = await createUser(db, "focus-requote-lost");
    const lost = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "quoted", { quote_sent_on: today });
    await update(agent, lost, { stage_id: await stageId(db, "auto", "lost", agent), outcome: "lost", loss_reason: "price" });
    await update(agent, lost, { current_policy_renews_on: addDays(today, 200) });
    expect(await ruleTasks(agent, "prospect_requote")).toMatchObject([{ status: "open", opportunity_id: lost }]);

    const other = await insertOpportunity(db, agent, await insertContact(db, agent), "home", "contacted", { current_policy_renews_on: addDays(today, 200) });
    await update(agent, other, { stage_id: await stageId(db, "home", "lost", agent), outcome: "lost", loss_reason: "price" });
    expect((await ruleTasks(agent, "prospect_requote", "t.opportunity_id = $2", [other]))[0]).toMatchObject({ status: "open" });

    await update(agent, other, { stage_id: await stageId(db, "home", "contacted", agent), outcome: "open" });
    await update(agent, other, { stage_id: await stageId(db, "home", "bound", agent), outcome: "won" });
    expect((await ruleTasks(agent, "prospect_requote", "t.opportunity_id = $2", [other]))[0]).toMatchObject({ status: "cancelled" });
  });

  it("existing policies and turned-off rules get none", async () => {
    const agent = await createUser(db, "focus-requote-none");
    const c = await insertContact(db, agent);
    await insertOpportunity(db, agent, c, "auto", "bound", {
      outcome: "won", existing_policy: true, renewal_date: addDays(today, 100), current_policy_renews_on: addDays(today, 100),
    });
    expect(await ruleTasks(agent, "prospect_requote")).toEqual([]);
    await setRule(agent, "prospect_requote", false);
    await insertOpportunity(db, agent, c, "home", "contacted", { current_policy_renews_on: addDays(today, 100) });
    expect(await ruleTasks(agent, "prospect_requote")).toEqual([]);
  });

  it("the one-time catch-up creates tasks for deals already holding a future date, once", async () => {
    const agent = await createUser(db, "focus-requote-backfill");
    await setRule(agent, "prospect_requote", false);
    const deal = await insertOpportunity(db, agent, await insertContact(db, agent), "auto", "contacted", { current_policy_renews_on: addDays(today, 90) });
    await insertOpportunity(db, agent, await insertContact(db, agent), "home", "contacted", { current_policy_renews_on: addDays(today, -1) });
    await setRule(agent, "prospect_requote", true);
    const first = (await db.query("select crm_private.create_missing_requote_tasks() as n")).rows[0].n as number;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await ruleTasks(agent, "prospect_requote")).toMatchObject([{ status: "open", due: addDays(today, 45), opportunity_id: deal }]);
    await db.query("select crm_private.create_missing_requote_tasks()");
    expect((await ruleTasks(agent, "prospect_requote")).length).toBe(1);
    // A later date change moves that same task.
    await update(agent, deal, { current_policy_renews_on: addDays(today, 91) });
    expect((await ruleTasks(agent, "prospect_requote")).filter((t) => t.status === "open").map((t) => t.due)).toEqual([addDays(today, 46)]);
  });
});

describe("Focus: thank the referrer (owner decision 6)", () => {
  it("one task on the referrer when a referred person is added, naming both", async () => {
    const agent = await createUser(db, "focus-thanks");
    const riley = await insertContact(db, agent, { first_name: "Riley", last_name: "Sample" });
    const jamie = await insertContact(db, agent, { first_name: "Jamie", last_name: "Example", referred_by_contact_id: riley });
    const tasks = await ruleTasks(agent, "referrer_thank_you");
    expect(tasks).toMatchObject([{ status: "open", due: today, category: "other", contact_id: riley, opportunity_id: null, title: "Thank Riley Sample for referring Jamie Example" }]);
    expect((await focus(agent, today)).thanks).toMatchObject([{ contact_id: riley, title: "Thank Riley Sample for referring Jamie Example" }]);

    // Editing the referred contact, or changing who referred them, adds nothing.
    const other = await insertContact(db, agent, { business_name: "Example Hardware", contact_type: "business", first_name: null, last_name: null });
    await asUser(db, agent, (q) => q.query("update public.contacts set notes = 'Prefers texts' where id = $1", [jamie]));
    await asUser(db, agent, (q) => q.query("update public.contacts set referred_by_contact_id = $2 where id = $1", [jamie, other]));
    expect((await ruleTasks(agent, "referrer_thank_you")).length).toBe(1);

    // A referrer linked later (e.g. on accepting a quote request) is thanked then.
    const casey = await insertContact(db, agent, { first_name: "Casey" });
    await asUser(db, agent, (q) => q.query("update public.contacts set referred_by_contact_id = $2 where id = $1", [casey, other]));
    expect((await ruleTasks(agent, "referrer_thank_you")).map((t) => t.title)).toEqual([
      "Thank Riley Sample for referring Jamie Example", "Thank Example Hardware for referring Casey Example",
    ]);
  });

  it("winning or losing a deal never closes it", async () => {
    const agent = await createUser(db, "focus-thanks-close");
    const referrer = await insertContact(db, agent, { first_name: "Riley" });
    const referred = await insertContact(db, agent, { first_name: "Jamie", referred_by_contact_id: referrer });
    const deal = await insertOpportunity(db, agent, referred, "auto", "contacted");
    const deal2 = await insertOpportunity(db, agent, referrer, "home", "contacted");
    await update(agent, deal, { stage_id: await stageId(db, "auto", "bound", agent), outcome: "won" });
    await update(agent, deal2, { stage_id: await stageId(db, "home", "lost", agent), outcome: "lost", loss_reason: "price" });
    expect((await ruleTasks(agent, "referrer_thank_you")).map((t) => t.status)).toEqual(["open"]);
  });

  it("merging a duplicate that was already thanked for adds no second task", async () => {
    const agent = await createUser(db, "focus-thanks-merge");
    const referrer = await insertContact(db, agent, { first_name: "Riley" });
    const kept = await insertContact(db, agent, { first_name: "Jamie", email: "jamie@example.com" });
    const dup = await insertContact(db, agent, { first_name: "Jamie", referred_by_contact_id: referrer });
    expect((await ruleTasks(agent, "referrer_thank_you")).length).toBe(1);
    await asUser(db, agent, (q) => q.query("select public.merge_contacts($1, $2)", [kept, dup]));
    expect((await db.query("select referred_by_contact_id from public.contacts where id = $1", [kept])).rows[0].referred_by_contact_id).toBe(referrer);
    expect((await ruleTasks(agent, "referrer_thank_you")).length).toBe(1);
  });

  it("does nothing when the rule is turned off", async () => {
    const agent = await createUser(db, "focus-thanks-off");
    await setRule(agent, "referrer_thank_you", false);
    const referrer = await insertContact(db, agent);
    await insertContact(db, agent, { first_name: "Jamie", referred_by_contact_id: referrer });
    expect(await ruleTasks(agent, "referrer_thank_you")).toEqual([]);
  });
});

describe("focus_list access", () => {
  it("shows only the caller's own records; anonymous callers are refused; password-only sessions see nothing", async () => {
    const a = await createUser(db, "focus-a");
    const b = await createUser(db, "focus-b");
    const deal = await insertOpportunity(db, a, await insertContact(db, a), "auto", "contacted");
    expect(ids((await focus(a, addDays(today, 7))).quiet_open)).toEqual([deal]);
    expect(await focus(b, addDays(today, 7))).toEqual({ today: addDays(today, 7), quiet_quotes: [], quiet_open: [], nurture: [], requote: [], thanks: [] });
    expect(await errorCode(asAnon(db, (q) => q.query("select public.focus_list($1)", [today])))).toBe("42501");
    const aal1 = await asPasswordOnlyUser(db, a, async (q) => (await q.query<{ f: Focus }>("select public.focus_list($1) as f", [addDays(today, 7)])).rows[0]!.f);
    expect(aal1.quiet_open).toEqual([]);
  });

  it("returns no notes or other free text about the contact", async () => {
    const agent = await createUser(db, "focus-fields");
    const c = await insertContact(db, agent, { notes: "Private relationship note" });
    await insertOpportunity(db, agent, c, "auto", "contacted", { description: "Private description" });
    const f = await focus(agent, addDays(today, 7));
    expect(JSON.stringify(f)).not.toContain("Private");
  });
});
