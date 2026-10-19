"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { signOut, verifyMfa } from "../actions";

export function MfaForm({ next, again = false }: { next: string; again?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(verifyMfa, {});
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <h1 className="text-2xl font-bold tracking-tight">Enter your code</h1>
        {again ? (
          <p role="status" className="rounded-md bg-subtle p-3 text-sm">For your security, the CRM asks for your code again every 12 hours.</p>
        ) : null}
        <p className="text-sm text-muted">Open your authenticator app and enter the 6-digit code it shows for this CRM (listed as “Producr CRM” if you set it up after the rename).</p>
        <FormAlert state={state} />
        <input type="hidden" name="next" value={next} />
        <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" error={state.fieldErrors?.code} />
        <SubmitButton pendingText="Checking…">Continue</SubmitButton>
      </form>
      <form action={signOut}>
        <button type="submit" className="min-h-11 w-full py-2 text-sm underline text-link">Use a different account</button>
      </form>
    </div>
  );
}
