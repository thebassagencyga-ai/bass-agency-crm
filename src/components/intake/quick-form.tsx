"use client";

import Link from "next/link";
import { quickIntake } from "@/app/(app)/intake/actions";
import { ReferrerPicker } from "@/components/contacts/referrer-picker";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { IntakeFields } from "./intake-fields";
import { TargetChoice } from "./target-choice";

export function QuickIntakeForm() {
  const { state, formAction, pending, onSubmit } = useActionForm(quickIntake);
  const errors = state.fieldErrors ?? {};
  const dupes = state.duplicates ?? [];
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert state={state} />
      {dupes.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-caution bg-caution-soft p-3">
          <TargetChoice duplicates={dupes} legend="Possible match found" />
          <input type="hidden" name="confirm_duplicate" value="1" />
        </div>
      ) : null}
      <IntakeFields
        values={state.values ?? {}} errors={errors} audience="agent"
        referrer={<ReferrerPicker initial={null} excludeId={null} error={errors.referred_by_contact_id} />}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Link href="/intake" className="min-h-11 px-3 py-2 text-center underline text-link">Cancel</Link>
        <div className="sm:ml-auto sm:w-56">
          <SubmitButton pendingText="Adding…" pending={pending}>{dupes.length > 0 ? "Continue" : "Add to CRM"}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
