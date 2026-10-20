import Link from "next/link";

// Reports: Overview (Phase 9) and Production (Phase 28, ADR-046). The main menu is unchanged.
export function ReportTabs({ current }: { current: "overview" | "production" }) {
  const tabs = [
    { key: "overview", label: "Overview", href: "/reports" },
    { key: "production", label: "Production", href: "/reports/production" },
  ] as const;
  return (
    <nav aria-label="Report" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined}
          className="-mb-px flex min-h-11 items-center border-b-4 border-transparent px-4 font-medium text-muted hover:text-fg aria-[current=page]:border-brand aria-[current=page]:text-fg"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
