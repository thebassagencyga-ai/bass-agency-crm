import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/routing";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Landing point for links in Supabase Auth emails (password reset). The email template must
// link to /auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password.
const ALLOWED_TYPES = new Set<EmailOtpType>(["recovery", "invite", "email"]);

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // Signed in with a password-only session; the middleware sends the user through the
    // authenticator step before the destination page opens.
    if (!error) return NextResponse.redirect(new URL(next, siteUrl()));
  }
  // Redirect targets are built from SITE_URL, never from the request's Host header.
  return NextResponse.redirect(new URL("/login?error=link", siteUrl()));
}
