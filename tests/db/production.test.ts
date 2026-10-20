import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 28 (ADR-046): production and commission estimates. production_report works out written
// premium, expected commission by line, year to date and the next 12 months from the agent's
// own policies and rates. Fictional data only.

let db: Db;
let m0: string; // first day of this month (New York)

const addMonths = (iso: string, n: number) => {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};
const day = (month: string, d: number) => `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;

type Line = { product_line: string; policies: number; premium: number; commission_new: number; renewals: number | null; renewal_premium: number | null; commission_renewal: number };
type Report = {
  month: string; rates_set: boolean; goals: Record<string, number | null> | null;
  written: { policies: number; premium: number; without_premium: number };
  ytd: { policies: number; premium: number };
  by_line: Line[];
  forecast: { month: string; renewals: number; life: number; new_business: number }[];
  active_policies: number; ended_this_month: number; life_without_type: number;
};

const report = (user: string, month = m0) =>
  asUser(db, user, async (q) => (await q.query<{ r: Report }>("select public.production_report($1) as r", [month])).rows[0]!.r);
const line = (r: Report, l: string) => r.by_line.find((x) => x.product_line === l)!;
const rates = (user: string, rows: [string, string | null, number | null, number | null][]) =>
  asUser(db, user, async (q) => {
    for (const [l, t, n, r] of rows) {
      await q.query("insert into public.commission_rates (product_line, life_policy_type, new_rate, renewal_rate) values ($1, $2, $3, $4)", [l, t, n, r]);
    }
  });
/** A won policy bound on a given date (closed_at set as the database would have at the time). */
async function policy(user: string, line: string, premium: number | null, boundOn: string, extra: Record<string, unknown> = {}) {
  const c = await insertContact(db, user);
  const id = await insertOpportunity(db, user, c, line, line === "life" ? "placed" : "bound", { outcome: "won", estimated_annual_premium: premium, ...extra });
  await db.query("update public.opportunities set closed_at = ($2::date + time '12:00') at time zone 'America/New_York' where id = $1", [id, boundOn]);
  return id;
}

beforeAll(async () => {
  db = await connect();
  m0 = (await db.query("select date_trunc('month', (now() at time zone 'America/New_York'))::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("written premium and policies", () => {
  it("counts sales won in the month and year to date; existing and imported policies are not sales", async () => {
    const agent = await createUser(db, "prod-written");
    await policy(agent, "auto", 1200, day(m0, 1));
    await policy(agent, "home", 1800, day(m0, 2));
    await policy(agent, "auto", null, day(m0, 3));
    await policy(agent, "home", 900, day(m0, 4), { existing_policy: true });
    const r = await report(agent);
    expect(r.written).toEqual({ policies: 3, premium: 3000, without_premium: 1 });
    expect(line(r, "auto")).toMatchObject({ policies: 2, premium: 1200 });
    expect(r.ytd.policies).toBeGreaterThanOrEqual(3);
    // Last month's sale counts in its own month only.
    const last = addMonths(m0, -1);
    await policy(agent, "commercial", 5000, day(last, 15));
    expect((await report(agent)).written.policies).toBe(3);
    expect((await report(agent, last)).written).toMatchObject({ policies: 1, premium: 5000 });
  });

  it("goals come back as entered", async () => {
    const agent = await createUser(db, "prod-goals");
    await asUser(db, agent, (q) => q.query("insert into public.production_goals (premium_per_month, policies_per_month, premium_per_year) values (20000, 12, 240000)"));
    expect((await report(agent)).goals).toEqual({ premium_per_month: 20000, policies_per_month: 12, premium_per_year: 240000 });
    expect(await errorCode(asUser(db, agent, (q) => q.query("insert into public.production_goals (premium_per_month) values (1)")))).toBe("23505");
  });
});

describe("auto, home and commercial commission", () => {
  it("no rates entered: no commission is shown and the report says so", async () => {
    const agent = await createUser(db, "prod-norates");
    await policy(agent, "auto", 1200, day(m0, 1));
    const r = await report(agent);
    expect(r.rates_set).toBe(false);
    expect(line(r, "auto").commission_new).toBe(0);
  });

  it("new business in the bound month; renewals in their renewal month, recorded premium when renewed, nothing when lost", async () => {
    const agent = await createUser(db, "prod-pc");
    await rates(agent, [["auto", null, 15, 10], ["home", null, 15, 10]]);
    await policy(agent, "auto", 1000, day(m0, 1));
    // An existing home policy renewing this month (premium on file 2,000): 10% = 200.
    await policy(agent, "home", 2000, "2025-01-01", { existing_policy: true, renewal_date: day(m0, 20) });
    let r = await report(agent);
    expect(r.rates_set).toBe(true);
    expect(Number(line(r, "auto").commission_new)).toBe(150);
    expect(line(r, "home")).toMatchObject({ renewals: 1, renewal_premium: 2000 });
    expect(Number(line(r, "home").commission_renewal)).toBe(200);

    // Renewed at a new premium (2,400): the recorded premium counts in its renewal month.
    const renewing = await policy(agent, "home", 3000, "2025-01-01", { existing_policy: true, renewal_date: day(m0, 25) });
    await asUser(db, agent, (q) => q.query("select public.record_renewal_outcome($1, 'renewed', null, 2400, null)", [renewing]));
    r = await report(agent);
    expect(line(r, "home")).toMatchObject({ renewals: 2, renewal_premium: 4400 });

    // Lost at renewal: earns nothing, the policy ends.
    const lost = await policy(agent, "auto", 800, "2025-01-01", { existing_policy: true, renewal_date: day(m0, 10) });
    await asUser(db, agent, (q) => q.query("select public.record_renewal_outcome($1, 'lost', 'price', null, null)", [lost]));
    r = await report(agent);
    expect(line(r, "auto").renewals).toBe(0);
    expect(r.ended_this_month).toBe(1);
  });

  it("the next 12 months: upcoming renewals (6-month auto twice), no new sales guessed", async () => {
    const agent = await createUser(db, "prod-forecast");
    await rates(agent, [["auto", null, 15, 10]]);
    await policy(agent, "auto", 600, "2025-01-01", { existing_policy: true, policy_term_months: 6, renewal_date: day(addMonths(m0, 2), 5) });
    await policy(agent, "auto", 1000, day(m0, 1));
    const f = (await report(agent)).forecast;
    expect(f).toHaveLength(12);
    expect(f[0]!.month).toBe(m0);
    expect(Number(f[0]!.new_business)).toBe(150);
    expect(f.slice(1).every((x) => Number(x.new_business) === 0)).toBe(true);
    expect(f.map((x) => Number(x.renewals))).toEqual([0, 0, 60, 0, 0, 0, 0, 0, 60, 0, 0, 0]);
  });
});

describe("life commission", () => {
  it("your tracker's example: $3,200 Term, monthly, 45% = $120 a month for 12 months, then the renewal rate", async () => {
    const agent = await createUser(db, "prod-life");
    await rates(agent, [["life", "term", 45, 2]]);
    await policy(agent, "life", 3200, day(addMonths(m0, -11), 5), { life_policy_type: "term", premium_mode: "monthly", first_payout_on: day(addMonths(m0, -11), 7) });
    const r = await report(agent);
    // Month 12 of the first year is this month; renewal years pay 2%.
    expect(r.forecast.map((x) => Math.round(Number(x.life) * 100) / 100)).toEqual([120, ...Array(11).fill(5.33)]);
    expect(Number(line(r, "life").commission_new)).toBe(120);
  });

  it("quarterly pays every 3 months; a policy rate overrides Settings; payments stop when the policy ends", async () => {
    const agent = await createUser(db, "prod-life-q");
    await rates(agent, [["life", "whole", 65, 3]]);
    const id = await policy(agent, "life", 2400, day(m0, 1), { life_policy_type: "whole", premium_mode: "quarterly", commission_rate_override: 50 });
    let f = (await report(agent)).forecast.map((x) => Number(x.life));
    expect(f).toEqual([300, 0, 0, 300, 0, 0, 300, 0, 0, 300, 0, 0]);
    await db.query("update public.opportunities set policy_ended_on = $2 where id = $1", [id, day(addMonths(m0, 4), 1)]);
    f = (await report(agent)).forecast.map((x) => Number(x.life));
    expect(f).toEqual([300, 0, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("life details belong to life deals only and are checked", async () => {
    const agent = await createUser(db, "prod-life-check");
    const c = await insertContact(db, agent);
    expect(await errorCode(insertOpportunity(db, agent, c, "auto", "new_lead", { premium_mode: "monthly" }))).toBe("23514");
    expect(await errorCode(insertOpportunity(db, agent, c, "life", "new_lead", { premium_mode: "weekly" }))).toBe("23514");
    expect(await errorCode(insertOpportunity(db, agent, c, "life", "new_lead", { commission_rate_override: 120 }))).toBe("23514");
    expect(await errorCode(rates(agent, [["life", null, 45, 2]]))).toBe("23514");
    expect(await errorCode(rates(agent, [["auto", "term", 45, 2]]))).toBe("23514");
    await rates(agent, [["auto", null, 15, 10]]);
    expect(await errorCode(rates(agent, [["auto", null, 12, 8]]))).toBe("23505");
  });
});

describe("access", () => {
  it("only the caller's records; anonymous refused; password-only sees nothing", async () => {
    const a = await createUser(db, "prod-a");
    const b = await createUser(db, "prod-b");
    await rates(a, [["auto", null, 15, 10]]);
    await policy(a, "auto", 1000, day(m0, 1));
    expect((await report(a)).written.policies).toBe(1);
    const other = await report(b);
    expect(other).toMatchObject({ rates_set: false, written: { policies: 0, premium: 0 }, active_policies: 0 });
    expect(await errorCode(asAnon(db, (q) => q.query("select public.production_report($1)", [m0])))).toBe("42501");
    const aal1 = await asPasswordOnlyUser(db, a, async (q) => (await q.query<{ r: Report }>("select public.production_report($1) as r", [m0])).rows[0]!.r);
    expect(aal1.written.policies).toBe(0);
    expect(await asUser(db, b, async (q) => (await q.query("select count(*)::int as n from public.commission_rates")).rows[0].n)).toBe(0);
  });
});
