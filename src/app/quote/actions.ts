"use server";

import type { FormState } from "@/components/form";
import { echoIntakeValues, intakeDbError, isIntakeToken, parseIntakeForm } from "@/lib/intake/schema";
import { createAnonClient } from "@/lib/supabase/anon";

// The public intake form's only action (ADR-028). It runs WITHOUT a session (anon role), so
// all it can do is call public.submit_intake, which adds one submission to the link owner's
// review inbox. The database validates everything again and rate-limits each link.

export async function submitQuoteRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echoIntakeValues(formData);
  const token = formData.get("token");
  if (typeof token !== "string" || !isIntakeToken(token)) {
    return { error: "This form link is not valid. Please contact The Bass Agency directly.", values };
  }
  // Hidden field people never see: anything in it means a bot. Pretend success, store nothing.
  const trap = formData.get("website");
  if (typeof trap === "string" && trap !== "") return { message: "sent" };

  const parsed = parseIntakeForm(formData, { requireConsent: true });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values };

  const { error } = await createAnonClient().rpc("submit_intake", {
    p_token: token, p_form: parsed.payload, p_consent: parsed.consent,
  });
  if (error) return { ...intakeDbError(error.message), values };
  return { message: "sent" };
}
