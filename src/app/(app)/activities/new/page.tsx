import type { Metadata } from "next";
import { LogActivityForm } from "@/components/tasks/log-activity-form";
import { requireFullSession } from "@/lib/auth/require";
import { isoToZonedLocal } from "@/lib/dates";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Log activity · The Bass Agency CRM" };

/** Dashboard quick action: pick a contact, then log what happened. */
export default async function LogActivityPage() {
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Log activity</h1>
      <LogActivityForm contactId={null} now={isoToZonedLocal(new Date().toISOString(), profile.time_zone)} opportunities={[]} openTasks={[]} />
    </section>
  );
}
