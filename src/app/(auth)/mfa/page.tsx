import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/routing";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step sign-in · The Bass Agency CRM" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <MfaForm next={safeNextPath(params.next)} />;
}
