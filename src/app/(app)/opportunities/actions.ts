"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { todayInZone } from "@/lib/dates";
import { DEFAULT_CHECK_BACK, checkBackDate, coverageSchema } from "@/lib/focus";
import { lifeDetailsSchema } from "@/lib/production";
import { changeLineSchema } from "@/lib/opportunities/schema";
import { EXISTING_POLICY_FIELDS, existingPolicyRow, existingPolicySchema } from "@/lib/opportunities/existing-policy";
import { resolveQuoteDate, suggestedQuoteDate } from "@/lib/opportunities/quote-date";
import { getProfile } from "@/lib/tasks/data";
import { isUuid } from "@/lib/contacts/data";
import {
  NEW_OPPORTUNITY_FIELDS,
  OPPORTUNITY_DETAIL_FIELDS,
  canToggleNurture,
  newOpportunitySchema,
  opportunityDetailsSchema,
  planStageChange,
  stageChangeSchema,
  termForLine,
  type Opportunity,
  type Stage,
} from "@/lib/opportunities";

// Every action re-checks the full (two-step) session on the server and writes through the
// user's own Supabase client, so RLS and the database constraints apply as well.

function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of [...NEW_OPPORTUNITY_FIELDS, "loss_reason", "loss_reason_detail"]) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 1000);
  }
  return values;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

function friendlyDbError(code: string | undefined): FormState {
  if (code === "23503") return { error: "That contact or stage could not be found." };
  if (code === "23514") return { error: "Some details are not valid. Check the fields and try again." };
  if (code === "42501") return { error: "You don't have permission to do that. Sign in again and retry." };
  return { error: "Could not save the opportunity. Please try again." };
}

async function getStage(supabase: SupabaseClient, id: string): Promise<Stage | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from("stages").select("id, pipeline_id, name, position, kind, is_quote_stage, archived_at").eq("id", id).maybeSingle();
  return (data as Stage | null) ?? null;
}

async function loadOpportunity(supabase: SupabaseClient, id: string): Promise<Opportunity | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from("opportunities").select("*").eq("id", id).maybeSingle();
  return (data as Opportunity | null) ?? null;
}

function revalidate(contactId: string) {
  revalidatePath("/opportunities");
  revalidatePath(`/contacts/${contactId}`);
}

export async function createOpportunity(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echoValues(formData);
  const raw = Object.fromEntries(NEW_OPPORTUNITY_FIELDS.map((f) => [f, formData.get(f)]));
  const parsed = newOpportunitySchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const data = parsed.data;

  // Phase 25: any working stage of any of the agent's pipelines (RLS limits it to their own).
  const stage = await getStage(supabase, data.stage_id);
  if (!stage || stage.kind !== "active" || stage.archived_at) {
    return { fieldErrors: { stage_id: "Choose a starting stage." }, values };
  }

  const { data: row, error } = await supabase.from("opportunities").insert(termForLine(data, data.product_line)).select("id").single();
  if (error || !row) return { ...friendlyDbError(error?.code), values };
  revalidate(data.contact_id);
  redirect(`/opportunities/${row.id as string}?saved=1`);
}

/**
 * A policy the client already has (ADR-042): inserted directly as won at the line's Bound stage,
 * so the database creates only the renewal review (no onboarding, review or referral tasks) and
 * reports do not count it as a sale. The contact becomes a client (Phase 23 trigger).
 */
export async function createExistingPolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const name of EXISTING_POLICY_FIELDS) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 1000);
  }
  const parsed = existingPolicySchema.safeParse(Object.fromEntries(EXISTING_POLICY_FIELDS.map((f) => [f, formData.get(f)])));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const data = parsed.data;

  // The Won stage of the pipeline this line's new leads go to (Phase 25).
  const { data: route } = await supabase.from("pipeline_routes").select("pipeline_id").eq("product_line", data.product_line).maybeSingle();
  const { data: wonStage } = route
    ? await supabase.from("stages").select("id").eq("pipeline_id", route.pipeline_id as string).eq("kind", "won").is("archived_at", null).maybeSingle()
    : { data: null };
  if (!wonStage) return { error: "Could not save the policy. Please try again.", values };
  const today = todayInZone((await getProfile(supabase, userId)).time_zone);

  const { data: row, error } = await supabase
    .from("opportunities").insert(existingPolicyRow(data, wonStage.id as string, today)).select("id").single();
  if (error || !row) return { ...friendlyDbError(error?.code), values };
  revalidate(data.contact_id);
  revalidatePath("/renewals");
  redirect(`/opportunities/${row.id as string}?existing=1`);
}

