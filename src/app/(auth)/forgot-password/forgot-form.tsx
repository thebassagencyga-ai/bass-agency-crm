"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { requestPasswordReset } from "../actions";

export function ForgotForm() {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">Enter your email and we&apos;ll send a link to choose a new password.</p>
      <FormAlert state={state} />
      <Field label="Email" name="email" type="email" inputMode="email" autoComplete="username" error={state.fieldErrors?.email} defaultValue={state.values?.email} />
      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
      <Link href="/login" className="min-h-11 py-2 text-center text-sm underline">Back to sign in</Link>
    </form>
  );
}
