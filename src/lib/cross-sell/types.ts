// Cross-sell rules and prompts (Phase 8, ADR-023). Rules are data the agent can edit.
import type { ContactType } from "@/lib/contacts/types";
import type { ProductLine } from "@/lib/pipelines";

export interface CrossSellRule {
  id: string;
  rule_key: string;
  name: string;
  has_any_lines: ProductLine[];
  lacks_line: ProductLine;
  contact_type: ContactType | null;
  reason: string;
  enabled: boolean;
}

/** Row returned by cross_sell_prompts. */
export interface CrossSellPrompt {
  contact_id: string;
  rule_id: string;
  rule_key: string;
  rule_name: string;
  reason: string;
  lacks_line: ProductLine;
  held_lines: ProductLine[];
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
}

export const RULE_CONTACT_TYPE_LABELS: Readonly<Record<"any" | ContactType, string>> = {
  any: "Individuals and businesses",
  individual: "Individuals only",
  business: "Businesses only",
};
