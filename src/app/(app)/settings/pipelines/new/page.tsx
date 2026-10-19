import type { Metadata } from "next";
import Link from "next/link";
import { PipelineEditor } from "@/components/settings/pipeline-editor";
import { requireFullSession } from "@/lib/auth/require";
import { getPipelines } from "@/lib/opportunities/data";
import { NEW_PIPELINE_STAGES } from "@/lib/opportunities/pipeline-editor";
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Add a pipeline · Producr CRM" };

export default async function NewPipelinePage() {
  const { supabase } = await requireFullSession();
  const pipelines = await getPipelines(supabase);
  const routedElsewhere: Partial<Record<ProductLine, string>> = {};
  for (const l of PRODUCT_LINES) {
    const p = pipelines.find((x) => x.lines.includes(l));
    if (p) routedElsewhere[l] = p.name;
  }
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href="/settings/pipelines" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Pipelines</Link>
      <h1 className="text-2xl font-bold tracking-tight">Add a pipeline</h1>
      <PipelineEditor id={null} name="" stages={NEW_PIPELINE_STAGES} lines={[]} routedElsewhere={routedElsewhere} />
    </section>
  );
}
