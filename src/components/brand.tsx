// Producr brand mark and wordmark (Phase 22, ADR-038). The P symbol is drawn in code so it stays
// sharp at any size; public/icons and src/app/icon.svg use the same shape.

/** The geometric P: a stem and a round bowl on an Electric Blue tile. */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M10.5 24V8.5h6.25a5.25 5.25 0 0 1 0 10.5H10.5" fill="none" className="stroke-on-brand" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "producr" (dominant, lowercase) with "CRM" as a quieter descriptor. */
export function Wordmark({ size = "md", tone = "default" }: { size?: "md" | "lg"; tone?: "default" | "shell" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark className={big ? "size-10" : "size-8"} />
      <span className={`font-bold tracking-tight lowercase ${big ? "text-3xl" : "text-xl"} ${tone === "shell" ? "text-shell-fg" : "text-fg"}`}>producr</span>
      <span className={`self-center rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-widest uppercase ${tone === "shell" ? "bg-white/10 text-shell-muted" : "bg-subtle text-muted"}`}>
        CRM
      </span>
    </span>
  );
}

export const TAGLINE = "Every lead. Every next move.";
