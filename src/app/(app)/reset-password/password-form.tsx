"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { updatePassword } from "../../(auth)/actions";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">At least 12 characters, with upper- and lower-case letters and a number.</p>
      <FormAlert state={state} />
      <Field label="New password" name="password" type="password" autoComplete="new-password" error={state.fieldErrors?.password} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" error={state.fieldErrors?.confirm} />
      <SubmitButton pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
