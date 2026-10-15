"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { safeNextPath } from "@/lib/auth/routing";
import { isUuid } from "@/lib/contacts/data";
import { RENEWAL_OUTCOME_FIELDS, renewalOutcomeSchema } from "@/lib/renewals";

// Every action re-checks the full (two-step) session on the server and writes through the
// user's own Supabase client, so RLS and the database rules apply as well.

function revalidateRenewals(contactId?: string, opportunityId?: string) {
  revalidatePath("/renewals");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  if (contactId) revalidatePath(`/contacts/${contactId}`);
  if (opportunityId) revalidatePath(`/opportunities/${opportunityId}`);
}

/** Retention workflow: renewed / re-marketed / lost, recorded in one database transaction. */
export async function recordRenewalOutcome(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const f of RENEWAL_OUTCOME_FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") values[f] = v.slice(0, 1000);
  }
  const parsed = renewalOutcomeSchema.safeParse(Object.fromEntries(RENEWAL_OUTCOME_FIELDS.map((f) => [f, formData.get(f)])));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { fieldErrors, values };
  }
  const input = parsed.data;
  const { data, error } = await supabase.rpc("record_renewal_outcome", {
    p_opportunity_id: input.opportunity_id,
    p_outcome: input.outcome,
    p_loss_reason: input.loss_reason,
    p_premium: input.premium,
    p_notes: input.notes,
  });
  if (error) {
    if (error.code === "P0002") return { error: "This policy could not be found.", values };
    if (error.code === "23505") return { error: "An outcome was already recorded for this renewal.", values };
    if (error.code === "23514") return { error: "This policy has no renewal to record. It may have ended, or its renewal date is missing.", values };
    if (error.code === "42501") return { error: "You don't have permission to do that. Sign in again and retry.", values };
    return { error: "Could not record the renewal. Please try again.", values };
  }
  const result = data as { next_renewal_date: string | null; contact_now_former_client: boolean } | null;
  const { data: opp } = await supabase.from("opportunities").select("contact_id").eq("id", input.opportunity_id).maybeSingle();
  revalidateRenewals((opp as { contact_id: string } | null)?.contact_id, input.opportunity_id);
  const flag = input.outcome === "lost" ? (result?.contact_now_former_client ? "lostformer" : "lost") : "kept";
  redirect(`/renewals?recorded=${flag}`);
}

/** Hides a cross-sell prompt for this contact for 12 months, then returns to the page it was on. */
export async function dismissCrossSell(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const contactId = String(formData.get("contact_id") ?? "");
  const ruleId = String(formData.get("rule_id") ?? "");
  const backRaw = String(formData.get("back") ?? "");
  const back = backRaw ? safeNextPath(backRaw) : "/renewals";
  const go = (flag: string): never => redirect(`${back}${back.includes("?") ? "&" : "?"}${flag}=1#cross-sell-heading`);
  if (!isUuid(contactId) || !isUuid(ruleId)) go("dismisserror");
  const { data, error } = await supabase.rpc("dismiss_cross_sell", { p_contact_id: contactId, p_rule_id: ruleId });
  if (error || data !== 1) go("dismisserror");
  revalidateRenewals(contactId);
  go("dismissed");
}
