import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBudget, costUsd, monthStart, worstCaseUsd } from "./budget";
import { AI_MODEL, aiEnabled, monthlyBudgetUsd } from "./config";
import type { JobRequest } from "./jobs";

// The one place the CRM talks to the Anthropic API (Phase 19, ADR-035). Server-only. It:
//   1. refuses unless the helpers are connected (ANTHROPIC_API_KEY set on the server);
//   2. refuses if this call could take the month over the cap;
//   3. asks for a structured answer, low effort, with Anthropic's server-side refusal fallback;
//   4. records tokens and cost (never the text) before returning anything.
// It never writes CRM records: callers return the suggestion to the user.

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const AI_ERRORS = {
  off: "AI helpers are not connected. See Settings → AI helpers.",
  budget: "This month's AI budget is used up. It resets on the 1st.",
  declined: "The AI declined this one. Please write it yourself.",
  failed: "The AI didn't answer properly. Please try again, or do this one yourself.",
  busy: "The AI service is busy. Try again in a minute.",
  record: "Could not record the AI usage, so the result was not shown. Please try again.",
} as const;

export async function monthSpendUsd(supabase: SupabaseClient, now = new Date()): Promise<number | null> {
  const { data, error } = await supabase.from("ai_usage").select("cost_usd").gte("created_at", monthStart(now));
  if (error) return null;
  return (data ?? []).reduce((sum, r) => sum + Number((r as { cost_usd: number | string }).cost_usd), 0);
}

export async function runJob<T>(supabase: SupabaseClient, req: JobRequest<T>): Promise<AiResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!aiEnabled(apiKey)) return { ok: false, error: AI_ERRORS.off };

  const spent = await monthSpendUsd(supabase);
  if (spent === null) return { ok: false, error: AI_ERRORS.record };
  const budget = checkBudget(spent, worstCaseUsd(req.system.length + req.user.length, req.maxTokens), monthlyBudgetUsd());
  if (!budget.ok) return { ok: false, error: budget.reason === "off" ? AI_ERRORS.off : AI_ERRORS.budget };

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: { effort: "low", format: betaZodOutputFormat(req.output) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (error) {
    // Never log the request or response: they contain client data.
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: AI_ERRORS.busy };
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "The AI key was refused. Check it in the hosting settings." };
    }
    return { ok: false, error: AI_ERRORS.failed };
  }

  const u = response.usage;
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  const { error: recordError } = await supabase.from("ai_usage").insert({
    job: req.job, model: response.model || AI_MODEL, input_tokens: input, output_tokens: output, cost_usd: costUsd(input, output),
  });
  if (recordError) return { ok: false, error: AI_ERRORS.record };

  if (response.stop_reason === "refusal") return { ok: false, error: AI_ERRORS.declined };
  if (response.stop_reason === "max_tokens" || response.parsed_output == null) return { ok: false, error: AI_ERRORS.failed };
  return { ok: true, value: response.parsed_output as T };
}
