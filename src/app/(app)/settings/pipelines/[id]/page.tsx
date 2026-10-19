import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PipelineEditor } from "@/components/settings/pipeline-editor";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { getPipelines } from "@/lib/opportunities/data";
import { PRODUCT_LINES, type ProductLine } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Edit pipeline · Producr CRM" };

export default async function EditPipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireFullSession();
  const pipelines = await getPipelines(supabase);
  const pipeline = pipelines.find((p) => p.id === id);
  if (!pipeline) notFound();
  // How many deals sit in each stage: a stage holding deals cannot be removed.
  const { data, error } = await supabase.from("opportunities").select("stage_id").eq("pipeline_id", id);
  if (error) throw new Error(`Could not load the pipeline's deals (${error.code ?? "unknown"}).`);
  const deals = new Map<string, number>();
  for (const r of (data ?? []) as { stage_id: string }[]) deals.set(r.stage_id, (deals.get(r.stage_id) ?? 0) + 1);
  const routedElsewhere: Partial<Record<ProductLine, string>> = {};
  for (const l of PRODUCT_LINES) {
    const p = pipelines.find((x) => x.lines.includes(l));
    if (p && p.id !== id) routedElsewhere[l] = p.name;
  }
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href="/settings/pipelines" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Pipelines</Link>
      <h1 className="text-2xl font-bold tracking-tight break-words">Edit {pipeline.name}</h1>
      <PipelineEditor
        id={pipeline.id}
        name={pipeline.name}
        stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, quote: s.is_quote_stage, deals: deals.get(s.id) ?? 0 }))}
        lines={pipeline.lines}
        routedElsewhere={routedElsewhere}
      />
    </section>
  );
}
