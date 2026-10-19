import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TaskForm } from "@/components/tasks/task-form";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { listForContact } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { getTask } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Edit task · ZeroLapse CRM" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireFullSession();
  const task = await getTask(supabase, id);
  if (!task) notFound();
  const [contact, opportunities] = await Promise.all([getContact(supabase, task.contact_id), listForContact(supabase, task.contact_id)]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Edit task</h1>
      <TaskForm
        task={task}
        contact={{ id: task.contact_id, name: contact ? contactDisplayName(contact) : "Contact" }}
        opportunities={opportunities.map((o) => ({ id: o.id, label: [PRODUCT_LINE_NAMES[o.product_line], o.description].filter(Boolean).join(" · ") }))}
        defaultDueDate={task.due_date}
      />
    </section>
  );
}
