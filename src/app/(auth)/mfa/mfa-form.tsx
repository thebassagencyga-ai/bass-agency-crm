"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { signOut, verifyMfa } from "../actions";

export function MfaForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(verifyMfa, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <h1 className="text-2xl font-semibold">Enter your code</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Open your authenticator app and enter the 6-digit code for The Bass Agency CRM.</p>
        <FormAlert state={state} />
        <input type="hidden" name="next" value={next} />
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" error={state.fieldErrors?.code} />
        <SubmitButton pendingText="Checking…">Continue</SubmitButton>
      </form>
      <form action={signOut}>
        <button type="submit" className="min-h-11 w-full py-2 text-sm underline">Use a different account</button>
      </form>
    </div>
  );
}
