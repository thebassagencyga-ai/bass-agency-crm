import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asPasswordOnlyUser,
  asUser,
  connect,
  createUser,
  errorCode,
  insertContact,
  insertOpportunity,
  stageId,
  type Db,
} from "./helpers";

// Phase 4: opportunity lifecycle rules (enforced by trigger) and search_opportunities.

const CHECK = "23514";
let db: Db;
let agent: string;
let other: string;
let contact: string;

const row = async (id: string) =>
  (await db.query("select * from public.opportunities where id = $1", [id])).rows[0];

const update = (userId: string, id: string, set: string, params: unknown[] = []) =>
  asUser(db, userId, (q) => q.query(`update public.opportunities set ${set} where id = $1`, [id, ...params]));

type SearchRow = { id: string; stage_name: string; first_name: string | null; business_name: string | null };
const search = (userId: string, args: Record<string, unknown> = {}, opts: { aal1?: boolean } = {}) => {
  const a = {
    p_query: "", p_product_line: null, p_outcome: null, p_stage_id: null,
    p_closed: "all", p_sort: "updated", p_limit: 25, p_offset: 0, ...args,
  };
  const run = (q: Db) =>
    q.query<SearchRow>(
      `select * from public.search_opportunities($1, $2, $3::public.opportunity_outcome, $4::uuid, $5, $6, $7, $8)`,
      [a.p_query, a.p_product_line, a.p_outcome, a.p_stage_id, a.p_closed, a.p_sort, a.p_limit, a.p_offset],
    ).then((r) => r.rows);
  return opts.aal1 ? asPasswordOnlyUser(db, userId, run) : asUser(db, userId, run);
};

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "opps");
  other = await createUser(db, "opps-other");
  contact = await insertContact(db, agent, { first_name: "Morgan", last_name: "Example" });
});
afterAll(async () => {
  await db.end();
});

describe("opportunity lifecycle", () => {
  it("one contact can hold several opportunities across product lines", async () => {
    const c = await insertContact(db, agent, { first_name: "Multi", last_name: "Line" });
    for (const line of ["auto", "home", "commercial", "life"]) await insertOpportunity(db, agent, c, line);
    await insertOpportunity(db, agent, c, "auto"); // a second auto opportunity too
    const { rows } = await db.query("select product_line from public.opportunities where contact_id = $1", [c]);
    expect(rows).toHaveLength(5);
  });

  it("stores the quoted carrier, within 100 characters", async () => {
    const opp = await insertOpportunity(db, agent, contact, "auto", "quoted", { quoted_carrier: "Example Mutual" });
    expect((await row(opp)).quoted_carrier).toBe("Example Mutual");
    expect(await errorCode(update(agent, opp, "quoted_carrier = $2", ["x".repeat(101)]))).toBe(CHECK);
  });

  it("never lets the product line change, so stages stay in the same pipeline", async () => {
    const opp = await insertOpportunity(db, agent, contact, "auto");
    const homeLead = await stageId(db, "home", "new_lead");
    expect(await errorCode(update(agent, opp, "product_line = 'home', stage_id = $2", [homeLead]))).toBe(CHECK);
    // A stage from another pipeline is refused by the composite foreign key.
    expect(await errorCode(update(agent, opp, "stage_id = $2", [homeLead]))).toBe("23503");
    expect((await row(opp)).product_line).toBe("auto");
  });

  it("ignores a cycle supplied by the client", async () => {
    const opp = await insertOpportunity(db, agent, contact, "auto", "new_lead", { cycle: 9 });
    expect((await row(opp)).cycle).toBe(1);
    await update(agent, opp, "cycle = 5");
    expect((await row(opp)).cycle).toBe(1);
  });

  it("reopening a lost opportunity starts a new cycle and clears the loss reason; history is audited", async () => {
    const opp = await insertOpportunity(db, agent, contact, "home", "quoted", { quote_sent_on: "2026-10-01" });
    const lost = await stageId(db, "home", "lost");
    const followUp = await stageId(db, "home", "follow_up");
    await update(agent, opp, "stage_id = $2, outcome = 'lost', loss_reason = 'price', loss_reason_detail = 'Fictional'", [lost]);
    expect(await row(opp)).toMatchObject({ outcome: "lost", loss_reason: "price", cycle: 1 });

    await update(agent, opp, "stage_id = $2, outcome = 'open'", [followUp]);
    expect(await row(opp)).toMatchObject({
      outcome: "open", loss_reason: null, loss_reason_detail: null, closed_at: null, cycle: 2,
    });
    expect((await row(opp)).quote_sent_on).toBeInstanceOf(Date);

    const { rows } = await db.query(
      "select old_values->>'loss_reason' as reason from public.audit_log where record_id = $1 and action = 'update' and old_values ? 'loss_reason'",
      [opp],
    );
    expect(rows.map((r) => r.reason)).toContain("price");
  });

  it("does not bump the cycle for moves between active stages or into nurture", async () => {
    const opp = await insertOpportunity(db, agent, contact, "life", "contacted");
    await update(agent, opp, "stage_id = $2", [await stageId(db, "life", "appointment_set")]);
    await update(agent, opp, "outcome = 'nurture'");
    await update(agent, opp, "outcome = 'open'");
    expect((await row(opp)).cycle).toBe(1);
  });

  it("life: Application Process and Decision Pending can never be won; Placed is won", async () => {
    const opp = await insertOpportunity(db, agent, contact, "life", "application_process");
    expect(await errorCode(update(agent, opp, "outcome = 'won'"))).toBe(CHECK);
    await update(agent, opp, "stage_id = $2", [await stageId(db, "life", "decision_pending")]);
    expect(await errorCode(update(agent, opp, "outcome = 'won'"))).toBe(CHECK);
    await update(agent, opp, "stage_id = $2, outcome = 'won'", [await stageId(db, "life", "placed")]);
    expect((await row(opp)).outcome).toBe("won");
  });

  it("another agent can neither see nor change the opportunity", async () => {
    const opp = await insertOpportunity(db, agent, contact, "auto");
    const result = await asUser(db, other, (q) =>
      q.query("update public.opportunities set next_action = 'x' where id = $1", [opp]),
    );
    expect(result.rowCount).toBe(0);
    const seen = await asUser(db, other, (q) => q.query("select id from public.opportunities where id = $1", [opp]));
    expect(seen.rowCount).toBe(0);
  });
});

