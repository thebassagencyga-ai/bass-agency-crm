import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicIntakeForm } from "@/components/intake/public-form";
import { isIntakeToken } from "@/lib/intake/schema";

// Public intake form (Phase 13, ADR-028). No sign-in. Whether the link is still enabled is
// checked when the form is sent (anonymous visitors cannot read link records).
export const metadata: Metadata = {
  title: "Request a quote · The Bass Agency",
  robots: { index: false, follow: false },
};

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isIntakeToken(token)) notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-lg font-semibold">The Bass Agency</p>
        <h1 className="text-2xl font-semibold">Request an insurance quote</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Carrollton, Georgia. Tell us a little about yourself and we&apos;ll be in touch.</p>
      </header>
      <PublicIntakeForm token={token} />
    </main>
  );
}
