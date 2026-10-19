"use client";

import { acceptIntake } from "@/app/(app)/intake/actions";
import { ReferrerPicker } from "@/components/contacts/referrer-picker";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { TargetChoice } from "./target-choice";

export function ReviewForm({
  id, duplicates, referredByName,
}: {
  id: string;
  duplicates: { id: string; label: string; detail: string }[];
  referredByName: string | null;
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(acceptIntake);
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={id} />
      <FormAlert state={state} />
      <TargetChoice duplicates={duplicates} legend="Where should this go?" />
      <ReferrerPicker
        initial={null} excludeId={null} error={state.fieldErrors?.referred_by_contact_id}
        hint={referredByName ? `They wrote "${referredByName}". Find that contact to record the referral, or leave empty.` : undefined}
      />
      <SubmitButton pendingText="Adding…" pending={pending}>Accept and add to CRM</SubmitButton>
      <p className="text-xs text-muted">
        Creates a New lead opportunity for each line and a quote task before any renewal month given. The request&apos;s details are then
        erased from the inbox.
      </p>
    </form>
  );
}
