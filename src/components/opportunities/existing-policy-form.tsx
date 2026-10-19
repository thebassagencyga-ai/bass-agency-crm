"use client";

import Link from "next/link";
import { useState } from "react";
import { createExistingPolicy } from "@/app/(app)/opportunities/actions";
import { Field, FormAlert, SelectField, SubmitButton, useActionForm } from "@/components/form";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

/** A policy the client already has (ADR-042): saved as bound, with no new-sale tasks. */
export function ExistingPolicyForm({ contactId, contactName, defaultLine }: { contactId: string; contactName: string; defaultLine?: ProductLine }) {
  const { state, formAction, pending, onSubmit } = useActionForm(createExistingPolicy);
  const v = (name: string): string | undefined => state.values?.[name];
  const [line, setLine] = useState<ProductLine>((v("product_line") as ProductLine | undefined) ?? defaultLine ?? "auto");
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="contact_id" value={contactId} />
      <p className="text-sm">For <span className="font-medium">{contactName}</span></p>
      <p className="text-sm text-muted">
        Saved as bound. No onboarding, review or referral tasks are added and it does not count as a
        new sale in Reports. The renewal review is scheduled as usual.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Product line</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRODUCT_LINES.map((l) => (
            <label key={l} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="product_line" value={l} defaultChecked={line === l} onChange={() => setLine(l)} />
              {PRODUCT_LINE_NAMES[l]}
            </label>
          ))}
        </div>
        {err.product_line ? <p className="text-sm text-bad">{err.product_line}</p> : null}
      </fieldset>
      <Field label="Carrier" name="quoted_carrier" required={false} defaultValue={v("quoted_carrier")} error={err.quoted_carrier} maxLength={100} />
      <Field label="Annual premium" name="estimated_annual_premium" inputMode="decimal" required={false} defaultValue={v("estimated_annual_premium")} error={err.estimated_annual_premium} hint="Yearly premium in dollars, e.g. 1,250." maxLength={20} />
      <Field label="Effective date" name="effective_date" type="date" required={false} defaultValue={v("effective_date")} error={err.effective_date} hint="When the policy started. Past dates are fine." />
      <Field label="Renewal date" name="renewal_date" type="date" required={false} defaultValue={v("renewal_date")} error={err.renewal_date} hint="Leave blank to use the effective date plus the term. A date already passed moves to the next renewal." />
      {line === "auto" ? (
        <SelectField
          label="Policy term" name="policy_term_months" required
          options={[{ value: "12", label: "12 months" }, { value: "6", label: "6 months" }]}
          defaultValue={v("policy_term_months") ?? "12"} error={err.policy_term_months}
        />
      ) : null}
      <Field label="Description" name="description" required={false} defaultValue={v("description")} error={err.description} maxLength={500} hint="e.g. 2 vehicles" />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Link href={`/contacts/${contactId}`} className="min-h-11 px-3 py-2 text-center underline text-link">Cancel</Link>
        <div className="sm:ml-auto sm:w-48">
          <SubmitButton pendingText="Saving…" pending={pending}>Add policy</SubmitButton>
        </div>
      </div>
    </form>
  );
}
