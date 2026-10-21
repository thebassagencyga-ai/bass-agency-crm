import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCT_LINES, SIX_MONTH_LINES } from "@/lib/pipelines";
import { asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 30 (ADR-048): nine more lines, each joining the pipeline of a related line. Fictional data only.

let db: Db;

const routes = (user: string) =>
  asUser(db, user, async (q) =>
    Object.fromEntries((await q.query<{ product_line: string; name: string }>(
      "select r.product_line, p.name from public.pipeline_routes r join public.pipelines p on p.id = r.pipeline_id",
    )).rows.map((r) => [r.product_line, r.name])),
  );

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("new lines join a related pipeline", () => {
  it("a new agent's Renters, Umbrella… go to Home; Motorcycle, Boat, RV to Auto; Commercial Auto, Farm to Commercial", async () => {
    const agent = await createUser(db, "lines-routes");
    expect(await routes(agent)).toEqual({
      auto: "Auto", motorcycle: "Auto", boat: "Auto", rv: "Auto",
      home: "Home", renters: "Home", condo: "Home", mobile_home: "Home", umbrella: "Home",
      commercial: "Commercial", commercial_auto: "Commercial", farm: "Commercial",
      life: "Life",
    });
    expect(await asUser(db, agent, async (q) => (await q.query("select count(*)::int as n from public.pipelines")).rows[0].n)).toBe(4);
  });

  it("a Renters deal starts in the Home pipeline's first stage and wins at its Bound stage", async () => {
    const agent = await createUser(db, "lines-renters");
    const c = await insertContact(db, agent);
    const id = await asUser(db, agent, async (q) =>
      (await q.query<{ id: string }>("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'renters', crm_engine.entry_stage('renters')) returning id", [c])).rows[0]!.id);
    const row = (await db.query(
      "select p.name as pipeline, s.name as stage from public.opportunities o join public.pipelines p on p.id = o.pipeline_id join public.stages s on s.id = o.stage_id where o.id = $1", [id],
    )).rows[0];
    expect(row).toEqual({ pipeline: "Home", stage: "New Lead" });
    expect((await db.query("select count(*)::int as n from public.tasks where opportunity_id = $1 and status = 'open'", [id])).rows[0].n).toBeGreaterThan(0);
    await asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = crm_engine.won_stage('renters'), outcome = 'won' where id = $1", [id]));
    expect((await db.query("select s.name from public.opportunities o join public.stages s on s.id = o.stage_id where o.id = $1", [id])).rows[0].name).toBe("Bound");
  });
});

describe("6-month terms", () => {
  it("allowed on exactly the lines in SIX_MONTH_LINES; a line change to another line resets to 12", async () => {
    const agent = await createUser(db, "lines-term");
    const c = await insertContact(db, agent);
    for (const line of PRODUCT_LINES) {
      const code = await errorCode(insertOpportunity(db, agent, c, line, "new_lead", { policy_term_months: 6 }));
      expect([line, code]).toEqual([line, SIX_MONTH_LINES.includes(line) ? undefined : "23514"]);
    }
    const moto = await insertOpportunity(db, agent, c, "motorcycle", "new_lead", { policy_term_months: 6 });
    await asUser(db, agent, (q) => q.query("update public.opportunities set product_line = 'auto' where id = $1", [moto]));
    expect((await db.query("select policy_term_months from public.opportunities where id = $1", [moto])).rows[0].policy_term_months).toBe(6);
    await asUser(db, agent, (q) => q.query("update public.opportunities set product_line = 'boat' where id = $1", [moto]));
    expect((await db.query("select policy_term_months from public.opportunities where id = $1", [moto])).rows[0].policy_term_months).toBe(12);
  });

  it("imports keep a 6-month motorcycle term; a 6-month boat is imported as 12", async () => {
    const agent = await createUser(db, "lines-import");
    await asUser(db, agent, (q) => q.query("select public.import_book('book.csv', $1)", [JSON.stringify([
      { contact: { first_name: "Robin", last_name: "Example" }, policies: [{ line: "motorcycle", term_months: 6 }, { line: "boat", term_months: 6 }, { line: "umbrella" }] },
    ])]));
    const rows = (await db.query("select product_line, policy_term_months, outcome::text from public.opportunities where owner_id = $1 order by product_line", [agent])).rows;
    expect(rows).toEqual([
      { product_line: "boat", policy_term_months: 12, outcome: "won" },
      { product_line: "motorcycle", policy_term_months: 6, outcome: "won" },
      { product_line: "umbrella", policy_term_months: 12, outcome: "won" },
    ]);
  });
});

describe("quote requests and cross-sell", () => {
  it("cross-sell rules may name any line held or lacking", async () => {
    const agent = await createUser(db, "lines-cross");
    await asUser(db, agent, (q) => q.query(
      "insert into public.cross_sell_rules (rule_key, name, has_any_lines, lacks_line, reason) values ('home_no_umbrella', 'Umbrella', '{home,condo,boat}', 'umbrella', 'Extra liability cover.')",
    ));
    expect(await errorCode(asUser(db, agent, (q) => q.query(
      "insert into public.cross_sell_rules (rule_key, name, has_any_lines, lacks_line, reason) values ('bad_rule', 'Bad', '{aircraft}', 'umbrella', 'x')",
    )))).toBe("23514");
  });

  it("each line has a commission rate row of its own", async () => {
    const agent = await createUser(db, "lines-rates");
    await asUser(db, agent, (q) => q.query("insert into public.commission_rates (product_line, new_rate, renewal_rate) values ('umbrella', 15, 12)"));
    const c = await insertContact(db, agent);
    await insertOpportunity(db, agent, c, "umbrella", "bound", { outcome: "won", estimated_annual_premium: 400 });
    const m0 = (await db.query("select date_trunc('month', (now() at time zone 'America/New_York'))::date::text as d")).rows[0].d;
    const r = await asUser(db, agent, async (q) => (await q.query("select public.production_report($1) as r", [m0])).rows[0].r);
    expect(r.by_line.map((l: { product_line: string }) => l.product_line)).toEqual([...PRODUCT_LINES]);
    expect(Number(r.by_line.find((l: { product_line: string }) => l.product_line === "umbrella").commission_new)).toBe(60);
  });
});
