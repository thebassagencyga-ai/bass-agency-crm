"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFullSession } from "@/lib/auth/require";
import { todayInZone } from "@/lib/dates";
import { snoozeSchema, snoozeUntil } from "@/lib/focus";
import { getProfile } from "@/lib/tasks/data";

/**
 * Focus (Phase 27): hide a quiet deal for 3 days or a week. It comes back after that if nothing
 * has been logged. Only open deals can be snoozed (the database clears it otherwise).
 */
export async function snoozeDeal(formData: FormData): Promise<void> {
  const { supabase, userId } = await requireFullSession();
  const parsed = snoozeSchema.safeParse({ id: formData.get("id"), days: formData.get("days") });
  if (!parsed.success) redirect("/dashboard?focus=error#focus");
  const today = todayInZone((await getProfile(supabase, userId)).time_zone);
  const { data, error } = await supabase.from("opportunities")
    .update({ focus_snoozed_until: snoozeUntil(today, parsed.data.days) })
    .eq("id", parsed.data.id).eq("outcome", "open").select("id");
  if (error || !data || data.length === 0) redirect("/dashboard?focus=error#focus");
  revalidatePath("/dashboard");
  redirect(`/dashboard?snoozed=${parsed.data.days}#focus`);
}
