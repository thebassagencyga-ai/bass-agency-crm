import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { asAnon, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 25 (ADR-043): each agent's own pipelines, stages and routing by line. Fictional data only.

let db: Db;
let agent: string;
let today: string;

type StageInput = { id?: string; name: string; kind?: "active" | "won" | "lost"; quote?: boolean };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const save = (user: string, id: string | null, name: string, lines: string[], stages: StageInput[]) =>
  asUser(db, user, async (q) =>
    (await q.query<{ id: string }>("select public.save_pipeline($1, $2, $3, $4) as id", [id, name, lines, JSON.stringify(stages)])).rows[0]!.id,
  );
const pipelinesOf = (user: string) =>
  asUser(db, user, async (q) =>
    (await q.query<{ id: string; name: string; lines: string[] | null; stages: string[] }>(
      `select p.id, p.name,
              (select array_agg(r.product_line order by r.product_line) from public.pipeline_routes r where r.pipeline_id = p.id) as lines,
              (select array_agg(s.name || ':' || s.kind || case when s.is_quote_stage then ':quote' else '' end order by s.position)
                 from public.stages s where s.pipeline_id = p.id and s.archived_at is null) as stages
         from public.pipelines p where p.archived_at is null order by p.position`,
    )).rows,
  );
const stagesOf = (user: string, pipeline: string) =>
  asUser(db, user, async (q) =>
    (await q.query<{ id: string; name: string; kind: string }>(
      "select id, name, kind::text from public.stages where pipeline_id = $1 and archived_at is null order by position", [pipeline],
    )).rows,
  );
const PNC: StageInput[] = [
  { name: "New Lead", kind: "active" }, { name: "Gathering Info", kind: "active" }, { name: "Quoted", kind: "active", quote: true },
  { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" },
];

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "pipelines");
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("starting pipelines (Phase 25)", () => {
  it("every new agent starts with four pipelines; each new line joins its related line's (Phase 30)", async () => {
    const user = await createUser(db, "fresh");
    expect(await pipelinesOf(user)).toEqual([
      { id: expect.any(String), name: "Auto", lines: ["auto", "boat", "motorcycle", "rv"], stages: ["New Lead:active", "Contacted:active", "Info Needed:active", "Quoted:active:quote", "Follow Up:active", "Bound:won", "Lost:lost"] },
      { id: expect.any(String), name: "Home", lines: ["condo", "home", "mobile_home", "renters", "umbrella"], stages: ["New Lead:active", "Contacted:active", "Property Info Needed:active", "Quoted:active:quote", "Follow Up:active", "Bound:won", "Lost:lost"] },
      { id: expect.any(String), name: "Commercial", lines: ["commercial", "commercial_auto", "farm"], stages: ["New Lead:active", "Discovery:active", "Info Needed:active", "Marketing or Quoting:active", "Proposal Presented:active:quote", "Follow Up:active", "Bound:won", "Lost:lost"] },
      { id: expect.any(String), name: "Life", lines: ["life"], stages: ["New Lead:active", "Contacted:active", "Appointment Set:active", "Needs Review:active", "Application Process:active", "Decision Pending:active", "Placed:won", "Lost:lost"] },
    ]);
  });
});

describe("your own pipeline (Phase 25)", () => {
  let pnc: string;

  it("a P&C pipeline for auto and home receives their new leads, imports and quote dates", async () => {
    pnc = await save(agent, null, "P&C", ["auto", "home"], PNC);
    const mine = await pipelinesOf(agent);
    expect(mine.map((p) => [p.name, p.lines])).toEqual([
      ["Auto", ["boat", "motorcycle", "rv"]], ["Home", ["condo", "mobile_home", "renters", "umbrella"]], ["Commercial", ["commercial", "commercial_auto", "farm"]], ["Life", ["life"]], ["P&C", ["auto", "home"]],
    ]);
    expect(mine.at(-1)!.stages).toEqual(["New Lead:active", "Gathering Info:active", "Quoted:active:quote", "Bound:won", "Lost:lost"]);

    const [first, , quoted, bound] = await stagesOf(agent, pnc);
    expect(await asUser(db, agent, async (q) => (await q.query("select crm_engine.entry_stage('home') as s")).rows[0].s)).toBe(first!.id);
    expect(await asUser(db, agent, async (q) => (await q.query("select crm_engine.won_stage('auto') as s")).rows[0].s)).toBe(bound!.id);

    // A new lead created at the first stage gets its "make initial contact" task.
    const c = await insertContact(db, agent);
    const opp = await asUser(db, agent, async (q) =>
      (await q.query<{ id: string }>("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'auto', $2) returning id", [c, first!.id])).rows[0]!.id,
    );
    const titles = async () => (await db.query("select title from public.tasks where opportunity_id = $1 order by title", [opp])).rows.map((r) => r.title);
    expect(await titles()).toEqual(["Make initial contact"]);
    // The stage marked as the quote stage records today's date and the quote follow-up.
    await asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $2 where id = $1", [opp, quoted!.id]));
    const row = (await db.query("select quote_sent_on::text as d, pipeline_id from public.opportunities where id = $1", [opp])).rows[0];
    expect(row).toEqual({ d: today, pipeline_id: pnc });
    expect(await titles()).toEqual(["Follow up on quote", "Make initial contact"]);

    // Import files policies under the line's Won stage.
    const batch = await asUser(db, agent, async (q) =>
      (await q.query("select public.import_book('book.csv', $1) as r", [JSON.stringify([{ existing_contact_id: null, contact: { first_name: "Imported", last_name: "Example" }, policies: [{ line: "home", renewal_date: addDays(today, 90) }] }])])).rows[0].r,
    );
    const imported = (await db.query("select stage_id, pipeline_id from public.opportunities where import_batch_id = $1", [batch.batch_id])).rows;
    expect(imported).toEqual([{ stage_id: bound!.id, pipeline_id: pnc }]);
  });

  it("intake (quick intake) starts new leads in the routed pipeline", async () => {
    const cid = await asUser(db, agent, async (q) =>
      (await q.query("select public.quick_intake($1, null, null) as id", [JSON.stringify({ first_name: "Quinn", last_name: "Example", email: "quinn@example.com", lines: ["home", "life"] })])).rows[0].id,
    );
    const opps = (await db.query(
      `select o.product_line, p.name as pipeline, s.position from public.opportunities o
         join public.pipelines p on p.id = o.pipeline_id join public.stages s on s.id = o.stage_id
        where o.contact_id = $1 order by o.product_line`, [cid],
    )).rows;
    expect(opps).toEqual([{ product_line: "home", pipeline: "P&C", position: 1 }, { product_line: "life", pipeline: "Life", position: 1 }]);
  });

  it("renames, reorders and adds stages; a stage holding deals cannot be removed", async () => {
    const [lead, info, quoted, bound, lost] = await stagesOf(agent, pnc);
    await save(agent, pnc, "Personal Lines", ["auto", "home"], [
      { id: lead!.id, name: "New Lead" }, { id: quoted!.id, name: "Quote Sent", quote: true }, { id: info!.id, name: "Info Needed" },
      { name: "Follow Up", kind: "active" }, { id: bound!.id, name: "Bound" }, { id: lost!.id, name: "Lost" },
    ]);
    expect((await pipelinesOf(agent)).at(-1)).toMatchObject({
      name: "Personal Lines", stages: ["New Lead:active", "Quote Sent:active:quote", "Info Needed:active", "Follow Up:active", "Bound:won", "Lost:lost"],
    });

    // The first stage holds a deal (previous test): leaving it out is refused, nothing changes.
    const err = await errorCode(save(agent, pnc, "Personal Lines", ["auto", "home"], [
      { id: info!.id, name: "Info Needed" }, { id: bound!.id, name: "Bound" }, { id: lost!.id, name: "Lost" },
    ]));
    expect(err).toBe("23514");
    expect((await stagesOf(agent, pnc)).map((s) => s.name)).toEqual(["New Lead", "Quote Sent", "Info Needed", "Follow Up", "Bound", "Lost"]);
  });

  it.each([
    ["no Won stage", [{ name: "A", kind: "active" }, { name: "B", kind: "active" }, { name: "Lost", kind: "lost" }]],
    ["two Lost stages", [{ name: "A", kind: "active" }, { name: "Won", kind: "won" }, { name: "Lost", kind: "lost" }, { name: "Lost 2", kind: "lost" }]],
    ["Won and Lost not last", [{ name: "Won", kind: "won" }, { name: "Lost", kind: "lost" }, { name: "A", kind: "active" }]],
    ["no working stage", [{ name: "Won", kind: "won" }, { name: "Lost", kind: "lost" }]],
    ["13 stages", [...Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, kind: "active" as const })), { name: "Won", kind: "won" as const }, { name: "Lost", kind: "lost" as const }]],
  ])("refuses a pipeline with %s, saving nothing", async (_label, stages) => {
    const before = (await pipelinesOf(agent)).length;
    expect(await errorCode(save(agent, null, "Broken", [], stages as StageInput[]))).toBe("23514");
    expect((await pipelinesOf(agent)).length).toBe(before);
  });

  it("a stage keeps its kind, and a deal cannot move into a removed stage", async () => {
    const [lead] = await stagesOf(agent, pnc);
    expect(await errorCode(asUser(db, agent, (q) => q.query("update public.stages set is_quote_stage = false, archived_at = null where id = $1", [lead!.id])))).toBeUndefined();
    const won = (await stagesOf(agent, pnc)).find((s) => s.kind === "won")!;
    expect(await errorCode(asUser(db, agent, (q) => q.query("update public.stages set kind = 'active' where id = $1", [won.id])))).toBe("42501");

    const homePipeline = (await db.query("select id from public.pipelines where owner_id = $1 and name = 'Home'", [agent])).rows[0].id;
    const homeStages = await stagesOf(agent, homePipeline);
    const removed = homeStages[2]!; // Property Info Needed: no deals
    await save(agent, homePipeline, "Home", [], homeStages.filter((s) => s.id !== removed.id).map((s) => ({ id: s.id, name: s.name })));
    const c = await insertContact(db, agent);
    const opp = await insertOpportunity(db, agent, c, "life");
    expect(await errorCode(asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $2 where id = $1", [opp, removed.id])))).toBe("23514");
  });

  it("a line routed here stays unless sent elsewhere; unknown lines are refused", async () => {
    const lines = async () => (await pipelinesOf(agent)).at(-1)!.lines;
    const stages = (await stagesOf(agent, pnc)).map((s) => ({ id: s.id, name: s.name }));
    await save(agent, pnc, "Personal Lines", [], stages);
    expect(await lines()).toEqual(["auto", "home"]);
    expect(await errorCode(save(agent, pnc, "Personal Lines", ["aircraft"], stages))).toBe("22023");
  });
});

