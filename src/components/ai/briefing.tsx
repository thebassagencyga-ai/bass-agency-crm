"use client";

import { useState, useTransition } from "react";
import { aiDailyBriefing } from "@/app/(app)/ai/actions";

/** Dashboard "Brief me" (Phase 19): an AI summary of today's work. Shown only; nothing is saved. */
export function BriefingPanel() {
  const [briefing, setBriefing] = useState<{ summary: string; priorities: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run() {
    setError(null);
    start(async () => {
      const result = await aiDailyBriefing();
      if (result.ok) setBriefing(result.value);
      else setError(result.error);
    });
  }
  return (
    <section aria-labelledby="briefing-heading" className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="briefing-heading" className="text-lg font-semibold">Daily briefing</h2>
        <button type="button" onClick={run} disabled={pending} className="min-h-11 rounded-md border border-slate-900 px-4 font-medium disabled:opacity-60 dark:border-slate-100">
          {pending ? "Thinking…" : briefing ? "Refresh" : "Brief me"}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
      {briefing ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="whitespace-pre-wrap">{briefing.summary}</p>
          {briefing.priorities.length > 0 ? (
            <ol aria-label="Priorities" className="list-decimal pl-5">
              {briefing.priorities.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          ) : null}
          <p className="text-xs text-slate-500">Written by AI from your tasks and renewals. Check the details in the CRM before acting.</p>
        </div>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          An AI summary of what to do first today. Sends task titles, due dates, clients&apos; first names and upcoming renewals; nothing else.
        </p>
      )}
    </section>
  );
}
