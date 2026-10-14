import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser, connect, createUser, errorCode, insertContact, insertOpportunity, stageId, type Db,
} from "./helpers";

// Schema constraints and business rules enforced by the database (ROADMAP Phase 1).

let db: Db;
let agent: string;

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "agent");
});
afterAll(async () => {
  await db.end();
});

const CHECK = "23514";
const FK = "23503";
const UNIQUE = "23505";
const NOT_NULL = "23502";

describe("contacts", () => {
  it("accepts an individual with only a first name and a business with only a business name", async () => {
    await expect(insertContact(db, agent, { first_name: "Jordan", last_name: null })).resolves.toBeTruthy();
    await expect(
      insertContact(db, agent, { contact_type: "business", first_name: null, last_name: null, business_name: "Example Hardware LLC" }),
    ).resolves.toBeTruthy();
  });

  it.each([
    ["individual with no name", { first_name: "  ", last_name: null }],
    ["business with no business name", { contact_type: "business", business_name: "" }],
    ["malformed email", { email: "not-an-email" }],
    ["lower-case state", { state: "ga" }],
    ["bad ZIP code", { postal_code: "3011" }],
    ["notes over 5000 characters", { notes: "x".repeat(5001) }],
  ])("rejects %s", async (_label, overrides) => {
    expect(await errorCode(insertContact(db, agent, overrides))).toBe(CHECK);
  });

  it("accepts a complete fictional address", async () => {
    await expect(
      insertContact(db, agent, {
        email: "pat@example.com", phone: "770-555-0101", address_line1: "1 Example St",
        city: "Carrollton", state: "GA", postal_code: "30117", preferred_contact_method: "text",
        lead_source: "Referral",
      }),
    ).resolves.toBeTruthy();
  });

  it("defaults to an active prospect owned by the caller", async () => {
    const id = await insertContact(db, agent);
    const { rows } = await db.query("select owner_id, relationship_status, archived_at from public.contacts where id = $1", [id]);
    expect(rows[0]).toEqual({ owner_id: agent, relationship_status: "prospect", archived_at: null });
  });

  it("keeps id and created_at fixed and bumps updated_at on update", async () => {
    const id = await insertContact(db, agent);
    const before = (await db.query("select created_at, updated_at from public.contacts where id = $1", [id])).rows[0];
    await asUser(db, agent, (q) =>
      q.query("update public.contacts set first_name = 'Renamed', created_at = '2000-01-01', id = gen_random_uuid() where id = $1", [id]),
    );
    const after = (await db.query("select created_at, updated_at, first_name from public.contacts where id = $1", [id])).rows[0];
    expect(after.first_name).toBe("Renamed");
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
  });

  it("can be archived and unarchived", async () => {
    const id = await insertContact(db, agent);
    await asUser(db, agent, (q) => q.query("update public.contacts set archived_at = now() where id = $1", [id]));
    await asUser(db, agent, (q) => q.query("update public.contacts set archived_at = null where id = $1", [id]));
    const { rows } = await db.query("select archived_at from public.contacts where id = $1", [id]);
    expect(rows[0].archived_at).toBeNull();
  });
});

