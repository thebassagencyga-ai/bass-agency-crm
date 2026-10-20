"use client";

import { saveGoals, saveRates } from "@/app/(app)/settings/production/actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { LIFE_POLICY_TYPE_LABELS, RATE_ROWS, rateKey } from "@/lib/production";

// Settings → Commission and goals (Phase 28, ADR-046).

const INPUT = "min-h-11 w-24 rounded-md border border-line-strong bg-card px-3 text-right text-base text-fg";
const TH = "border-b border-line py-2 pr-3 text-left text-sm font-medium text-muted";

function RateInput({ name, label, value, error }: { name: string; label: string; value: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          id={name} name={name} defaultValue={value} inputMode="decimal" aria-label={label} maxLength={8}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${name}-error` : undefined} className={INPUT}
        />
        <span aria-hidden="true">%</span>
      </div>
      {error ? <p id={`${name}-error`} className="text-sm text-bad">{error}</p> : null}
    </div>
  );
}

export function RatesForm({ initial }: { initial: Record<string, string> }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveRates);
  const v = (k: string) => state.values?.[k] ?? initial[k] ?? "";
  const err = state.fieldErrors ?? {};
  const table = (rows: typeof RATE_ROWS, life: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th scope="col" className={TH}>{life ? "Policy type" : "Line"}</th>
            <th scope="col" className={TH}>{life ? "First year" : "New business"}</th>
            <th scope="col" className={TH}>{life ? "Renewal years" : "Renewal"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const name = r.type ? LIFE_POLICY_TYPE_LABELS[r.type] : PRODUCT_LINE_NAMES[r.line];
            return (
              <tr key={`${r.line}-${r.type ?? ""}`}>
                <th scope="row" className="border-b border-line py-2 pr-3 text-left font-medium">{name}</th>
                <td className="border-b border-line py-2 pr-3">
                  <RateInput name={rateKey(r.line, r.type, "new")} label={`${name} ${life ? "first-year" : "new-business"} rate, percent`} value={v(rateKey(r.line, r.type, "new"))} error={err[rateKey(r.line, r.type, "new")]} />
                </td>
                <td className="border-b border-line py-2 pr-3">
                  <RateInput name={rateKey(r.line, r.type, "renewal")} label={`${name} renewal rate, percent`} value={v(rateKey(r.line, r.type, "renewal"))} error={err[rateKey(r.line, r.type, "renewal")]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <section aria-labelledby="pc-rates" className="flex flex-col gap-2">
        <h3 id="pc-rates" className="font-semibold">Auto, home and commercial</h3>
        {table(RATE_ROWS.filter((r) => r.line !== "life"), false)}
      </section>
      <section aria-labelledby="life-rates" className="flex flex-col gap-2">
        <h3 id="life-rates" className="font-semibold">Life, by policy type</h3>
        <p className="text-sm text-muted">Paid in step with each policy&apos;s premium mode. A rate on the policy itself overrides the first-year rate.</p>
        {table(RATE_ROWS.filter((r) => r.line === "life"), true)}
      </section>
      <div className="sm:w-48"><SubmitButton pendingText="Saving…" pending={pending}>Save rates</SubmitButton></div>
    </form>
  );
}

export function GoalsForm({ initial }: { initial: Record<string, string> }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveGoals);
  const v = (k: string) => state.values?.[k] ?? initial[k] ?? "";
  const err = state.fieldErrors ?? {};
  const field = (name: string, label: string, prefix?: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">{label} <span className="font-normal text-muted">(optional)</span></label>
      <div className="flex items-center gap-1">
        {prefix ? <span aria-hidden="true">{prefix}</span> : null}
        <input id={name} name={name} defaultValue={v(name)} inputMode="decimal" maxLength={16}
          aria-invalid={err[name] ? true : undefined} aria-describedby={err[name] ? `${name}-error` : undefined}
          className="min-h-11 w-36 rounded-md border border-line-strong bg-card px-3 text-right text-base text-fg" />
      </div>
      {err[name] ? <p id={`${name}-error`} className="text-sm text-bad">{err[name]}</p> : null}
    </div>
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormAlert state={state} />
      <div className="flex flex-wrap gap-6">
        {field("premium_per_month", "Premium per month", "$")}
        {field("policies_per_month", "Policies per month")}
        {field("premium_per_year", "Premium per year", "$")}
      </div>
      <div className="sm:w-48"><SubmitButton pendingText="Saving…" pending={pending}>Save goals</SubmitButton></div>
    </form>
  );
}
