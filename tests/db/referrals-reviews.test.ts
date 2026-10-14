import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Referral and Google review request support (owner request 2026-10-14, ADR-013).
// Phase 1 covers the data model; Phase 6 executes the rules.

let db: Db;
let agent: string;
let other: string;

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "referrals");
  other = await createUser(db, "referrals-other");
});
afterAll(async () => {
  await db.end();
});

describe("referred by", () => {
  it("links a new contact to the client who referred them", async () => {
    const referrer = await insertContact(db, agent, { first_name: "Riley", relationship_status: "client" });
    const referred = await insertContact(db, agent, { first_name: "Morgan", referred_by_contact_id: referrer, lead_source: "Referral" });
    const { rows } = await asUser(db, agent, (q) =>
      q.query("select id from public.contacts where referred_by_contact_id = $1", [referrer]),
    );
    expect(rows.map((r) => r.id)).toEqual([referred]);
  });

  it("rejects a contact referring itself", async () => {
    const id = await insertContact(db, agent);
    const code = await errorCode(
      asUser(db, agent, (q) => q.query("update public.contacts set referred_by_contact_id = id where id = $1", [id])),
    );
    expect(code).toBe("23514");
  });

  it("rejects a referrer owned by another agent", async () => {
    const othersContact = await insertContact(db, other);
    expect(await errorCode(insertContact(db, agent, { referred_by_contact_id: othersContact }))).toBe("23503");
  });
});

describe("Google reviews", () => {
  it("records the date a client left a review", async () => {
    const id = await insertContact(db, agent, { google_review_left_on: "2026-10-20" });
    const { rows } = await db.query("select google_review_left_on::text as d from public.contacts where id = $1", [id]);
    expect(rows[0].d).toBe("2026-10-20");
  });

  it("lets an agent save an https review link on their profile, and rejects anything else", async () => {
    const ok = await asUser(db, agent, (q) =>
      q.query("update public.profiles set google_review_url = 'https://g.page/r/example/review' where id = $1", [agent]),
    );
    expect(ok.rowCount).toBe(1);
    expect(
      await errorCode(
        asUser(db, agent, (q) => q.query("update public.profiles set google_review_url = 'javascript:alert(1)' where id = $1", [agent])),
      ),
    ).toBe("23514");
  });

  it("logs review and referral requests and their outcomes in contact history", async () => {
    const id = await insertContact(db, agent);
    await asUser(db, agent, async (q) => {
      await q.query("insert into public.activities (contact_id, activity_type) values ($1, 'review_request')", [id]);
      await q.query("insert into public.activities (contact_id, activity_type, outcome) values ($1, 'review_request', 'review_left')", [id]);
      await q.query("insert into public.activities (contact_id, activity_type, outcome) values ($1, 'referral_request', 'referral_received')", [id]);
      await q.query("insert into public.activities (contact_id, activity_type, outcome) values ($1, 'referral_request', 'declined')", [id]);
    });
    const { rows } = await db.query("select count(*)::int as n from public.activities where contact_id = $1", [id]);
    expect(rows[0].n).toBe(4);
  });
});

describe("task start date and category", () => {
  it("supports a task visible from a start date and due 30 days later", async () => {
    const contact = await insertContact(db, agent);
    const { rows } = await asUser(db, agent, (q) =>
      q.query(
        `insert into public.tasks (contact_id, title, category, start_date, due_date)
         values ($1, 'Ask for a Google review', 'review_request', '2026-10-15', '2026-11-14')
         returning category::text, start_date::text, due_date::text`,
        [contact],
      ),
    );
    expect(rows[0]).toEqual({ category: "review_request", start_date: "2026-10-15", due_date: "2026-11-14" });
  });

  it("defaults manual tasks to the 'other' category with no start date", async () => {
    const contact = await insertContact(db, agent);
    const { rows } = await asUser(db, agent, (q) =>
      q.query("insert into public.tasks (contact_id, title, due_date) values ($1, 'Call', '2026-10-20') returning category::text, start_date", [contact]),
    );
    expect(rows[0]).toEqual({ category: "other", start_date: null });
  });

  it("rejects a start date after the due date", async () => {
    const contact = await insertContact(db, agent);
    const code = await errorCode(
      asUser(db, agent, (q) =>
        q.query("insert into public.tasks (contact_id, title, start_date, due_date) values ($1, 'x', '2026-11-02', '2026-11-01')", [contact]),
      ),
    );
    expect(code).toBe("23514");
  });
});

describe("default review and referral rules", () => {
  it("start 1 day after a win, are due 30 days later, and do not repeat within 12 months", async () => {
    const userId = await createUser(db, "review-rules");
    const rules = await asUser(db, userId, async (q) =>
      (
        await q.query(
          `select rule_key, trigger_event::text, task_category::text, offset_days, day_count::text,
                  completion_window_days, cooldown_days, config
             from public.automation_rules
            where rule_key in ('review_request', 'referral_request') order by rule_key`,
        )
      ).rows,
    );
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule).toMatchObject({
        trigger_event: "opportunity_won", offset_days: 1, day_count: "calendar",
        completion_window_days: 30, cooldown_days: 365,
      });
      expect(rule.config.scope).toBe("contact");
      expect(typeof rule.config.message_template).toBe("string");
    }
    const review = rules.find((r) => r.rule_key === "review_request");
    expect(review?.task_category).toBe("review_request");
    expect(review?.config.skip_if_review_left).toBe(true);
    expect(review?.config.message_template).toContain("{review_link}");
    expect(rules.find((r) => r.rule_key === "referral_request")?.task_category).toBe("referral_request");
  });

  it("message templates offer no incentive (Google review policy)", async () => {
    const userId = await createUser(db, "review-policy");
    const templates = await asUser(db, userId, async (q) =>
      (await q.query<{ t: string }>("select config ->> 'message_template' as t from public.automation_rules where config ? 'message_template'")).rows.map((r) => r.t),
    );
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t).not.toMatch(/gift|discount|reward|prize|entry|drawing|\$|free/i);
    }
  });

  it("assigns a category to every task-creating default rule", async () => {
    const userId = await createUser(db, "categories");
    const { rows } = await asUser(db, userId, (q) =>
      q.query<{ rule_key: string; task_category: string }>(
        "select rule_key, task_category::text from public.automation_rules where action <> 'close_prospecting_tasks' order by rule_key",
      ),
    );
    expect(Object.fromEntries(rows.map((r) => [r.rule_key, r.task_category]))).toEqual({
      contacted_no_quote_follow_up: "prospecting",
      new_lead_initial_contact: "prospecting",
      no_response_follow_up: "prospecting",
      quote_sent_follow_up: "prospecting",
      referral_request: "referral_request",
      renewal_review: "renewal",
      reopened_restart: "prospecting",
      requested_follow_up: "prospecting",
      review_request: "review_request",
      won_onboarding_checklist: "onboarding",
    });
  });
});
