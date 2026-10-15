"use client";

import { saveProfile } from "@/app/(app)/tasks/actions";
import { Field, FormAlert, SubmitButton, useActionForm } from "@/components/form";

export function ProfileForm({ displayName, reviewUrl }: { displayName: string; reviewUrl: string | null }) {
  const { state, formAction, pending, onSubmit } = useActionForm(saveProfile);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <FormAlert state={state} />
      <Field label="Your name (used to sign messages)" name="display_name" required={false} defaultValue={state.values?.display_name ?? displayName} error={err.display_name} maxLength={100} />
      <Field label="Google review link" name="google_review_url" type="url" required={false} defaultValue={state.values?.google_review_url ?? reviewUrl ?? ""} error={err.google_review_url} maxLength={500} hint="From your Google Business Profile: “Ask for reviews” → copy the link." />
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>Save settings</SubmitButton>
      </div>
    </form>
  );
}
