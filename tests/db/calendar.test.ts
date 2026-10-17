import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInZone } from "@/lib/dates";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 18 (ADR-034): calendar subscription link. Fictional data only.

let db: Db;
let alice: string;
let bob: string;
const today = todayInZone("America/New_York");

const rotate = (user: string) =>
  asUser(db, user, async (q) => (await q.query("select public.rotate_calendar_link() as t")).rows[0].t as string);
const feed = (token: string) =>
  asAnon(db, async (q) => (await q.query("select * from public.calendar_feed($1)", [token])).rows);
const addTask = (user: string, contact: string, title: string, due: string) =>
  asUser(db, user, async (q) =>
    (await q.query("insert into public.tasks (contact_id, title, due_date) values ($1, $2, $3) returning id", [contact, title, due])).rows[0].id as string);

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "cal-alice");
  bob = await createUser(db, "cal-bob");
});
afterAll(async () => {
  await db.end();
});

describe("calendar link", () => {
  it("is shown once: only a hash is stored, and a new link disables the old one", async () => {
    const first = await rotate(alice);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const stored = (await db.query("select encode(token_hash, 'hex') as h, enabled from public.calendar_feeds where owner_id = $1", [alice])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].h).not.toContain(first);
    expect(JSON.stringify((await db.query("select * from public.calendar_feeds where owner_id = $1", [alice])).rows)).not.toContain(first);

    const second = await rotate(alice);
    expect(second).not.toBe(first);
    expect(await errorCode(feed(first))).toBe("P0002");
    expect(await feed(second)).toEqual([]);
    const rows = (await db.query("select enabled from public.calendar_feeds where owner_id = $1 order by created_at", [alice])).rows;
    expect(rows.map((r) => r.enabled)).toEqual([false, true]);
  });

  it("lists only the link owner's open tasks, with the contact's name, by due date", async () => {
    const carol = await createUser(db, "cal-carol");
    const person = await insertContact(db, carol, { first_name: "Robin", last_name: "Example" });
    const business = await insertContact(db, carol, { contact_type: "business", business_name: "Example Bakery LLC", first_name: null, last_name: null });
    await addTask(carol, person, "Call about the home quote", addDays(today, 3));
    await addTask(carol, business, "Renewal review", addDays(today, 1));
    const overdue = await addTask(carol, person, "Overdue check-in", addDays(today, -5));
    const done = await addTask(carol, person, "Done already", today);
    await addTask(carol, person, "Too far ahead", addDays(today, 500));
    await asUser(db, carol, (q) => q.query("update public.tasks set status = 'completed', completed_at = now() where id = $1", [done]));
    const theirs = await insertContact(db, bob, { first_name: "Bobs" });
    await addTask(bob, theirs, "Bob's task", today);

    const token = await rotate(carol);
    const rows = await feed(token);
    expect(rows.map((r) => [r.title, r.contact_name, r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : r.due_date])).toEqual([
      ["Overdue check-in", "Robin Example", addDays(today, -5)],
      ["Renewal review", "Example Bakery LLC", addDays(today, 1)],
      ["Call about the home quote", "Robin Example", addDays(today, 3)],
    ]);
    expect(rows[0].task_id).toBe(overdue);
    // A completed task leaves the feed.
    await asUser(db, carol, (q) => q.query("update public.tasks set status = 'completed', completed_at = now() where id = $1", [overdue]));
    expect((await feed(token)).map((r) => r.title)).not.toContain("Overdue check-in");
  });

  it("is refused for a bad, unknown or turned-off link; signed-in users cannot call the feed function", async () => {
    const dana = await createUser(db, "cal-dana");
    const token = await rotate(dana);
    for (const bad of ["", "abc", "g".repeat(64), "a".repeat(64), `${token}x`]) expect(await errorCode(feed(bad)), bad).toBe("P0002");
    expect(await errorCode(asUser(db, dana, (q) => q.query("select * from public.calendar_feed($1)", [token])))).toBe("42501");
    await asUser(db, dana, (q) => q.query("update public.calendar_feeds set enabled = false, disabled_at = now() where enabled"));
    expect(await errorCode(feed(token))).toBe("P0002");
  });

  it("records 'last used' at most hourly, without filling the audit log", async () => {
    const erin = await createUser(db, "cal-erin");
    const token = await rotate(erin);
    const audits = async () => Number((await db.query("select count(*) from public.audit_log where table_name = 'calendar_feeds' and owner_id = $1", [erin])).rows[0].count);
    const before = await audits();
    await feed(token);
    await feed(token);
    const row = (await db.query("select last_fetched_at, updated_at from public.calendar_feeds where owner_id = $1 and enabled", [erin])).rows[0];
    expect(row.last_fetched_at).not.toBeNull();
    expect(await audits()).toBe(before);
  });

  it("is each agent's own, needs two-step sign-in, and the hash cannot be changed", async () => {
    await rotate(bob);
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.calendar_feeds where owner_id = $1", [alice])).rows[0].n)).toBe(0);
    const changed = await asUser(db, bob, async (q) => (await q.query("update public.calendar_feeds set enabled = false, disabled_at = now() where owner_id = $1", [alice])).rowCount);
    expect(changed).toBe(0);
    expect(await errorCode(asUser(db, bob, (q) => q.query("update public.calendar_feeds set token_hash = $1 where owner_id = $2", [Buffer.alloc(32), bob])))).toBe("42501");
    expect(await errorCode(asPasswordOnlyUser(db, bob, (q) => q.query("select public.rotate_calendar_link()")))).toBe("42501");
    expect(await errorCode(asAnon(db, (q) => q.query("select public.rotate_calendar_link()")))).toBe("42501");
  });
});
