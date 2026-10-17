import Link from "next/link";
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

const TAG = "rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-900 dark:text-sky-100";

/** A contact's tags (Phase 17). `linked`: each opens the contact list filtered by that tag. */
export function TagList({ tags, linked = false }: { tags: readonly string[]; linked?: boolean }) {
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <li key={t}>
          {linked ? (
            <Link href={`/contacts?tag=${encodeURIComponent(t)}`} className={`inline-flex min-h-11 min-w-11 items-center justify-center ${TAG} underline-offset-2 hover:underline`}>{t}</Link>
          ) : (
            <span className={TAG}>{t}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MergedBadge() {
  return <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">Merged</span>;
}
