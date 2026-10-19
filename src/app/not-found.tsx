import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found · ZeroLapse CRM" };

// Any address that doesn't exist (a mistyped link, an old bookmark). Says nothing about
// whether a record exists for someone else.
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-slate-600 dark:text-slate-400">This page doesn&apos;t exist or isn&apos;t available to you. Check the link, or go back to your dashboard.</p>
      <Link href="/dashboard" className="flex min-h-11 w-fit items-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">
        Go to the dashboard
      </Link>
    </main>
  );
}
