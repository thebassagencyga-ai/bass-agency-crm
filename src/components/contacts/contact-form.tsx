"use client";

import Link from "next/link";
import { useState } from "react";
import { saveContact } from "@/app/(app)/contacts/actions";
import { Field, FormAlert, SelectField, SubmitButton, TextAreaField, useActionForm } from "@/components/form";
import { CONTACT_METHOD_LABELS, CONTACT_METHODS, RELATIONSHIP_LABELS, RELATIONSHIP_STATUSES, type Contact } from "@/lib/contacts/types";
import { ReferrerPicker } from "./referrer-picker";

const statusOptions = RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABELS[s] }));
const methodOptions = CONTACT_METHODS.map((m) => ({ value: m, label: CONTACT_METHOD_LABELS[m] }));

export function ContactForm({
  contact, referrer, leadSources,
}: {
  contact: Contact | null;
  referrer: { id: string; label: string; detail: string } | null;
  leadSources: string[];
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveContact);
  const v = (name: keyof Contact): string | undefined => {
    if (state.values && name in state.values) return state.values[name];
    const value = contact?.[name];
    return value === null || value === undefined ? undefined : String(value);
  };
  const [type, setType] = useState<string>(v("contact_type") ?? "individual");
  const err = state.fieldErrors ?? {};
  const isEdit = contact !== null;
  const detailFields = ["alt_phone", "address_line1", "address_line2", "city", "state", "postal_code", "preferred_contact_method", "referred_by_contact_id", "google_review_left_on", "notes"];
  const detailsOpen = isEdit || detailFields.some((f) => err[f]);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      {isEdit ? <input type="hidden" name="id" value={contact.id} /> : null}
      <FormAlert state={state} />

      {state.duplicates && state.duplicates.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">You may already have this contact (same email or phone):</p>
          <ul className="list-disc pl-5">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/contacts/${d.id}`} className="inline-flex min-h-11 min-w-11 items-center underline" target="_blank">{d.label}</Link>
                {d.detail ? <span className="text-amber-800 dark:text-amber-200"> — {d.detail}</span> : null}
              </li>
            ))}
          </ul>
          <input type="hidden" name="confirm_duplicate" value="1" />
          <p>Review the match above, or save again to create a separate contact anyway.</p>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Contact type</legend>
        <div className="flex gap-2">
          {(["individual", "business"] as const).map((t) => (
            <label key={t} className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-100 dark:border-slate-600 dark:has-[:checked]:border-slate-100 dark:has-[:checked]:bg-slate-800">
              {/* defaultChecked, not checked: React 19 resets the form after each action, and only
                  the default (kept in step with `type`) survives that reset. */}
              <input type="radio" name="contact_type" value={t} defaultChecked={type === t} onChange={() => setType(t)} />
              {t === "individual" ? "Individual" : "Business"}
            </label>
          ))}
        </div>
        {err.contact_type ? <p className="text-sm text-red-700">{err.contact_type}</p> : null}
      </fieldset>

      {type === "business" ? (
        <Field label="Business name" name="business_name" defaultValue={v("business_name")} error={err.business_name} autoComplete="organization" maxLength={200} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={type === "business" ? "Contact person first name" : "First name"} name="first_name" required={false} defaultValue={v("first_name")} error={err.first_name} autoComplete="given-name" maxLength={100} />
        <Field label={type === "business" ? "Contact person last name" : "Last name"} name="last_name" required={false} defaultValue={v("last_name")} error={err.last_name} autoComplete="family-name" maxLength={100} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" inputMode="tel" required={false} defaultValue={v("phone")} error={err.phone} autoComplete="tel" />
        <Field label="Email" name="email" type="email" inputMode="email" required={false} defaultValue={v("email")} error={err.email} autoComplete="email" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lead source" name="lead_source" required={false} defaultValue={v("lead_source")} error={err.lead_source} list="lead-sources" maxLength={100} />
        <SelectField label="Status" name="relationship_status" options={statusOptions} defaultValue={v("relationship_status") ?? "prospect"} error={err.relationship_status} required />
      </div>
      <datalist id="lead-sources">
        {leadSources.map((s) => <option key={s} value={s} />)}
      </datalist>

      <details open={detailsOpen} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">More details</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field label="Other phone" name="alt_phone" type="tel" inputMode="tel" required={false} defaultValue={v("alt_phone")} error={err.alt_phone} />
          <Field label="Street address" name="address_line1" required={false} defaultValue={v("address_line1")} error={err.address_line1} autoComplete="address-line1" maxLength={200} />
          <Field label="Address line 2" name="address_line2" required={false} defaultValue={v("address_line2")} error={err.address_line2} autoComplete="address-line2" maxLength={200} />
          <div className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] gap-2">
            <Field label="City" name="city" required={false} defaultValue={v("city")} error={err.city} autoComplete="address-level2" maxLength={100} />
            <Field label="State" name="state" required={false} defaultValue={v("state") ?? (isEdit ? undefined : "GA")} error={err.state} autoComplete="address-level1" maxLength={2} />
            <Field label="ZIP" name="postal_code" inputMode="numeric" required={false} defaultValue={v("postal_code")} error={err.postal_code} autoComplete="postal-code" maxLength={10} />
          </div>
          <SelectField label="Preferred contact method" name="preferred_contact_method" options={methodOptions} defaultValue={v("preferred_contact_method")} error={err.preferred_contact_method} placeholder="Not specified" />
          <ReferrerPicker initial={referrer} excludeId={contact?.id ?? null} error={err.referred_by_contact_id} />
          <Field label="Google review left on" name="google_review_left_on" type="date" required={false} defaultValue={v("google_review_left_on")} error={err.google_review_left_on} hint="Record it here once this client has left a Google review; review requests then stop." />
          <TextAreaField label="Notes" name="notes" defaultValue={v("notes")} error={err.notes} maxLength={5000} hint="Relationship notes only. Never record SSNs, payment details, health or underwriting information." />
        </div>
      </details>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Link href={isEdit ? `/contacts/${contact.id}` : "/contacts"} className="min-h-11 px-3 py-2 text-center underline">Cancel</Link>
        <div className="sm:ml-auto sm:w-48">
          <SubmitButton pendingText="Saving…" pending={pending}>{state.duplicates?.length ? "Save anyway" : isEdit ? "Save changes" : "Save contact"}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
