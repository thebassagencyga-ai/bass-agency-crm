import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db,
} from "./helpers";

// Phase 5: task lifecycle and the task list functions.

const TODAY = "2026-10-15";
let db: Db;
let agent: string;
let other: string;
let contact: string;

async function insertTask(userId: string, contactId: string, values: Record<string, unknown>): Promise<string> {
  const v = { contact_id: contactId, title: "Fictional task", due_date: TODAY, ...values };
  const cols = Object.keys(v);
  return asUser(db, userId, async (q) => {
    const { rows } = await q.query<{ id: string }>(
      `insert into public.tasks (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(v),
    );
    return rows[0]!.id;
  });
}

type Row = { id: string; first_name: string | null; product_line: string | null };
const list = (userId: string, view: string, args: Record<string, unknown> = {}, aal1 = false) => {
  const a = { p_product_line: null, p_priority: null, p_category: null, p_contact_id: null, p_limit: 50, p_offset: 0, ...args };
  const run = (q: Db) =>
    q.query<Row>(
      `select * from public.search_tasks($1, $2::date, $3, $4::public.task_priority, $5::public.task_category, $6::uuid, $7, $8)`,
      [view, TODAY, a.p_product_line, a.p_priority, a.p_category, a.p_contact_id, a.p_limit, a.p_offset],
    ).then((r) => r.rows);
  return aal1 ? asPasswordOnlyUser(db, userId, run) : asUser(db, userId, run);
};
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "tasks");
  other = await createUser(db, "tasks-other");
  contact = await insertContact(db, agent, { first_name: "Taylor", last_name: "Example", phone: "770-555-0142" });
});
afterAll(async () => {
  await db.end();
});

describe("task lifecycle", () => {
  it("completing stamps completed_at; reopening clears it; the task is kept", async () => {
    const id = await insertTask(agent, contact, {});
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'completed' where id = $1", [id]));
    let row = (await db.query("select status, completed_at from public.tasks where id = $1", [id])).rows[0];
    expect(row.completed_at).toBeInstanceOf(Date);
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'open' where id = $1", [id]));
    row = (await db.query("select status, completed_at from public.tasks where id = $1", [id])).rows[0];
    expect(row).toEqual({ status: "open", completed_at: null });
  });

  it("start date must not be after the due date", async () => {
    expect(await errorCode(insertTask(agent, contact, { start_date: "2026-10-20", due_date: "2026-10-19" }))).toBe("23514");
  });

  it("links only to an opportunity of the same contact", async () => {
    const otherContact = await insertContact(db, agent, { first_name: "Other" });
    const opp = await insertOpportunity(db, agent, otherContact, "auto");
    expect(await errorCode(insertTask(agent, contact, { opportunity_id: opp }))).toBe("23503");
    const own = await insertOpportunity(db, agent, contact, "home");
    await expect(insertTask(agent, contact, { opportunity_id: own })).resolves.toBeTruthy();
  });

  it("manual tasks cannot pretend to be automation tasks", async () => {
    expect(await errorCode(insertTask(agent, contact, { dedupe_key: "opp:x:rule:y:cycle:1" }))).toBe("23514");
  });

  it("no one can delete a task", async () => {
    const id = await insertTask(agent, contact, {});
    expect(await errorCode(asUser(db, agent, (q) => q.query("delete from public.tasks where id = $1", [id])))).toBe("42501");
  });
});

describe("search_tasks and task_counts", () => {
  let user: string;
  const t: Record<string, string> = {};

  beforeAll(async () => {
    user = await createUser(db, "task-views");
    // These tests are about the list views; automatic tasks (Phase 6) are tested elsewhere.
    await asUser(db, user, (q) => q.query("update public.automation_rules set enabled = false"));
    const c = await insertContact(db, user, { first_name: "Riley", last_name: "Example" });
    const homeOpp = await insertOpportunity(db, user, c, "home");
    t.overdue = await insertTask(user, c, { due_date: "2026-10-10", priority: "normal" });
    t.overdueHigh = await insertTask(user, c, { due_date: "2026-10-10", priority: "high" });
    t.today = await insertTask(user, c, { due_date: TODAY, opportunity_id: homeOpp, category: "prospecting" });
    t.upcoming = await insertTask(user, c, { due_date: "2026-10-20" });
    // Review request: starts tomorrow, due in 30 days — not part of today's work yet.
    t.notStarted = await insertTask(user, c, { start_date: "2026-10-16", due_date: "2026-11-15", category: "review_request" });
    t.completed = await insertTask(user, c, { due_date: "2026-10-01" });
    t.cancelled = await insertTask(user, c, { due_date: "2026-10-02" });
    await asUser(db, user, async (q) => {
      await q.query("update public.tasks set status = 'completed' where id = $1", [t.completed]);
      await q.query("update public.tasks set status = 'cancelled' where id = $1", [t.cancelled]);
    });
    await insertTask(other, await insertContact(db, other, { first_name: "Riley" }), { due_date: "2026-10-10" });
  });

  it("splits open tasks into overdue (high priority first), today and upcoming", async () => {
    expect(ids(await list(user, "overdue"))).toEqual([t.overdueHigh, t.overdue]);
    expect(ids(await list(user, "today"))).toEqual([t.today]);
    expect(ids(await list(user, "upcoming"))).toEqual([t.upcoming, t.notStarted]);
  });

  it("a task that has not started never shows as overdue or due today", async () => {
    const work = [...(await list(user, "overdue")), ...(await list(user, "today"))];
    expect(ids(work)).not.toContain(t.notStarted);
  });

  it("done lists completed and cancelled tasks", async () => {
    expect(ids(await list(user, "done")).sort()).toEqual([t.completed, t.cancelled].sort());
  });

  it("filters by product line, priority, category and contact", async () => {
    expect(ids(await list(user, "today", { p_product_line: "home" }))).toEqual([t.today]);
    expect(ids(await list(user, "today", { p_product_line: "auto" }))).toEqual([]);
    expect(ids(await list(user, "overdue", { p_priority: "high" }))).toEqual([t.overdueHigh]);
    expect(ids(await list(user, "upcoming", { p_category: "review_request" }))).toEqual([t.notStarted]);
  });

  it("returns the contact name and the opportunity's product line", async () => {
    expect((await list(user, "today"))[0]).toMatchObject({ first_name: "Riley", product_line: "home" });
  });

  it("an unknown view returns nothing", async () => {
    expect(await list(user, "everything")).toEqual([]);
  });

  it("counts open tasks per view", async () => {
    const counts = await asUser(db, user, (q) => q.query("select * from public.task_counts($1::date)", [TODAY]).then((r) => r.rows[0]));
    expect(counts).toEqual({ overdue: "2", due_today: "1", upcoming: "2" });
  });

  it("shows nothing to another account, a password-only session, or anonymous callers", async () => {
    expect(await list(other, "today")).toEqual([]);
    expect(ids(await list(other, "overdue"))).toHaveLength(1); // only their own
    expect(await list(user, "overdue", {}, true)).toEqual([]);
    expect(await errorCode(asAnon(db, (q) => q.query("select * from public.task_counts(current_date)")))).toBe("42501");
  });
});

describe("activities", () => {
  it("are kept with their contact and cannot be deleted", async () => {
    const id = await asUser(db, agent, async (q) => {
      const { rows } = await q.query<{ id: string }>(
        "insert into public.activities (contact_id, activity_type, outcome, notes) values ($1, 'call', 'left_message', 'Fictional') returning id",
        [contact],
      );
      return rows[0]!.id;
    });
    expect(await errorCode(asUser(db, agent, (q) => q.query("delete from public.activities where id = $1", [id])))).toBe("42501");
    const seen = await asUser(db, other, (q) => q.query("select id from public.activities where id = $1", [id]));
    expect(seen.rowCount).toBe(0);
  });

  it("a requested follow-up date needs the 'requested follow-up' outcome", async () => {
    expect(
      await errorCode(
        asUser(db, agent, (q) =>
          q.query("insert into public.activities (contact_id, activity_type, outcome, requested_follow_up_on) values ($1, 'call', 'connected', '2026-11-01')", [contact]),
        ),
      ),
    ).toBe("23514");
  });
});
