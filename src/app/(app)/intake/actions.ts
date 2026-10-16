"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { findDuplicates, isUuid } from "@/lib/contacts/data";
import { echoIntakeValues, parseIntakeForm } from "@/lib/intake/schema";

// Intake inbox and quick intake (Phase 13, ADR-028). Every action re-checks the two-step
// session and calls invoker functions with the user's own client, so RLS applies.

/** "new", or the id of an existing contact to add to. */
function readTarget(formData: FormData): string | null | "invalid" {
  const raw = formData.get("target");
  if (raw === null || raw === "" || raw === "new") return null;
  return typeof raw === "string" && isUuid(raw) ? raw : "invalid";
}

/** The referrer picked from contacts; refuses text that was typed but never picked. */
function readReferrer(formData: FormData): { id: string | null } | { error: string } {
  const raw = formData.get("referred_by_contact_id");
  const id = typeof raw === "string" && raw !== "" ? raw : null;
  if (id !== null && !isUuid(id)) return { error: "Choose the referrer from the list." };
  const search = formData.get("referred_by_search");
  if (id === null && typeof search === "string" && search.trim() !== "") {
    return { error: "Tap the referrer in the list under the box, or clear the box." };
  }
  return { id };
}

function dbMessage(code: string | undefined, message: string | undefined): string {
  if (code === "P0002") return message ?? "This could not be found.";
  if (code === "22023") return "Some details in this request are not valid. Discard it, or add the person as a contact by hand.";
  if (code === "42501") return "You don't have permission to do that. Sign in again and retry.";
  return "Could not save. Please try again.";
}

export async function acceptIntake(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { error: "This request could not be found." };
  const target = readTarget(formData);
  if (target === "invalid") return { error: "Choose where to add this person." };
  const referrer = readReferrer(formData);
  if ("error" in referrer) return { fieldErrors: { referred_by_contact_id: referrer.error } };

  const { data, error } = await supabase.rpc("accept_intake", { p_id: id, p_contact_id: target, p_referred_by: referrer.id });
  if (error || typeof data !== "string") return { error: dbMessage(error?.code, error?.message) };
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  redirect(`/intake?accepted=${data}`);
}

export async function discardIntake(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/intake");
  const { error } = await supabase.rpc("discard_intake", { p_id: id });
  if (error) redirect(`/intake/${id}?error=discard`);
  revalidatePath("/intake");
  revalidatePath("/dashboard");
  redirect("/intake?discarded=1");
}

export async function quickIntake(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echoIntakeValues(formData);
  const parsed = parseIntakeForm(formData, { requireConsent: false });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };
  const target = readTarget(formData);
  if (target === "invalid") return { error: "Choose where to add this person.", values };
  const referrer = readReferrer(formData);
  if ("error" in referrer) return { fieldErrors: { referred_by_contact_id: referrer.error }, values };

  // Possible duplicates: ask once (add to the existing contact, or create a new one anyway).
  if (target === null && formData.get("confirm_duplicate") !== "1") {
    const duplicates = await findDuplicates(supabase, parsed.payload.email, parsed.payload.phone, null);
    if (duplicates.length > 0) return { duplicates, values };
  }

  const { data, error } = await supabase.rpc("quick_intake", { p_form: parsed.payload, p_contact_id: target, p_referred_by: referrer.id });
  if (error || typeof data !== "string") return { error: dbMessage(error?.code, error?.message), values };
  revalidatePath("/contacts");
  redirect(`/contacts/${data}?saved=1`);
}

export async function createOrReplaceIntakeLink(): Promise<void> {
  const { supabase } = await requireFullSession();
  const { error } = await supabase.rpc("rotate_intake_link");
  redirect(error ? "/settings?intake=error#intake" : "/settings?intake=new#intake");
}

export async function setIntakeLinkEnabled(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "1";
  if (!isUuid(id)) redirect("/settings#intake");
  const { data, error } = await supabase
    .from("intake_links")
    .update({ enabled, disabled_at: enabled ? null : new Date().toISOString() })
    .eq("id", id)
    .select("id");
  // Turning an old link back on while a newer one is on fails the one-link rule: say so.
  if (error || !data || data.length === 0) redirect("/settings?intake=error#intake");
  redirect(`/settings?intake=${enabled ? "on" : "off"}#intake`);
}
