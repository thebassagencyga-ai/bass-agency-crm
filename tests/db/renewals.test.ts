import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 8: renewals view and retention workflow (ROADMAP Phase 8, ADR-023).

let db: Db;
let agent: string;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

type RenewalRow = { id: string; product_line: string; outcome: string; renewal_date: string; review_task_id: string | null; first_name: string | null };
const renewals = (days: number, user = agent, line: string | null = null): Promise<RenewalRow[]> =>
  asUser(db, user, async (q) =>
    (await q.query<RenewalRow>(
      "select id, product_line, outcome::text, renewal_date::text, review_task_id, first_name from public.search_renewals($1::date, $2, $3)",
      [today, days, line],
    )).rows,
  );
const record = (opp: string, outcome: string, extra: { reason?: string; premium?: number; notes?: string } = {}, user = agent) =>
  asUser(db, user, async (q) =>
    (await q.query("select public.record_renewal_outcome($1, $2::public.renewal_outcome, $3::public.renewal_loss_reason, $4, $5) as r", [
      opp, outcome, extra.reason ?? null, extra.premium ?? null, extra.notes ?? null,
    ])).rows[0].r as { next_renewal_date: string | null; contact_now_former_client: boolean },
  );
const opp = (id: string) =>
  asUser(db, agent, async (q) =>
    (await q.query("select renewal_date::text, estimated_annual_premium::float as premium, policy_ended_on::text, outcome::text from public.opportunities where id = $1", [id])).rows[0],
  );
const reviewTasks = (oppId: string) =>
  asUser(db, agent, async (q) =>
    (await q.query("select status::text, due_date::text as due, dedupe_key from public.tasks where opportunity_id = $1 and category = 'renewal' order by created_at, due_date", [oppId])).rows,
  );
const contactStatus = (id: string) =>
  asUser(db, agent, async (q) => (await q.query("select relationship_status::text as s from public.contacts where id = $1", [id])).rows[0].s);
const policy = (contact: string, line: string, renewal: string, more: Record<string, unknown> = {}) =>
  insertOpportunity(db, agent, contact, line, line === "life" ? "placed" : "bound", { outcome: "won", renewal_date: renewal, ...more });

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "renewals");
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
});
afterAll(async () => {
  await db.end();
});

describe("renewals view", () => {
  let lee: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    lee = await insertContact(db, agent, { first_name: "Lee", last_name: "Sample", relationship_status: "client" });
    ids.in20 = await policy(lee, "auto", addDays(today, 20));
    ids.in50 = await policy(lee, "home", addDays(today, 50));
    ids.in80 = await policy(lee, "life", addDays(today, 80));
    ids.in120 = await policy(lee, "commercial", addDays(today, 120));
    ids.pastDue = await policy(lee, "auto", addDays(today, -3));
    ids.prospect = await insertOpportunity(db, agent, lee, "home", "quoted", { renewal_date: addDays(today, 10) });
    ids.prospectPast = await insertOpportunity(db, agent, lee, "auto", "quoted", { renewal_date: addDays(today, -10) });
    ids.lost = await insertOpportunity(db, agent, lee, "life", "lost", { outcome: "lost", loss_reason: "price", renewal_date: addDays(today, 15) });
  });

  it("filters by 30 / 60 / 90 days, soonest first, always including past-due policies", async () => {
    const ofLee = async (days: number) => (await renewals(days)).filter((r) => r.first_name === "Lee").map((r) => r.id);
    expect(await ofLee(30)).toEqual([ids.pastDue, ids.prospect, ids.in20]);
    expect(await ofLee(60)).toEqual([ids.pastDue, ids.prospect, ids.in20, ids.in50]);
    expect(await ofLee(90)).toEqual([ids.pastDue, ids.prospect, ids.in20, ids.in50, ids.in80]);
  });

  it("never lists lost opportunities or prospects whose renewal date has passed", async () => {
    const listed = (await renewals(90)).map((r) => r.id);
    expect(listed).not.toContain(ids.lost);
    expect(listed).not.toContain(ids.prospectPast);
  });

  it("filters by product line and shows the open review task", async () => {
    const autos = await renewals(30, agent, "auto");
    expect(autos.map((r) => r.id)).toEqual([ids.pastDue, ids.in20]);
    expect(autos.every((r) => r.review_task_id !== null)).toBe(true);
  });

  it("another agent sees none of them", async () => {
    const other = await createUser(db, "renewals-other");
    expect(await renewals(90, other)).toEqual([]);
  });
});

