"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
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
  const { data } = await supabase.from("pipeline_stages").select("id, product_line, code, name, position, kind").eq("id", id).maybeSingle();
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

  const stage = await getStage(supabase, data.stage_id);
  if (!stage || stage.product_line !== data.product_line || stage.kind !== "active") {
    return { fieldErrors: { stage_id: "Choose a starting stage from this product line." }, values };
  }

  const { data: row, error } = await supabase.from("opportunities").insert(termForLine(data, data.product_line)).select("id").single();
  if (error || !row) return { ...friendlyDbError(error?.code), values };
  revalidate(data.contact_id);
  redirect(`/opportunities/${row.id as string}?saved=1`);
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
  const { supabase } = await requireFullSession();
  const values = echoValues(formData);
  const parsed = stageChangeSchema.safeParse({
    id: formData.get("id"),
    stage_id: formData.get("stage_id"),
    loss_reason: formData.get("loss_reason"),
    loss_reason_detail: formData.get("loss_reason_detail"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };

  const [opp, stage] = await Promise.all([loadOpportunity(supabase, parsed.data.id), getStage(supabase, parsed.data.stage_id)]);
  if (!opp) return { error: "This opportunity could not be found.", values };
  if (!stage) return { fieldErrors: { stage_id: "Choose a stage." }, values };

  const plan = planStageChange({
    current: { productLine: opp.product_line, outcome: opp.outcome, stageId: opp.stage_id },
    target: { id: stage.id, productLine: stage.product_line, kind: stage.kind },
    lossReason: parsed.data.loss_reason,
    lossReasonDetail: parsed.data.loss_reason_detail,
  });
  if (!plan.ok) return { fieldErrors: { [plan.field]: plan.message }, values };

  const { data: rows, error } = await supabase.from("opportunities").update(plan.update).eq("id", opp.id).select("id");
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
    const qs = new URLSearchParams({ line: opp.product_line, [flag]: "1" });
    if (q) qs.set("q", q);
    return `/opportunities?${qs.toString()}#opp-${opp.id}`;
  };
  if (!stage) redirect(back("error"));
  if (stage.kind === "lost") redirect(`/opportunities/${opp.id}?mark=lost#mark-lost`);

  const plan = planStageChange({
    current: { productLine: opp.product_line, outcome: opp.outcome, stageId: opp.stage_id },
    target: { id: stage.id, productLine: stage.product_line, kind: stage.kind },
  });
  if (!plan.ok) redirect(back("error"));
  const { error } = await supabase.from("opportunities").update(plan.update).eq("id", opp.id);
  if (error) redirect(back("error"));
  revalidate(opp.contact_id);
  redirect(back(plan.update.outcome === "won" ? "won" : "moved"));
}

export async function setNurture(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  const on = formData.get("nurture") === "1";
  const opp = await loadOpportunity(supabase, id);
  if (!opp) redirect("/opportunities");
  if (!canToggleNurture(opp.outcome, opp.stage_kind)) redirect(`/opportunities/${opp.id}?error=1`);
  const { error } = await supabase.from("opportunities").update({ outcome: on ? "nurture" : "open" }).eq("id", opp.id);
  if (error) redirect(`/opportunities/${opp.id}?error=1`);
  revalidate(opp.contact_id);
  redirect(`/opportunities/${opp.id}?${on ? "nurture" : "unnurture"}=1`);
}
