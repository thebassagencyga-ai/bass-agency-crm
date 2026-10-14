"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { emailSchema, newPasswordSchema, signInSchema, totpCodeSchema } from "@/lib/auth/forms";
import { requireFullSession } from "@/lib/auth/require";
import { safeNextPath } from "@/lib/auth/routing";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const TOO_MANY = "Too many attempts. Wait a few minutes and try again.";

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get("email") ?? "").slice(0, 254) };
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const next = safeNextPath(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // One message for wrong email or wrong password, so the form cannot be used to discover accounts.
    return { error: error.status === 429 ? TOO_MANY : "Email or password is incorrect.", values };
  }
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const step = level?.nextLevel === "aal2" ? "/mfa" : "/mfa/setup";
  redirect(`${step}?next=${encodeURIComponent(next)}`);
}

export async function verifyMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = totpCodeSchema.safeParse(formData.get("code") ?? "");
  if (!code.success) return { fieldErrors: { code: code.error.issues[0]?.message ?? "Invalid code." } };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect("/mfa/setup");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
  if (error) return { error: error.status === 429 ? TOO_MANY : "That code didn't work. Check your authenticator app and try again." };
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function confirmEnrollment(_prev: FormState, formData: FormData): Promise<FormState> {
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  const code = totpCodeSchema.safeParse(formData.get("code") ?? "");
  if (!factorId.success) return { error: "Setup expired. Reload the page to start again." };
  if (!code.success) return { fieldErrors: { code: code.error.issues[0]?.message ?? "Invalid code." } };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factorId.data, code: code.data });
  if (error) return { error: error.status === 429 ? TOO_MANY : "That code didn't work. Make sure you scanned the code on this screen, then try the newest code." };
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get("email") ?? "").slice(0, 254) };
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error?.status === 429) return { error: TOO_MANY, values };
  // Same answer whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way. It expires in one hour." };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: error.code === "same_password" ? "Choose a password you haven't used here before." : "Could not change the password. Try again." };
  }
  return { message: "Password changed." };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?signedOut=1");
}
