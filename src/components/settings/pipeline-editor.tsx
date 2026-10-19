"use client";

import Link from "next/link";
import { useState } from "react";
import { archivePipeline, savePipeline } from "@/app/(app)/settings/pipeline-actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { MAX_NAME, MAX_STAGES, type StageDraft } from "@/lib/opportunities/pipeline-editor";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

const INPUT = "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg";
const SMALL_BUTTON = "min-h-11 min-w-11 rounded-md border border-line-strong bg-card px-3 text-sm font-medium hover:bg-subtle disabled:opacity-40";

type Row = StageDraft & { key: string; deals: number };

/**
 * Edit a pipeline (Phase 25): its name, the lines whose new leads it receives, and its stages
 * in order. Working stages can be renamed, reordered, added and removed (only when empty);
 * Won and Lost always end the list and can only be renamed.
 */
export function PipelineEditor({ id, name, stages, lines, routedElsewhere }: {
  id: string | null;
  name: string;
  stages: (StageDraft & { deals?: number })[];
  /** Lines whose new leads already come here. */
  lines: ProductLine[];
  /** For each other line, the pipeline its new leads go to now. */
  routedElsewhere: Partial<Record<ProductLine, string>>;
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(savePipeline);
  const [rows, setRows] = useState<Row[]>(() =>
    stages.map((s, i) => ({ ...s, key: s.id ?? `new-${i}`, deals: s.deals ?? 0 })),
  );
  const [nextKey, setNextKey] = useState(0);
  const working = rows.filter((r) => r.kind === "active");
  const ends = rows.filter((r) => r.kind !== "active");
  const err = state.fieldErrors ?? {};

  const update = (key: string, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRows(() => {
      const next = [...working];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return [...next, ...ends];
    });
  const setQuote = (key: string) => setRows((rs) => rs.map((r) => ({ ...r, quote: r.key === key ? !r.quote : false })));
  const add = () => {
    setRows([...working, { key: `added-${nextKey}`, name: "", kind: "active", deals: 0 }, ...ends]);
    setNextKey((n) => n + 1);
  };
  const payload = JSON.stringify(rows.map(({ id: stageId, name: stageName, kind, quote }) => ({ id: stageId ?? null, name: stageName, kind, quote: Boolean(quote) })));

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <FormAlert state={state} />
        <input type="hidden" name="id" value={id ?? ""} />
        <input type="hidden" name="stages" value={payload} />

        <div className="flex flex-col gap-1">
          <label htmlFor="pipeline-name" className="text-sm font-medium">Pipeline name</label>
          <input id="pipeline-name" name="name" defaultValue={state.values?.name ?? name} maxLength={MAX_NAME} required aria-invalid={err.name ? true : undefined} className={INPUT} />
          {err.name ? <p className="text-sm text-bad">{err.name}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">New leads that come here</legend>
          <p className="text-sm text-muted">Each line&apos;s new leads (quote form, quick intake, imports) go to one pipeline. Tick a line to send it here.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRODUCT_LINES.map((l) => {
              const here = lines.includes(l);
              return (
                <label key={l} className="flex min-h-11 items-center gap-2 rounded-md border border-line-strong px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="checkbox" name="lines" value={l} defaultChecked={here} disabled={here} />
                  {/* A disabled box is not submitted; keep lines already here in the form. */}
                  {here ? <input type="hidden" name="lines" value={l} /> : null}
                  <span>
                    {PRODUCT_LINE_NAMES[l]}
                    {!here && routedElsewhere[l] ? <span className="block text-xs text-muted">Now: {routedElsewhere[l]}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
          {lines.length > 0 ? <p className="text-xs text-muted">To send a ticked line elsewhere, tick it on that pipeline.</p> : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Stages, in order</legend>
          <p className="text-sm text-muted">New leads start at the first stage. Tick &ldquo;Quote stage&rdquo; on the stage where the quote has been delivered: moving a deal there records the quote date and schedules the quote follow-up.</p>
          {err.stages ? <p role="alert" className="text-sm text-bad">{err.stages}</p> : null}
          <ol aria-label="Stages" className="flex flex-col gap-2">
            {working.map((r, i) => (
              <li key={r.key} className="flex flex-col gap-2 rounded-md border border-line bg-card p-3">
                <div className="flex items-end gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor={`stage-${r.key}`} className="text-sm font-medium">Stage {i + 1}</label>
                    <input id={`stage-${r.key}`} value={r.name} maxLength={MAX_NAME} onChange={(e) => update(r.key, { name: e.target.value })} className={INPUT} />
                  </div>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.name || "stage"} up`} className={SMALL_BUTTON}>↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === working.length - 1} aria-label={`Move ${r.name || "stage"} down`} className={SMALL_BUTTON}>↓</button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={Boolean(r.quote)} onChange={() => setQuote(r.key)} />
                    Quote stage
                  </label>
                  {r.deals > 0 ? (
                    <span className="text-muted">{r.deals} {r.deals === 1 ? "deal" : "deals"} here (move them to remove it)</span>
                  ) : (
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={working.length <= 1} className={SMALL_BUTTON}>
                      Remove {r.name ? `“${r.name}”` : "stage"}
                    </button>
                  )}
                </div>
              </li>
            ))}
            {ends.map((r) => (
              <li key={r.key} className="flex flex-col gap-1 rounded-md border border-line bg-subtle p-3">
                <label htmlFor={`stage-${r.key}`} className="text-sm font-medium">{r.kind === "won" ? "Won stage (bound or placed)" : "Lost stage"}</label>
                <input id={`stage-${r.key}`} value={r.name} maxLength={MAX_NAME} onChange={(e) => update(r.key, { name: e.target.value })} className={INPUT} />
              </li>
            ))}
          </ol>
          <button type="button" onClick={add} disabled={rows.length >= MAX_STAGES} className={`${SMALL_BUTTON} w-fit`}>Add a stage</button>
        </fieldset>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Link href="/settings/pipelines" className="min-h-11 px-3 py-2 text-center underline text-link">Cancel</Link>
          <div className="sm:ml-auto sm:w-48">
            <SubmitButton pendingText="Saving…" pending={pending}>Save pipeline</SubmitButton>
          </div>
        </div>
      </form>
      {id ? <ArchivePipeline id={id} receivesLeads={lines.length > 0} /> : null}
    </div>
  );
}

function ArchivePipeline({ id, receivesLeads }: { id: string; receivesLeads: boolean }) {
  const { state, formAction, pending, onSubmit } = useActionForm(archivePipeline);
  return (
    <details className="rounded-md border border-line bg-card p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">Archive this pipeline…</summary>
      <form action={formAction} onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
        <FormAlert state={state} />
        <input type="hidden" name="id" value={id} />
        <p className="text-sm text-muted">
          {receivesLeads ? "First send its lines to another pipeline. " : null}
          Open deals must be moved or closed first. Won and lost deals keep their history.
        </p>
        <button type="submit" disabled={pending} className="min-h-11 w-fit rounded-md border border-line-strong bg-card px-4 font-medium hover:bg-subtle">
          {pending ? "Archiving…" : "Archive pipeline"}
        </button>
      </form>
    </details>
  );
}
