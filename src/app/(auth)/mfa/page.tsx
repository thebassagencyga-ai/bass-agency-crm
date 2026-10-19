import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/routing";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step sign-in · Producr CRM" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  // Asked again 12 hours after the last code (Phase 16): the session may still be two-step.
  return <MfaForm next={safeNextPath(params.next)} again={params.again === "1"} />;
}
