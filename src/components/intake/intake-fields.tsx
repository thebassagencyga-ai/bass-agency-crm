"use client";

import { useState } from "react";
import { Field, SelectField } from "@/components/form";
import {
  HEARD_ABOUT_OPTIONS, INTAKE_CONTACT_METHOD_LABELS, INTAKE_CONTACT_METHODS, INTAKE_LINE_LABELS, INTAKE_LINES, MONTH_NAMES,
} from "@/lib/intake/types";

const methodOptions = INTAKE_CONTACT_METHODS.map((m) => ({ value: m, label: INTAKE_CONTACT_METHOD_LABELS[m] }));
const monthOptions = MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }));
const heardOptions = HEARD_ABOUT_OPTIONS.map((h) => ({ value: h, label: h }));

const CHOICE =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100 dark:border-slate-600 dark:has-[:checked]:border-slate-100 dark:has-[:checked]:bg-slate-800";

/**
 * The intake questions, shared by the public form (/quote/…) and the agent's quick intake.
 * `referrer` replaces the "who referred you" text box (the agent picks a contact instead).
 */
export function IntakeFields({
  values, errors, audience, referrer,
}: {
  values: Record<string, string>;
  errors: Record<string, string>;
  audience: "prospect" | "agent";
  referrer?: React.ReactNode;
}) {
  const [lines, setLines] = useState<string[]>(values.lines ? values.lines.split(",") : []);
  const [heard, setHeard] = useState(values.heard_about ?? "");
  const you = audience === "prospect";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="first_name" defaultValue={values.first_name} error={errors.first_name} autoComplete="given-name" maxLength={100} />
        <Field label="Last name" name="last_name" defaultValue={values.last_name} error={errors.last_name} autoComplete="family-name" maxLength={100} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" inputMode="tel" required={false} defaultValue={values.phone} error={errors.phone} autoComplete="tel"
          hint={you ? "A phone number or an email is needed so we can reach you." : "A phone number or an email is needed."} />
        <Field label="Email" name="email" type="email" inputMode="email" required={false} defaultValue={values.email} error={errors.email} autoComplete="email" maxLength={254} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Field label="ZIP code" name="postal_code" inputMode="numeric" required={false} defaultValue={values.postal_code} error={errors.postal_code} autoComplete="postal-code" maxLength={10} />
        <SelectField label={you ? "Best way to reach you" : "Best way to reach them"} name="preferred_contact_method" options={methodOptions} defaultValue={values.preferred_contact_method} placeholder="No preference" />
      </div>
      <Field label={you ? "Best time to reach you" : "Best time to reach them"} name="best_time" required={false} defaultValue={values.best_time} error={errors.best_time} maxLength={100} hint="For example: weekday evenings." />

      <fieldset className="flex flex-col gap-2" aria-describedby={errors.lines ? "lines-error" : undefined}>
        <legend className="text-sm font-medium">{you ? "What would you like a quote for?" : "Lines to quote"}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {INTAKE_LINES.map((line) => (
            <label key={line} className={CHOICE}>
              <input
                type="checkbox" name="lines" value={line} defaultChecked={lines.includes(line)}
                onChange={(e) => setLines((cur) => (e.target.checked ? [...cur, line] : cur.filter((l) => l !== line)))}
              />
              {INTAKE_LINE_LABELS[line]}
            </label>
          ))}
        </div>
        {errors.lines ? <p id="lines-error" className="text-sm text-red-700 dark:text-red-400">{errors.lines}</p> : null}
      </fieldset>

      {lines.length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium">{you ? "Your current coverage (optional)" : "Current coverage (optional)"}</legend>
          <p className="text-xs text-slate-500">
            {you ? "If you have insurance now, who is it with and when does it renew? This helps us quote in time." : "Helps time the quote: a task is set 30 days before the renewal month."}
          </p>
          {INTAKE_LINES.filter((l) => lines.includes(l)).map((line) => (
            <div key={line} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field label={`${INTAKE_LINE_LABELS[line]}: current company`} name={`carrier_${line}`} id={`carrier_${line}`} required={false}
                defaultValue={values[`carrier_${line}`]} error={errors[`carrier_${line}`]} maxLength={100} />
              <SelectField label="Renews in" name={`renews_${line}`} id={`renews_${line}`} options={monthOptions} defaultValue={values[`renews_${line}`]} placeholder="Not sure" />
            </div>
          ))}
        </fieldset>
      ) : null}

      <SelectField label={you ? "How did you hear about us?" : "How did they hear about you?"} name="heard_about" options={heardOptions} defaultValue={heard}
        placeholder="Choose one" error={errors.heard_about} onChange={setHeard}
      />
      {referrer ?? (heard === "Referral" ? (
        <Field label="Who referred you?" name="referred_by_name" required={false} defaultValue={values.referred_by_name} error={errors.referred_by_name} maxLength={100}
          hint="So we can thank them." />
      ) : null)}
    </>
  );
}

