import type { Metadata } from "next";
import Link from "next/link";
import { undoImport } from "@/app/(app)/import/actions";
import { ImportWizard } from "@/components/import/import-wizard";
import { aiEnabled } from "@/lib/ai/config";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { formatInstantDateTime } from "@/lib/dates";
import { listImports } from "@/lib/import/data";

export const metadata: Metadata = { title: "Import clients · Producr CRM" };

const UNDO: Record<string, { text: string; ok: boolean }> = {
  done: { text: "Import undone: everything it added was removed.", ok: true },
  changed: { text: "Can't undo: some of its records were changed or used since (edited, a task completed, an activity logged…). Nothing was removed.", ok: false },
  old: { text: "Can't undo: imports can be undone for 7 days.", ok: false },
  error: { text: "That didn't work. Please try again.", ok: false },
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const { supabase } = await requireFullSession();
  const batches = await listImports(supabase);
  const done = query.done && isUuid(query.done) ? batches.find((b) => b.id === query.done) : undefined;
  const undo = query.undo ? UNDO[query.undo] : undefined;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Import clients</h1>
      {done ? (
        <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">
          Imported {done.file_name}: {done.contacts_created} new contacts, {done.contacts_matched} existing contacts updated with policies,{" "}
          {done.policies_created} policies. <Link href="/contacts" className="underline text-link">See contacts</Link> · <Link href="/renewals" className="underline text-link">Renewals</Link>
        </p>
      ) : null}
      {undo ? (
        <p role={undo.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${undo.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{undo.text}</p>
      ) : null}

      <ImportWizard ai={aiEnabled()} />

      <section aria-labelledby="recent-heading" className="flex max-w-2xl flex-col gap-2">
        <h2 id="recent-heading" className="text-lg font-semibold">Recent imports</h2>
        {batches.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul aria-label="Recent imports" className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{b.file_name}</span>
                  <span className="block text-sm text-muted">
                    {formatInstantDateTime(b.created_at)} · {b.contacts_created} new, {b.contacts_matched} matched, {b.policies_created} policies
                    {b.status === "undone" ? " · undone" : ""}
                  </span>
                </span>
                {b.undoable ? (
                  <form action={undoImport}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="min-h-11 rounded-md border border-bad px-3 text-sm font-medium text-bad" aria-label={`Undo import of ${b.file_name}`}>Undo</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
