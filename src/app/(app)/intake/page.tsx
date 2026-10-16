import type { Metadata } from "next";
import Link from "next/link";
import { requireFullSession } from "@/lib/auth/require";
import { formatInstantDateTime } from "@/lib/dates";
import { listNewSubmissions } from "@/lib/intake/data";
import { INTAKE_LINE_LABELS } from "@/lib/intake/types";
import { isUuid } from "@/lib/contacts/data";

export const metadata: Metadata = { title: "Intake · The Bass Agency CRM" };

export default async function IntakeInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const rows = await listNewSubmissions(supabase);
  const accepted = query.accepted && isUuid(query.accepted) ? query.accepted : null;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      {accepted ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Added to the CRM. <Link href={`/contacts/${accepted}`} className="underline">Open the contact</Link>
        </p>
      ) : null}
      {query.discarded ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">Request discarded; its details were erased.</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Intake</h1>
        <Link href="/intake/new" className="flex min-h-11 items-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900">Quick intake</Link>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Quote requests from your public form. Review each one: accept it into the CRM or discard it.{" "}
        <Link href="/settings#intake" className="underline">Your form link</Link>
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No new requests. Share your form link (Settings) by text, QR code or on a website.
        </p>
      ) : (
        <ul aria-label="New requests" className="flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/intake/${s.id}`} className="flex min-h-11 flex-col gap-1 rounded-md border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900">
                <span className="font-medium">{s.first_name} {s.last_name}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {s.lines.map((l) => INTAKE_LINE_LABELS[l]).join(", ")} · {formatInstantDateTime(s.submitted_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
