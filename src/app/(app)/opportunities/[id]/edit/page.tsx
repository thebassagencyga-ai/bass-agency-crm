import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpportunityForm } from "@/components/opportunities/opportunity-form";
import { requireFullSession } from "@/lib/auth/require";
import { getOpportunity } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Edit opportunity · ZeroLapse CRM" };

export default async function EditOpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireFullSession();
  const opp = await getOpportunity(supabase, id);
  if (!opp) notFound();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Edit {PRODUCT_LINE_NAMES[opp.product_line]} opportunity</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">Change the stage or outcome from the opportunity page.</p>
      <OpportunityForm mode="edit" opportunity={opp} />
    </section>
  );
}
