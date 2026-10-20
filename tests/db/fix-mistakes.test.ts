import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 29 (ADR-047): correcting a deal's line, marking a won sale as an existing policy, and
// removing a deal entered by mistake. Fictional data only.

let db: Db;
let m0: string;

const visible = (user: string, id: string) =>
  asUser(db, user, async (q) => (await q.query("select count(*)::int as n from public.opportunities where id = $1", [id])).rows[0].n as number);
const raw = (id: string) => db.query("select * from public.opportunities where id = $1", [id]).then((r) => r.rows[0]);
const tasks = (id: string) =>
  db.query<{ title: string; category: string; status: string }>("select title, category::text, status::text from public.tasks where opportunity_id = $1 order by title", [id]).then((r) => r.rows);

beforeAll(async () => {
  db = await connect();
  m0 = (await db.query("select date_trunc('month', (now() at time zone 'America/New_York'))::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("changing a deal's line", () => {
  it("keeps the stage and tasks; resets the 6-month term and life details; the history records it", async () => {
    const agent = await createUser(db, "fix-line");
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "auto", "contacted", { policy_term_months: 6 });
    const before = await raw(opp);
    const taskCount = (await tasks(opp)).length;
    await asUser(db, agent, (q) => q.query("update public.opportunities set product_line = 'home' where id = $1", [opp]));
    const after = await raw(opp);
    expect(after).toMatchObject({ product_line: "home", policy_term_months: 12, stage_id: before.stage_id, cycle: before.cycle });
    expect((await tasks(opp)).length).toBe(taskCount);
    const log = (await db.query("select old_values, new_values from public.audit_log where record_id = $1 and action = 'update' order by id desc limit 1", [opp])).rows[0];
    expect(log.old_values).toMatchObject({ product_line: "auto" });
    expect(log.new_values).toMatchObject({ product_line: "home" });

    const life = await insertOpportunity(db, agent, c, "life", "new_lead", { life_policy_type: "term", premium_mode: "monthly", commission_rate_override: 40 });
    await asUser(db, agent, (q) => q.query("update public.opportunities set product_line = 'auto' where id = $1", [life]));
    expect(await raw(life)).toMatchObject({ product_line: "auto", life_policy_type: null, premium_mode: null, commission_rate_override: null });
  });
});

describe("marking a won sale as an existing policy", () => {
  it("off the board and out of sales; the win's onboarding, review and referral tasks close; renewal reviews stay", async () => {
    const agent = await createUser(db, "fix-existing");
    const c = await insertContact(db, agent, { first_name: "Kerry" });
    const opp = await insertOpportunity(db, agent, c, "auto", "contacted", { estimated_annual_premium: 1200 });
    const bound = (await db.query("select s.id from public.stages s join public.pipeline_routes r on r.pipeline_id = s.pipeline_id where r.owner_id = $1 and r.product_line = 'auto' and s.kind = 'won'", [agent])).rows[0].id;
    await asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $2, outcome = 'won', renewal_date = $3 where id = $1", [opp, bound, `${Number(m0.slice(0, 4)) + 1}-03-01`]));
    const before = await tasks(opp);
    expect(before.some((t) => t.category === "onboarding" && t.status === "open")).toBe(true);

    const onBoard = () => asUser(db, agent, async (q) => (await q.query("select id from public.search_opportunities(null, null, null, null, 'recent', 'updated', 50, 0, null)")).rows.map((r) => r.id));
    const written = () => asUser(db, agent, async (q) => (await q.query("select public.production_report($1) as r", [m0])).rows[0].r.written.policies as number);
    expect(await onBoard()).toContain(opp);
    expect(await written()).toBe(1);

    const closed = await asUser(db, agent, async (q) => (await q.query("select public.mark_existing_policy($1) as n", [opp])).rows[0].n as number);
    expect(closed).toBe(before.filter((t) => t.status === "open" && ["onboarding", "review_request", "referral_request"].includes(t.category)).length);
    const after = await tasks(opp);
    expect(after.filter((t) => ["onboarding", "review_request", "referral_request"].includes(t.category)).every((t) => t.status === "cancelled")).toBe(true);
    expect(after.filter((t) => t.category === "renewal").map((t) => t.status)).toEqual(["open"]);
    expect((await raw(opp)).existing_policy).toBe(true);
    expect(await onBoard()).not.toContain(opp);
    expect(await written()).toBe(0);

    // Only once, only for won sales, only the caller's own.
    expect(await errorCode(asUser(db, agent, (q) => q.query("select public.mark_existing_policy($1)", [opp])))).toBe("23514");
    const open = await insertOpportunity(db, agent, c, "home", "contacted");
    expect(await errorCode(asUser(db, agent, (q) => q.query("select public.mark_existing_policy($1)", [open])))).toBe("23514");
    const other = await createUser(db, "fix-existing-other");
    expect(await errorCode(asUser(db, other, (q) => q.query("select public.mark_existing_policy($1)", [opp])))).toBe("P0002");
  });
});

describe("removing a deal entered by mistake", () => {
  it("hidden everywhere, its open tasks closed, no longer editable; nothing deleted, history kept", async () => {
    const agent = await createUser(db, "fix-remove");
    const c = await insertContact(db, agent, { first_name: "Test" });
    const opp = await insertOpportunity(db, agent, c, "auto", "new_lead", { estimated_annual_premium: 1250 });
    expect((await tasks(opp)).some((t) => t.status === "open")).toBe(true);

    const other = await createUser(db, "fix-remove-other");
    expect(await errorCode(asUser(db, other, (q) => q.query("select public.remove_opportunity($1)", [opp])))).toBe("P0002");

    await asUser(db, agent, (q) => q.query("select public.remove_opportunity($1)", [opp]));
    expect(await visible(agent, opp)).toBe(0);
    expect((await tasks(opp)).every((t) => t.status === "cancelled")).toBe(true);
    expect((await raw(opp)).removed_at).not.toBeNull(); // still in the database
    expect((await db.query("select count(*)::int as n from public.audit_log where record_id = $1 and action = 'update' and new_values ? 'removed_at'", [opp])).rows[0].n).toBe(1);

    const listed = await asUser(db, agent, async (q) => (await q.query("select id from public.search_opportunities(null, null, null, null, 'all', 'updated', 50, 0, null)")).rows.map((r) => r.id));
    expect(listed).not.toContain(opp);
    const dash = await asUser(db, agent, async (q) => (await q.query("select public.dashboard_summary($1) as d", [m0])).rows[0].d);
    expect(JSON.stringify(dash.open_by_line)).not.toContain("1250");
    const report = await asUser(db, agent, async (q) => (await q.query("select public.production_report($1) as r", [m0])).rows[0].r);
    expect(report.active_policies).toBe(0);

    // A removed deal cannot be edited or brought back through the app.
    const changed = await asUser(db, agent, async (q) => (await q.query("update public.opportunities set removed_at = null, description = 'x' where id = $1", [opp])).rowCount);
    expect(changed).toBe(0);
    expect(await errorCode(asUser(db, agent, (q) => q.query("select public.remove_opportunity($1)", [opp])))).toBe("P0002");
  });
});
