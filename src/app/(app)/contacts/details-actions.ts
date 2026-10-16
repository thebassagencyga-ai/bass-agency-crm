"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { householdMemberSchema, vehicleSchema } from "@/lib/contacts/details";

// Household members and vehicles on a contact (Phase 14). Saved through the user's own client
// (RLS: owner + two-step); "Remove" archives, nothing is deleted.

type Table = "household_members" | "vehicles";

function ids(formData: FormData): { contactId: string; id: string | null } | null {
  const contactId = String(formData.get("contact_id") ?? "");
  const rawId = String(formData.get("id") ?? "");
  if (!isUuid(contactId) || (rawId !== "" && !isUuid(rawId))) return null;
  return { contactId, id: rawId === "" ? null : rawId };
}

async function save(table: Table, formData: FormData, values: Record<string, unknown>): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const target = ids(formData);
  if (!target) return { error: "This record could not be found." };
  const query = target.id === null
    ? supabase.from(table).insert({ ...values, contact_id: target.contactId }).select("id")
    : supabase.from(table).update(values).eq("id", target.id).eq("contact_id", target.contactId).is("archived_at", null).select("id");
  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return { error: error?.code === "23514" ? "Some details are not valid. Check them and try again." : "Could not save. Please try again." };
  }
  redirect(`/contacts/${target.contactId}?detailsaved=1#${table === "vehicles" ? "vehicles" : "household"}`);
}

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
};

export async function saveHouseholdMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = householdMemberSchema.safeParse({
    first_name: formData.get("first_name") ?? "", last_name: formData.get("last_name") ?? "", relationship: formData.get("relationship") ?? "",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues) };
  return save("household_members", formData, parsed.data);
}

export async function saveVehicle(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = vehicleSchema().safeParse({ year: formData.get("year") ?? "", make: formData.get("make") ?? "", model: formData.get("model") ?? "" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues) };
  return save("vehicles", formData, parsed.data);
}

export async function removeContactDetail(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const target = ids(formData);
  const table = formData.get("table") === "vehicles" ? "vehicles" : "household_members";
  if (!target || target.id === null) redirect("/contacts");
  const { data, error } = await supabase
    .from(table).update({ archived_at: new Date().toISOString() })
    .eq("id", target.id).eq("contact_id", target.contactId).select("id");
  redirect(`/contacts/${target.contactId}?${error || !data?.length ? "error" : "detailremoved"}=1#${table === "vehicles" ? "vehicles" : "household"}`);
}
