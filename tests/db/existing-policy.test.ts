import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// ADR-042: a policy the client already has, entered by hand, is saved directly as won and
// marked existing_policy. Only the renewal review is created, and reports do not count it as a
// sale or its contact as a new lead. Fictional data only.

let db: Db;
let agent: string;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const tasksFor = (contact: string) =>
  asUser(db, agent, async (q) =>
    (await q.query<{ rule: string | null; status: string }>(
      `select r.rule_key as rule, t.status::text from public.tasks t
       left join public.automation_rules r on r.id = t.automation_rule_id
       where t.contact_id = $1 order by r.rule_key`, [contact],
    )).rows,
  );
const existingOf = (id: string) =>
  asUser(db, agent, async (q) => (await q.query<{ e: boolean }>("select existing_policy as e from public.opportunities where id = $1", [id])).rows[0]!.e);
const existingPolicy = (contact: string, line: string, extra: Record<string, unknown> = {}) =>
  insertOpportunity(db, agent, contact, line, "bound", { outcome: "won", existing_policy: true, ...extra });

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "existing-policy");
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("existing policies (ADR-042)", () => {
  it("create only the renewal review, and the contact becomes a client", async () => {
    const c = await insertContact(db, agent);
    await existingPolicy(c, "auto", { effective_date: addDays(today, -200), renewal_date: addDays(today, 30), policy_term_months: 6 });
    expect(await tasksFor(c)).toEqual([{ rule: "renewal_review", status: "open" }]);
    const { rows } = await db.query("select relationship_status::text as s from public.contacts where id = $1", [c]);
    expect(rows[0].s).toBe("client");
  });

  it("while a sale moved to Bound still gets its onboarding, review and referral tasks", async () => {
    const c = await insertContact(db, agent);
    const o = await insertOpportunity(db, agent, c, "home", "contacted");
    await asUser(db, agent, async (q) =>
      q.query("update public.opportunities set stage_id = (select s.id from public.stages s join public.pipeline_routes r on r.pipeline_id = s.pipeline_id where r.product_line = 'home' and s.template_code = 'bound'), outcome = 'won' where id = $1", [o]),
    );
    const rules = (await tasksFor(c)).map((t) => t.rule);
    expect(rules).toContain("won_onboarding_checklist");
    expect(rules).toContain("review_request");
    expect(rules).toContain("referral_request");
    expect(await existingOf(o)).toBe(false);
  });

  it("can only be created as won; once set it never turns off (Phase 29: a won sale may be marked later)", async () => {
    const c = await insertContact(db, agent);
    expect(await errorCode(insertOpportunity(db, agent, c, "auto", "contacted", { existing_policy: true }))).toBe("23514");

    const o = await existingPolicy(c, "home");
    await asUser(db, agent, (q) => q.query("update public.opportunities set existing_policy = false where id = $1", [o]));
    expect(await existingOf(o)).toBe(true);
    // Reopened and won again: still the same existing policy.
    await asUser(db, agent, (q) =>
      q.query("update public.opportunities set stage_id = (select s.id from public.stages s join public.pipeline_routes r on r.pipeline_id = s.pipeline_id where r.product_line = 'home' and s.template_code = 'follow_up'), outcome = 'open' where id = $1", [o]),
    );
    expect(await existingOf(o)).toBe(true);

    // Phase 29 (ADR-047): a won deal entered as a sale can be marked later; an open one cannot.
    const sale = await insertOpportunity(db, agent, c, "auto", "bound", { outcome: "won" });
    await asUser(db, agent, (q) => q.query("update public.opportunities set existing_policy = true where id = $1", [sale]));
    expect(await existingOf(sale)).toBe(true);
    const open = await insertOpportunity(db, agent, c, "home", "contacted");
    await asUser(db, agent, (q) => q.query("update public.opportunities set existing_policy = true where id = $1", [open]));
    expect(await existingOf(open)).toBe(false);
  });

  it("are not sales, new leads or new referrals in the reports", async () => {
    const u = await createUser(db, "existing-policy-report");
    await asUser(db, u, (q) => q.query("update public.automation_rules set enabled = false"));
    const referrer = await insertContact(db, u, { first_name: "Riley", created_at: "2026-01-05T15:00:00Z" });
    const sold = await insertContact(db, u, { first_name: "Sam", lead_source: "Website" });
    const existing = await insertContact(db, u, { first_name: "Taylor", lead_source: "Website", referred_by_contact_id: referrer });
    await insertOpportunity(db, u, sold, "auto", "bound", { outcome: "won" });
    await insertOpportunity(db, u, existing, "auto", "bound", { outcome: "won", existing_policy: true });

    const report = await asUser(db, u, async (q) =>
      (await q.query("select public.report_summary($1::date, $2::date, $3::date) as r", [addDays(today, -1), addDays(today, 1), today])).rows[0].r,
    );
    expect(report.conversion).toEqual([{ product_line: "auto", won: 1, lost: 0, won_premium: 0, won_with_premium: 0 }]);
    expect(report.new_leads).toEqual([{ source: "Website", contacts: 1, with_opportunity: 1, won: 1 }]);
    expect(report.referrals).toEqual([]);
    expect(report.asks.referrals_received).toBe(0);
  });
});

describe("the board (fix after Phase 25)", () => {
  it("leaves imported and existing policies out of 'won in the last 30 days'; the table still has them", async () => {
    const u = await createUser(db, "board-existing");
    const c = await insertContact(db, u);
    const sale = await insertOpportunity(db, u, c, "auto", "bound", { outcome: "won" });
    const held = await insertOpportunity(db, u, c, "auto", "bound", { outcome: "won", existing_policy: true });
    const imported = await asUser(db, u, async (q) =>
      (await q.query("select public.import_book('book.csv', $1) as r", [JSON.stringify([{ existing_contact_id: c, contact: {}, policies: [{ line: "auto" }] }])])).rows[0].r,
    );
    const importedId = (await db.query("select id from public.opportunities where import_batch_id = $1", [imported.batch_id])).rows[0].id;
    const search = (closed: string) => asUser(db, u, async (q) =>
      (await q.query<{ id: string }>("select id from public.search_opportunities(p_closed := $1, p_limit := 50)", [closed])).rows.map((r) => r.id).sort(),
    );
    expect(await search("recent")).toEqual([sale]);
    expect(await search("all")).toEqual([sale, held, importedId].sort());
  });
});
