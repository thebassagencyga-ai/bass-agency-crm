// Placeholder for screens built in later phases (ROADMAP.md).
export function Placeholder({ title, phase, summary }: { title: string; phase: number; summary: string }) {
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted">{summary}</p>
      <p className="text-sm text-muted">Coming in Phase {phase}.</p>
    </section>
  );
}
