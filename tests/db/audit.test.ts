import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, errorCode, insertContact, insertOpportunity, stageId, type Db } from "./helpers";

// Audit trail (ADR-009): written by trigger, readable by the owner, immutable to app users.

let db: Db;
let agent: string;
let other: string;

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "audited");
  other = await createUser(db, "other");
});
afterAll(async () => {
  await db.end();
});

const auditRows = (userId: string, recordId: string) =>
  asUser(db, userId, async (q) =>
    (
      await q.query<{ action: string; actor_id: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null }>(
        "select action, actor_id, old_values, new_values from public.audit_log where record_id = $1 order by id",
        [recordId],
      )
    ).rows,
  );

describe("audit log", () => {
  it("records inserts and only the changed columns of updates, with the acting user", async () => {
    const contact = await insertContact(db, agent, { first_name: "Before" });
    await asUser(db, agent, (q) => q.query("update public.contacts set first_name = 'After' where id = $1", [contact]));

    const rows = await auditRows(agent, contact);
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows.every((r) => r.actor_id === agent)).toBe(true);
    expect(rows[1]!.old_values).toEqual({ first_name: "Before" });
    expect(rows[1]!.new_values).toEqual({ first_name: "After" });
  });

  it("records an opportunity outcome change", async () => {
    const contact = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, contact, "auto", "quoted");
    const lost = await stageId(db, "auto", "lost");
    await asUser(db, agent, (q) =>
      q.query("update public.opportunities set stage_id = $1, outcome = 'lost', loss_reason = 'price' where id = $2", [lost, opp]),
    );
    const update = (await auditRows(agent, opp)).find((r) => r.action === "update");
    expect(update?.old_values).toMatchObject({ outcome: "open", loss_reason: null });
    expect(update?.new_values).toMatchObject({ outcome: "lost", loss_reason: "price" });
  });

  it("does not write an entry for a no-op update", async () => {
    const contact = await insertContact(db, agent);
    await asUser(db, agent, (q) => q.query("update public.contacts set first_name = first_name where id = $1", [contact]));
    expect((await auditRows(agent, contact)).map((r) => r.action)).toEqual(["insert"]);
  });

  it("is invisible to other users", async () => {
    const contact = await insertContact(db, agent);
    expect(await auditRows(other, contact)).toEqual([]);
  });

  it.each([
    "insert into public.audit_log (owner_id, table_name, record_id, action) values (auth.uid(), 'contacts', gen_random_uuid(), 'insert')",
    "update public.audit_log set action = 'delete'",
    "delete from public.audit_log",
  ])("cannot be modified by users: %s", async (sql) => {
    expect(await errorCode(asUser(db, agent, (q) => q.query(sql)))).toBe("42501");
  });
});
