"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { signOut, verifyMfa } from "../actions";

export function MfaForm({ next, again = false }: { next: string; again?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(verifyMfa, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <h1 className="text-2xl font-semibold">Enter your code</h1>
        {again ? (
          <p role="status" className="rounded-md bg-slate-100 p-3 text-sm dark:bg-slate-800">For your security, the CRM asks for your code again every 12 hours.</p>
        ) : null}
        <p className="text-sm text-slate-600 dark:text-slate-400">Open your authenticator app and enter the 6-digit code for ZeroLapse CRM.</p>
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
