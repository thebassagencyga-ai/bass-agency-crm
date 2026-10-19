"use client";

import { useId, useRef, useState, useTransition } from "react";
import { searchReferrers } from "@/app/(app)/contacts/actions";

type Option = { id: string; label: string; detail: string };

/**
 * Picks one of the user's contacts (by default: the contact who referred this one).
 * Stores the id in a hidden input; the search text is submitted as `searchName` so the
 * server can refuse text that was typed but never picked.
 */
export function ReferrerPicker({
  initial, excludeId, error, name = "referred_by_contact_id", searchName = "referred_by_search", label = "Referred by", optional = true,
  hint = "Pick from your contacts: type 2 or more letters, then tap the person in the list.",
}: {
  initial: Option | null; excludeId: string | null; error?: string;
  name?: string; searchName?: string; label?: string; optional?: boolean; hint?: string;
}) {
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
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <label htmlFor={`${id}-search`} className="text-sm font-medium">
        {label} {optional ? <span className="font-normal text-muted">(optional)</span> : null}
      </label>
      {selected ? null : (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {selected ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-line-strong px-3">
          <span>{selected.label}</span>
          <button type="button" onClick={() => setSelected(null)} className="min-h-11 px-2 text-sm underline text-link">
            Remove
          </button>
        </div>
      ) : (
        <>
          <input
            id={`${id}-search`}
            type="search"
            name={searchName}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search contacts by name, phone or email"
            autoComplete="off"
            aria-describedby={`${id}-hint ${id}-status`}
            className="min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          />
          <p id={`${id}-status`} aria-live="polite" className="text-xs text-muted">
            {pending ? "Searching…" : query.trim().length >= 2 && results.length === 0
              ? "No matching contacts. Add the person as a contact first, then pick them here."
              : ""}
          </p>
          {results.length > 0 ? (
            <ul className="divide-y divide-line rounded-md border border-line bg-card">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setQuery("");
                      setResults([]);
                    }}
                    className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-subtle"
                  >
                    <span>{r.label}</span>
                    {r.detail ? <span className="text-xs text-muted">{r.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </div>
  );
}
