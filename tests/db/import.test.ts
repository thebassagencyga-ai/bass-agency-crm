import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, todayInZone } from "@/lib/dates";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 15 import (ADR-031): one transaction, policies as won opportunities, renewals rolled
// forward, matched contacts left as they are, reports ignore imported history, undo all or
// nothing within 7 days and only while nothing was changed. Fictional data only.

let db: Db;
let alice: string;
let bob: string;
const today = todayInZone("America/New_York");

const person = (first: string, extra: Record<string, unknown> = {}) => ({
  existing_contact_id: null,
  contact: { contact_type: "individual", first_name: first, last_name: "Example", email: `${first.toLowerCase()}@example.com`, phone: "404-555-0101", ...extra },
  policies: [] as Record<string, unknown>[],
});
const importBook = (user: string, contacts: unknown[], file = "clients.csv") =>
  asUser(db, user, async (q) => (await q.query("select public.import_book($1, $2) as r", [file, JSON.stringify(contacts)])).rows[0].r);
const undo = (user: string, batch: string) =>
  asUser(db, user, (q) => q.query("update public.import_batches set status = 'undone' where id = $1", [batch]));
const errorMessage = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "import-alice");
  bob = await createUser(db, "import-bob");
});
afterAll(async () => {
  await db.end();
});

