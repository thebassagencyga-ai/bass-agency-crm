"use client";

// Shown when a page in the app fails to load (for example, the database is unreachable).
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted">The page couldn&apos;t load. Your data is safe. Try again in a moment.</p>
      <button type="button" onClick={reset} className="min-h-11 w-fit rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">
        Try again
      </button>
    </section>
  );
}
