import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 7: dashboard counts validated against fixture data.

const TODAY = "2026-10-15";
let db: Db;
let user: string;
let other: string;

type Summary = {
  tasks: { overdue: number; due_today: number; upcoming_7_days: number };
  open_by_line: { product_line: string; open_count: number; nurture_count: number; premium: number }[];
  renewals: { next_60_days: number; soonest: { id: string; renewal_date: string; first_name: string | null; business_name: string | null }[] };
  recent_activity: { id: string; activity_type: string; first_name: string | null }[];
};
const summary = (userId: string, aal1 = false): Promise<Summary> => {
  const run = async (q: Db) => (await q.query("select public.dashboard_summary($1::date) as s", [TODAY])).rows[0].s as Summary;
  return aal1 ? asPasswordOnlyUser(db, userId, run) : asUser(db, userId, run);
};
const task = (userId: string, contactId: string, due: string, status = "open") =>
  asUser(db, userId, async (q) => {
    const { rows } = await q.query("insert into public.tasks (contact_id, title, due_date) values ($1, 'Fixture task', $2) returning id", [contactId, due]);
    if (status !== "open") await q.query("update public.tasks set status = $2 where id = $1", [rows[0].id, status]);
  });

beforeAll(async () => {
  db = await connect();
  user = await createUser(db, "dashboard");
  other = await createUser(db, "dashboard-other");
  // Fixture counts only: no automatic tasks.
  for (const u of [user, other]) await asUser(db, u, (q) => q.query("update public.automation_rules set enabled = false"));

  const pat = await insertContact(db, user, { first_name: "Pat", last_name: "Example" });
  const shop = await insertContact(db, user, { contact_type: "business", business_name: "Example Hardware LLC" });

  // Tasks: 2 overdue, 1 today, 2 in the next 7 days, 1 later, plus done ones that never count.
  await task(user, pat, "2026-10-01");
  await task(user, pat, "2026-10-14");
  await task(user, pat, TODAY);
  await task(user, shop, "2026-10-16");
  await task(user, shop, "2026-10-22");
  await task(user, shop, "2026-11-30");
  await task(user, pat, "2026-10-02", "completed");
  await task(user, pat, TODAY, "cancelled");

  // Opportunities: auto 2 open (1,000 + 500) + 1 nurture; home 1 open; life won and lost (not open).
  await insertOpportunity(db, user, pat, "auto", "quoted", { estimated_annual_premium: 1000, renewal_date: "2026-11-01" });
  await insertOpportunity(db, user, shop, "auto", "new_lead", { estimated_annual_premium: 500 });
  await insertOpportunity(db, user, pat, "auto", "follow_up", { outcome: "nurture" });
  await insertOpportunity(db, user, shop, "home", "contacted", { renewal_date: "2026-10-20" });
  await insertOpportunity(db, user, pat, "life", "placed", { outcome: "won", estimated_annual_premium: 900, renewal_date: "2026-12-10" });
  await insertOpportunity(db, user, shop, "commercial", "lost", { outcome: "lost", loss_reason: "price", renewal_date: "2026-10-25" });
  await insertOpportunity(db, user, pat, "home", "quoted", { renewal_date: "2027-03-01" }); // beyond 60 days

  // Activities: 9 so the list is capped at 8; newest first.
  for (let i = 1; i <= 9; i++) {
    await asUser(db, user, (q) =>
      q.query("insert into public.activities (contact_id, activity_type, occurred_at) values ($1, 'call', $2)", [pat, `2026-10-${String(i).padStart(2, "0")}T15:00:00Z`]),
    );
  }

  // Another agent's data must never be counted.
  const theirs = await insertContact(db, other, { first_name: "Pat", last_name: "Example" });
  await task(other, theirs, "2026-10-01");
  await insertOpportunity(db, other, theirs, "auto", "quoted", { renewal_date: "2026-10-20", estimated_annual_premium: 99999 });
});
afterAll(async () => {
  await db.end();
});

describe("dashboard_summary", () => {
  it("counts open tasks: overdue, due today, next 7 days", async () => {
    expect((await summary(user)).tasks).toEqual({ overdue: 2, due_today: 1, upcoming_7_days: 2 });
  });

  it("counts open and nurture opportunities by line with their estimated premium", async () => {
    expect((await summary(user)).open_by_line).toEqual([
      { product_line: "auto", open_count: 2, nurture_count: 1, premium: 1500 },
      { product_line: "home", open_count: 2, nurture_count: 0, premium: 0 },
    ]);
  });

  it("lists renewals in the next 60 days (soonest first), excluding lost ones", async () => {
    const r = (await summary(user)).renewals;
    // Oct 20 (home), Nov 1 (auto) and Dec 10 (won life policy) are within 60 days; the lost
    // commercial one (Oct 25) and the March renewal are not.
    expect(r.next_60_days).toBe(3);
    expect(r.soonest.map((x) => [x.renewal_date, x.business_name ?? x.first_name])).toEqual([
      ["2026-10-20", "Example Hardware LLC"],
      ["2026-11-01", "Pat"],
      ["2026-12-10", "Pat"],
    ]);
  });

  it("shows the 8 most recent activities, newest first", async () => {
    const recent = (await summary(user)).recent_activity;
    expect(recent).toHaveLength(8);
    expect(recent[0]).toMatchObject({ activity_type: "call", first_name: "Pat" });
  });

  it("another agent sees only their own numbers", async () => {
    const theirs = await summary(other);
    expect(theirs.tasks).toEqual({ overdue: 1, due_today: 0, upcoming_7_days: 0 });
    expect(theirs.open_by_line).toEqual([{ product_line: "auto", open_count: 1, nurture_count: 0, premium: 99999 }]);
    expect(theirs.recent_activity).toEqual([]);
  });

  it("is empty for a password-only session and refused to anonymous callers", async () => {
    const s = await summary(user, true);
    expect(s).toEqual({ tasks: { overdue: 0, due_today: 0, upcoming_7_days: 0 }, open_by_line: [], renewals: { next_60_days: 0, soonest: [] }, recent_activity: [] });
    expect(await errorCode(asAnon(db, (q) => q.query("select public.dashboard_summary(current_date)")))).toBe("42501");
  });
});
