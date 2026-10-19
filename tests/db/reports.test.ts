import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 9: every report figure against fixture data (ROADMAP Phase 9, ADR-024).
// Period: September 2026 in New York time; "today" is Oct 15, 2026.

const START = "2026-09-01";
const END = "2026-09-30";
const TODAY = "2026-10-15";

let db: Db;
let user: string;
let other: string;
let report: Report;

type Report = {
  period: { start: string; end: string; today: string };
  open_pipeline: { pipeline_id: string; pipeline_name: string; pipeline_position: number; stage_name: string; open_count: number; nurture_count: number; premium: number; with_premium: number }[];
  new_leads: { source: string | null; contacts: number; with_opportunity: number; won: number }[];
  quotes: { product_line: string; quoted: number; open_count: number; nurture_count: number; won: number; lost: number; premium: number; with_premium: number }[];
  conversion: { product_line: string; won: number; lost: number; won_premium: number; won_with_premium: number }[];
  tasks: { completed: number; completed_on_time: number; completed_late: number; overdue_now: number };
  renewals: {
    reviews_overdue: number; reviews_next_30: number; reviews_31_60: number; policies_next_90: number;
    outcomes: { renewed: number; remarketed: number; lost: number };
  };
  cross_sell: { by_rule: { rule_name: string; lacks_line: string; prompts: number }[]; dismissed: number };
  referrals: { referrer_id: string; first_name: string | null; referred: number; won: number; working: number }[];
  asks: { review_asked: number; reviews_recorded: number; referral_asked: number; referrals_received: number };
};

