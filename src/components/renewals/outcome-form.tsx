"use client";

import { useState } from "react";
import { recordRenewalOutcome } from "@/app/(app)/renewals/actions";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import {
  RENEWAL_LOSS_REASONS, RENEWAL_LOSS_REASON_LABELS, RENEWAL_OUTCOMES, RENEWAL_OUTCOME_LABELS, type RenewalOutcome,
} from "@/lib/renewals/types";

/** Records what happened at this renewal. Renewed and re-marketed roll the date forward. */
export function RenewalOutcomeForm({ opportunityId, nextRenewalLabel }: { opportunityId: string; nextRenewalLabel: string }) {
  const { state, formAction, pending, onSubmit } = useActionForm(recordRenewalOutcome);
  const err = state.fieldErrors ?? {};
  const [outcome, setOutcome] = useState<RenewalOutcome | "">((state.values?.outcome as RenewalOutcome | undefined) ?? "");
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <fieldset className="flex flex-col gap-2" aria-describedby={err.outcome ? "outcome-error" : undefined}>
        <legend className="mb-1 text-sm font-medium">What happened at renewal?</legend>
        {RENEWAL_OUTCOMES.map((o) => (
          <label key={o} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line-strong px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            {/* defaultChecked: see useActionForm on why forms are not reset. */}
            <input type="radio" name="outcome" value={o} defaultChecked={outcome === o} onChange={() => setOutcome(o)} />
            {RENEWAL_OUTCOME_LABELS[o]}
          </label>
        ))}
        {err.outcome ? <p id="outcome-error" className="text-sm text-bad">{err.outcome}</p> : null}
      </fieldset>

      {outcome === "lost" ? (
        <SelectField
          label="Why did the client leave?" name="loss_reason" required placeholder="Choose a reason"
          options={RENEWAL_LOSS_REASONS.map((r) => ({ value: r, label: RENEWAL_LOSS_REASON_LABELS[r] }))}
          defaultValue={state.values?.loss_reason} error={err.loss_reason}
        />
      ) : outcome ? (
        <>
          <p className="text-sm text-muted">{nextRenewalLabel}</p>
          <Field
            label="New annual premium" name="premium" inputMode="decimal" required={false} maxLength={20}
            hint="Only if it changed, e.g. 1,250. Leave blank to keep the current estimate."
            defaultValue={state.values?.premium} error={err.premium}
          />
        </>
      ) : null}

      <TextAreaField label="Notes" name="notes" maxLength={1000} defaultValue={state.values?.notes} error={err.notes} hint="Relationship notes only. No policy numbers or personal financial details." />
      <div className="sm:w-56">
        <SubmitButton pendingText="Recording…" pending={pending}>Record outcome</SubmitButton>
      </div>
    </form>
  );
}
