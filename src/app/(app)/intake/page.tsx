import type { Metadata } from "next";
import Link from "next/link";
import { requireFullSession } from "@/lib/auth/require";
import { formatInstantDateTime } from "@/lib/dates";
import { listNewSubmissions } from "@/lib/intake/data";
import { INTAKE_LINE_LABELS } from "@/lib/intake/types";
import { isUuid } from "@/lib/contacts/data";

export const metadata: Metadata = { title: "Intake · Producr CRM" };

export default async function IntakeInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const rows = await listNewSubmissions(supabase);
  const accepted = query.accepted && isUuid(query.accepted) ? query.accepted : null;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      {accepted ? (
        <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">
          Added to the CRM. <Link href={`/contacts/${accepted}`} className="underline text-link">Open the contact</Link>
        </p>
      ) : null}
      {query.discarded ? (
        <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">Request discarded; its details were erased.</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Intake</h1>
        <Link href="/intake/new" className="flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Quick intake</Link>
      </div>
      <p className="text-sm text-muted">
        Quote requests from your public form. Review each one: accept it into the CRM or discard it.{" "}
        <Link href="/settings#intake" className="underline text-link">Your form link</Link>
      </p>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-muted">
          No new requests. Share your form link (Settings) by text, QR code or on a website.
        </p>
      ) : (
        <ul aria-label="New requests" className="flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/intake/${s.id}`} className="flex min-h-11 flex-col gap-1 rounded-md border border-line p-3 hover:bg-subtle bg-card">
                <span className="font-medium">{s.first_name} {s.last_name}</span>
                <span className="text-sm text-muted">
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
