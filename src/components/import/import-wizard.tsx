"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { aiSuggestImport } from "@/app/(app)/ai/actions";
import { findImportMatches, runImport } from "@/app/(app)/import/actions";
import { SelectField } from "@/components/form";
import { buildImport, distinctLineValues, lineKey, MAX_IMPORT_ROWS, type ImportClient, type ImportIssue, type LineChoices } from "@/lib/import/build";
import { parseCsv } from "@/lib/import/csv";
import { guessMapping, IMPORT_FIELDS, type ImportField, type Mapping } from "@/lib/import/fields";
import { PRODUCT_LINES, PRODUCT_LINE_NAMES } from "@/lib/pipelines";

const MAX_BYTES = 2 * 1024 * 1024;
const BUTTON = "min-h-11 rounded-md bg-brand px-4 py-2 font-medium text-on-brand disabled:opacity-60 hover:bg-brand-hover";
const SECONDARY = "min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 py-2 font-medium";
const lineOptions = [...PRODUCT_LINES.map((l) => ({ value: l, label: PRODUCT_LINE_NAMES[l] })), { value: "skip", label: "Skip (contact only, no policy)" }];

type Preview = { clients: ImportClient[]; issues: ImportIssue[]; tooMany: boolean; matches: Record<string, { id: string; label: string }> };

