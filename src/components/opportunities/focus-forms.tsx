"use client";

import { useState } from "react";
import { nurtureWithCheckBack, saveCoverage } from "@/app/(app)/opportunities/actions";
import { Field, FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { formatDateOnly, isIsoDate } from "@/lib/dates";
import { CHECK_BACK_CHOICES, DEFAULT_CHECK_BACK, requoteDueOn } from "@/lib/focus";

// Phase 27 (ADR-045) forms on the deal page: the nurture check-back date and the prospect's
// current coverage. The database schedules the tasks from what is saved here.

const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg";

/** Move to nurture (or change the date): asks when to check back, 30 days unless chosen. */
export function NurtureForm({ id, nurtured }: { id: string; nurtured: boolean }) {
  const { state, formAction, pending, onSubmit } = useActionForm(nurtureWithCheckBack);
  const [choice, setChoice] = useState(state.values?.check_back ?? DEFAULT_CHECK_BACK);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-1 sm:w-64">
        <label htmlFor="check_back" className="text-sm font-medium">Check back</label>
        <select
          id="check_back" name="check_back" value={choice} onChange={(e) => setChoice(e.target.value)}
          aria-invalid={err.check_back ? true : undefined} aria-describedby="check_back-hint" className={SELECT}
        >
          {CHECK_BACK_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <p id="check_back-hint" className="text-xs text-muted">Focus shows this deal again on that day, and a &quot;Check back&quot; task is added.</p>
        {err.check_back ? <p className="text-sm text-bad">{err.check_back}</p> : null}
      </div>
      {choice === "date" ? (
        <div className="sm:w-64">
          <Field label="Check back on" name="check_back_on" type="date" defaultValue={state.values?.check_back_on ?? ""} error={err.check_back_on} />
        </div>
      ) : null}
      <div className="sm:w-56">
        <SubmitButton pendingText="Saving…" pending={pending}>{nurtured ? "Save new date" : "Move to nurture"}</SubmitButton>
      </div>
    </form>
  );
}

/**
 * The prospect's current carrier and renewal date, with a preview of when the re-quote reminder
 * shows up (owner decision 5: 45 days before by default, never in the past).
 */
export function CoverageForm({ id, carrier, renewsOn, today, daysBefore }: {
  id: string; carrier: string | null; renewsOn: string | null; today: string; daysBefore: number | null;
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveCoverage);
  const [date, setDate] = useState(state.values?.current_policy_renews_on ?? renewsOn ?? "");
  const err = state.fieldErrors ?? {};
  const due = isIsoDate(date) && daysBefore !== null ? requoteDueOn(date, daysBefore, today) : null;
  let preview: string;
  if (!isIsoDate(date)) preview = "Add the renewal date to get a re-quote reminder before it renews.";
  else if (daysBefore === null) preview = "The re-quote reminder is turned off in Settings → Automation.";
  else if (!due) preview = "This date has passed, so there is no re-quote reminder.";
  else preview = `Shows in Focus on ${formatDateOnly(due)}${due === today ? " (today)" : ""}: ${daysBefore} days before it renews.`;
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Current carrier" name="current_carrier" required={false} maxLength={100} defaultValue={state.values?.current_carrier ?? carrier ?? ""} error={err.current_carrier} />
        <div className="flex flex-col gap-1">
          <label htmlFor="current_policy_renews_on" className="text-sm font-medium">Renews on <span className="font-normal text-muted">(optional)</span></label>
          <input
            id="current_policy_renews_on" name="current_policy_renews_on" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            aria-invalid={err.current_policy_renews_on ? true : undefined} aria-describedby="coverage-preview"
            className={`${SELECT} appearance-none [&::-webkit-date-and-time-value]:text-left`}
          />
          {err.current_policy_renews_on ? <p className="text-sm text-bad">{err.current_policy_renews_on}</p> : null}
        </div>
      </div>
      <p id="coverage-preview" role="status" className="rounded-md bg-brand-soft p-3 text-sm">{preview}</p>
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>Save coverage</SubmitButton>
      </div>
    </form>
  );
}
