// Producr brand mark and wordmark (Phase 22, ADR-038). The mark is "P." in Inter Bold (glyph
// outlines, so it looks the same without the font) in Midnight Ink on an Electric Blue tile.
// src/app/icon.svg, public/offline.html and scripts/make-icons.mjs use the same path.
export const MARK_PATH =
  "M135 0V1490H716Q886 1490 1005 1425Q1124 1361 1186 1247Q1249 1134 1249 987Q1249 839 1185 727Q1122 614 1001 550Q881 487 709 487H335V733H660Q754 733 814 765Q875 798 904 855Q934 912 934 987Q934 1062 904 1119Q875 1176 814 1207Q753 1238 659 1238H440V0ZM1542 -19Q1469 -19 1419 31Q1369 80 1369 153Q1369 226 1419 275Q1469 324 1542 324Q1615 324 1665 275Q1715 226 1715 153Q1715 80 1665 31Q1615 -19 1542 -19Z";
export const MARK_TRANSFORM = "translate(8.241 22.25) scale(0.008389 -0.008389)";

export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d={MARK_PATH} transform={MARK_TRANSFORM} className="fill-on-brand" />
    </svg>
  );
}

/** The lockup: the mark, then "producr" (dominant, lowercase) over a quieter "CRM". */
export function Wordmark({ size = "md", tone = "default" }: { size?: "md" | "lg"; tone?: "default" | "shell" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark className={big ? "size-12" : "size-9"} />
      <span className="flex flex-col items-start leading-none">
        <span className={`font-bold tracking-tight lowercase ${big ? "text-3xl" : "text-xl"} ${tone === "shell" ? "text-shell-fg" : "text-fg"}`}>producr</span>
        {/* A real space, so the name reads "producr CRM" (screen readers, accessible-name checks). */}
        {" "}
        {/* Electric Blue on the Ink shell; the deeper link blue on light backgrounds (contrast). */}
        <span className={`mt-0.5 font-medium tracking-wide ${big ? "text-base" : "text-xs"} ${tone === "shell" ? "text-brand" : "text-link"}`}>CRM</span>
      </span>
    </span>
  );
}

export const TAGLINE = "Every lead. Every next move.";
