// What merging two contacts will produce (Phase 17, ADR-033), for the preview. The database
// function public.merge_contacts does the merge; this mirrors its rules so the user sees the
// result before confirming. Kept in step by tests/unit/merge.test.ts and tests/db/tags-merge.test.ts.
import type { Contact, RelationshipStatus } from "./types";

export const MERGE_NOTE_SEPARATOR = "\n\n— Merged from a duplicate contact —\n";

type Fields = Pick<Contact,
  "first_name" | "last_name" | "business_name" | "email" | "phone" | "alt_phone" | "address_line1" | "address_line2" |
  "city" | "state" | "postal_code" | "preferred_contact_method" | "lead_source" | "relationship_status" |
  "referred_by_contact_id" | "google_review_left_on" | "notes" | "tags">;

const RANK: Record<RelationshipStatus, number> = { prospect: 0, former_client: 1, client: 2 };
const digits10 = (p: string) => p.replace(/\D/g, "").slice(-10);
const blank = (s: string | null) => s === null || s.trim() === "";

export function mergedFields(keep: Contact, dup: Contact): { result: Fields; filled: (keyof Fields)[] } {
  const keepHasAddress = [keep.address_line1, keep.address_line2, keep.city, keep.state, keep.postal_code].some((v) => v !== null);
  const address = (k: string | null, d: string | null) => (keepHasAddress ? k : d);
  const altPhone = keep.alt_phone
    ?? (keep.phone && dup.phone && digits10(dup.phone) !== digits10(keep.phone) ? dup.phone : null)
    ?? dup.alt_phone;
  const referrer =
    keep.referred_by_contact_id && keep.referred_by_contact_id !== dup.id ? keep.referred_by_contact_id
    : dup.referred_by_contact_id && dup.referred_by_contact_id !== keep.id ? dup.referred_by_contact_id
    : null;
  const reviews = [keep.google_review_left_on, dup.google_review_left_on].filter((d): d is string => d !== null).sort();
  const notes = blank(dup.notes) ? keep.notes : blank(keep.notes) ? dup.notes : `${keep.notes}${MERGE_NOTE_SEPARATOR}${dup.notes}`.slice(0, 5000);
  const seen = new Set<string>();
  const tags = [...keep.tags, ...dup.tags].filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 20);

  const result: Fields = {
    first_name: keep.first_name ?? dup.first_name,
    last_name: keep.last_name ?? dup.last_name,
    business_name: keep.business_name ?? dup.business_name,
    email: keep.email ?? dup.email,
    phone: keep.phone ?? dup.phone,
    alt_phone: altPhone,
    address_line1: address(keep.address_line1, dup.address_line1),
    address_line2: address(keep.address_line2, dup.address_line2),
    city: address(keep.city, dup.city),
    state: address(keep.state, dup.state),
    postal_code: address(keep.postal_code, dup.postal_code),
    preferred_contact_method: keep.preferred_contact_method ?? dup.preferred_contact_method,
    lead_source: keep.lead_source ?? dup.lead_source,
    relationship_status: RANK[dup.relationship_status] > RANK[keep.relationship_status] ? dup.relationship_status : keep.relationship_status,
    referred_by_contact_id: referrer,
    google_review_left_on: reviews[0] ?? null,
    notes,
    tags,
  };
  const filled = (Object.keys(result) as (keyof Fields)[]).filter((k) => JSON.stringify(result[k]) !== JSON.stringify(keep[k]));
  return { result, filled };
}
