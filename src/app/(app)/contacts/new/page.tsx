import type { Metadata } from "next";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireFullSession } from "@/lib/auth/require";
import { leadSourceOptions } from "@/lib/contacts/data";

export const metadata: Metadata = { title: "Add contact · The Bass Agency CRM" };

export default async function NewContactPage() {
  const { supabase } = await requireFullSession();
  const sources = await leadSourceOptions(supabase);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Add contact</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">Only a name is required. Add more now or later.</p>
      <ContactForm contact={null} referrer={null} leadSources={sources} />
    </section>
  );
}
