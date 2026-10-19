import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireFullSession } from "@/lib/auth/require";
import { getOpportunity } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Edit opportunity · Producr CRM" };

export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireFullSession();
  const opp = await getOpportunity(supabase, id);
  if (!opp) notFound();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Edit {PRODUCT_LINE_NAMES[opp.product_line]} opportunity</h1>
      <p className="text-sm text-muted">Change the stage or outcome from the opportunity page.</p>
      <OpportunityForm mode="edit" opportunity={opp} />
    </section>
  );
}
