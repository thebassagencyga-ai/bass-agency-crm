import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, insertContact, insertOpportunity, stageId, type Db } from "./helpers";

// Phase 23 (ADR-039): quote stages record the quote date, the quote follow-up fires once, and
// binding a policy makes the contact a client. Fictional data only.

let db: Db;
let agent: string;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const opp = (id: string) =>
  asUser(db, agent, async (q) =>
    (await q.query<{ quote_sent_on: string | null; outcome: string; cycle: number }>(
      "select quote_sent_on::text, outcome::text, cycle from public.opportunities where id = $1", [id],
    )).rows[0]!,
  );
const update = (id: string, set: Record<string, unknown>) =>
  asUser(db, agent, async (q) => {
    const cols = Object.keys(set);
    await q.query(
      `update public.opportunities set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`,
      [id, ...Object.values(set)],
    );
  });
const moveTo = async (id: string, line: string, code: string, extra: Record<string, unknown> = {}) =>
  update(id, { stage_id: await stageId(db, line, code), ...extra });
const quoteTasks = (id: string) =>
  asUser(db, agent, async (q) =>
    (await q.query<{ status: string; due: string }>(
      `select t.status::text, t.due_date::text as due from public.tasks t
       join public.automation_rules r on r.id = t.automation_rule_id
       where t.opportunity_id = $1 and r.rule_key = 'quote_sent_follow_up' order by t.created_at`, [id],
    )).rows,
  );
const status = (contact: string) =>
  asUser(db, agent, async (q) =>
    (await q.query<{ s: string }>("select relationship_status::text as s from public.contacts where id = $1", [contact])).rows[0]!.s,
  );
const setStatus = (contact: string, s: string) =>
  asUser(db, agent, (q) => q.query("update public.contacts set relationship_status = $2 where id = $1", [contact, s]));

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "quote-status");
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("quote stages (Phase 23)", () => {
  it("are Quoted for auto and home and Proposal Presented for commercial; life has none", async () => {
    const { rows } = await db.query<{ product_line: string; code: string }>(
      "select product_line, code from public.pipeline_stages where is_quote_stage order by product_line",
    );
    expect(rows).toEqual([
      { product_line: "auto", code: "quoted" },
      { product_line: "commercial", code: "proposal_presented" },
      { product_line: "home", code: "quoted" },
    ]);
  });

  it("moving into a quote stage records today's date and creates one quote follow-up", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "auto");
    await moveTo(o, "auto", "contacted");
    expect((await opp(o)).quote_sent_on).toBeNull();
    await moveTo(o, "auto", "quoted");
    expect((await opp(o)).quote_sent_on).toBe(today);
    expect(await quoteTasks(o)).toEqual([{ status: "open", due: addDays(today, 3) }]);

    // Back and forth between stages keeps the date and adds no task.
    await moveTo(o, "auto", "follow_up");
    await moveTo(o, "auto", "quoted");
    expect((await opp(o)).quote_sent_on).toBe(today);
    expect(await quoteTasks(o)).toHaveLength(1);
  });

  it("a date the agent supplies wins, and an existing date is never overwritten", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "home");
    const earlier = addDays(today, -2);
    await moveTo(o, "home", "quoted", { quote_sent_on: earlier });
    expect((await opp(o)).quote_sent_on).toBe(earlier);
    // Follow-up 3 days after the quote, but never in the past.
    const expectedDue = addDays(earlier, 3) < today ? today : addDays(earlier, 3);
    expect(await quoteTasks(o)).toEqual([{ status: "open", due: expectedDue }]);

    // Correcting the date re-dates the same task.
    await update(o, { quote_sent_on: today });
    expect(await quoteTasks(o)).toEqual([{ status: "open", due: addDays(today, 3) }]);
  });

  it("commercial Proposal Presented records the date; non-quote stages and life never do", async () => {
    const c = await insertContact(db, agent, { contact_type: "business", first_name: null, last_name: null, business_name: "Example Bakery LLC" });
    const com = await insertOpportunity(db, agent, c, "commercial");
    await moveTo(com, "commercial", "marketing_quoting");
    expect((await opp(com)).quote_sent_on).toBeNull();
    await moveTo(com, "commercial", "proposal_presented");
    expect((await opp(com)).quote_sent_on).toBe(today);

    const p = await insertContact(db, agent);
    const life = await insertOpportunity(db, agent, p, "life");
    for (const code of ["contacted", "appointment_set", "needs_review", "application_process", "decision_pending"]) {
      await moveTo(life, "life", code);
    }
    expect((await opp(life)).quote_sent_on).toBeNull();
  });

  it("an opportunity created directly at a quote stage gets the date and its follow-up", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "auto", "quoted");
    expect((await opp(o)).quote_sent_on).toBe(today);
    expect(await quoteTasks(o)).toHaveLength(1);
  });

  it("won or lost opportunities moved by the system get no quote date", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "auto", "bound", { outcome: "won" });
    expect((await opp(o)).quote_sent_on).toBeNull();
  });
});

