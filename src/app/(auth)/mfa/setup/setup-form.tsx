"use client";

import { useActionState } from "react";
import { Field, FormAlert, SubmitButton, type FormState } from "@/components/form";
import { confirmEnrollment } from "../../actions";

export function SetupForm({ factorId, qrCode, secret, next }: { factorId: string; qrCode: string; secret: string; next: string }) {
  const [state, action] = useActionState<FormState, FormData>(confirmEnrollment, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-bold tracking-tight">Set up two-step sign-in</h1>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-fg">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Scan this code, or enter the setup key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL SVG from Supabase; next/image adds nothing here */}
      <img src={qrCode} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto rounded-md bg-card p-2" />
      <p className="text-center text-sm">
        Setup key: <code className="break-all font-mono">{secret}</code>
      </p>
      <FormAlert state={state} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" error={state.fieldErrors?.code} />
      <SubmitButton pendingText="Checking…">Turn on two-step sign-in</SubmitButton>
    </form>
  );
}
