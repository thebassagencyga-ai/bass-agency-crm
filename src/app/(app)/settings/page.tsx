import type { Metadata } from "next";
import Link from "next/link";
import { requireFullSession } from "@/lib/auth/require";

export const metadata: Metadata = { title: "Settings · The Bass Agency CRM" };

export default async function SettingsPage() {
  const { email } = await requireFullSession();
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-medium">Signed in as</dt>
        <dd className="break-all">{email}</dd>
        <dt className="font-medium">Two-step sign-in</dt>
        <dd>On (required)</dd>
      </dl>
      <Link href="/reset-password" className="min-h-11 py-2 underline">Change password</Link>
      <p className="text-sm text-slate-500">Automation rules, your Google review link and other preferences arrive in later phases.</p>
    </section>
  );
}