const run = (userId: string, start = START, end = END, aal1 = false): Promise<Report> => {
  const q = async (c: Db) => (await c.query("select public.report_summary($1::date, $2::date, $3::date) as r", [start, end, TODAY])).rows[0].r as Report;
  return aal1 ? asPasswordOnlyUser(db, userId, q) : asUser(db, userId, q);
};
const contact = (userId: string, values: Record<string, unknown>) => insertContact(db, userId, values);
const closeAt = (oppId: string, at: string) => db.query("update public.opportunities set closed_at = $2 where id = $1", [oppId, at]);
const insertAs = (userId: string, table: string, values: Record<string, unknown>) =>
  asUser(db, userId, async (q) => {
    const cols = Object.keys(values);
    return (
      await q.query<{ id: string }>(
        `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(values),
      )
    ).rows[0]!.id;
  });

async function seed(u: string): Promise<{ avery: string }> {
  // Fixture figures only: no automatic tasks.
  await asUser(db, u, (q) => q.query("update public.automation_rules set enabled = false"));

  // Contacts. Instants are UTC; New York is UTC−4 in September.
  const avery = await contact(u, { first_name: "Avery", lead_source: "Website", relationship_status: "client", created_at: "2026-09-05T15:00:00Z", google_review_left_on: "2026-09-20" });
  const blake = await contact(u, { first_name: "Blake", lead_source: " website ", created_at: "2026-09-10T15:00:00Z" });
  await contact(u, { first_name: "Casey", created_at: "2026-10-01T02:00:00Z" }); // Sep 30, 10 pm in New York: in
  const drew = await contact(u, { first_name: "Drew", lead_source: "Referral", referred_by_contact_id: avery, created_at: "2026-09-20T15:00:00Z" });
  const eden = await contact(u, { first_name: "Eden", lead_source: "Referral", referred_by_contact_id: avery, created_at: "2026-09-21T15:00:00Z" });
  await contact(u, { first_name: "Finn", lead_source: "Website", referred_by_contact_id: avery, created_at: "2026-09-01T03:00:00Z" }); // Aug 31 in New York: out
  const gray = await contact(u, { contact_type: "business", business_name: "Example Hardware LLC", lead_source: "Walk-in", created_at: "2026-08-01T15:00:00Z", google_review_left_on: "2026-08-01" });

  // Opportunities.
  const averyAuto = await insertOpportunity(db, u, avery, "auto", "bound", { outcome: "won", quote_sent_on: "2026-09-06", estimated_annual_premium: 1200, renewal_date: "2026-11-01" });
  await closeAt(averyAuto, "2026-09-15T16:00:00Z");
  const averyHome = await insertOpportunity(db, u, avery, "home", "lost", { outcome: "lost", loss_reason: "price", quote_sent_on: "2026-09-07" });
  await closeAt(averyHome, "2026-09-25T16:00:00Z");
  await insertOpportunity(db, u, blake, "auto", "quoted", { quote_sent_on: "2026-09-12", estimated_annual_premium: 800 });
  await insertOpportunity(db, u, blake, "home", "follow_up", { outcome: "nurture", quote_sent_on: "2026-09-13", estimated_annual_premium: 500 });
  await insertOpportunity(db, u, drew, "life", "new_lead");
  const edenAuto = await insertOpportunity(db, u, eden, "auto", "bound", { outcome: "won", quote_sent_on: "2026-08-30" });
  await closeAt(edenAuto, "2026-10-02T16:00:00Z"); // closed in October: not in September's conversion
  const grayCommercial = await insertOpportunity(db, u, gray, "commercial", "bound", { outcome: "won", estimated_annual_premium: 5000 });
  await closeAt(grayCommercial, "2026-09-03T16:00:00Z");

  // Tasks (on Avery unless noted).
  const task = (values: Record<string, unknown>) => insertAs(u, "tasks", { contact_id: avery, title: "Fixture task", ...values });
  await task({ due_date: "2026-09-10", status: "completed", completed_at: "2026-09-09T15:00:00Z" }); // on time
  await task({ due_date: "2026-09-10", status: "completed", completed_at: "2026-09-12T15:00:00Z" }); // late
  await task({ due_date: "2026-09-30", status: "completed", completed_at: "2026-10-01T03:00:00Z" }); // Sep 30 in New York, on time
  await task({ due_date: "2026-10-01", status: "completed", completed_at: "2026-10-05T15:00:00Z" }); // October: out
  await task({ due_date: "2026-10-10" }); // overdue now
  await task({ due_date: "2026-10-20" }); // not overdue
  await task({ due_date: "2026-09-01", status: "cancelled" }); // never counted
  await task({ due_date: "2026-10-01", category: "renewal" }); // review overdue
  await task({ due_date: "2026-10-30", category: "renewal" }); // review in the next 30 days
  await task({ due_date: "2026-12-01", category: "renewal" }); // review in 31–60 days
  await task({ due_date: "2026-09-30", category: "review_request", status: "completed", completed_at: "2026-09-16T15:00:00Z" });
  await task({ contact_id: gray, due_date: "2026-09-30", category: "referral_request", status: "completed", completed_at: "2026-09-22T15:00:00Z" });

  // Request activities: Avery asked twice (task + activity) counts once; Blake's is in October.
  const activity = (contactId: string, type: string, at: string) => insertAs(u, "activities", { contact_id: contactId, activity_type: type, occurred_at: at });
  await activity(avery, "review_request", "2026-09-17T15:00:00Z");
  await activity(gray, "review_request", "2026-09-18T15:00:00Z");
  await activity(blake, "review_request", "2026-10-02T15:00:00Z");

  // Renewal outcomes: one in September, one in October.
  const outcome = (renewal: string, kind: string, recorded: string) =>
    insertAs(u, "renewal_outcomes", {
      opportunity_id: grayCommercial, renewal_date: renewal, outcome: kind, recorded_on: recorded,
      next_renewal_date: kind === "lost" ? null : "2027-09-10", loss_reason: kind === "lost" ? "price" : null,
    });
  await outcome("2026-09-10", "renewed", "2026-09-15");
  await outcome("2026-10-01", "lost", "2026-10-03");

  // Eden's "auto without home" prompt was dismissed in September.
  const rule = await asUser(db, u, async (q) => (await q.query("select id from public.cross_sell_rules where rule_key = 'auto_no_home'")).rows[0].id as string);
  await insertAs(u, "cross_sell_dismissals", { contact_id: eden, rule_id: rule, dismissed_on: "2026-09-20", hidden_until: "2027-09-20" });
  return { avery };
}

let avery: string;
beforeAll(async () => {
  db = await connect();
  user = await createUser(db, "reports");
  other = await createUser(db, "reports-other");
  ({ avery } = await seed(user));
  report = await run(user);
});
afterAll(async () => {
  await db.end();
});

describe("report_summary for September 2026", () => {
  it("open pipeline now: open and nurture by pipeline and stage; premium only where recorded", () => {
    expect(report.open_pipeline.map((r) => [r.pipeline_name, r.stage_name, r.open_count, r.nurture_count, Number(r.premium), r.with_premium])).toEqual([
      ["Auto", "Quoted", 1, 0, 800, 1],
      ["Home", "Follow Up", 0, 1, 500, 1],
      ["Life", "New Lead", 1, 0, 0, 0],
    ]);
  });

  it("new leads by source: contacts added in the period (New York dates), sources matched ignoring case and spaces", () => {
    expect(report.new_leads).toEqual([
      { source: "Referral", contacts: 2, with_opportunity: 2, won: 1 },
      { source: "Website", contacts: 2, with_opportunity: 2, won: 1 },
      { source: null, contacts: 1, with_opportunity: 0, won: 0 },
    ]);
  });

  it("quotes sent in the period by line, with where they stand now", () => {
    expect(report.quotes.map((r) => ({ ...r, premium: Number(r.premium) }))).toEqual([
      { product_line: "auto", quoted: 2, open_count: 1, nurture_count: 0, won: 1, lost: 0, premium: 2000, with_premium: 2 },
      { product_line: "home", quoted: 2, open_count: 0, nurture_count: 1, won: 0, lost: 1, premium: 500, with_premium: 1 },
    ]);
  });

  it("conversion counts only opportunities closed in the period (won and lost; open excluded)", () => {
    expect(report.conversion.map((r) => ({ ...r, won_premium: Number(r.won_premium) }))).toEqual([
      { product_line: "auto", won: 1, lost: 0, won_premium: 1200, won_with_premium: 1 },
      { product_line: "commercial", won: 1, lost: 0, won_premium: 5000, won_with_premium: 1 },
      { product_line: "home", won: 0, lost: 1, won_premium: 0, won_with_premium: 0 },
    ]);
  });

  it("tasks: completed in the period (on time vs late) and overdue now", () => {
    expect(report.tasks).toEqual({ completed: 5, completed_on_time: 4, completed_late: 1, overdue_now: 2 });
  });

  it("renewals: open reviews by due date, policies renewing in 90 days, outcomes recorded in the period", () => {
    expect(report.renewals).toEqual({
      reviews_overdue: 1, reviews_next_30: 1, reviews_31_60: 1, policies_next_90: 1,
      outcomes: { renewed: 1, remarketed: 0, lost: 0 },
    });
  });

  it("cross-sell: current prompts by rule (dismissed ones hidden) and dismissals in the period", () => {
    expect(report.cross_sell).toEqual({
      by_rule: [
        { rule_name: "Auto or home client without life", lacks_line: "life", prompts: 2 },
        { rule_name: "Commercial client without life", lacks_line: "life", prompts: 1 },
      ],
      dismissed: 1,
    });
  });

  it("referral sources: who referred the contacts added in the period, and how they are doing", () => {
    expect(report.referrals.map((r) => ({ id: r.referrer_id, name: r.first_name, referred: r.referred, won: r.won, working: r.working }))).toEqual([
      { id: avery, name: "Avery", referred: 2, won: 1, working: 1 },
    ]);
  });

  it("reviews and referrals: clients asked (once each), reviews recorded, referrals received", () => {
    expect(report.asks).toEqual({ review_asked: 2, reviews_recorded: 1, referral_asked: 1, referrals_received: 2 });
  });
});

describe("access and input", () => {
  it("another agent's report has none of these figures", async () => {
    const theirs = await run(other);
    expect(theirs.open_pipeline).toEqual([]);
    expect(theirs.new_leads).toEqual([]);
    expect(theirs.conversion).toEqual([]);
    expect(theirs.tasks).toEqual({ completed: 0, completed_on_time: 0, completed_late: 0, overdue_now: 0 });
    expect(theirs.referrals).toEqual([]);
    expect(theirs.asks).toEqual({ review_asked: 0, reviews_recorded: 0, referral_asked: 0, referrals_received: 0 });
  });

  it("a password-only session gets empty figures; anonymous callers are refused", async () => {
    const aal1 = await run(user, START, END, true);
    expect([aal1.open_pipeline, aal1.new_leads, aal1.tasks.completed]).toEqual([[], [], 0]);
    expect(await errorCode(asAnon(db, (q) => q.query("select public.report_summary('2026-09-01', '2026-09-30', '2026-10-15')")))).toBe("42501");
  });

  it("rejects a period that ends before it starts or spans more than two years", async () => {
    expect(await errorCode(run(user, "2026-09-30", "2026-09-01"))).toBe("22023");
    expect(await errorCode(run(user, "2023-01-01", "2026-09-30"))).toBe("22023");
  });
});