describe("import_book", () => {
  it("creates clients and their policies in one batch", async () => {
    const soon = addDays(today, 20);
    const a = person("Avery");
    a.policies = [
      { line: "auto", carrier: "Example Mutual", premium: "1200.50", effective_date: addMonths(soon, -6), renewal_date: soon, term_months: 6 },
      { line: "home", carrier: "Sample Insurance", premium: 900, effective_date: "2025-03-01", renewal_date: "2026-03-01" },
    ];
    const b = { ...person("Blake"), contact: { contact_type: "business", business_name: "Example Bakery LLC", phone: "404-555-0102" }, policies: [{ line: "commercial", carrier: "Example Commercial", premium: 3000 }] };
    const prospect = person("Casey");
    const r = await importBook(alice, [a, b, prospect]);
    expect(r).toMatchObject({ contacts_created: 3, contacts_matched: 0, policies_created: 3 });

    const contacts = (await db.query(
      "select first_name, business_name, relationship_status, lead_source, import_batch_id from public.contacts where import_batch_id = $1 order by coalesce(first_name, business_name)",
      [r.batch_id])).rows;
    expect(contacts.map((c) => [c.first_name ?? c.business_name, c.relationship_status, c.lead_source])).toEqual([
      ["Avery", "client", "Imported"], ["Casey", "prospect", "Imported"], ["Example Bakery LLC", "client", "Imported"],
    ]);

    const opps = (await db.query(
      `select o.product_line, o.outcome, s.kind, o.quoted_carrier, o.estimated_annual_premium::text as premium,
              o.effective_date::text as eff, o.renewal_date::text as ren, o.policy_term_months as term, o.closed_at is not null as closed
         from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
        where o.import_batch_id = $1 order by o.product_line`, [r.batch_id])).rows;
    expect(opps[0]).toMatchObject({ product_line: "auto", outcome: "won", kind: "won", quoted_carrier: "Example Mutual", premium: "1200.50", ren: soon, term: 6, closed: true });
    // A renewal date already passed is moved forward by the term until it is in the future.
    expect(opps[2]!.product_line).toBe("home");
    expect(opps[2]!.ren > today).toBe(true);
    expect(opps[2]!.ren.endsWith("-03-01")).toBe(true);
    expect(opps[1]).toMatchObject({ product_line: "commercial", ren: null, eff: null, closed: true });

    // The automation adds a renewal review; one already due is due today, not overdue.
    const reviews = (await db.query(
      "select t.due_date::text as due from public.tasks t join public.opportunities o on o.id = t.opportunity_id where o.import_batch_id = $1 and t.category = 'renewal'",
      [r.batch_id])).rows;
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    expect(reviews.every((t) => t.due >= today)).toBe(true);
  });

  it("adds policies to a matched contact and leaves that contact as it is (except: now a client)", async () => {
    const existing = await insertContact(db, alice, { first_name: "Drew", last_name: "Example", email: "drew@example.com", notes: "Met at church." });
    const before = (await db.query("select * from public.contacts where id = $1", [existing])).rows[0];
    const r = await importBook(alice, [{ existing_contact_id: existing, contact: { first_name: "Ignored", email: "other@example.com" }, policies: [{ line: "life", carrier: "Example Life", premium: 400 }] }]);
    expect(r).toMatchObject({ contacts_created: 0, contacts_matched: 1, policies_created: 1 });
    const after = (await db.query("select * from public.contacts where id = $1", [existing])).rows[0];
    // Phase 23 (ADR-039): a bound policy makes a prospect a client; nothing else on the contact changes.
    expect(before.relationship_status).toBe("prospect");
    expect(after).toEqual({ ...before, relationship_status: "client", updated_at: after.updated_at });
    expect((await db.query("select product_line from public.opportunities where contact_id = $1", [existing])).rows).toEqual([{ product_line: "life" }]);
  });

  it("is all or nothing: one bad row and nothing is saved", async () => {
    const count = async () => Number((await db.query("select count(*) from public.contacts where owner_id = $1", [alice])).rows[0].count);
    const n = await count();
    const bad = [person("Good1"), { ...person("Bad"), contact: { contact_type: "individual", first_name: "Bad", email: "not-an-email" } }];
    expect(await errorCode(importBook(alice, bad))).toBe("23514");
    const badLine = [{ ...person("Line"), policies: [{ line: "boat" }] }];
    expect(await errorMessage(importBook(alice, badLine))).toBe("Unknown line: boat");
    expect(await count()).toBe(n);
    expect(Number((await db.query("select count(*) from public.import_batches where owner_id = $1 and contacts_created = 0 and contacts_matched = 0", [alice])).rows[0].count)).toBe(0);
  });

  it("refuses an empty or oversized import", async () => {
    expect(await errorMessage(importBook(alice, []))).toBe("Nothing to import.");
    expect(await errorMessage(importBook(alice, Array.from({ length: 1001 }, (_, i) => person(`P${i}`))))).toBe("Import at most 1,000 clients at a time.");
  });

  it("cannot attach policies to another agent's contact, and is not for anonymous or password-only sessions", async () => {
    const theirs = await insertContact(db, bob, { first_name: "Bob's", last_name: "Client" });
    expect(await errorCode(importBook(alice, [{ existing_contact_id: theirs, contact: {}, policies: [{ line: "auto" }] }]))).toBe("P0002");
    expect(await errorCode(asAnon(db, (q) => q.query("select public.import_book('x', '[]')")))).toBe("42501");
    expect(await errorCode(asPasswordOnlyUser(db, alice, (q) => q.query("select public.import_book('x', $1)", [JSON.stringify([person("Aal1")])])))).toBeDefined();
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.import_batches where owner_id = $1", [alice])).rows[0].n)).toBe(0);
  });

  it("handles 500 clients in one go", async () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ ...person(`Bulk${i}`, { phone: null }), policies: [{ line: "auto", premium: 1000, renewal_date: addDays(today, 30 + (i % 300)) }] }));
    const started = Date.now();
    const r = await importBook(alice, big, "bulk.csv");
    expect(r).toMatchObject({ contacts_created: 500, policies_created: 500 });
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

describe("reports ignore imported history", () => {
  it("imported clients are not new leads, wins or referrals", async () => {
    const carol = await createUser(db, "import-carol");
    await importBook(carol, [{ ...person("Rpt"), policies: [{ line: "auto", effective_date: today, renewal_date: addMonths(today, 12) }] }]);
    const r = await asUser(db, carol, async (q) => (await q.query("select public.report_summary($1::date, $1::date, $1::date) as r", [today])).rows[0].r);
    expect(r.new_leads).toEqual([]);
    expect(r.conversion).toEqual([]);
    expect(r.referrals).toEqual([]);
    expect(r.asks.referrals_received).toBe(0);
    // …but the policy is a policy: it shows in renewals.
    expect(r.renewals.policies_next_90).toBe(0);
  });
});

