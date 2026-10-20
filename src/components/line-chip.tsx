import { PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";

// Phase 29 (ADR-047): one soft colour per line of business, from globals.css (contrast-tested).
export const LINE_CHIP_CLASS: Readonly<Record<ProductLine, string>> = {
  auto: "bg-lob-auto text-lob-auto-fg",
  home: "bg-lob-home text-lob-home-fg",
  commercial: "bg-lob-commercial text-lob-commercial-fg",
  life: "bg-lob-life text-lob-life-fg",
};

/** The line class for a tag named after a line ("Auto", "home"…), else null. */
export function lineClassForName(name: string): string | null {
  const key = name.trim().toLowerCase() as ProductLine;
  return key in LINE_CHIP_CLASS ? LINE_CHIP_CLASS[key] : null;
}

export function LineChip({ line }: { line: ProductLine }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${LINE_CHIP_CLASS[line]}`}>{PRODUCT_LINE_NAMES[line]}</span>;
}
