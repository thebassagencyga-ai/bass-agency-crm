import type { Metadata } from "next";
import { TaskForm } from "@/components/tasks/task-form";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { todayInZone } from "@/lib/dates";
import { listForContact } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Add task · ZeroLapse CRM" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { contact: contactId } = await searchParams;
  const { supabase, userId } = await requireFullSession();
  const [contact, profile] = await Promise.all([contactId ? getContact(supabase, contactId) : Promise.resolve(null), getProfile(supabase, userId)]);
  const opportunities = contact ? await listForContact(supabase, contact.id) : [];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Add task</h1>
      <TaskForm
        contact={contact ? { id: contact.id, name: contactDisplayName(contact) } : null}
        opportunities={opportunities.map((o) => ({ id: o.id, label: [PRODUCT_LINE_NAMES[o.product_line], o.description].filter(Boolean).join(" · ") }))}
        defaultDueDate={todayInZone(profile.time_zone)}
      />
    </section>
  );
}
