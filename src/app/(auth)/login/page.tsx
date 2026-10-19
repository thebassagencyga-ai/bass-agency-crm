import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/routing";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Producr CRM" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const notice =
    params.signedOut ? "You have been signed out." :
    params.expired ? "You were signed out because the CRM wasn't used for 7 days. Sign in again." :
    params.error === "link" ? "That link is invalid or has expired. Request a new one." :
    undefined;
  return <LoginForm next={safeNextPath(params.next)} notice={notice} />;
}
