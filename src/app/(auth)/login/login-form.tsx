"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { signIn } from "../actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, notice ? { message: notice } : {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <FormAlert state={state} />
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" inputMode="email" autoComplete="username" error={state.fieldErrors?.email} defaultValue={state.values?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" error={state.fieldErrors?.password} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <Link href="/forgot-password" className="min-h-11 py-2 text-center text-sm underline text-link">Forgot your password?</Link>
    </form>
  );
}
