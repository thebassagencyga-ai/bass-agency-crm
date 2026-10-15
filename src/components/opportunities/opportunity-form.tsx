"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createOpportunity, updateOpportunity } from "@/app/(app)/opportunities/actions";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import type { Opportunity, Stage } from "@/lib/opportunities/types";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

type Props =
  | { mode: "create"; contactId: string; contactName: string; stages: Stage[]; opportunity?: undefined }
  | { mode: "edit"; opportunity: Opportunity; contactId?: undefined; contactName?: undefined; stages?: undefined };

const PREMIUM_HINT = "Estimated yearly premium in dollars, e.g. 1,250.";

export function OpportunityForm(props: Props) {
  const action = props.mode === "create" ? createOpportunity : updateOpportunity;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const existing = props.opportunity;
  const v = (name: string): string | undefined => {
    if (state.values && name in state.values) return state.values[name];
    const value = existing ? (existing as unknown as Record<string, unknown>)[name] : undefined;
    return value === null || value === undefined ? undefined : String(value);
  };
  const [line, setLine] = useState<ProductLine>((v("product_line") as ProductLine | undefined) ?? "auto");
  const err = state.fieldErrors ?? {};
  const startStages = props.mode === "create" ? props.stages.filter((s) => s.product_line === line && s.kind === "active") : [];

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {props.mode === "create" ? (
        <>
          <input type="hidden" name="contact_id" value={props.contactId} />
          <p className="text-sm">For <span className="font-medium">{props.contactName}</span></p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Product line</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRODUCT_LINES.map((l) => (
                <label key={l} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100 dark:border-slate-600 dark:has-[:checked]:border-slate-100 dark:has-[:checked]:bg-slate-800">
                  {/* defaultChecked: React 19 resets the form after each action (see contact form). */}
                  <input type="radio" name="product_line" value={l} defaultChecked={line === l} onChange={() => setLine(l)} />
                  {PRODUCT_LINE_NAMES[l]}
                </label>
              ))}
            </div>
            {err.product_line ? <p className="text-sm text-red-700 dark:text-red-400">{err.product_line}</p> : null}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="stage_id" className="text-sm font-medium">Starting stage</label>
            <select
              id="stage_id" name="stage_id" key={line}
              defaultValue={startStages.some((s) => s.id === v("stage_id")) ? v("stage_id") : startStages[0]?.id}
              aria-invalid={err.stage_id ? true : undefined}
              className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {startStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {err.stage_id ? <p className="text-sm text-red-700 dark:text-red-400">{err.stage_id}</p> : null}
          </div>
        </>
      ) : (
        <input type="hidden" name="id" value={existing!.id} />
      )}

      <Field label="Description" name="description" required={false} defaultValue={v("description")} error={err.description} maxLength={500} hint="e.g. 2 vehicles, bundle with home" />
      <Field label="Next action" name="next_action" required={false} defaultValue={v("next_action")} error={err.next_action} maxLength={500} />
      <details open={props.mode === "edit" || ["quoted_carrier", "quote_sent_on", "estimated_annual_premium", "effective_date", "renewal_date"].some((f) => err[f])} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Quote and policy dates</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field label="Quoted carrier" name="quoted_carrier" required={false} defaultValue={v("quoted_carrier")} error={err.quoted_carrier} maxLength={100} />
          <Field label="Quote sent on" name="quote_sent_on" type="date" required={false} defaultValue={v("quote_sent_on")} error={err.quote_sent_on} />
          <Field label="Estimated annual premium" name="estimated_annual_premium" inputMode="decimal" required={false} defaultValue={v("estimated_annual_premium")} error={err.estimated_annual_premium} hint={PREMIUM_HINT} maxLength={20} />
          <Field label="Effective date" name="effective_date" type="date" required={false} defaultValue={v("effective_date")} error={err.effective_date} />
          <Field label="Renewal date" name="renewal_date" type="date" required={false} defaultValue={v("renewal_date")} error={err.renewal_date} />
        </div>
      </details>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Link href={existing ? `/opportunities/${existing.id}` : `/contacts/${props.contactId}`} className="min-h-11 px-3 py-2 text-center underline">Cancel</Link>
        <div className="sm:ml-auto sm:w-48">
          <SubmitButton pendingText="Saving…">{existing ? "Save changes" : "Add opportunity"}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
