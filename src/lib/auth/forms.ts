// Server-side validation for the authentication forms.
import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(200),
});

export const emailSchema = z.object({ email });

export const totpCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."));

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(200)
      .regex(/[a-z]/, "Include a lower-case letter.")
      .regex(/[A-Z]/, "Include an upper-case letter.")
      .regex(/[0-9]/, "Include a number."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The passwords do not match.", path: ["confirm"] });
