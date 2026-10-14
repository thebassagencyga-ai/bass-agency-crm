// Placeholder for screens built in later phases (ROADMAP.md).
export function Placeholder({ title, phase, summary }: { title: string; phase: number; summary: string }) {
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">{summary}</p>
      <p className="text-sm text-slate-500">Coming in Phase {phase}.</p>
    </section>
  );
}
