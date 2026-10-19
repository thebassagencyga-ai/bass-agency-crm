import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readAuthState } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/auth/routing";
import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up two-step sign-in · Producr CRM" };

export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { state } = await readAuthState(supabase);
  if (!state.signedIn) redirect("/login");
  if (state.hasVerifiedFactor) redirect("/mfa");

  // Start fresh: remove abandoned, never-verified setups, then create one for this screen.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app", issuer: "Producr CRM" });
  if (error || !data) {
    return <p role="alert" className="text-bad">Could not start setup. Reload the page to try again.</p>;
  }
  return <SetupForm factorId={data.id} qrCode={data.totp.qr_code} secret={data.totp.secret} next={safeNextPath(params.next)} />;
}