describe("client status on bind (Phase 23)", () => {
  it("a prospect becomes a client when an opportunity is bound", async () => {
    const c = await insertContact(db, agent);
    expect(await status(c)).toBe("prospect");
    const o = await insertOpportunity(db, agent, c, "auto");
    await moveTo(o, "auto", "bound", { outcome: "won" });
    expect(await status(c)).toBe("client");
  });

  it("a former client becomes a client again when a new policy is bound", async () => {
    const c = await insertContact(db, agent, { relationship_status: "former_client" });
    const o = await insertOpportunity(db, agent, c, "home");
    await moveTo(o, "home", "bound", { outcome: "won" });
    expect(await status(c)).toBe("client");
  });

  it("losing or reopening an opportunity never downgrades a client", async () => {
    const c = await insertContact(db, agent);
    const won = await insertOpportunity(db, agent, c, "auto");
    await moveTo(won, "auto", "bound", { outcome: "won" });
    const other = await insertOpportunity(db, agent, c, "home");
    await moveTo(other, "home", "lost", { outcome: "lost", loss_reason: "price" });
    expect(await status(c)).toBe("client");
    await moveTo(won, "auto", "follow_up", { outcome: "open" }); // reopen
    expect(await status(c)).toBe("client");
  });

  it("other opportunity changes leave a manually set status alone", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "auto");
    await moveTo(o, "auto", "contacted");
    await update(o, { next_action: "Call Tuesday" });
    expect(await status(c)).toBe("prospect");
  });

  it("the change is in the audit log as the agent's own edit", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "auto");
    await moveTo(o, "auto", "bound", { outcome: "won" });
    const { rows } = await db.query(
      `select actor_id, old_values->>'relationship_status' as before, new_values->>'relationship_status' as after
       from public.audit_log where table_name = 'contacts' and record_id = $1 and action = 'update'`, [c],
    );
    expect(rows).toEqual([{ actor_id: agent, before: "prospect", after: "client" }]);
  });
});

describe("one-time correction (Phase 23)", () => {
  it("marks only unmerged contacts with an active bound policy as clients", async () => {
    const active = await insertContact(db, agent);
    const ended = await insertContact(db, agent);
    const formerActive = await insertContact(db, agent);
    const noPolicy = await insertContact(db, agent);
    const a = await insertOpportunity(db, agent, active, "auto", "bound", { outcome: "won" });
    const e = await insertOpportunity(db, agent, ended, "auto", "bound", { outcome: "won", policy_ended_on: today });
    await insertOpportunity(db, agent, formerActive, "home", "bound", { outcome: "won" });
    await insertOpportunity(db, agent, noPolicy, "auto", "lost", { outcome: "lost", loss_reason: "price" });
    // Simulate data from before this phase: statuses that the new trigger would have fixed.
    await setStatus(active, "prospect");
    await setStatus(ended, "prospect");
    await setStatus(formerActive, "former_client");
    expect([a, e]).toHaveLength(2);

    const { rows } = await db.query<{ n: number }>("select crm_private.correct_client_statuses() as n");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
    expect(await status(active)).toBe("client");
    expect(await status(formerActive)).toBe("client");
    expect(await status(ended)).toBe("prospect");
    expect(await status(noPolicy)).toBe("prospect");
    // Running it again changes nothing for these contacts.
    await db.query("select crm_private.correct_client_statuses()");
    expect(await status(ended)).toBe("prospect");
  });

  it("is not callable by app users", async () => {
    await expect(asUser(db, agent, (q) => q.query("select crm_private.correct_client_statuses()"))).rejects.toThrow();
  });
});
