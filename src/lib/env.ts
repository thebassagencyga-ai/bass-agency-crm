// Runtime configuration. None of these are NEXT_PUBLIC_, so none are bundled into browser
// code. The publishable key is not a secret (RLS protects the data), but keeping it
// server-side means the browser never talks to Supabase directly (connect-src 'self').
import { z } from "zod";

const supabaseSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(20),
});

export function supabaseEnv(): z.infer<typeof supabaseSchema> {
  const parsed = supabaseSchema.safeParse({
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (see .env.example).");
  }
  return parsed.data;
}

/** Public base URL of this app, used in password-reset links. Never derived from the Host header. */
export function siteUrl(): string {
  const parsed = z.url().safeParse(process.env.SITE_URL);
  if (!parsed.success) throw new Error("SITE_URL must be set (see .env.example).");
  return parsed.data.replace(/\/$/, "");
}
