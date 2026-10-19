import { OUTCOME_LABELS } from "@/lib/opportunities/types";
import type { OpportunityOutcome } from "@/lib/pipelines";

const OUTCOME_STYLES: Record<OpportunityOutcome, string> = {
  open: "bg-brand-soft text-link",
  nurture: "bg-caution-soft text-caution",
  won: "bg-good-soft text-good",
  lost: "bg-subtle text-fg",
};

export function OutcomeBadge({ outcome }: { outcome: OpportunityOutcome }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLES[outcome]}`}>{OUTCOME_LABELS[outcome]}</span>;
}
