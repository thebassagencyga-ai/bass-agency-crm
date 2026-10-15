import type { Metadata } from "next";
import Link from "next/link";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { getStages } from "@/lib/opportunities/data";

export const metadata: Metadata = { title: "Add opportunity · The Bass Agency CRM" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { contact: contactId } = await searchParams;
  const { supabase } = await requireFullSession();
  const contact = contactId ? await getContact(supabase, contactId) : null;
  if (!contact) {
    return (
      <section className="flex max-w-xl flex-col gap-2">
        <h1 className="text-2xl font-semibold">Add opportunity</h1>
        <p>Opportunities are added from a contact. Open the contact, then choose &quot;Add opportunity&quot;.</p>
        <Link href="/contacts" className="min-h-11 py-2 underline">Go to contacts</Link>
      </section>
    );
  }
  const stages = await getStages(supabase);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Add opportunity</h1>
      <OpportunityForm mode="create" contactId={contact.id} contactName={contactDisplayName(contact)} stages={stages} />
    </section>
  );
}