export async function updateOpportunity(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echoValues(formData);
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { error: "This opportunity could not be found.", values };
  const raw = Object.fromEntries(OPPORTUNITY_DETAIL_FIELDS.map((f) => [f, formData.get(f)]));
  const parsed = opportunityDetailsSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const existing = await loadOpportunity(supabase, id);
  if (!existing) return { error: "This opportunity could not be found.", values };

  const { data: rows, error } = await supabase
    .from("opportunities")
    .update(termForLine(parsed.data, existing.product_line))
    .eq("id", id)
    .select("id, contact_id");
  if (error) return { ...friendlyDbError(error.code), values };
  const updated = rows?.[0] as { id: string; contact_id: string } | undefined;
  if (!updated) return { error: "This opportunity could not be found.", values };
  revalidate(updated.contact_id);
  redirect(`/opportunities/${id}?saved=1`);
}

/** Stage change from the detail page (including won, lost with a reason, and reopen). */
export async function changeStage(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireFullSession();
  const values = echoValues(formData);
  const parsed = stageChangeSchema.safeParse({
    id: formData.get("id"),
    stage_id: formData.get("stage_id"),
    loss_reason: formData.get("loss_reason"),
    loss_reason_detail: formData.get("loss_reason_detail"),
    quote_sent_on: formData.get("quote_sent_on"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };

  const [opp, stage, profile] = await Promise.all([
    loadOpportunity(supabase, parsed.data.id), getStage(supabase, parsed.data.stage_id), getProfile(supabase, userId),
  ]);
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (!stage) return { fieldErrors: { stage_id: "Choose a stage." }, values };

  const plan = planStageChange({
    current: { pipelineId: opp.pipeline_id, outcome: opp.outcome, stageId: opp.stage_id },
    target: { id: stage.id, pipelineId: stage.pipeline_id, kind: stage.kind, archived: stage.archived_at !== null },
    lossReason: parsed.data.loss_reason,
    lossReasonDetail: parsed.data.loss_reason_detail,
  });
  if (!plan.ok) return { fieldErrors: { [plan.field]: plan.message }, values };

  // Into a quote stage (Phase 23): save the quote date, today unless the agent changed it.
  // Saving it (or changing it) is what schedules the quote follow-up.
  let update: typeof plan.update & { quote_sent_on?: string } = plan.update;
  if (stage.is_quote_stage && (plan.update.outcome === "open" || plan.update.outcome === "nurture")) {
    const today = todayInZone(profile.time_zone);
    const suggestion = suggestedQuoteDate({ existing: opp.quote_sent_on, reopening: plan.reopened, today });
    const quote = resolveQuoteDate(parsed.data.quote_sent_on, suggestion, today);
    if (!quote.ok) return { fieldErrors: { quote_sent_on: quote.message }, values };
    update = { ...plan.update, quote_sent_on: quote.date };
  }

  const { data: rows, error } = await supabase.from("opportunities").update(update).eq("id", opp.id).select("id");
  if (error) return { ...friendlyDbError(error.code), values };
  if (!rows || rows.length === 0) return { error: "This opportunity could not be found.", values };
  revalidate(opp.contact_id);
  const notice = plan.reopened ? "reopened" : plan.update.outcome === "won" ? "won" : plan.update.outcome === "lost" ? "lost" : "moved";
  redirect(`/opportunities/${opp.id}?${notice}=1`);
}

/** Quick "move to stage" from a board card. Lost needs a reason, so it goes to the detail page. */
export async function moveFromBoard(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  const stageId = String(formData.get("stage_id") ?? "");
  const q = String(formData.get("q") ?? "").slice(0, 100);
  const [opp, stage] = await Promise.all([loadOpportunity(supabase, id), getStage(supabase, stageId)]);
  if (!opp) redirect("/opportunities?error=move");
  const back = (flag: string) => {
    // Back to the pipeline the deal is now in (a move can cross pipelines, Phase 25).
    const qs = new URLSearchParams({ pipeline: stage?.pipeline_id ?? opp.pipeline_id, [flag]: "1" });
    if (q) qs.set("q", q);
    return `/opportunities?${qs.toString()}#opp-${opp.id}`;
  };
  if (!stage) redirect(back("error"));
  if (stage.kind === "lost") redirect(`/opportunities/${opp.id}?mark=lost#mark-lost`);

  const plan = planStageChange({
    current: { pipelineId: opp.pipeline_id, outcome: opp.outcome, stageId: opp.stage_id },
    target: { id: stage.id, pipelineId: stage.pipeline_id, kind: stage.kind, archived: stage.archived_at !== null },
  });
  if (!plan.ok) redirect(back("error"));
  const { error } = await supabase.from("opportunities").update(plan.update).eq("id", opp.id);
  if (error) redirect(back("error"));
  revalidate(opp.contact_id);
  redirect(back(plan.update.outcome === "won" ? "won" : "moved"));
}

/**
 * Back to open (nurture=0), or into nurture with the default check-back date (nurture=1, the
 * form used before JavaScript loads). The check-back form below lets the agent choose the date.
 */
export async function setNurture(formData: FormData): Promise<void> {
  const { supabase, userId } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  const on = formData.get("nurture") === "1";
  const opp = await loadOpportunity(supabase, id);
  if (!opp) redirect("/opportunities");
  if (!canToggleNurture(opp.outcome, opp.stage_kind)) redirect(`/opportunities/${opp.id}?error=1`);
  const update: Record<string, unknown> = { outcome: on ? "nurture" : "open" };
  if (on) {
    const date = checkBackDate(todayInZone((await getProfile(supabase, userId)).time_zone), DEFAULT_CHECK_BACK, null);
    if (date.ok) update.nurture_check_back_on = date.date;
  }
  const { error } = await supabase.from("opportunities").update(update).eq("id", opp.id);
  if (error) redirect(`/opportunities/${opp.id}?error=1`);
  revalidate(opp.contact_id);
  redirect(`/opportunities/${opp.id}?${on ? "nurture" : "unnurture"}=1`);
}

/**
 * Move to nurture, or change the check-back date of a nurtured deal (Phase 27, owner decision 3).
 * Saving the date is what schedules the "Check back" task (one per nurture period).
 */
export async function nurtureWithCheckBack(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const name of ["check_back", "check_back_on"]) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 20);
  }
  const opp = await loadOpportunity(supabase, String(formData.get("id") ?? ""));
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (!canToggleNurture(opp.outcome, opp.stage_kind)) return { error: "Only an open deal can be moved to nurture.", values };
  const today = todayInZone((await getProfile(supabase, userId)).time_zone);
  const date = checkBackDate(today, values.check_back ?? "", values.check_back_on ?? null);
  if (!date.ok) return { fieldErrors: { [values.check_back === "date" ? "check_back_on" : "check_back"]: date.message }, values };
  const { error } = await supabase.from("opportunities").update({ outcome: "nurture", nurture_check_back_on: date.date }).eq("id", opp.id);
  if (error) return { ...friendlyDbError(error.code), values };
  revalidate(opp.contact_id);
  revalidatePath("/dashboard");
  redirect(`/opportunities/${opp.id}?${opp.outcome === "nurture" ? "checkback" : "nurture"}=1`);
}

