import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIPELINES, PRODUCT_LINES } from "@/lib/pipelines";
import { asUser, connect, createUser, type Db } from "./helpers";

let db: Db;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("reference data", () => {
  it("seeds exactly the four product lines", async () => {
    const { rows } = await db.query<{ code: string }>("select code from public.product_lines order by sort_order");
    expect(rows.map((r) => r.code)).toEqual([...PRODUCT_LINES]);
  });

  it.each(PRODUCT_LINES)("seeds the %s pipeline exactly as defined in src/lib/pipelines.ts", async (line) => {
    const { rows } = await db.query<{ code: string; name: string; kind: string }>(
      "select code, name, kind::text from public.pipeline_stages where product_line = $1 order by position",
      [line],
    );
    expect(rows).toEqual(PIPELINES[line].map(({ code, name, kind }) => ({ code, name, kind })));
  });
});

describe("default automation rules", () => {
  it("are created for every new profile, enabled, and match the spec's defaults", async () => {
    const userId = await createUser(db, "rules");
    const rules = await asUser(db, userId, async (q) => {
      const { rows } = await q.query<{
        rule_key: string; trigger_event: string; action: string; anchor: string;
        offset_days: number; day_count: string; enabled: boolean;
      }>(
        `select rule_key, trigger_event::text, action::text, anchor::text, offset_days, day_count::text, enabled
           from public.automation_rules order by rule_key`,
      );
      return Object.fromEntries(rows.map((r) => [r.rule_key, r]));
    });

    expect(Object.keys(rules)).toHaveLength(12);
    expect(Object.values(rules).every((r) => r.enabled)).toBe(true);
    expect(rules.new_lead_initial_contact).toMatchObject({ trigger_event: "opportunity_created", offset_days: 0 });
    expect(rules.contacted_no_quote_follow_up).toMatchObject({ offset_days: 2, day_count: "business" });
    expect(rules.quote_sent_follow_up).toMatchObject({ offset_days: 3, day_count: "calendar" });
    expect(rules.requested_follow_up).toMatchObject({ anchor: "requested_date", offset_days: 0 });
    expect(rules.no_response_follow_up).toMatchObject({ offset_days: 5, day_count: "calendar" });
    expect(rules.won_close_prospecting).toMatchObject({ trigger_event: "opportunity_won", action: "close_prospecting_tasks" });
    expect(rules.won_onboarding_checklist).toMatchObject({ action: "create_checklist" });
    expect(rules.lost_close_prospecting).toMatchObject({ trigger_event: "opportunity_lost", action: "close_prospecting_tasks" });
    expect(rules.renewal_review).toMatchObject({ anchor: "renewal_date", offset_days: -60 });
    expect(rules.reopened_restart).toMatchObject({ trigger_event: "opportunity_reopened" });
  });

  it("do not leak to other users", async () => {
    const a = await createUser(db, "rules-a");
    const b = await createUser(db, "rules-b");
    const seenByA = await asUser(db, a, async (q) => {
      const { rows } = await q.query<{ owner_id: string }>("select distinct owner_id from public.automation_rules");
      return rows.map((r) => r.owner_id);
    });
    expect(seenByA).toEqual([a]);
    expect(seenByA).not.toContain(b);
  });
});