describe("archiving a pipeline (Phase 25)", () => {
  it("needs its lines sent elsewhere and its open deals moved or closed first", async () => {
    const user = await createUser(db, "archiver");
    const archive = (id: string) => asUser(db, user, (q) => q.query("update public.pipelines set archived_at = now() where id = $1", [id]));
    const auto = (await pipelinesOf(user))[0]!;
    expect(await errorCode(archive(auto.id))).toBe("23514"); // still receives auto leads

    const pnc = await save(user, null, "P&C", ["auto", "boat", "motorcycle", "rv"], PNC);
    const c = await insertContact(db, user);
    const autoStages = await stagesOf(user, auto.id); // deals still in the old Auto pipeline
    const insertAt = (stage: string, outcome: string) => asUser(db, user, async (q) =>
      (await q.query<{ id: string }>("insert into public.opportunities (contact_id, product_line, stage_id, outcome) values ($1, 'auto', $2, $3) returning id", [c, stage, outcome])).rows[0]!.id);
    const open = await insertAt(autoStages[0]!.id, "open");
    const won = await insertAt(autoStages.find((s) => s.kind === "won")!.id, "won");
    expect(await errorCode(archive(auto.id))).toBe("23514"); // an open deal is still there

    const [pncLead] = await stagesOf(user, pnc);
    await asUser(db, user, (q) => q.query("update public.opportunities set stage_id = $2 where id = $1", [open, pncLead!.id]));
    expect(await errorCode(archive(auto.id))).toBeUndefined();
    expect((await pipelinesOf(user)).map((p) => p.name)).toEqual(["Home", "Commercial", "Life", "P&C"]);
    // The won policy keeps its history in the archived pipeline.
    expect((await db.query("select pipeline_id, outcome from public.opportunities where id = $1", [won])).rows[0]).toEqual({ pipeline_id: auto.id, outcome: "won" });
    // New leads cannot be sent to an archived pipeline.
    expect(await errorCode(asUser(db, user, (q) => q.query("update public.pipeline_routes set pipeline_id = $1 where product_line = 'auto'", [auto.id])))).toBe("23514");
  });

  it("allows up to 10 pipelines in use", async () => {
    const user = await createUser(db, "many");
    for (let i = 0; i < 6; i++) await save(user, null, `Extra ${i}`, [], PNC);
    expect(await errorCode(save(user, null, "One too many", [], PNC))).toBe("23514");
  });
});