/**
 * The prospect's current carrier and when that policy renews (Phase 27, owner decision 5). Any
 * deal that is not won; the database schedules (or moves, or cancels) the re-quote task.
 */
export async function saveCoverage(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const name of ["current_carrier", "current_policy_renews_on"]) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 200);
  }
  const parsed = coverageSchema.safeParse({
    id: formData.get("id"), current_carrier: formData.get("current_carrier"), current_policy_renews_on: formData.get("current_policy_renews_on"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const opp = await loadOpportunity(supabase, parsed.data.id);
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (opp.outcome === "won") return { error: "This is a client's policy: use its renewal date instead.", values };
  const { error } = await supabase.from("opportunities")
    .update({ current_carrier: parsed.data.current_carrier, current_policy_renews_on: parsed.data.current_policy_renews_on })
    .eq("id", opp.id);
  if (error) return { ...friendlyDbError(error.code), values };
  revalidate(opp.contact_id);
  revalidatePath("/dashboard");
  revalidatePath("/renewals");
  redirect(`/opportunities/${opp.id}?coverage=1#coverage`);
}

/**
 * Life deals: policy type, premium mode, first payout date and an optional rate for this policy
 * (Phase 28, ADR-046). Used only by Reports → Production; nothing else changes.
 */
export async function saveLifeDetails(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const name of ["life_policy_type", "premium_mode", "first_payout_on", "commission_rate_override"]) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 30);
  }
  const parsed = lifeDetailsSchema.safeParse({ id: formData.get("id"), ...values });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const opp = await loadOpportunity(supabase, parsed.data.id);
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (opp.product_line !== "life") return { error: "Commission details are for life policies only.", values };
  const { id, ...update } = parsed.data;
  const { error } = await supabase.from("opportunities").update(update).eq("id", id);
  if (error) return { ...friendlyDbError(error.code), values };
  revalidate(opp.contact_id);
  revalidatePath("/reports/production");
  redirect(`/opportunities/${opp.id}?lifesaved=1#life-details`);
}