/** Import a client list: choose a CSV → match columns → check → import (Phase 15). */
export function ImportWizard({ ai = false }: { ai?: boolean }) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [lineChoices, setLineChoices] = useState<LineChoices>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [useMatch, setUseMatch] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // AI suggestions (Phase 19) change the selects' starting values; bumping this remounts them.
  const [aiRound, setAiRound] = useState(0);
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const lineValues = useMemo(() => distinctLineValues(rows, mapping), [rows, mapping]);
  const unmatchedLines = lineValues.filter((v) => !(lineKey(v.value) in lineChoices) && v.guess === null);
  const columnOptions = headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));

  async function onFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("The file is larger than 2 MB. Split it into smaller files.");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("The file has no rows under the heading. Is it a CSV export of your report?");
    if (parsed.length - 1 > MAX_IMPORT_ROWS) return setError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    const head = parsed[0]!;
    setFileName(file.name.slice(0, 200));
    setHeaders(head);
    setRows(parsed.slice(1));
    setMapping(guessMapping(head));
    setLineChoices({});
  }

  function suggestWithAi() {
    setAiNote(null);
    startTransition(async () => {
      const result = await aiSuggestImport(headers, lineValues.map((v) => v.value));
      if (!result.ok) {
        setAiNote({ ok: false, text: result.error });
        return;
      }
      setPreview(null);
      setMapping(result.value.mapping);
      setLineChoices(Object.fromEntries(Object.entries(result.value.lines).map(([value, line]) => [lineKey(value), line as LineChoices[string]])));
      setAiRound((r) => r + 1);
      setAiNote({ ok: true, text: "Suggestions filled in. Check each column and policy type before checking the file." });
    });
  }

  function setField(field: ImportField, value: string) {
    setPreview(null);
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  function check() {
    setError(null);
    startTransition(async () => {
      const built = buildImport(rows, mapping, lineChoices);
      try {
        const matches = built.clients.length > 0 ? await findImportMatches(built.clients.map((c) => ({ key: c.key, contact: c.contact }))) : {};
        setPreview({ ...built, matches });
        setUseMatch(Object.fromEntries(Object.keys(matches).map((k) => [k, true])));
      } catch {
        setError("Could not check the file. Please try again.");
      }
    });
  }

  function doImport() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const result = await runImport({
        file_name: fileName || "import.csv",
        clients: preview.clients.map((c) => ({
          existing_contact_id: useMatch[c.key] ? (preview.matches[c.key]?.id ?? null) : null,
          contact: c.contact,
          policies: c.policies,
        })),
      });
      if (result.ok) router.push(`/import?done=${result.batchId}`);
      else setError(result.error);
    });
  }

  const nameMapped = mapping.full_name !== undefined || mapping.first_name !== undefined || mapping.last_name !== undefined || mapping.business_name !== undefined;
  const skipped = preview?.issues.filter((i) => i.skipped) ?? [];
  const warnings = preview?.issues.filter((i) => !i.skipped) ?? [];
  const matchedCount = preview ? Object.keys(preview.matches).filter((k) => useMatch[k]).length : 0;
  const policyCount = preview?.clients.reduce((n, c) => n + c.policies.length, 0) ?? 0;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {error ? <p role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad">{error}</p> : null}

      <section aria-labelledby="step1" className="flex flex-col gap-2">
        <h2 id="step1" className="text-lg font-semibold">1. Choose the file</h2>
        <p className="text-sm text-muted">A CSV export of your client or policy report (save Excel files as CSV). One row per policy or per client; up to 1,000 clients.</p>
        <label htmlFor="import-file" className="text-sm font-medium">CSV file</label>
        <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])}
          className="min-h-11 w-full rounded-md border border-line-strong p-2 text-base" />
        {headers.length > 0 ? <p role="status" className="text-sm">{fileName}: {rows.length.toLocaleString()} rows, {headers.length} columns.</p> : null}
      </section>

      {headers.length > 0 ? (
        <section aria-labelledby="step2" className="flex flex-col gap-3">
          <h2 id="step2" className="text-lg font-semibold">2. Match the columns</h2>
          <p className="text-sm text-muted">Guessed from the headings. Change any that are wrong; leave a field as &quot;Not in file&quot; if the report doesn&apos;t have it.</p>
          {ai ? (
            <div className="flex flex-col gap-1">
              <button type="button" className={SECONDARY} disabled={pending} onClick={suggestWithAi}>{pending ? "Asking…" : "Suggest matches with AI"}</button>
              <p className="text-xs text-muted">Sends only the column headings and policy-type names, never client rows.</p>
              {aiNote ? <p role={aiNote.ok ? "status" : "alert"} className={`text-sm ${aiNote.ok ? "" : "text-bad"}`}>{aiNote.text}</p> : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <SelectField key={`${fileName}-${aiRound}-${f.key}`} id={`map-${f.key}`} name={`map-${f.key}`} label={f.label} options={columnOptions}
                defaultValue={mapping[f.key] === undefined ? "" : String(mapping[f.key])} placeholder="Not in file"
                onChange={(v) => setField(f.key, v)} />
            ))}
          </div>
          {!nameMapped ? <p role="alert" className="text-sm text-bad">Match at least one name column.</p> : null}

          {lineValues.length > 0 ? (
            <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3 bg-card">
              <legend className="px-1 text-sm font-medium">Policy types in the file</legend>
              {lineValues.map((v) => (
                <SelectField key={`${aiRound}-${v.value}`} id={`line-${lineKey(v.value)}`} name={`line-${lineKey(v.value)}`}
                  label={`"${v.value}" (${v.count} row${v.count === 1 ? "" : "s"})`} options={lineOptions}
                  defaultValue={lineChoices[lineKey(v.value)] ?? v.guess ?? ""} placeholder="Choose a line" required
                  onChange={(choice) => { setPreview(null); setLineChoices((c) => ({ ...c, [lineKey(v.value)]: choice as LineChoices[string] })); }} />
              ))}
            </fieldset>
          ) : null}
          <button type="button" className={BUTTON} disabled={pending || !nameMapped || unmatchedLines.length > 0} onClick={check}>
            {pending && !preview ? "Checking…" : "Check the file"}
          </button>
          {unmatchedLines.length > 0 ? <p className="text-sm text-muted">Choose a line for every policy type first.</p> : null}
        </section>
      ) : null}

      {preview ? (
        <section aria-labelledby="step3" className="flex flex-col gap-3">
          <h2 id="step3" className="text-lg font-semibold">3. Check and import</h2>
          <ul aria-label="Import summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Clients", preview.clients.length], ["Already in CRM", matchedCount], ["Policies", policyCount], ["Rows left out", skipped.length],
            ].map(([label, n]) => (
              <li key={label} className="flex flex-col rounded-md border border-line p-3 bg-card">
                <span className="text-2xl font-bold tracking-tight">{Number(n).toLocaleString()}</span><span className="text-sm">{label}</span>
              </li>
            ))}
          </ul>
          {preview.tooMany ? <p role="alert" className="text-sm text-caution">Only the first 1,000 clients will be imported. Import the rest from a second file.</p> : null}

          {Object.keys(preview.matches).length > 0 ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Already in the CRM (same email or phone)</legend>
              <p className="text-xs text-muted">Ticked: the policies are added to your existing contact, which is not changed. Unticked: a new contact is created.</p>
              {preview.clients.filter((c) => preview.matches[c.key]).slice(0, 100).map((c) => (
                <label key={c.key} className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={useMatch[c.key] ?? false} onChange={(e) => setUseMatch((u) => ({ ...u, [c.key]: e.target.checked }))} className="h-5 w-5" />
                  <span>Row {c.rows.join(", ")}: add to {preview.matches[c.key]!.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {skipped.length + warnings.length > 0 ? (
            <details className="rounded-md border border-line p-3 bg-card" open={skipped.length > 0}>
              <summary className="min-h-11 cursor-pointer py-2 font-medium">Problems ({skipped.length} left out, {warnings.length} imported with a field left empty)</summary>
              <ul aria-label="Import problems" className="flex flex-col gap-1 text-sm">
                {[...skipped, ...warnings].slice(0, 200).map((i, n) => (
                  <li key={n}><span className="font-medium">Row {i.row}{i.skipped ? " (left out)" : ""}:</span> {i.message}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <p className="text-sm text-muted">
            Policies are added as current (won) policies; renewal dates already passed are moved to the next renewal. You can undo the
            import for 7 days, as long as you haven&apos;t changed any of its records.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={BUTTON} disabled={pending || preview.clients.length === 0} onClick={doImport}>
              {pending ? "Importing…" : `Import ${preview.clients.length.toLocaleString()} client${preview.clients.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" className={SECONDARY} disabled={pending} onClick={() => setPreview(null)}>Change the matches</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
