import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// runJob against a fake Anthropic SDK and a fake Supabase client: the cap is checked before
// calling, usage is recorded (numbers only) before anything is returned, and refusals or bad
// answers become friendly errors. No network.

vi.mock("server-only", () => ({}));
const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class APIConnectionError extends APIError {}
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class Anthropic {
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});
vi.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({ betaZodOutputFormat: (s: unknown) => ({ type: "json_schema", schema: s }) }));

const { runJob, AI_ERRORS } = await import("@/lib/ai/run");

function fakeSupabase(spent: number[], insertError: unknown = null) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({ gte: async () => ({ data: spent.map((c) => ({ cost_usd: String(c) })), error: null }) }),
      insert: async (row: Record<string, unknown>) => {
        expect(table).toBe("ai_usage");
        inserted.push(row);
        return { error: insertError };
      },
    }),
  };
  return { client: client as never, inserted };
}

const req = { job: "daily_briefing" as const, system: "s", user: "u", maxTokens: 1000, output: z.object({ ok: z.boolean() }) };
const reply = (over: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5", stop_reason: "end_turn", parsed_output: { ok: true },
  usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...over,
});

beforeEach(() => {
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-ant-" + "x".repeat(40);
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

describe("runJob", () => {
  it("is off without a key and never calls the API", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { client } = fakeSupabase([]);
    expect(await runJob(client, req)).toEqual({ ok: false, error: AI_ERRORS.off });
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses when the month's cap could be exceeded, before calling", async () => {
    const { client } = fakeSupabase([6, 3.99]);
    expect(await runJob(client, req)).toEqual({ ok: false, error: AI_ERRORS.budget });
    expect(parse).not.toHaveBeenCalled();
  });

  it("calls with low effort, structured output and refusal fallback; records tokens and cost only", async () => {
    parse.mockResolvedValue(reply());
    const { client, inserted } = fakeSupabase([1]);
    expect(await runJob(client, req)).toEqual({ ok: true, value: { ok: true } });
    const params = parse.mock.calls[0]![0];
    expect(params).toMatchObject({ model: "claude-opus-5-5", max_tokens: 1000, output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(inserted).toEqual([{ job: "daily_briefing", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 200, cost_usd: 0.01 }]);
  });

  it("records usage even when the answer is a refusal or unusable", async () => {
    for (const [over, error] of [[{ stop_reason: "refusal" }, AI_ERRORS.declined], [{ parsed_output: null }, AI_ERRORS.failed], [{ stop_reason: "max_tokens" }, AI_ERRORS.failed]] as const) {
      parse.mockResolvedValue(reply(over));
      const { client, inserted } = fakeSupabase([]);
      expect(await runJob(client, req)).toEqual({ ok: false, error });
      expect(inserted).toHaveLength(1);
    }
  });

  it("shows nothing if the usage could not be recorded", async () => {
    parse.mockResolvedValue(reply());
    const { client } = fakeSupabase([], { code: "42501" });
    expect(await runJob(client, req)).toEqual({ ok: false, error: AI_ERRORS.record });
  });

  it("turns API errors into plain messages", async () => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as { RateLimitError: new () => Error; AuthenticationError: new () => Error };
    parse.mockRejectedValueOnce(new Anthropic.RateLimitError());
    expect(await runJob(fakeSupabase([]).client, req)).toEqual({ ok: false, error: AI_ERRORS.busy });
    parse.mockRejectedValueOnce(new Anthropic.AuthenticationError());
    expect((await runJob(fakeSupabase([]).client, req)).ok).toBe(false);
    parse.mockRejectedValueOnce(new Error("boom"));
    expect(await runJob(fakeSupabase([]).client, req)).toEqual({ ok: false, error: AI_ERRORS.failed });
  });
});