// ---------------------------------------------------------------------------
// Phase 29 (ADR-047): fixing mistakes
// ---------------------------------------------------------------------------

/** Correct a deal's line. Stage, tasks and dates stay; the database resets what no longer applies. */
export async function changeLine(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = { product_line: String(formData.get("product_line") ?? "").slice(0, 20) };
  const parsed = changeLineSchema.safeParse({ id: formData.get("id"), product_line: values.product_line });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const opp = await loadOpportunity(supabase, parsed.data.id);
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (opp.product_line === parsed.data.product_line) return { fieldErrors: { product_line: "It is already on that line." }, values };
  const { error } = await supabase.from("opportunities").update({ product_line: parsed.data.product_line }).eq("id", opp.id);
  if (error) return { ...friendlyDbError(error.code), values };
  revalidate(opp.contact_id);
  revalidatePath("/reports/production");
  redirect(`/opportunities/${opp.id}?linechanged=1`);
}

/** A won deal entered as a new sale was really a policy the client already had. */
export async function markExistingPolicy(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const opp = await loadOpportunity(supabase, String(formData.get("id") ?? ""));
  if (!opp) redirect("/opportunities");
  const { error } = await supabase.rpc("mark_existing_policy", { p_id: opp.id });
  if (error) redirect(`/opportunities/${opp.id}?error=1`);
  revalidate(opp.contact_id);
  revalidatePath("/reports/production");
  revalidatePath("/dashboard");
  redirect(`/opportunities/${opp.id}?markedexisting=1`);
}

/** Remove a deal entered by mistake (asks for confirmation). Nothing is deleted. */
export async function removeOpportunity(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const opp = await loadOpportunity(supabase, String(formData.get("id") ?? ""));
  if (!opp) redirect("/opportunities");
  if (formData.get("confirm") !== "yes") redirect(`/opportunities/${opp.id}?confirmremove=1#fix`);
  const { error } = await supabase.rpc("remove_opportunity", { p_id: opp.id });
  if (error) redirect(`/opportunities/${opp.id}?error=1`);
  revalidate(opp.contact_id);
  revalidatePath("/reports/production");
  revalidatePath("/dashboard");
  redirect(`/contacts/${opp.contact_id}?removed=1`);
}
