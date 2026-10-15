import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { RULE_CONTACT_TYPE_LABELS, type CrossSellRule } from "./types";

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

/** Plain-English summary for Settings, e.g. "Has Auto, no Home · Individuals only". */
export function describeCrossSellRule(rule: Pick<CrossSellRule, "has_any_lines" | "lacks_line" | "contact_type">): string {
  const held = list(rule.has_any_lines.map((l) => PRODUCT_LINE_NAMES[l]));
  return `Has ${held}, no ${PRODUCT_LINE_NAMES[rule.lacks_line]} · ${RULE_CONTACT_TYPE_LABELS[rule.contact_type ?? "any"]}`;
}

/** A rule key derived from a new rule's name: lowercase words joined by "_", unique-ified by the caller. */
export function ruleKeyFromName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  const key = /^[a-z]/.test(base) ? base : `rule_${base}`;
  return key.length >= 3 ? key : `${key}_rule`.slice(0, 50);
}
