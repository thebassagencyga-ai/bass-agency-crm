import type { Metadata } from "next";
import Link from "next/link";
import { ExistingPolicyForm } from "@/components/opportunities/existing-policy-form";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireFullSession } from "@/lib/auth/require";
import { getContact } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { getPipelines } from "@/lib/opportunities/data";
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Add opportunity · Producr CRM" };

export default async function NewOpportunityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { contact: contactId, line, existing } = await searchParams;
  const { supabase } = await requireFullSession();
  const contact = contactId ? await getContact(supabase, contactId) : null;
  if (!contact) {
    return (
      <section className="flex max-w-xl flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Add opportunity</h1>
        <p>Opportunities are added from a contact. Open the contact, then choose &quot;Add opportunity&quot;.</p>
        <Link href="/contacts" className="min-h-11 py-2 underline text-link">Go to contacts</Link>
      </section>
    );
  }
  const defaultLine = (PRODUCT_LINES as readonly string[]).includes(line ?? "") ? (line as ProductLine) : undefined;
  const switchLink = (
    <Link
      href={`/opportunities/new?contact=${contact.id}${existing === "1" ? "" : "&existing=1"}`}
      className="flex min-h-11 w-fit items-center text-sm underline text-link"
    >
      {existing === "1" ? "Adding a new lead or quote instead?" : "Adding a policy they already have?"}
    </Link>
  );
  if (existing === "1") {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Add existing policy</h1>
        {switchLink}
        <ExistingPolicyForm contactId={contact.id} contactName={contactDisplayName(contact)} defaultLine={defaultLine} />
      </section>
    );
  }
  const pipelines = await getPipelines(supabase);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Add opportunity</h1>
      {switchLink}
      <OpportunityForm mode="create" contactId={contact.id} contactName={contactDisplayName(contact)} pipelines={pipelines} defaultLine={defaultLine} />
    </section>
  );
}
