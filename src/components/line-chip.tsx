import { LINE_FAMILY, PRODUCT_LINE_NAMES, PRODUCT_LINES, type BaseLine, type ProductLine } from "@/lib/pipelines";

// Phase 29 (ADR-047): one soft colour per line of business, from globals.css (contrast-tested).
// Phase 30 (ADR-048): each line takes its family's colour (Renters like Home, Farm like Commercial).
const FAMILY_CLASS: Readonly<Record<BaseLine, string>> = {
  auto: "bg-lob-auto text-lob-auto-fg",
  home: "bg-lob-home text-lob-home-fg",
  commercial: "bg-lob-commercial text-lob-commercial-fg",
  life: "bg-lob-life text-lob-life-fg",
};
export const LINE_CHIP_CLASS: Readonly<Record<ProductLine, string>> = Object.fromEntries(
  PRODUCT_LINES.map((l) => [l, FAMILY_CLASS[LINE_FAMILY[l]]]),
) as Record<ProductLine, string>;

const BY_NAME = new Map<string, ProductLine>(PRODUCT_LINES.flatMap((l) => [[l, l], [PRODUCT_LINE_NAMES[l].toLowerCase(), l]]));

/** The line class for a tag named after a line ("Auto", "home", "Mobile Home"…), else null. */
export function lineClassForName(name: string): string | null {
  const line = BY_NAME.get(name.trim().toLowerCase().replace(/\s+/g, " "));
  return line ? LINE_CHIP_CLASS[line] : null;
}

export function LineChip({ line }: { line: ProductLine }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${LINE_CHIP_CLASS[line]}`}>{PRODUCT_LINE_NAMES[line]}</span>;
}
