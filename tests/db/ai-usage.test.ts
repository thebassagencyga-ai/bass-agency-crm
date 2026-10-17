import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, type Db } from "./helpers";

// Phase 19 (ADR-035): the AI usage ledger behind the monthly cap. Numbers only; append-only.

let db: Db;
let alice: string;
let bob: string;
const add = (user: string, job = "draft_message", cost = 0.0123) =>
  asUser(db, user, (q) => q.query("insert into public.ai_usage (job, model, input_tokens, output_tokens, cost_usd) values ($1, 'claude-opus-5-5', 1000, 200, $2)", [job, cost]));

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "ai-alice");
  bob = await createUser(db, "ai-bob");
});
afterAll(async () => {
  await db.end();
});

describe("ai_usage", () => {
  it("records a call for its owner; the month's total is the sum", async () => {
    await add(alice);
    await add(alice, "daily_briefing", 0.0077);
    const total = await asUser(db, alice, async (q) =>
      Number((await q.query("select sum(cost_usd) as s from public.ai_usage where created_at >= date_trunc('month', now())")).rows[0].s));
    expect(total).toBeCloseTo(0.02, 6);
  });

  it("cannot be edited or removed by the app, so a recorded cost always counts", async () => {
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.ai_usage set cost_usd = 0 where owner_id = $1", [alice])))).toBe("42501");
    expect(await errorCode(asUser(db, alice, (q) => q.query("delete from public.ai_usage where owner_id = $1", [alice])))).toBe("42501");
  });

  it("refuses unknown jobs and negative numbers", async () => {
    expect(await errorCode(add(alice, "send_email"))).toBe("23514");
    expect(await errorCode(add(alice, "draft_message", -1))).toBe("23514");
  });

  it("is private to each agent and closed to password-only and anonymous sessions", async () => {
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.ai_usage where owner_id = $1", [alice])).rows[0].n)).toBe(0);
    expect(await errorCode(asUser(db, bob, (q) => q.query("insert into public.ai_usage (owner_id, job, model, input_tokens, output_tokens, cost_usd) values ($1, 'draft_message', 'm', 1, 1, 0.1)", [alice])))).toBe("42501");
    expect(await errorCode(asPasswordOnlyUser(db, alice, (q) =>
      q.query("insert into public.ai_usage (job, model, input_tokens, output_tokens, cost_usd) values ('draft_message', 'm', 1, 1, 0.1)")))).toBe("42501");
    expect(await asPasswordOnlyUser(db, alice, async (q) => (await q.query("select count(*)::int as n from public.ai_usage")).rows[0].n)).toBe(0);
    expect(await errorCode(asAnon(db, (q) => q.query("select 1 from public.ai_usage")))).toBe("42501");
  });
});
