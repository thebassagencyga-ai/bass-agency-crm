"use client";

import { changeLine } from "@/app/(app)/opportunities/actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

// Phase 29 (ADR-047): correct a deal's line.
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg";

export function ChangeLineForm({ id, line }: { id: string; line: ProductLine }) {
  const { state, formAction, pending, onSubmit } = useActionForm(changeLine);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-1 sm:w-64">
        <label htmlFor="change-line" className="text-sm font-medium">Correct line</label>
        <select id="change-line" name="product_line" defaultValue={state.values?.product_line ?? line}
          aria-invalid={err.product_line ? true : undefined} aria-describedby="change-line-hint" className={SELECT}>
          {PRODUCT_LINES.map((l) => <option key={l} value={l}>{PRODUCT_LINE_NAMES[l]}</option>)}
        </select>
        <p id="change-line-hint" className="text-xs text-muted">The stage, tasks and dates stay. A 6-month term (auto only) and life commission details reset when they no longer apply.</p>
        {err.product_line ? <p className="text-sm text-bad">{err.product_line}</p> : null}
      </div>
      <div className="sm:w-48"><SubmitButton pendingText="Saving…" pending={pending}>Change line</SubmitButton></div>
    </form>
  );
}
