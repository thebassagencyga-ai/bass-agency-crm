import type { Metadata } from "next";
import Link from "next/link";
import { requireFullSession } from "@/lib/auth/require";
import { getPipelines } from "@/lib/opportunities/data";
import { MAX_PIPELINES } from "@/lib/opportunities/pipeline-editor";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";

export const metadata: Metadata = { title: "Pipelines · Producr CRM" };

/** Settings → Pipelines (Phase 25): the agent's own pipelines, their stages and routing. */
export default async function PipelinesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const pipelines = await getPipelines(supabase);
  const notice = query.saved ? "Pipeline saved." : query.archived ? "Pipeline archived." : null;
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href="/settings" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Settings</Link>
      <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
      {notice ? <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">{notice}</p> : null}
      <p className="text-sm text-muted">
        Each pipeline has its own stages. Every line of business sends its new leads to one pipeline; one pipeline can take several lines (for example P&amp;C for Auto and Home).
      </p>
      <ul aria-label="Your pipelines" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
        {pipelines.map((p) => (
          <li key={p.id} className="flex flex-col gap-1 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              <Link href={`/settings/pipelines/${p.id}`} className="flex min-h-11 items-center underline text-link" aria-label={`Edit ${p.name}`}>Edit</Link>
            </div>
            <span className="text-sm">
              {p.lines.length > 0 ? `New leads: ${p.lines.map((l) => PRODUCT_LINE_NAMES[l]).join(", ")}` : <span className="text-muted">No lines send new leads here</span>}
            </span>
            <span className="text-sm text-muted break-words">{p.stages.map((s) => s.name).join(" → ")}</span>
          </li>
        ))}
      </ul>
      {pipelines.length < MAX_PIPELINES ? (
        <Link href="/settings/pipelines/new" className="flex min-h-11 w-fit items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Add a pipeline</Link>
      ) : (
        <p className="text-sm text-muted">You have {MAX_PIPELINES} pipelines, the most allowed. Archive one to add another.</p>
      )}
    </section>
  );
}
