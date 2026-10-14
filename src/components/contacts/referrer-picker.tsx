"use client";

import { useId, useRef, useState, useTransition } from "react";
import { searchReferrers } from "@/app/(app)/contacts/actions";

type Option = { id: string; label: string; detail: string };

/** Picks the contact who referred this one. Stores the id in a hidden input. */
export function ReferrerPicker({
  initial, excludeId, error,
}: { initial: Option | null; excludeId: string | null; error?: string }) {
  const [selected, setSelected] = useState<Option | null>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    // Small delay so we search once the user pauses typing.
    timer.current = setTimeout(() => {
      startTransition(async () => setResults(await searchReferrers(value, excludeId)));
    }, 250);
  }

  return (
    <div className="flex flex-col gap-1">
      <input type="hidden" name="referred_by_contact_id" value={selected?.id ?? ""} />
      <label htmlFor={`${id}-search`} className="text-sm font-medium">
        Referred by <span className="font-normal text-slate-500">(optional)</span>
      </label>
      {selected ? null : (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          Pick from your contacts: type 2 or more letters, then tap the person in the list.
        </p>
      )}
      {selected ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-slate-300 px-3 dark:border-slate-600">
          <span>{selected.label}</span>
          <button type="button" onClick={() => setSelected(null)} className="min-h-11 px-2 text-sm underline">
            Remove
          </button>
        </div>
      ) : (
        <>
          <input
            id={`${id}-search`}
            type="search"
            name="referred_by_search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search contacts by name, phone or email"
            autoComplete="off"
            aria-describedby={`${id}-hint ${id}-status`}
            className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <p id={`${id}-status`} aria-live="polite" className="text-xs text-slate-500">
            {pending ? "Searching…" : query.trim().length >= 2 && results.length === 0
              ? "No matching contacts. Add the referrer as a contact first, then pick them here."
              : ""}
          </p>
          {results.length > 0 ? (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setQuery("");
                      setResults([]);
                    }}
                    className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span>{r.label}</span>
                    {r.detail ? <span className="text-xs text-slate-500">{r.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
