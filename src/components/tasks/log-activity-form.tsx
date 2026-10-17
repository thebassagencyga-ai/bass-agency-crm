"use client";

import { useState } from "react";
import { logActivity } from "@/app/(app)/tasks/actions";
import { ReferrerPicker } from "@/components/contacts/referrer-picker";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import { ACTIVITY_OUTCOMES, ACTIVITY_OUTCOME_LABELS, ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS } from "@/lib/activities/types";

type Option = { id: string; label: string };

type Defaults = { activity_type?: string; opportunity_id?: string; notes?: string; outcome?: string; requested_follow_up_on?: string };

/**
 * contactId null: the form starts with a contact picker (dashboard quick action).
 * defaults: starting values, e.g. after a text or email was opened from the CRM (Phase 16).
 */
export function LogActivityForm({ contactId, now, opportunities, openTasks, defaults }: { contactId: string | null; now: string; opportunities: Option[]; openTasks: Option[]; defaults?: Defaults }) {
  const { state, formAction, pending, onSubmit } = useActionForm(logActivity);
  const err = state.fieldErrors ?? {};
  const v = (name: string) => state.values?.[name] ?? (defaults as Record<string, string | undefined> | undefined)?.[name];
  const [outcome, setOutcome] = useState(v("outcome") ?? "");
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      {contactId ? (
        <input type="hidden" name="contact_id" value={contactId} />
      ) : (
        <ReferrerPicker
          initial={null} excludeId={null} error={err.contact_id}
          name="contact_id" searchName="contact_search" label="Contact" optional={false}
          hint="Type 2 or more letters of the contact's name, then tap them in the list."
        />
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField label="What happened" name="activity_type" required options={ACTIVITY_TYPES.map((t) => ({ value: t, label: ACTIVITY_TYPE_LABELS[t] }))} defaultValue={v("activity_type") ?? "call"} error={err.activity_type} />
        <Field label="When" name="occurred_at" type="datetime-local" defaultValue={v("occurred_at") ?? now} error={err.occurred_at} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="outcome" className="text-sm font-medium">Outcome <span className="font-normal text-slate-500">(optional)</span></label>
        <select
          id="outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}
          className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">None</option>
          {ACTIVITY_OUTCOMES.map((o) => <option key={o} value={o}>{ACTIVITY_OUTCOME_LABELS[o]}</option>)}
        </select>
      </div>
      {outcome === "requested_follow_up" || err.requested_follow_up_on ? (
        <Field label="Follow up on" name="requested_follow_up_on" type="date" defaultValue={v("requested_follow_up_on")} error={err.requested_follow_up_on} />
      ) : null}
      {opportunities.length > 0 ? (
        <SelectField label="About opportunity" name="opportunity_id" options={opportunities.map((o) => ({ value: o.id, label: o.label }))} defaultValue={v("opportunity_id")} placeholder="None" error={err.opportunity_id} />
      ) : null}
      {openTasks.length > 0 ? (
        <SelectField label="For task" name="task_id" options={openTasks.map((t) => ({ value: t.id, label: t.label }))} defaultValue={v("task_id")} placeholder="None" error={err.task_id} />
      ) : null}
      <TextAreaField label="Notes" name="notes" defaultValue={v("notes")} error={err.notes} maxLength={5000} hint="Relationship notes only. Never record SSNs, payment details, health or underwriting information." />
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>Log activity</SubmitButton>
      </div>
    </form>
  );
}
