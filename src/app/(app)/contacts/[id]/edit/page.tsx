import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireFullSession } from "@/lib/auth/require";
import { getContact, knownTags, leadSourceOptions, summarize } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";

export const metadata: Metadata = { title: "Edit contact · The Bass Agency CRM" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireFullSession();
  const contact = await getContact(supabase, id);
  if (!contact) notFound();
  // A merged contact is a record of where things went; it is not edited (Phase 17).
  if (contact.merged_into_contact_id) redirect(`/contacts/${contact.id}`);
  const [referrer, sources, tags] = await Promise.all([
    contact.referred_by_contact_id ? getContact(supabase, contact.referred_by_contact_id) : Promise.resolve(null),
    leadSourceOptions(supabase),
    knownTags(supabase),
  ]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold break-words">Edit {contactDisplayName(contact)}</h1>
      <ContactForm contact={contact} referrer={referrer ? summarize(referrer) : null} leadSources={sources} knownTags={tags.map((t) => t.tag)} />
    </section>
  );
}
