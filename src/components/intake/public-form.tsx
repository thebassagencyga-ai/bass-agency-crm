"use client";

import { submitQuoteRequest } from "@/app/quote/actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { CONSENT_TEXT } from "@/lib/intake/types";
import { IntakeFields } from "./intake-fields";

export function PublicIntakeForm({ token }: { token: string }) {
  const { state, formAction, pending, onSubmit } = useActionForm(submitQuoteRequest);
  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  if (state.message === "sent") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md bg-good-soft p-4 text-good">
        <h2 className="text-lg font-semibold">Thank you — we have your request.</h2>
        <p>The Bass Agency will contact you soon about your quote.</p>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad">Please check the highlighted fields.</p>
      ) : (
        <FormAlert state={state} />
      )}
      <IntakeFields values={values} errors={errors} audience="prospect" />

      {/* Trap for bots: hidden from people and screen readers, never focusable. */}
      <div aria-hidden="true" className="invisible absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
          <input type="checkbox" name="consent" defaultChecked={values.consent === "on"} className="mt-1 h-5 w-5 shrink-0"
            aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "consent-error" : undefined} />
          <span className="text-sm">{CONSENT_TEXT}</span>
        </label>
        {errors.consent ? <p id="consent-error" className="text-sm text-bad">{errors.consent}</p> : null}
      </div>
      <p className="text-xs text-muted">
        Please don&apos;t include Social Security numbers, driver&apos;s license numbers, payment or bank details, or health information.
        We&apos;ll ask for anything else we need when we talk.
      </p>
      <SubmitButton pendingText="Sending…" pending={pending}>Send my request</SubmitButton>
    </form>
  );
}
