import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, todayInZone } from "../../src/lib/dates";
import { asUser, connect, createUser, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 11 date-handling suite: the app (TypeScript) and the database (PostgreSQL) must agree
// on every date rule — "today" in New York across midnight and daylight-saving changes,
// calendar-day and month arithmetic, business days, renewal roll-forward — so a task or
// renewal never lands a day early or late depending on which side computed it (ADR-007).

let db: Db;
let user: string;
beforeAll(async () => {
  db = await connect();
  user = await createUser(db, "dates");
  await asUser(db, user, (q) => q.query("update public.automation_rules set enabled = false where rule_key <> 'renewal_review'"));
});
afterAll(async () => {
  await db.end();
});

const pg = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0].v as T;

describe("today in New York: app and database agree", () => {
  it.each([
    "2026-10-16T03:59:59Z", // 11:59 pm EDT on Oct 15
    "2026-10-16T04:00:00Z", // midnight EDT
    "2026-11-01T05:30:00Z", // 1:30 am, the hour that repeats (EDT → EST)
    "2026-11-02T04:59:59Z", // 11:59 pm EST on Nov 1
    "2026-11-02T05:00:00Z", // midnight EST
    "2027-03-14T06:59:59Z", // 1:59 am EST, just before clocks go forward
    "2027-03-14T07:00:00Z", // 3:00 am EDT
    "2026-12-31T23:30:00Z", // New Year's Eve evening: still 2026 in New York
    "2027-01-01T05:00:00Z", // midnight New Year in New York
    "2028-02-29T04:30:00Z", // leap day morning UTC: Feb 28 evening in New York
  ])("%s", async (instant) => {
    const app = todayInZone("America/New_York", new Date(instant));
    const database = await pg<string>("select (($1::timestamptz) at time zone 'America/New_York')::date::text as v", [instant]);
    expect(app).toBe(database);
  });

  it("the database's own today uses the user's time zone, not the server's", async () => {
    await db.query("update public.profiles set time_zone = 'Pacific/Honolulu' where id = $1", [user]);
    const [engine, honolulu] = await asUser(db, user, async (q) => {
      const r = await q.query("select crm_engine.user_today()::text as a, (now() at time zone 'Pacific/Honolulu')::date::text as b");
      return [r.rows[0].a, r.rows[0].b];
    });
    expect(engine).toBe(honolulu);
    await db.query("update public.profiles set time_zone = 'America/New_York' where id = $1", [user]);
  });
});

describe("calendar arithmetic: app and database agree", () => {
  const dates = ["2026-01-31", "2026-02-28", "2026-03-08", "2026-08-31", "2026-10-31", "2026-11-01", "2026-12-31", "2027-03-14", "2028-02-29", "2028-08-31"];

  it.each(dates)("days from %s", async (d) => {
    for (const n of [-366, -31, -1, 1, 7, 30, 60, 365]) {
      expect(addDays(d, n)).toBe(await pg<string>("select ($1::date + $2::int)::text as v", [d, n]));
    }
  });

  it.each(dates)("months from %s (renewal terms clamp to month end)", async (d) => {
    for (const n of [1, 6, 12, -1, -12]) {
      expect(addMonths(d, n)).toBe(await pg<string>("select ($1::date + make_interval(months => $2))::date::text as v", [d, n]));
    }
  });
});

describe("business days (Mon–Fri)", () => {
  it.each([
    ["2026-10-16", 2, "2026-10-20"], // Friday + 2 → Tuesday
    ["2026-10-17", 1, "2026-10-19"], // Saturday + 1 → Monday
    ["2026-10-18", 2, "2026-10-20"], // Sunday + 2 → Tuesday
    ["2026-10-12", 5, "2026-10-19"], // Monday + 5 → next Monday
    ["2026-12-31", 1, "2027-01-01"], // holidays are not skipped (ADR-007)
    ["2026-10-19", -1, "2026-10-16"], // Monday − 1 → Friday
    ["2026-10-16", 0, "2026-10-16"],
  ])("%s + %i → %s", async (from, n, expected) => {
    expect(await pg<string>("select crm_engine.add_business_days($1::date, $2)::text as v", [from, n])).toBe(expected);
  });
});

describe("renewal dates", () => {
  it.each([
    ["2026-08-31", 6, "2027-02-28"],
    ["2027-08-31", 6, "2028-02-29"],
    ["2028-02-29", 12, "2029-02-28"],
    ["2026-12-31", 12, "2027-12-31"],
  ])("a renewal on %s with a %i-month term rolls to %s, matching the app's preview", async (renewal, term, expected) => {
    const c = await insertContact(db, user, { first_name: "Dale", relationship_status: "client" });
    const id = await insertOpportunity(db, user, c, "auto", "bound", { outcome: "won", renewal_date: renewal, policy_term_months: term });
    const next = await asUser(db, user, async (q) => (await q.query("select public.record_renewal_outcome($1, 'renewed') ->> 'next_renewal_date' as v", [id])).rows[0].v);
    expect(next).toBe(expected);
    expect(addMonths(renewal, term)).toBe(expected); // what the renewal page shows beforehand
  });

  it("a review is never scheduled in the past, and is due 60 days before a distant renewal", async () => {
    const today = await asUser(db, user, async (q) => (await q.query("select crm_engine.user_today()::text as v")).rows[0].v as string);
    const c = await insertContact(db, user, { first_name: "Reese" });
    const soon = await insertOpportunity(db, user, c, "home", "bound", { outcome: "won", renewal_date: addDays(today, 10) });
    const later = await insertOpportunity(db, user, c, "life", "placed", { outcome: "won", renewal_date: addDays(today, 200) });
    const due = (opp: string) => asUser(db, user, async (q) => (await q.query("select due_date::text as v from public.tasks where opportunity_id = $1 and category = 'renewal'", [opp])).rows[0].v);
    expect(await due(soon)).toBe(today);
    expect(await due(later)).toBe(addDays(today, 140));
  });
});

describe("stored values", () => {
  it("calendar dates come back exactly as entered, whatever the session time zone", async () => {
    const c = await insertContact(db, user, { first_name: "Tess" });
    const id = await insertOpportunity(db, user, c, "auto", "quoted", { effective_date: "2026-11-01", renewal_date: "2027-11-01" });
    for (const tz of ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      await db.query(`set time zone '${tz}'`);
      const r = (await db.query("select effective_date::text as e, renewal_date::text as r from public.opportunities where id = $1", [id])).rows[0];
      expect(r).toEqual({ e: "2026-11-01", r: "2027-11-01" });
    }
    await db.query("set time zone 'UTC'");
  });
});
