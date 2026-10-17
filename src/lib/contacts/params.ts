// Parses the contact list's URL search parameters. Invalid values fall back to defaults
// rather than erroring, so a hand-edited URL never breaks the page.
import { CONTACT_TYPES, RELATIONSHIP_STATUSES, type ContactType, type RelationshipStatus } from "./types";

export const CONTACT_SORTS = ["name", "recent", "updated"] as const;
export const ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export const CONTACTS_PAGE_SIZE = 25;

export interface ContactListParams {
  q: string;
  type: ContactType | null;
  status: RelationshipStatus | null;
  leadSource: string | null;
  tag: string | null;
  archived: (typeof ARCHIVE_FILTERS)[number];
  sort: (typeof CONTACT_SORTS)[number];
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

export function parseContactListParams(raw: Raw): ContactListParams {
  const page = Number.parseInt(first(raw.page), 10);
  const source = first(raw.source).trim().slice(0, 100);
  return {
    q: first(raw.q).trim().slice(0, 100),
    type: oneOf(first(raw.type), CONTACT_TYPES),
    status: oneOf(first(raw.status), RELATIONSHIP_STATUSES),
    leadSource: source || null,
    tag: first(raw.tag).trim().slice(0, 40) || null,
    archived: oneOf(first(raw.archived), ARCHIVE_FILTERS) ?? "active",
    sort: oneOf(first(raw.sort), CONTACT_SORTS) ?? "name",
    page: Number.isFinite(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}
