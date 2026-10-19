import type { Metadata } from "next";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireFullSession } from "@/lib/auth/require";
import { knownTags, leadSourceOptions } from "@/lib/contacts/data";

export const metadata: Metadata = { title: "Add contact · Producr CRM" };

export default async function NewContactPage() {
  const { supabase } = await requireFullSession();
  const [sources, tags] = await Promise.all([leadSourceOptions(supabase), knownTags(supabase)]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Add contact</h1>
      <p className="text-sm text-muted">Only a name is required. Add more now or later.</p>
      <ContactForm contact={null} referrer={null} leadSources={sources} knownTags={tags.map((t) => t.tag)} />
    </section>
  );
}
