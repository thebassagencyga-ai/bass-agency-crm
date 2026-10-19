import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { mergeContacts } from "@/app/(app)/contacts/actions";
import { TagList } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { findDuplicates, getContact, isUuid, relatedCounts, searchForMerge } from "@/lib/contacts/data";
import { contactDisplayName } from "@/lib/contacts/format";
import { mergedFields } from "@/lib/contacts/merge";
import { CONTACT_METHOD_LABELS, RELATIONSHIP_LABELS, type Contact } from "@/lib/contacts/types";
import { formatDateOnly } from "@/lib/dates";

export const metadata: Metadata = { title: "Merge contacts · Producr CRM" };

const ERRORS: Record<string, string> = {
  already: "That contact was already merged into another one.",
  archived: "The contact you keep must not be archived. Restore it first, or keep the other one.",
  failed: "The merge didn't work and nothing was changed. Please try again.",
};
const CHOICE = "flex min-h-11 flex-1 items-center justify-center rounded-md border px-3 text-center font-medium";

/** Merge a duplicate (Phase 17, ADR-033): pick the other contact, choose which to keep, check, merge. */
export default async function MergePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireFullSession();
  const contact = await getContact(supabase, id);
  if (!contact) notFound();
  if (contact.merged_into_contact_id) redirect(`/contacts/${id}`);
  const name = contactDisplayName(contact);

  const other = query.with && isUuid(query.with) && query.with !== id ? await getContact(supabase, query.with) : null;
  if (!other || other.merged_into_contact_id) {
    const q = (query.q ?? "").slice(0, 100);
    const [suggested, found] = await Promise.all([
      findDuplicates(supabase, contact.email, contact.phone, contact.id),
      searchForMerge(supabase, q, contact.id),
    ]);
    const pick = (list: typeof suggested, label: string) => (
      <ul aria-label={label} className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
        {list.map((d) => (
          <li key={d.id}>
            <Link href={`/contacts/${id}/merge?with=${d.id}`} className="flex min-h-11 flex-col justify-center px-3 py-2 hover:bg-subtle">
              <span className="font-medium">{d.label}</span>
              {d.detail ? <span className="text-sm text-muted">{d.detail}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    );
    return (
      <section className="flex max-w-xl flex-col gap-4">
        <Link href={`/contacts/${id}`} className="flex min-h-11 w-fit items-center text-sm underline text-link">← {name}</Link>
        <h1 className="text-2xl font-bold tracking-tight break-words">Merge {name} with…</h1>
        <p className="text-sm text-muted">Choose the duplicate. You&apos;ll see what the merged contact looks like before anything changes.</p>
        {suggested.filter((d) => !d.archived).length > 0 ? (
          <>
            <h2 className="text-lg font-semibold">Same email or phone</h2>
            {pick(suggested.filter((d) => !d.archived), "Possible duplicates")}
          </>
        ) : null}
        <form method="get" role="search" className="flex flex-col gap-2">
          <label htmlFor="merge-q" className="text-sm font-medium">Find the other contact</label>
          <div className="flex gap-2">
            <input id="merge-q" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Name, phone or email"
              className="min-h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 py-2 text-base" />
            <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Search</button>
          </div>
        </form>
        {q.length >= 2 ? (found.length > 0 ? pick(found, "Search results") : <p className="text-sm">No other contact matches &quot;{q}&quot;.</p>) : null}
      </section>
    );
  }

  // Which one is kept: this contact unless the user chose the other.
  const keep: Contact = query.keep === other.id ? other : contact;
  const dup: Contact = keep.id === contact.id ? other : contact;
  const { result, filled } = mergedFields(keep, dup);
  const [moving, referrerContact] = await Promise.all([
    relatedCounts(supabase, dup.id),
    result.referred_by_contact_id ? getContact(supabase, result.referred_by_contact_id) : Promise.resolve(null),
  ]);
  const address = [result.address_line1, result.address_line2, [result.city, result.state].filter(Boolean).join(", "), result.postal_code].filter(Boolean).join(", ");
  const from = (...keys: (keyof typeof result)[]) => keys.some((k) => filled.includes(k));
  const rows: [string, React.ReactNode, boolean][] = [
    ["Name", contactDisplayName({ ...keep, ...result }), from("first_name", "last_name", "business_name")],
    ["Phone", [result.phone, result.alt_phone].filter(Boolean).join(" · ") || "—", from("phone", "alt_phone")],
    ["Email", result.email ?? "—", from("email")],
    ["Address", address || "—", from("address_line1", "city", "state", "postal_code")],
    ["Status", RELATIONSHIP_LABELS[result.relationship_status], from("relationship_status")],
    ["Prefers", result.preferred_contact_method ? CONTACT_METHOD_LABELS[result.preferred_contact_method] : "—", from("preferred_contact_method")],
    ["Lead source", result.lead_source ?? "—", from("lead_source")],
    ["Referred by", referrerContact ? contactDisplayName(referrerContact) : "—", from("referred_by_contact_id")],
    ["Google review", result.google_review_left_on ? formatDateOnly(result.google_review_left_on) : "—", from("google_review_left_on")],
    ["Tags", result.tags.length > 0 ? <TagList key="t" tags={result.tags} /> : "—", from("tags")],
    ["Notes", result.notes ? <span key="n" className="whitespace-pre-wrap">{result.notes}</span> : "—", from("notes")],
  ];
  const moves = [
    [moving.opportunities, "opportunity", "opportunities"], [moving.tasks, "task", "tasks"], [moving.activities, "activity", "activities"],
    [moving.household, "household member", "household members"], [moving.vehicles, "vehicle", "vehicles"], [moving.referrals, "referral", "referrals"],
  ] as const;
  const moveText = moves.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const error = query.error ? ERRORS[query.error] : undefined;

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href={`/contacts/${id}/merge`} className="flex min-h-11 w-fit items-center text-sm underline text-link">← Choose another contact</Link>
      <h1 className="text-2xl font-bold tracking-tight break-words">Merge duplicates</h1>
      {error ? <p role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad">{error}</p> : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Which contact do you keep?</legend>
        <div className="flex gap-2">
          {[contact, other].map((c) => (
            <Link key={c.id} href={`/contacts/${id}/merge?with=${other.id}&keep=${c.id}`} aria-current={keep.id === c.id ? "true" : undefined}
              className={`${CHOICE} ${keep.id === c.id ? "border-brand bg-brand text-on-brand hover:bg-brand-hover" : "border-line-strong"}`}>
              Keep {contactDisplayName(c)}{c.archived_at ? " (archived)" : ""}
            </Link>
          ))}
        </div>
        <p className="text-sm text-muted">
          The kept contact&apos;s details win; its empty details are filled from {contactDisplayName(dup)}.
        </p>
      </fieldset>

      <h2 className="text-lg font-semibold">The merged contact</h2>
      <dl aria-label="Merged contact" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {rows.map(([label, value, changed]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-muted">{label}</dt>
            <dd className="break-words">{value}{changed ? <span className="ml-2 rounded bg-caution-soft px-1.5 py-0.5 text-xs text-caution">from the duplicate</span> : null}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {moveText.length > 0 ? <>Moves to {contactDisplayName(keep)}: {moveText.join(", ")}.</> : <>{contactDisplayName(dup)} has no opportunities, tasks or history to move.</>}
      </p>
      <p className="text-sm text-muted">
        {contactDisplayName(dup)} is then archived and marked &quot;merged&quot;, with a link here. Nothing is deleted, but a merge can&apos;t be undone.
      </p>
      <form action={mergeContacts} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="keep" value={keep.id} />
        <input type="hidden" name="merge" value={dup.id} />
        <input type="hidden" name="from" value={id} />
        <button type="submit" disabled={keep.archived_at !== null}
          className="min-h-11 rounded-md bg-brand px-4 font-medium text-on-brand disabled:opacity-60 hover:bg-brand-hover">
          Merge into {contactDisplayName(keep)}
        </button>
        <Link href={`/contacts/${id}`} className="flex min-h-11 items-center justify-center px-3 underline text-link">Cancel</Link>
      </form>
      {keep.archived_at ? <p className="text-sm text-caution">{ERRORS.archived}</p> : null}
    </section>
  );
}
