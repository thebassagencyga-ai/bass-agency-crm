import { RELATIONSHIP_LABELS, type RelationshipStatus } from "@/lib/contacts/types";

const STATUS_STYLES: Record<RelationshipStatus, string> = {
  prospect: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  client: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
  former_client: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function StatusBadge({ status }: { status: RelationshipStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{RELATIONSHIP_LABELS[status]}</span>;
}

export function ArchivedBadge() {
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">Archived</span>;
}
