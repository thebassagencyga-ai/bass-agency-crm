"use client";

// Shown when a page in the app fails to load (for example, the database is unreachable).
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-slate-600 dark:text-slate-400">The page couldn&apos;t load. Your data is safe. Try again in a moment.</p>
      <button type="button" onClick={reset} className="min-h-11 w-fit rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">
        Try again
      </button>
    </section>
  );
}