describe("opportunities", () => {
  it("one contact can hold several opportunities across all four product lines", async () => {
    const contact = await insertContact(db, agent);
    for (const line of ["auto", "home", "commercial", "life"]) {
      await insertOpportunity(db, agent, contact, line);
    }
    await insertOpportunity(db, agent, contact, "auto"); // a second auto opportunity is also allowed
    const { rows } = await db.query<{ product_line: string }>(
      "select product_line from public.opportunities where contact_id = $1 order by product_line",
      [contact],
    );
    expect(rows.map((r) => r.product_line)).toEqual(["auto", "auto", "commercial", "home", "life"]);
    const contacts = await db.query("select count(*)::int as n from public.contacts where id = $1", [contact]);
    expect(contacts.rows[0].n).toBe(1);
  });

  it("rejects a stage that belongs to a different product line", async () => {
    const contact = await insertContact(db, agent);
    const lifeStage = await stageId(db, "life", "appointment_set");
    const code = await errorCode(
      asUser(db, agent, (q) =>
        q.query("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'auto', $2)", [contact, lifeStage]),
      ),
    );
    expect(code).toBe(FK);
  });

  it("rejects moving an existing opportunity to another line's stage", async () => {
    const contact = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, contact, "home");
    const commercialStage = await stageId(db, "commercial", "discovery");
    const code = await errorCode(
      asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $1 where id = $2", [commercialStage, opp])),
    );
    expect(code).toBe(FK);
  });

  it("rejects an unknown stage", async () => {
    const contact = await insertContact(db, agent);
    const code = await errorCode(
      asUser(db, agent, (q) =>
        q.query("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'auto', gen_random_uuid())", [contact]),
      ),
    );
    expect(code).toBe(NOT_NULL);
  });

  it.each([
    ["won outcome on an active stage", "auto", "quoted", { outcome: "won" }],
    ["open outcome on the Bound stage", "auto", "bound", { outcome: "open" }],
    ["won outcome on the Lost stage", "home", "lost", { outcome: "won", loss_reason: null }],
    ["life: won while only at Application Process", "life", "application_process", { outcome: "won" }],
    ["life: won while Decision Pending", "life", "decision_pending", { outcome: "won" }],
  ])("rejects %s", async (_label, line, stage, overrides) => {
    const contact = await insertContact(db, agent);
    expect(await errorCode(insertOpportunity(db, agent, contact, line, stage, overrides))).toBe(CHECK);
  });

  it("accepts Placed as the won outcome for life, and nurture on an active stage", async () => {
    const contact = await insertContact(db, agent);
    await expect(insertOpportunity(db, agent, contact, "life", "placed", { outcome: "won" })).resolves.toBeTruthy();
    await expect(insertOpportunity(db, agent, contact, "auto", "follow_up", { outcome: "nurture" })).resolves.toBeTruthy();
  });

  it("requires a loss reason when lost, and forbids one otherwise", async () => {
    const contact = await insertContact(db, agent);
    expect(await errorCode(insertOpportunity(db, agent, contact, "auto", "lost", { outcome: "lost" }))).toBe(CHECK);
    expect(
      await errorCode(insertOpportunity(db, agent, contact, "auto", "quoted", { loss_reason: "price" })),
    ).toBe(CHECK);
    await expect(
      insertOpportunity(db, agent, contact, "auto", "lost", { outcome: "lost", loss_reason: "price", loss_reason_detail: "Fictional" }),
    ).resolves.toBeTruthy();
  });

  it("stamps closed_at when won, keeps the record, and clears closed_at on reopen", async () => {
    const contact = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, contact, "home", "quoted", { quote_sent_on: "2026-10-01", estimated_annual_premium: 1234.5 });
    const bound = await stageId(db, "home", "bound");
    const followUp = await stageId(db, "home", "follow_up");

    await asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $1, outcome = 'won' where id = $2", [bound, opp]));
    let row = (await db.query("select outcome, closed_at, stage_kind from public.opportunities where id = $1", [opp])).rows[0];
    expect(row.outcome).toBe("won");
    expect(row.stage_kind).toBe("won");
    expect(row.closed_at).toBeInstanceOf(Date);

    await asUser(db, agent, (q) =>
      q.query("update public.opportunities set stage_id = $1, outcome = 'open', cycle = cycle + 1 where id = $2", [followUp, opp]),
    );
    row = (await db.query("select outcome, closed_at, cycle, quote_sent_on from public.opportunities where id = $1", [opp])).rows[0];
    expect(row).toMatchObject({ outcome: "open", closed_at: null, cycle: 2 });
    expect(row.quote_sent_on).toBeInstanceOf(Date); // history fields survive the reopen
  });

  it("rejects a renewal date on or before the effective date, and a negative premium", async () => {
    const contact = await insertContact(db, agent);
    expect(
      await errorCode(insertOpportunity(db, agent, contact, "auto", "new_lead", { effective_date: "2026-11-01", renewal_date: "2026-11-01" })),
    ).toBe(CHECK);
    expect(
      await errorCode(insertOpportunity(db, agent, contact, "auto", "new_lead", { estimated_annual_premium: -1 })),
    ).toBe(CHECK);
  });

  it("stores effective and renewal dates as calendar dates (no time zone shift)", async () => {
    const contact = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, contact, "auto", "new_lead", { effective_date: "2026-11-01", renewal_date: "2027-05-01" });
    const { rows } = await db.query(
      "select effective_date::text as e, renewal_date::text as r from public.opportunities where id = $1",
      [opp],
    );
    expect(rows[0]).toEqual({ e: "2026-11-01", r: "2027-05-01" });
  });
});