describe("access (Phase 25)", () => {
  it("another agent cannot see, save into or route to my pipelines", async () => {
    const other = await createUser(db, "pipelines-other");
    const mine = (await pipelinesOf(agent))[0]!;
    expect(await asUser(db, other, async (q) => (await q.query("select count(*)::int as n from public.pipelines where owner_id = $1", [agent])).rows[0].n)).toBe(0);
    expect(await errorCode(save(other, mine.id, "Mine now", [], PNC))).toBe("P0002");
    expect(await errorCode(asUser(db, other, (q) => q.query("update public.pipeline_routes set pipeline_id = $1 where product_line = 'auto'", [mine.id])))).toBe("23503");
    expect(await errorCode(asAnon(db, (q) => q.query("select public.save_pipeline(null, 'x', '{}', '[]')")))).toBe("42501");
  });
});

describe("the Phase 25 migration on existing data", () => {
  // Builds a separate database at the migration before Phase 25, adds deals, then applies it.
  const MIGRATIONS = path.resolve(import.meta.dirname, "../../supabase/migrations");
  const PHASE25 = "20261102120000_custom_pipelines.sql";
  let old: pg.Client;
  let name: string;

  beforeAll(async () => {
    name = `crm_p25_${process.pid}_${Date.now()}`;
    await db.query(`create database ${name}`);
    const url = new URL(inject("testDatabaseUrl"));
    url.pathname = `/${name}`;
    old = new pg.Client({ connectionString: url.toString() });
    await old.connect();
    await old.query(readFileSync(path.join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
    for (const f of readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f) && f < PHASE25).sort()) {
      await old.query(readFileSync(path.join(MIGRATIONS, f), "utf8"));
    }
  }, 120_000);
  afterAll(async () => {
    await old.end();
    await db.query(`drop database if exists ${name} with (force)`);
  });

  it("moves every deal to the same-named stage, changing no date, task or 'last updated'", async () => {
    const user = await createUser(old, "migrated");
    const stage = async (line: string, code: string) =>
      (await old.query("select id from public.pipeline_stages where product_line = $1 and code = $2", [line, code])).rows[0].id as string;
    const c = await insertContact(old, user);
    const deals: [string, string, Record<string, unknown>][] = [
      ["auto", "quoted", { quote_sent_on: null }], // an old deal at Quoted without a date stays without one
      ["home", "follow_up", { outcome: "nurture" }],
      ["commercial", "proposal_presented", { quote_sent_on: addDays(today, -3) }],
      ["life", "placed", { outcome: "won", renewal_date: addDays(today, 200) }],
      ["auto", "lost", { outcome: "lost", loss_reason: "price" }],
    ];
    for (const [line, code, extra] of deals) {
      const values = { contact_id: c, product_line: line, stage_id: await stage(line, code), ...extra };
      const cols = Object.keys(values);
      await asUser(old, user, (q) => q.query(`insert into public.opportunities (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(values)));
    }
    const snapshot = async () => ({
      opps: (await old.query("select id, product_line, outcome::text, quote_sent_on::text, updated_at::text, cycle from public.opportunities order by id")).rows,
      tasks: (await old.query("select id, title, status::text, due_date::text from public.tasks order by id")).rows,
    });
    const before = await snapshot();

    await old.query(readFileSync(path.join(MIGRATIONS, PHASE25), "utf8"));

    expect(await snapshot()).toEqual(before);
    const moved = (await old.query(
      `select o.product_line, p.name as pipeline, s.name as stage, s.template_code as code, s.owner_id = o.owner_id as own
         from public.opportunities o join public.stages s on s.id = o.stage_id join public.pipelines p on p.id = o.pipeline_id
        order by o.product_line, s.position`,
    )).rows;
    expect(moved).toEqual([
      { product_line: "auto", pipeline: "Auto", stage: "Quoted", code: "quoted", own: true },
      { product_line: "auto", pipeline: "Auto", stage: "Lost", code: "lost", own: true },
      { product_line: "commercial", pipeline: "Commercial", stage: "Proposal Presented", code: "proposal_presented", own: true },
      { product_line: "home", pipeline: "Home", stage: "Follow Up", code: "follow_up", own: true },
      { product_line: "life", pipeline: "Life", stage: "Placed", code: "placed", own: true },
    ]);
  });
});
