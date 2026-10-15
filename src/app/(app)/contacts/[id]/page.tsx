import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchivedBadge, StatusBadge } from "@/components/contacts/badges";
import { requireFullSession } from "@/lib/auth/require";
import { getContact, getReferrals } from "@/lib/contacts/data";
import { contactDisplayName, contactPersonName } from "@/lib/contacts/format";
import { CONTACT_METHOD_LABELS } from "@/lib/contacts/types";
import { formatDateOnly, formatInstantDate } from "@/lib/dates";
import { OutcomeBadge } from "@/components/opportunities/badges";
import { getStages, listForContact } from "@/lib/opportunities/data";
import { formatMoney } from "@/lib/opportunities/format";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { setContactArchived } from "../actions";

export const metadata: Metadata = { title: "Contact · The Bass Agency CRM" };

const NOTICES: Record<string, { text: string; tone: "ok" | "error" }> = {
  saved: { text: "Contact saved.", tone: "ok" },
  archived: { text: "Contact archived. It is hidden from the contact list but nothing was deleted.", tone: "ok" },
  restored: { text: "Contact restored.", tone: "ok" },
  error: { text: "That didn't work. Please try again.", tone: "error" },
};

export default async function ContactPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const contact = await getContact(supabase, id);
  if (!contact) notFound();

  const [referrer, referrals, opportunities, stages] = await Promise.all([
    contact.referred_by_contact_id ? getContact(supabase, contact.referred_by_contact_id) : Promise.resolve(null),
    getReferrals(supabase, contact.id),
    listForContact(supabase, contact.id),
    getStages(supabase),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const noticeKey = Object.keys(NOTICES).find((k) => query[k]);
  const notice = noticeKey ? NOTICES[noticeKey] : undefined;
  const person = contactPersonName(contact);
  const address = [contact.address_line1, contact.address_line2, [contact.city, contact.state].filter(Boolean).join(", "), contact.postal_code]
    .filter((p) => p && p.trim())
    .join(", ");

  const rows: [string, React.ReactNode][] = [
    ["Type", contact.contact_type === "business" ? "Business" : "Individual"],
    ...(person ? [["Contact person", person] as [string, React.ReactNode]] : []),
    ["Phone", contact.phone ? <a href={`tel:${contact.phone}`} className="underline">{contact.phone}</a> : "—"],
    ...(contact.alt_phone ? [["Other phone", <a key="alt" href={`tel:${contact.alt_phone}`} className="underline">{contact.alt_phone}</a>] as [string, React.ReactNode]] : []),
    ["Email", contact.email ? <a href={`mailto:${contact.email}`} className="break-all underline">{contact.email}</a> : "—"],
    ["Address", address || "—"],
    ["Prefers", contact.preferred_contact_method ? CONTACT_METHOD_LABELS[contact.preferred_contact_method] : "—"],
    ["Lead source", contact.lead_source ?? "—"],
    ["Referred by", referrer ? <Link href={`/contacts/${referrer.id}`} className="underline">{contactDisplayName(referrer)}</Link> : "—"],
    ["Google review", contact.google_review_left_on ? `Left on ${formatDateOnly(contact.google_review_left_on)}` : "Not recorded"],
    ["Added", formatInstantDate(contact.created_at)],
    ["Last updated", formatInstantDate(contact.updated_at)],
  ];

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      {notice ? (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Link href="/contacts" className="w-fit text-sm underline">← Contacts</Link>
        <h1 className="text-2xl font-semibold break-words">{contactDisplayName(contact)}</h1>
        <div className="flex gap-1">
          <StatusBadge status={contact.relationship_status} />
          {contact.archived_at ? <ArchivedBadge /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/contacts/${contact.id}/edit`} className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Edit</Link>
          {contact.archived_at ? (
            <form action={setContactArchived}>
              <input type="hidden" name="id" value={contact.id} />
              <input type="hidden" name="archive" value="0" />
              <button type="submit" className="min-h-11 rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">Restore contact</button>
            </form>
          ) : (
            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-400 px-4 font-medium">Archive…</summary>
              <form action={setContactArchived} className="mt-2 flex flex-col gap-2 rounded-md border border-slate-300 p-3 text-sm dark:border-slate-600">
                <p>Archiving hides this contact from the list. Nothing is deleted and you can restore it any time.</p>
                <input type="hidden" name="id" value={contact.id} />
                <input type="hidden" name="archive" value="1" />
                <button type="submit" className="min-h-11 rounded-md bg-amber-700 px-4 font-medium text-white">Archive contact</button>
              </form>
            </details>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {contact.notes ? (
        <section aria-labelledby="notes-heading" className="flex flex-col gap-1">
          <h2 id="notes-heading" className="text-lg font-semibold">Notes</h2>
          <p className="whitespace-pre-wrap break-words">{contact.notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="referrals-heading" className="flex flex-col gap-1">
        <h2 id="referrals-heading" className="text-lg font-semibold">Referrals from this contact</h2>
        {referrals.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">None recorded yet.</p>
        ) : (
          <ul className="list-disc pl-5">
            {referrals.map((r) => (
              <li key={r.id}><Link href={`/contacts/${r.id}`} className="underline">{r.label}</Link></li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="opps-heading" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="opps-heading" className="text-lg font-semibold">Opportunities</h2>
          {contact.archived_at ? null : (
            <Link href={`/opportunities/new?contact=${contact.id}`} className="flex min-h-11 items-center rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100">
              Add opportunity
            </Link>
          )}
        </div>
        {opportunities.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">None yet.</p>
        ) : (
          <ul aria-label="Opportunities for this contact" className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {opportunities.map((o) => (
              <li key={o.id}>
                <Link href={`/opportunities/${o.id}`} className="flex min-h-11 flex-wrap items-center gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                  <span className="font-medium">{PRODUCT_LINE_NAMES[o.product_line]}</span>
                  <span className="text-sm">{stageName.get(o.stage_id)}</span>
                  <OutcomeBadge outcome={o.outcome} />
                  {o.estimated_annual_premium !== null ? <span className="text-sm">{formatMoney(o.estimated_annual_premium, { whole: true })}/yr</span> : null}
                  {o.description ? <span className="w-full text-sm break-words text-slate-600 dark:text-slate-400">{o.description}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {[
        ["Tasks", 5, "Open and completed follow-up tasks."],
        ["Activity", 5, "Calls, meetings, notes and follow-up outcomes."],
      ].map(([title, phase, text]) => (
        <section key={String(title)} className="flex flex-col gap-1 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-600">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{text} Coming in Phase {phase}.</p>
        </section>
      ))}
    </section>
  );
}
