"use client";

import { useState } from "react";
import { Field, SelectField } from "@/components/form";
import { HOUSEHOLD_RELATIONSHIPS, MAX_HOUSEHOLD, MAX_VEHICLES, RELATIONSHIP_LABELS } from "@/lib/contacts/details";
import {
  HEARD_ABOUT_OPTIONS, INTAKE_CONTACT_METHOD_LABELS, INTAKE_CONTACT_METHODS, INTAKE_LINE_LABELS, INTAKE_LINES, MONTH_NAMES,
} from "@/lib/intake/types";

const methodOptions = INTAKE_CONTACT_METHODS.map((m) => ({ value: m, label: INTAKE_CONTACT_METHOD_LABELS[m] }));
const monthOptions = MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }));
const heardOptions = HEARD_ABOUT_OPTIONS.map((h) => ({ value: h, label: h }));
const relationshipOptions = HOUSEHOLD_RELATIONSHIPS.map((r) => ({ value: r, label: RELATIONSHIP_LABELS[r] }));

/** Rows already filled in (after a validation error), so they are shown again. */
const filledRows = (values: Record<string, string>, prefixes: string[], max: number) => {
  let n = 0;
  for (let i = 0; i < max; i++) if (prefixes.some((p) => (values[`${p}_${i}`] ?? "").trim() !== "")) n = i + 1;
  return n;
};

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
  const [people, setPeople] = useState(filledRows(values, ["hh_first", "hh_last"], MAX_HOUSEHOLD));
  const [cars, setCars] = useState(Math.max(1, filledRows(values, ["veh_year", "veh_make", "veh_model"], MAX_VEHICLES)));

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
      <Field label="Street address" name="address_line1" required={false} defaultValue={values.address_line1} error={errors.address_line1} autoComplete="street-address" maxLength={200} />
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] gap-2">
        <Field label="City" name="city" required={false} defaultValue={values.city} error={errors.city} autoComplete="address-level2" maxLength={100} />
        <Field label="State" name="state" required={false} defaultValue={values.state ?? "GA"} error={errors.state} autoComplete="address-level1" maxLength={2} />
        <Field label="ZIP" name="postal_code" inputMode="numeric" required={false} defaultValue={values.postal_code} error={errors.postal_code} autoComplete="postal-code" maxLength={10} />
      </div>
      <SelectField label={you ? "Best way to reach you" : "Best way to reach them"} name="preferred_contact_method" options={methodOptions} defaultValue={values.preferred_contact_method} placeholder="No preference" />
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

      {lines.includes("auto") ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-sm font-medium">Vehicles (optional)</legend>
          <p className="text-xs text-slate-500">Year, make and model only{you ? " — we'll ask for anything else when we talk" : ""}.</p>
          {Array.from({ length: cars }, (_, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <Field label={`Vehicle ${i + 1} year`} name={`veh_year_${i}`} id={`veh_year_${i}`} inputMode="numeric" required={false} maxLength={4} defaultValue={values[`veh_year_${i}`]} />
                <Field label="Make" name={`veh_make_${i}`} id={`veh_make_${i}`} required={false} maxLength={50} defaultValue={values[`veh_make_${i}`]} />
                <Field label="Model" name={`veh_model_${i}`} id={`veh_model_${i}`} required={false} maxLength={50} defaultValue={values[`veh_model_${i}`]} />
              </div>
              {errors[`vehicle_${i}`] ? <p className="text-sm text-red-700 dark:text-red-400">{errors[`vehicle_${i}`]}</p> : null}
            </div>
          ))}
          {cars < MAX_VEHICLES ? (
            <button type="button" onClick={() => setCars(cars + 1)} className="min-h-11 self-start rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Add another vehicle</button>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-medium">{you ? "Others in your household or on the policy (optional)" : "Household / other drivers (optional)"}</legend>
        <p className="text-xs text-slate-500">Names only. Please don&apos;t include dates of birth or driver&apos;s license numbers.</p>
        {Array.from({ length: people }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={`Person ${i + 1} first name`} name={`hh_first_${i}`} id={`hh_first_${i}`} required={false} maxLength={100} defaultValue={values[`hh_first_${i}`]} />
              <Field label="Last name" name={`hh_last_${i}`} id={`hh_last_${i}`} required={false} maxLength={100} defaultValue={values[`hh_last_${i}`]} />
              <SelectField label="Relationship" name={`hh_rel_${i}`} id={`hh_rel_${i}`} options={relationshipOptions} defaultValue={values[`hh_rel_${i}`] || "spouse"} required />
            </div>
            {errors[`household_${i}`] ? <p className="text-sm text-red-700 dark:text-red-400">{errors[`household_${i}`]}</p> : null}
          </div>
        ))}
        {people < MAX_HOUSEHOLD ? (
          <button type="button" onClick={() => setPeople(people + 1)} className="min-h-11 self-start rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">
            {people === 0 ? "Add a person" : "Add another person"}
          </button>
        ) : null}
      </fieldset>

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