describe("undo", () => {
  it("removes everything the import created, when nothing was changed", async () => {
    const r = await importBook(alice, [{ ...person("Undo1"), policies: [{ line: "home", renewal_date: addDays(today, 10) }] }, person("Undo2")]);
    await undo(alice, r.batch_id);
    expect(Number((await db.query("select count(*) from public.contacts where import_batch_id = $1", [r.batch_id])).rows[0].count)).toBe(0);
    expect(Number((await db.query("select count(*) from public.opportunities where import_batch_id = $1", [r.batch_id])).rows[0].count)).toBe(0);
    const batch = (await db.query("select status, undone_at from public.import_batches where id = $1", [r.batch_id])).rows[0];
    expect(batch.status).toBe("undone");
    expect(batch.undone_at).not.toBeNull();
    // Recorded in the audit log.
    expect(Number((await db.query("select count(*) from public.audit_log where action = 'delete' and table_name = 'contacts' and owner_id = $1", [alice])).rows[0].count)).toBeGreaterThanOrEqual(2);
    // An undone import stays undone.
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.import_batches set status = 'done', undone_at = null where id = $1", [r.batch_id])))).toBe("23514");
  });

  it.each([
    ["a contact was edited", "update public.contacts set notes = 'Called' where import_batch_id = $1"],
    ["an activity was logged", "insert into public.activities (contact_id, activity_type) select id, 'call' from public.contacts where import_batch_id = $1 limit 1"],
    ["a task was completed", "update public.tasks set status = 'completed', completed_at = now() where opportunity_id in (select id from public.opportunities where import_batch_id = $1)"],
    ["a new opportunity was added", "insert into public.opportunities (contact_id, product_line, stage_id) select c.id, 'life', s.id from public.contacts c, public.pipeline_stages s where c.import_batch_id = $1 and s.product_line = 'life' and s.position = 1 limit 1"],
  ])("is refused, changing nothing, when %s", async (_label, sql) => {
    const r = await importBook(alice, [{ ...person("Keep"), policies: [{ line: "auto", renewal_date: addDays(today, 15) }] }]);
    await asUser(db, alice, (q) => q.query(sql, [r.batch_id]));
    expect(await errorMessage(undo(alice, r.batch_id))).toBe("import_changed");
    expect(Number((await db.query("select count(*) from public.contacts where import_batch_id = $1", [r.batch_id])).rows[0].count)).toBe(1);
    expect((await db.query("select status from public.import_batches where id = $1", [r.batch_id])).rows[0].status).toBe("done");
  });

  it("is refused after 7 days", async () => {
    const r = await importBook(alice, [person("Old")]);
    // Backdate (triggers paused: they keep created_at fixed on purpose).
    await db.query("begin");
    await db.query("set local session_replication_role = replica");
    await db.query("update public.import_batches set created_at = now() - interval '8 days' where id = $1", [r.batch_id]);
    await db.query("commit");
    expect(await errorMessage(undo(alice, r.batch_id))).toBe("import_too_old");
  });

  it("another agent cannot undo it; users still cannot delete anything directly", async () => {
    const r = await importBook(alice, [person("Mine")]);
    const changed = await asUser(db, bob, async (q) => (await q.query("update public.import_batches set status = 'undone' where id = $1", [r.batch_id])).rowCount);
    expect(changed).toBe(0);
    expect(await errorCode(asUser(db, alice, (q) => q.query("delete from public.contacts where import_batch_id = $1", [r.batch_id])))).toBe("42501");
    expect(await errorCode(asUser(db, alice, (q) => q.query("delete from public.import_batches where id = $1", [r.batch_id])))).toBe("42501");
  });
});