describe("tasks", () => {
  let contact: string;
  let opp: string;
  let ruleId: string;

  beforeAll(async () => {
    contact = await insertContact(db, agent);
    opp = await insertOpportunity(db, agent, contact, "auto");
    ruleId = await asUser(db, agent, async (q) =>
      (await q.query<{ id: string }>("select id from public.automation_rules where rule_key = 'quote_sent_follow_up'")).rows[0]!.id,
    );
  });

  const insertTask = (values: Record<string, unknown>) =>
    asUser(db, agent, async (q) => {
      const all = { contact_id: contact, title: "Follow up", due_date: "2026-10-20", ...values };
      const cols = Object.keys(all);
      const { rows } = await q.query<{ id: string }>(
        `insert into public.tasks (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(all),
      );
      return rows[0]!.id;
    });

  it("stamps completed_at on completion and clears it on reopen; history row is kept", async () => {
    const id = await insertTask({ opportunity_id: opp, priority: "high" });
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'completed' where id = $1", [id]));
    let row = (await db.query("select status, completed_at from public.tasks where id = $1", [id])).rows[0];
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBeInstanceOf(Date);
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'open' where id = $1", [id]));
    row = (await db.query("select status, completed_at from public.tasks where id = $1", [id])).rows[0];
    expect(row).toEqual({ status: "open", completed_at: null });
  });

  it("updating a due date changes the same task instead of creating another", async () => {
    const id = await insertTask({});
    await asUser(db, agent, (q) => q.query("update public.tasks set due_date = '2026-10-25', due_date_overridden = true where id = $1", [id]));
    const { rows } = await db.query("select due_date::text as d, due_date_overridden from public.tasks where id = $1", [id]);
    expect(rows[0]).toEqual({ d: "2026-10-25", due_date_overridden: true });
  });

  it("rejects a duplicate automation task with the same dedupe key, even after completion", async () => {
    const key = `opp:${opp}:rule:quote_sent_follow_up:cycle:1`;
    const first = await insertTask({ origin: "automation", automation_rule_id: ruleId, dedupe_key: key, opportunity_id: opp });
    await asUser(db, agent, (q) => q.query("update public.tasks set status = 'completed' where id = $1", [first]));
    expect(
      await errorCode(insertTask({ origin: "automation", automation_rule_id: ruleId, dedupe_key: key, opportunity_id: opp })),
    ).toBe(UNIQUE);
  });

  it("supports idempotent upsert on the dedupe key (retry updates, never duplicates)", async () => {
    const key = `opp:${opp}:rule:quote_sent_follow_up:cycle:9`;
    const upsert = (due: string) =>
      asUser(db, agent, (q) =>
        q.query(
          `insert into public.tasks (contact_id, opportunity_id, title, due_date, origin, automation_rule_id, dedupe_key)
           values ($1, $2, 'Follow up on quote', $3, 'automation', $4, $5)
           on conflict (owner_id, dedupe_key) where dedupe_key is not null
           do update set due_date = excluded.due_date
           where public.tasks.status = 'open' and not public.tasks.due_date_overridden`,
          [contact, opp, due, ruleId, key],
        ),
      );
    await upsert("2026-10-17");
    await upsert("2026-10-17");
    await upsert("2026-10-18");
    const { rows } = await db.query("select due_date::text as d from public.tasks where dedupe_key = $1", [key]);
    expect(rows).toEqual([{ d: "2026-10-18" }]);
  });

  it("requires automation tasks to carry a rule and key, and manual tasks to carry neither", async () => {
    expect(await errorCode(insertTask({ origin: "automation" }))).toBe(CHECK);
    expect(await errorCode(insertTask({ dedupe_key: "manual-with-key" }))).toBe(CHECK);
  });

  it("rejects an opportunity that belongs to a different contact", async () => {
    const otherContact = await insertContact(db, agent);
    const otherOpp = await insertOpportunity(db, agent, otherContact, "home");
    expect(await errorCode(insertTask({ opportunity_id: otherOpp }))).toBe(FK);
  });

  it("rejects a blank title and a missing due date", async () => {
    expect(await errorCode(insertTask({ title: "   " }))).toBe(CHECK);
    expect(await errorCode(insertTask({ due_date: null }))).toBe(NOT_NULL);
  });
});

describe("activities", () => {
  it("allows a requested follow-up date only with the requested_follow_up outcome", async () => {
    const contact = await insertContact(db, agent);
    const insert = (outcome: string) =>
      asUser(db, agent, (q) =>
        q.query(
          "insert into public.activities (contact_id, activity_type, outcome, requested_follow_up_on) values ($1, 'call', $2, '2026-11-02')",
          [contact, outcome],
        ),
      );
    expect(await errorCode(insert("connected"))).toBe(CHECK);
    await expect(insert("requested_follow_up")).resolves.toBeTruthy();
  });
});

describe("history preservation", () => {
  it("a contact with opportunities, tasks and activities cannot be deleted, even by the database owner", async () => {
    const contact = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, contact, "auto");
    await asUser(db, agent, async (q) => {
      await q.query("insert into public.tasks (contact_id, opportunity_id, title, due_date) values ($1, $2, 't', current_date)", [contact, opp]);
      await q.query("insert into public.activities (contact_id, opportunity_id, activity_type) values ($1, $2, 'note')", [contact, opp]);
    });
    expect(await errorCode(db.query("delete from public.contacts where id = $1", [contact]))).toBe(FK);
    expect(await errorCode(db.query("delete from public.opportunities where id = $1", [opp]))).toBe(FK);
  });

  it("a user with CRM records cannot be removed from auth.users (profile is restricted)", async () => {
    const user = await createUser(db, "leaver");
    await insertContact(db, user);
    expect(await errorCode(db.query("delete from auth.users where id = $1", [user]))).toBe(FK);
  });
});
