import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found · Producr CRM" };

// Any address that doesn't exist (a mistyped link, an old bookmark). Says nothing about
// whether a record exists for someone else.
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">This page doesn&apos;t exist or isn&apos;t available to you. Check the link, or go back to your dashboard.</p>
      <Link href="/dashboard" className="flex min-h-11 w-fit items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">
        Go to the dashboard
      </Link>
    </main>
  );
}
