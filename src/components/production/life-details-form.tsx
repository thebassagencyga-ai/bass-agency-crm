"use client";

import { useState } from "react";
import { saveLifeDetails } from "@/app/(app)/opportunities/actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { formatDateOnly, isIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/opportunities/format";
import {
  LIFE_POLICY_TYPES, LIFE_POLICY_TYPE_LABELS, PREMIUM_MODES, PREMIUM_MODE_LABELS, lifeInstalment, monthLabel, type LifePolicyType, type PremiumMode,
} from "@/lib/production";

// Life deals (Phase 28, ADR-046): what Reports → Production needs to estimate commission,
// with a live preview using the same rule as the database.

const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg";

export function LifeDetailsForm({ id, initial, premium, effectiveDate, settingsRates }: {
  id: string;
  initial: { life_policy_type: string; premium_mode: string; first_payout_on: string; commission_rate_override: string };
  premium: number | null;
  effectiveDate: string | null;
  settingsRates: Partial<Record<LifePolicyType, number>>;
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveLifeDetails);
  const v = state.values ?? initial;
  const [type, setType] = useState(v.life_policy_type ?? "");
  const [mode, setMode] = useState(v.premium_mode ?? "");
  const [payout, setPayout] = useState(v.first_payout_on ?? "");
  const [override, setOverride] = useState(v.commission_rate_override ?? "");
  const err = state.fieldErrors ?? {};
  const overrideNum = override.trim() === "" ? null : Number(override.replace(/%$/, ""));
  const rate = overrideNum !== null && Number.isFinite(overrideNum) ? overrideNum : (type ? settingsRates[type as LifePolicyType] ?? null : null);
  const preview = lifeInstalment({
    premium, mode: (mode || null) as PremiumMode | null, rate,
    firstPayoutOn: isIsoDate(payout) ? payout : null, effectiveDate,
  });
  let text: string;
  if (premium === null) text = "Add the estimated annual premium to see the commission.";
  else if (rate === null) text = type ? `No first-year rate for ${LIFE_POLICY_TYPE_LABELS[type as LifePolicyType]} in Settings yet.` : "Choose the policy type (or enter a rate) to see the commission.";
  else if (!preview) text = "";
  else {
    const every = { 12: "a month", 4: "every 3 months", 2: "every 6 months", 1: "a year" }[preview.perYear] ?? "";
    text = `About ${formatMoney(preview.amount)} ${every}${preview.fromMonth ? ` from ${monthLabel(preview.fromMonth)}` : ""} (${formatMoney(premium)} × ${rate}% ÷ ${preview.perYear}), first year.`;
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="life_policy_type" className="text-sm font-medium">Policy type</label>
          <select id="life_policy_type" name="life_policy_type" value={type} onChange={(e) => setType(e.target.value)} aria-invalid={err.life_policy_type ? true : undefined} className={SELECT}>
            <option value="">Not set</option>
            {LIFE_POLICY_TYPES.map((t) => <option key={t} value={t}>{LIFE_POLICY_TYPE_LABELS[t]}</option>)}
          </select>
          {err.life_policy_type ? <p className="text-sm text-bad">{err.life_policy_type}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="premium_mode" className="text-sm font-medium">Premium mode</label>
          <select id="premium_mode" name="premium_mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-invalid={err.premium_mode ? true : undefined} className={SELECT}>
            <option value="">Not set (monthly)</option>
            {PREMIUM_MODES.map((m) => <option key={m} value={m}>{PREMIUM_MODE_LABELS[m]}</option>)}
          </select>
          {err.premium_mode ? <p className="text-sm text-bad">{err.premium_mode}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="first_payout_on" className="text-sm font-medium">First payout date <span className="font-normal text-muted">(optional)</span></label>
          <input id="first_payout_on" name="first_payout_on" type="date" value={payout} onChange={(e) => setPayout(e.target.value)}
            aria-invalid={err.first_payout_on ? true : undefined} aria-describedby="payout-hint" className={`${SELECT} appearance-none [&::-webkit-date-and-time-value]:text-left`} />
          <p id="payout-hint" className="text-xs text-muted">{effectiveDate ? `Blank uses the effective date (${formatDateOnly(effectiveDate)}).` : "Blank uses the effective date, else the date it was bound."}</p>
          {err.first_payout_on ? <p className="text-sm text-bad">{err.first_payout_on}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="commission_rate_override" className="text-sm font-medium">Rate for this policy <span className="font-normal text-muted">(optional)</span></label>
          <input id="commission_rate_override" name="commission_rate_override" inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} maxLength={8}
            placeholder={type && settingsRates[type as LifePolicyType] !== undefined ? `${settingsRates[type as LifePolicyType]}% from Settings` : "First-year %"}
            aria-invalid={err.commission_rate_override ? true : undefined} className={SELECT} />
          {err.commission_rate_override ? <p className="text-sm text-bad">{err.commission_rate_override}</p> : null}
        </div>
      </div>
      {text ? <p role="status" className="rounded-md bg-brand-soft p-3 text-sm">{text}</p> : null}
      <div className="sm:w-48"><SubmitButton pendingText="Saving…" pending={pending}>Save details</SubmitButton></div>
    </form>
  );
}
