import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { discardIntake } from "@/app/(app)/intake/actions";
import { ReviewForm } from "@/components/intake/review-form";
import { requireFullSession } from "@/lib/auth/require";
import { findDuplicates } from "@/lib/contacts/data";
import { formatInstantDateTime } from "@/lib/dates";
import { getSubmission } from "@/lib/intake/data";
import { describeCoverage } from "@/lib/intake/format";
import { INTAKE_CONTACT_METHOD_LABELS, INTAKE_LINE_LABELS } from "@/lib/intake/types";
import { RELATIONSHIP_LABELS } from "@/lib/contacts/details";
import { MessageComposer } from "@/components/messages/message-composer";
import { getProfile } from "@/lib/tasks/data";

export const metadata: Metadata = { title: "Review request · ZeroLapse CRM" };

export default async function ReviewIntakePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, userId } = await requireFullSession();
  const s = await getSubmission(supabase, id);
  if (!s || s.status !== "new") notFound();
  const [duplicates, profile] = await Promise.all([findDuplicates(supabase, s.email, s.phone, null), getProfile(supabase, userId)]);

  const rows: [string, string | null][] = [
    ["Phone", s.phone],
    ["Email", s.email],
    ["Address", [s.address_line1, s.city, [s.state, s.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null],
    ["Best way to reach", s.preferred_contact_method ? INTAKE_CONTACT_METHOD_LABELS[s.preferred_contact_method] : null],
    ["Best time", s.best_time],
    ["Wants quotes for", s.lines.map((l) => INTAKE_LINE_LABELS[l]).join(", ")],
    ["Current coverage", s.current_coverage.length > 0 ? s.current_coverage.map(describeCoverage).join("; ") : null],
    ["Vehicles", (s.vehicles ?? []).map((v) => [v.year, v.make, v.model].filter(Boolean).join(" ")).join("; ") || null],
    ["Household / other drivers", (s.household ?? []).map((p) => `${[p.first_name, p.last_name].filter(Boolean).join(" ")} (${RELATIONSHIP_LABELS[p.relationship]})`).join("; ") || null],
    ["Heard about you", s.heard_about],
    ["Referred by (as written)", s.referred_by_name],
    ["Sent", formatInstantDateTime(s.submitted_at)],
  ];

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Link href="/intake" className="flex min-h-11 items-center text-sm underline">← Intake</Link>
      {query.error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">Could not discard. Please try again.</p> : null}
      <h1 className="text-2xl font-semibold">{s.first_name} {s.last_name}</h1>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">Agreed to be contacted by phone, text or email on {formatInstantDateTime(s.consent_at)}.</p>
      <details className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Reply by text or email…</summary>
        <MessageComposer
          phone={s.phone} email={s.email}
          values={{ first_name: s.first_name, agent_name: profile.display_name, line: null, renewal_date: null }}
          templates={["intake_reply", "checkin", "blank"]} initial="intake_reply" logHref={null}
        />
      </details>
      <ReviewForm id={s.id} duplicates={duplicates} referredByName={s.referred_by_name} />
      <form action={discardIntake} className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <input type="hidden" name="id" value={s.id} />
        <button type="submit" className="min-h-11 w-full rounded-md border border-red-700 px-4 py-2 font-medium text-red-800 hover:bg-red-50 dark:border-red-400 dark:text-red-300 dark:hover:bg-red-950">
          Discard (spam or not a real request)
        </button>
      </form>
    </section>
  );
}
