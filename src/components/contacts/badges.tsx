import Link from "next/link";
import { lineClassForName } from "@/components/line-chip";
import { RELATIONSHIP_LABELS, type RelationshipStatus } from "@/lib/contacts/types";

const STATUS_STYLES: Record<RelationshipStatus, string> = {
  prospect: "bg-brand-soft text-link",
  client: "bg-good-soft text-good",
  former_client: "bg-subtle text-fg",
};

export function StatusBadge({ status }: { status: RelationshipStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{RELATIONSHIP_LABELS[status]}</span>;
}

export function ArchivedBadge() {
  return <span className="rounded bg-caution-soft px-2 py-0.5 text-xs font-medium text-caution">Archived</span>;
}

const TAG_BASE = "rounded-full px-2 py-0.5 text-xs font-medium";
/** Tags named after a line (Auto, Home, Commercial, Life) take that line's colour (Phase 29). */
const tagClass = (t: string) => `${TAG_BASE} ${lineClassForName(t) ?? "bg-brand-soft text-fg"}`;

/** A contact's tags (Phase 17). `linked`: each opens the contact list filtered by that tag. */
export function TagList({ tags, linked = false }: { tags: readonly string[]; linked?: boolean }) {
  return (
    <ul aria-label="Tags" className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <li key={t}>
          {linked ? (
            <Link href={`/contacts?tag=${encodeURIComponent(t)}`} className={`inline-flex min-h-11 min-w-11 items-center justify-center ${tagClass(t)} underline-offset-2 hover:underline`}>{t}</Link>
          ) : (
            <span className={tagClass(t)}>{t}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MergedBadge() {
  return <span className="rounded bg-subtle px-2 py-0.5 text-xs font-medium text-fg">Merged</span>;
}
