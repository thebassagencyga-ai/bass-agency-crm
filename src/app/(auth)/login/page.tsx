import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/routing";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · The Bass Agency CRM" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const notice =
    params.signedOut ? "You have been signed out." :
    params.error === "link" ? "That link is invalid or has expired. Request a new one." :
    undefined;
  return <LoginForm next={safeNextPath(params.next)} notice={notice} />;
}
