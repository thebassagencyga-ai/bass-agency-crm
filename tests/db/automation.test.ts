import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, stageId, type Db } from "./helpers";

// Phase 6: automation engine. Each acceptance criterion in ROADMAP.md has a test here.

let db: Db;
let agent: string;
let today: string;

type TaskRow = {
  id: string; title: string; status: string; category: string; priority: string; origin: string;
  due: string; start: string | null; dedupe_key: string | null; opportunity_id: string | null;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addBusinessDays = (iso: string, n: number) => {
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d;
};

const tasksOf = async (contactId: string, user = agent): Promise<TaskRow[]> =>
  asUser(db, user, async (q) =>
    (
      await q.query<TaskRow>(
        `select id, title, status::text, category::text, priority::text, origin::text, due_date::text as due,
                start_date::text as start, dedupe_key, opportunity_id
           from public.tasks where contact_id = $1 order by created_at, title`,
        [contactId],
      )
    ).rows,
  );
const update = (table: string, id: string, set: string, params: unknown[] = [], user = agent) =>
  asUser(db, user, (q) => q.query(`update public.${table} set ${set} where id = $1`, [id, ...params]));
const logActivity = (contactId: string, values: Record<string, unknown>, user = agent) =>
  asUser(db, user, async (q) => {
    const v = { contact_id: contactId, activity_type: "call", ...values };
    const cols = Object.keys(v);
    return (
      await q.query<{ id: string }>(
        `insert into public.activities (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(v),
      )
    ).rows[0]!.id;
  });
const setRule = (ruleKey: string, set: string, user = agent) =>
  asUser(db, user, (q) => q.query(`update public.automation_rules set ${set} where rule_key = $1`, [ruleKey]));

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "automation");
  today = await asUser(db, agent, async (q) => (await q.query<{ d: string }>("select crm_engine.user_today()::text as d")).rows[0]!.d);
});
afterAll(async () => {
  await db.end();
});

describe("today and business days", () => {
  it("today is the New York date", async () => {
    const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    expect(today).toBe(ny);
  });

  it.each([
    ["2026-10-16", 2, "2026-10-20"], // Friday + 2 business days → Tuesday
    ["2026-10-17", 1, "2026-10-19"], // Saturday + 1 → Monday
    ["2026-10-14", 2, "2026-10-16"], // Wednesday + 2 → Friday
    ["2026-10-14", 0, "2026-10-14"],
  ])("%s + %i business days = %s", async (from, n, expected) => {
    const { rows } = await db.query("select crm_engine.add_business_days($1::date, $2)::text as d", [from, n]);
    expect(rows[0].d).toBe(expected);
  });
});

describe("new leads, contact, quotes and requested dates", () => {
  it("new lead → 'Make initial contact' due today (only when starting at the first stage)", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "auto", "new_lead");
    await insertOpportunity(db, agent, c, "home", "contacted");
    expect(await tasksOf(c)).toEqual([
      expect.objectContaining({
        title: "Make initial contact", due: today, start: null, category: "prospecting", priority: "high",
        origin: "automation", opportunity_id: opp, dedupe_key: `opp:${opp}:rule:new_lead_initial_contact:cycle:1`,
      }),
    ]);
  });

  it("initial contact done without a quote → follow-up in 2 business days; with a quote → none", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "auto");
    const [initial] = await tasksOf(c);
    await update("tasks", initial!.id, "status = 'completed'");
    const tasks = await tasksOf(c);
    expect(tasks.find((t) => t.title === "Follow up after initial contact")).toMatchObject({ due: addBusinessDays(today, 2), status: "open", opportunity_id: opp });

    const c2 = await insertContact(db, agent);
    await insertOpportunity(db, agent, c2, "auto", "new_lead", { quote_sent_on: today });
    const first = (await tasksOf(c2)).find((t) => t.title === "Make initial contact")!;
    await update("tasks", first.id, "status = 'completed'");
    expect((await tasksOf(c2)).map((t) => t.title)).not.toContain("Follow up after initial contact");
  });

  it("quote sent → follow-up 3 days later; changing the quote date moves the same task; repeats never duplicate", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "home", "quoted");
    await update("opportunities", opp, "quote_sent_on = $2", [today]);
    await update("opportunities", opp, "quote_sent_on = $2", [today]); // repeated event
    let quoteTasks = (await tasksOf(c)).filter((t) => t.title === "Follow up on quote");
    expect(quoteTasks).toEqual([expect.objectContaining({ due: addDays(today, 3), category: "prospecting" })]);

    await update("opportunities", opp, "quote_sent_on = $2", [addDays(today, -1)]);
    quoteTasks = (await tasksOf(c)).filter((t) => t.title === "Follow up on quote");
    expect(quoteTasks).toEqual([expect.objectContaining({ id: quoteTasks[0]!.id, due: addDays(today, 2) })]);
  });

  it("a date the owner changed is never overwritten", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "home", "quoted", { quote_sent_on: today });
    const task = (await tasksOf(c)).find((t) => t.title === "Follow up on quote")!;
    await update("tasks", task.id, "due_date = $2, due_date_overridden = true", [addDays(today, 10)]);
    await update("opportunities", opp, "quote_sent_on = $2", [addDays(today, -1)]);
    expect((await tasksOf(c)).find((t) => t.id === task.id)!.due).toBe(addDays(today, 10));
  });

  it("prospect asks for a date → task due that date", async () => {
    const c = await insertContact(db, agent);
    await logActivity(c, { outcome: "requested_follow_up", requested_follow_up_on: addDays(today, 10) });
    expect(await tasksOf(c)).toEqual([expect.objectContaining({ title: "Follow up as requested", due: addDays(today, 10) })]);
  });

  it("no response → asks first by default; the owner's confirmation creates one task due in 5 days, once", async () => {
    const c = await insertContact(db, agent);
    const activity = await logActivity(c, { outcome: "no_response" });
    expect(await tasksOf(c)).toEqual([]);
    const confirm = () => asUser(db, agent, (q) => q.query("select public.confirm_no_response_follow_up($1) as n", [activity]));
    expect((await confirm()).rows[0].n).toBe(1);
    expect((await confirm()).rows[0].n).toBe(0);
    expect(await tasksOf(c)).toEqual([expect.objectContaining({ title: "Follow up again (no response)", due: addDays(today, 5) })]);
  });

  it("no response creates the task straight away when the owner turns confirmation off", async () => {
    const user = await createUser(db, "no-confirm");
    await asUser(db, user, (q) =>
      q.query("update public.automation_rules set config = '{\"confirm_before_creating\": false}' where rule_key = 'no_response_follow_up'"),
    );
    const c = await insertContact(db, user);
    await logActivity(c, { outcome: "no_answer" }, user);
    expect(await tasksOf(c, user)).toEqual([expect.objectContaining({ title: "Follow up again (no response)", due: addDays(today, 5) })]);
  });
});

describe("won and lost", () => {
  it("won: closes prospecting tasks only, adds the onboarding checklist, review and referral requests", async () => {
    const c = await insertContact(db, agent, { first_name: "Winner" });
    const opp = await insertOpportunity(db, agent, c, "auto", "new_lead", { quote_sent_on: today });
    await asUser(db, agent, (q) =>
      q.query(
        `insert into public.tasks (contact_id, opportunity_id, title, due_date, category) values
           ($1, $2, 'Manual prospecting call', $3, 'prospecting'),
           ($1, $2, 'Check renewal paperwork', $3, 'renewal')`,
        [c, opp, today],
      ),
    );
    await update("opportunities", opp, "stage_id = $2, outcome = 'won'", [await stageId(db, "auto", "bound", agent)]);
    const tasks = await tasksOf(c);
    const status = (title: string) => tasks.filter((t) => t.title === title).map((t) => t.status);

    expect(status("Make initial contact")).toEqual(["cancelled"]);
    expect(status("Follow up on quote")).toEqual(["cancelled"]);
    expect(status("Manual prospecting call")).toEqual(["cancelled"]);
    expect(status("Check renewal paperwork")).toEqual(["open"]);
    expect(tasks.filter((t) => t.category === "onboarding").map((t) => t.title).sort()).toEqual(
      ["Confirm policy documents were received", "Review other coverage needs", "Thank the client"],
    );
    for (const category of ["review_request", "referral_request"]) {
      expect(tasks.filter((t) => t.category === category)).toEqual([
        expect.objectContaining({ start: addDays(today, 1), due: addDays(today, 31), status: "open" }),
      ]);
    }
  });

  it("review and referral requests are per contact: a second win within 365 days adds none", async () => {
    const c = await insertContact(db, agent);
    const bound = await stageId(db, "auto", "bound", agent);
    const first = await insertOpportunity(db, agent, c, "auto");
    await update("opportunities", first, "stage_id = $2, outcome = 'won'", [bound]);
    const second = await insertOpportunity(db, agent, c, "auto");
    await update("opportunities", second, "stage_id = $2, outcome = 'won'", [bound]);
    const tasks = await tasksOf(c);
    expect(tasks.filter((t) => t.category === "review_request")).toHaveLength(1);
    expect(tasks.filter((t) => t.category === "referral_request")).toHaveLength(1);
    expect(tasks.filter((t) => t.category === "onboarding")).toHaveLength(6); // checklist per win
  });

  it("no review request once a Google review is recorded (the referral request still comes)", async () => {
    const c = await insertContact(db, agent, { google_review_left_on: "2026-01-15" });
    const opp = await insertOpportunity(db, agent, c, "life", "contacted");
    await update("opportunities", opp, "stage_id = $2, outcome = 'won'", [await stageId(db, "life", "placed", agent)]);
    const categories = (await tasksOf(c)).map((t) => t.category);
    expect(categories).not.toContain("review_request");
    expect(categories).toContain("referral_request");
  });

  it("lost: prospecting tasks closed, nothing new created; a loss reason is still required", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "home");
    const lost = await stageId(db, "home", "lost", agent);
    expect(await errorCode(update("opportunities", opp, "stage_id = $2, outcome = 'lost'", [lost]))).toBe("23514");
    await update("opportunities", opp, "stage_id = $2, outcome = 'lost', loss_reason = 'price'", [lost]);
    expect((await tasksOf(c)).map((t) => [t.title, t.status])).toEqual([["Make initial contact", "cancelled"]]);
  });

  it("no prospecting reminders after a win or loss: a later quote date or requested follow-up creates nothing", async () => {
    const c = await insertContact(db, agent);
    // Starts at Contacted: since Phase 23 a Quoted start would record a quote date (and its follow-up) up front.
    const opp = await insertOpportunity(db, agent, c, "home", "contacted");
    await update("opportunities", opp, "stage_id = $2, outcome = 'lost', loss_reason = 'timing'", [await stageId(db, "home", "lost", agent)]);
    await update("opportunities", opp, "quote_sent_on = $2", [today]);
    await logActivity(c, { opportunity_id: opp, outcome: "requested_follow_up", requested_follow_up_on: addDays(today, 7) });
    expect(await tasksOf(c)).toEqual([]);
  });

  it("reopen: a new 'Re-engage' task in a new cycle; earlier tasks are kept", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "commercial");
    await update("opportunities", opp, "stage_id = $2, outcome = 'lost', loss_reason = 'price'", [await stageId(db, "commercial", "lost", agent)]);
    await update("opportunities", opp, "stage_id = $2, outcome = 'open'", [await stageId(db, "commercial", "follow_up", agent)]);
    const tasks = await tasksOf(c);
    expect(tasks.map((t) => [t.title, t.status])).toEqual([
      ["Make initial contact", "cancelled"],
      ["Re-engage reopened opportunity", "open"],
    ]);
    expect(tasks[1]!.dedupe_key).toBe(`opp:${opp}:rule:reopened_restart:cycle:2`);
  });
});

describe("renewals", () => {
  it("renewal date known → review 60 days before; moving the date moves the same task; a new year adds a new one", async () => {
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "auto", "quoted");
    const renewal = addDays(today, 100);
    await update("opportunities", opp, "renewal_date = $2", [renewal]);
    let reviews = (await tasksOf(c)).filter((t) => t.category === "renewal");
    expect(reviews).toEqual([expect.objectContaining({ title: "Renewal review", due: addDays(renewal, -60) })]);

    await update("opportunities", opp, "renewal_date = $2", [addDays(renewal, 5)]);
    reviews = (await tasksOf(c)).filter((t) => t.category === "renewal");
    expect(reviews).toEqual([expect.objectContaining({ id: reviews[0]!.id, due: addDays(renewal, -55) })]);

    await update("opportunities", opp, "renewal_date = $2", [addDays(renewal, 370)]);
    expect((await tasksOf(c)).filter((t) => t.category === "renewal")).toHaveLength(2);
  });

  it("a renewal less than 60 days away is due today, not in the past", async () => {
    const c = await insertContact(db, agent);
    await insertOpportunity(db, agent, c, "home", "quoted", { renewal_date: addDays(today, 20) });
    expect((await tasksOf(c)).filter((t) => t.category === "renewal")).toEqual([expect.objectContaining({ due: today })]);
  });
});

describe("rule settings and safety", () => {
  it("a disabled rule creates nothing", async () => {
    const user = await createUser(db, "disabled-rule");
    await setRule("new_lead_initial_contact", "enabled = false", user);
    const c = await insertContact(db, user);
    await insertOpportunity(db, user, c, "auto");
    expect(await tasksOf(c, user)).toEqual([]);
  });

  it("changed rule timing and title are used for new tasks", async () => {
    const user = await createUser(db, "custom-rule");
    await setRule("quote_sent_follow_up", "offset_days = 5, task_title_template = 'Call about the quote', task_priority = 'normal'", user);
    const c = await insertContact(db, user);
    await insertOpportunity(db, user, c, "auto", "quoted", { quote_sent_on: today });
    expect(await tasksOf(c, user)).toEqual([expect.objectContaining({ title: "Call about the quote", due: addDays(today, 5), priority: "normal" })]);
  });

  it("disabling 'close prospecting on win' leaves those tasks open", async () => {
    const user = await createUser(db, "keep-open");
    await setRule("won_close_prospecting", "enabled = false", user);
    const c = await insertContact(db, user);
    const opp = await insertOpportunity(db, user, c, "auto");
    await update("opportunities", opp, "stage_id = $2, outcome = 'won'", [await stageId(db, "auto", "bound", user)], user);
    expect((await tasksOf(c, user)).find((t) => t.title === "Make initial contact")!.status).toBe("open");
  });

  it("uses only the acting user's rules and data", async () => {
    const other = await createUser(db, "automation-other");
    await setRule("new_lead_initial_contact", "task_title_template = 'Other agent title'", other);
    const c = await insertContact(db, agent);
    await insertOpportunity(db, agent, c, "auto");
    expect((await tasksOf(c)).map((t) => t.title)).toEqual(["Make initial contact"]);
    expect(await tasksOf(c, other)).toEqual([]);
  });

  it("the engine schema is closed to anonymous callers and contains no SECURITY DEFINER code", async () => {
    const { rows } = await db.query(
      `select has_schema_privilege('anon', 'crm_engine', 'usage') as anon_usage,
              (select count(*)::int from pg_proc p where p.pronamespace = 'crm_engine'::regnamespace and p.prosecdef) as definer,
              (select count(*)::int from pg_proc p where p.pronamespace = 'crm_engine'::regnamespace
                 and has_function_privilege('anon', p.oid, 'execute')) as anon_exec`,
    );
    expect(rows[0]).toEqual({ anon_usage: false, definer: 0, anon_exec: 0 });
    expect(await errorCode(asAnon(db, (q) => q.query("select public.confirm_no_response_follow_up(gen_random_uuid())")))).toBe("42501");
  });

  it("confirming someone else's activity does nothing", async () => {
    const other = await createUser(db, "confirm-other");
    const c = await insertContact(db, agent);
    const activity = await logActivity(c, { outcome: "no_response" });
    const n = await asUser(db, other, async (q) => (await q.query("select public.confirm_no_response_follow_up($1) as n", [activity])).rows[0].n);
    expect(n).toBe(0);
    expect(await tasksOf(c)).toEqual([]);
  });
});