describe("search_opportunities", () => {
  let ids: Record<string, string>;
  let user: string;

  beforeAll(async () => {
    user = await createUser(db, "opp-search");
    const avery = await insertContact(db, user, { first_name: "Avery", last_name: "Adams" });
    const shop = await insertContact(db, user, { contact_type: "business", business_name: "Example Hardware LLC" });
    ids = {
      auto: await insertOpportunity(db, user, avery, "auto", "quoted", { estimated_annual_premium: 1200, quoted_carrier: "Example Mutual" }),
      home: await insertOpportunity(db, user, avery, "home", "new_lead", { description: "Lake house 100%_fictional" }),
      commercial: await insertOpportunity(db, user, shop, "commercial", "discovery", { estimated_annual_premium: 5000 }),
      wonOld: await insertOpportunity(db, user, shop, "auto", "bound", { outcome: "won" }),
      lostRecent: await insertOpportunity(db, user, avery, "life", "lost", { outcome: "lost", loss_reason: "timing" }),
    };
    // Make the won opportunity look closed 40 days ago (as the database owner, outside RLS).
    await db.query("update public.opportunities set closed_at = now() - interval '40 days' where id = $1", [ids.wonOld]);
    await insertOpportunity(db, other, await insertContact(db, other, { first_name: "Avery", last_name: "Adams" }), "auto");
  });

  it("returns only the caller's opportunities with contact and stage names", async () => {
    const rows = await search(user);
    expect(rows.map((r) => r.id).sort()).toEqual(Object.values(ids).sort());
    const auto = rows.find((r) => r.id === ids.auto)!;
    expect(auto).toMatchObject({ stage_name: "Quoted", first_name: "Avery" });
  });

  it.each([
    ["contact name", "avery adams", ["auto", "home", "lostRecent"]],
    ["business name", "hardware", ["commercial", "wonOld"]],
    ["description, with % and _ literal", "100%_f", ["home"]],
    ["quoted carrier", "mutual", ["auto"]],
  ])("finds by %s", async (_label, query, expected) => {
    const rows = await search(user, { p_query: query });
    expect(rows.map((r) => r.id).sort()).toEqual(expected.map((k) => ids[k]).sort());
  });

  it("filters by product line, outcome and stage", async () => {
    expect((await search(user, { p_product_line: "auto" })).map((r) => r.id).sort()).toEqual([ids.auto, ids.wonOld].sort());
    expect((await search(user, { p_outcome: "lost" })).map((r) => r.id)).toEqual([ids.lostRecent]);
    const quoted = await stageId(db, "auto", "quoted");
    expect((await search(user, { p_stage_id: quoted })).map((r) => r.id)).toEqual([ids.auto]);
  });

  it("board view keeps open work and recently closed, hides older closed", async () => {
    const recent = (await search(user, { p_closed: "recent" })).map((r) => r.id);
    expect(recent).toContain(ids.lostRecent);
    expect(recent).not.toContain(ids.wonOld);
    const none = (await search(user, { p_closed: "none" })).map((r) => r.id);
    expect(none.sort()).toEqual([ids.auto, ids.home, ids.commercial].sort());
  });

  it("sorts by premium, highest first", async () => {
    const rows = await search(user, { p_sort: "premium" });
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual([ids.commercial, ids.auto]);
  });

  it("caps the page size at 200", async () => {
    expect(await search(user, { p_limit: 100000 })).toHaveLength(5);
  });

  it("returns nothing to a password-only session, and refuses anonymous callers", async () => {
    expect(await search(user, {}, { aal1: true })).toEqual([]);
    expect(
      await errorCode(asAnon(db, (q) => q.query("select * from public.search_opportunities()"))),
    ).toBe("42501");
  });
});