describe("retention workflow", () => {
  it("renewed → outcome recorded, renewal date rolls forward 12 months, premium updated, review closed, next review created", async () => {
    const c = await insertContact(db, agent, { first_name: "Robin", relationship_status: "client" });
    const renewal = addDays(today, 40);
    const id = await policy(c, "home", renewal, { estimated_annual_premium: 1200 });
    expect(await reviewTasks(id)).toEqual([expect.objectContaining({ status: "open", due: today })]);

    const result = await record(id, "renewed", { premium: 1350, notes: "Fictional: kept same coverage" });
    const next = addMonths(renewal, 12);
    expect(result).toEqual({ next_renewal_date: next, contact_now_former_client: false });
    expect(await opp(id)).toEqual({ renewal_date: next, premium: 1350, policy_ended_on: null, outcome: "won" });
    const tasks = await reviewTasks(id);
    expect(tasks.map((t) => [t.status, t.due])).toEqual([["completed", today], ["open", addDays(next, -60)]]);

    const rows = await asUser(db, agent, async (q) =>
      (await q.query("select outcome::text, renewal_date::text, next_renewal_date::text, premium::float, notes, recorded_on::text from public.renewal_outcomes where opportunity_id = $1", [id])).rows,
    );
    expect(rows).toEqual([{ outcome: "renewed", renewal_date: renewal, next_renewal_date: next, premium: 1350, notes: "Fictional: kept same coverage", recorded_on: today }]);
  });

  it("a 6-month auto policy rolls forward 6 months and still gets its next review", async () => {
    const c = await insertContact(db, agent, { first_name: "Sam", relationship_status: "client" });
    // January renewal → July: same calendar year, so the key must name the half year.
    const year = Number(today.slice(0, 4)) + 1;
    const renewal = `${year}-01-15`;
    const id = await policy(c, "auto", renewal, { policy_term_months: 6, estimated_annual_premium: 900 });
    await record(id, "renewed");
    expect((await opp(id)).renewal_date).toBe(`${year}-07-15`);
    expect((await opp(id)).premium).toBe(900);
    const tasks = await reviewTasks(id);
    expect(tasks.map((t) => [t.status, t.dedupe_key.split(":").pop()])).toEqual([["completed", `${year}-h1`], ["open", `${year}-h2`]]);
  });

  it("re-marketed is recorded like renewed (client kept, date rolls forward)", async () => {
    const c = await insertContact(db, agent, { first_name: "Kai", relationship_status: "client" });
    const renewal = addDays(today, 25);
    const id = await policy(c, "auto", renewal);
    const result = await record(id, "remarketed", { premium: 1100 });
    expect(result.next_renewal_date).toBe(addMonths(renewal, 12));
    expect((await opp(id)).premium).toBe(1100);
  });

  it("lost → reason required; the policy ends, leaves renewals and the dashboard, and the contact becomes a former client", async () => {
    const c = await insertContact(db, agent, { first_name: "Drew", relationship_status: "client" });
    const renewal = addDays(today, 30);
    const id = await policy(c, "home", renewal);

    expect(await errorCode(record(id, "lost"))).toBe("23514");
    const result = await record(id, "lost", { reason: "other_carrier" });
    expect(result).toEqual({ next_renewal_date: null, contact_now_former_client: true });
    expect(await opp(id)).toEqual(expect.objectContaining({ renewal_date: renewal, policy_ended_on: renewal, outcome: "won" }));
    expect(await contactStatus(c)).toBe("former_client");
    expect((await reviewTasks(id)).map((t) => t.status)).toEqual(["completed"]);
    expect((await renewals(90)).map((r) => r.id)).not.toContain(id);

    const soonest = await asUser(db, agent, async (q) =>
      (await q.query("select public.dashboard_summary($1::date) -> 'renewals' -> 'soonest' as s", [today])).rows[0].s as { id: string }[],
    );
    expect(soonest.map((s) => s.id)).not.toContain(id);

    // An ended policy gets no further renewal reviews, even if its date is edited.
    await asUser(db, agent, (q) => q.query("update public.opportunities set renewal_date = $2 where id = $1", [id, addDays(renewal, 400)]));
    expect(await reviewTasks(id)).toHaveLength(1);
  });

  it("lost on one policy keeps the contact a client while another policy is active", async () => {
    const c = await insertContact(db, agent, { first_name: "Jules", relationship_status: "client" });
    const home = await policy(c, "home", addDays(today, 30));
    await policy(c, "auto", addDays(today, 200));
    const result = await record(home, "lost", { reason: "price" });
    expect(result.contact_now_former_client).toBe(false);
    expect(await contactStatus(c)).toBe("client");
  });

  it("only an active policy with a renewal date can have an outcome", async () => {
    const c = await insertContact(db, agent, { first_name: "Ari" });
    const open = await insertOpportunity(db, agent, c, "auto", "quoted", { renewal_date: addDays(today, 30) });
    const noDate = await policy(c, "home", null as unknown as string);
    const ended = await policy(c, "life", addDays(today, 30));
    await record(ended, "lost", { reason: "no_longer_needed" });
    expect(await errorCode(record(open, "renewed"))).toBe("23514");
    expect(await errorCode(record(noDate, "renewed"))).toBe("23514");
    expect(await errorCode(record(ended, "renewed"))).toBe("23514");
  });

  it("reopening an ended policy's opportunity clears the end date", async () => {
    const c = await insertContact(db, agent, { first_name: "Quinn" });
    const id = await policy(c, "home", addDays(today, 30));
    await record(id, "lost", { reason: "moved_away" });
    const sid = (await db.query("select id from public.pipeline_stages where product_line = 'home' and code = 'quoted'")).rows[0].id;
    await asUser(db, agent, (q) => q.query("update public.opportunities set stage_id = $2, outcome = 'open' where id = $1", [id, sid]));
    expect((await opp(id)).policy_ended_on).toBeNull();
  });

  it("an outcome is recorded once per renewal date and is never edited or deleted", async () => {
    const c = await insertContact(db, agent, { first_name: "Morgan" });
    const id = await policy(c, "home", addDays(today, 30));
    await record(id, "renewed");
    const dup = await errorCode(
      asUser(db, agent, (q) =>
        q.query(
          "insert into public.renewal_outcomes (opportunity_id, renewal_date, outcome, next_renewal_date, recorded_on) values ($1, $2, 'renewed', $3, $4)",
          [id, addDays(today, 30), addDays(today, 400), today],
        ),
      ),
    );
    const edit = await errorCode(asUser(db, agent, (q) => q.query("update public.renewal_outcomes set notes = 'x' where opportunity_id = $1", [id])));
    const del = await errorCode(asUser(db, agent, (q) => q.query("delete from public.renewal_outcomes where opportunity_id = $1", [id])));
    expect([dup, edit, del]).toEqual(["23505", "42501", "42501"]);
  });

  it("6-month terms are for auto only", async () => {
    const c = await insertContact(db, agent, { first_name: "Avery" });
    expect(await errorCode(policy(c, "home", addDays(today, 30), { policy_term_months: 6 }))).toBe("23514");
    expect(await errorCode(policy(c, "auto", addDays(today, 30), { policy_term_months: 3 }))).toBe("23514");
  });
});

describe("access", () => {
  it("another agent cannot record an outcome on someone else's policy", async () => {
    const c = await insertContact(db, agent, { first_name: "Casey" });
    const id = await policy(c, "home", addDays(today, 30));
    const other = await createUser(db, "renewals-intruder");
    expect(await errorCode(record(id, "renewed", {}, other))).toBe("P0002");
    expect((await opp(id)).renewal_date).toBe(addDays(today, 30));
  });

  it("anonymous callers cannot run the functions; a password-only session sees nothing", async () => {
    const anon = await errorCode(asAnon(db, (q) => q.query("select * from public.search_renewals(current_date, 90, null)")));
    const anonRecord = await errorCode(
      asAnon(db, (q) => q.query("select public.record_renewal_outcome(gen_random_uuid(), 'renewed')")),
    );
    const aal1 = await asPasswordOnlyUser(db, agent, async (q) => (await q.query("select * from public.search_renewals($1::date, 90, null)", [today])).rowCount);
    expect([anon, anonRecord, aal1]).toEqual(["42501", "42501", 0]);
  });
});
