import { OUTCOME_LABELS } from "@/lib/opportunities/types";
import type { OpportunityOutcome } from "@/lib/pipelines";

const OUTCOME_STYLES: Record<OpportunityOutcome, string> = {
  open: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  nurture: "bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  won: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
  lost: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function OutcomeBadge({ outcome }: { outcome: OpportunityOutcome }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLES[outcome]}`}>{OUTCOME_LABELS[outcome]}</span>;
}
