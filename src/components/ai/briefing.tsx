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
    <section aria-labelledby="briefing-heading" className="flex flex-col gap-2 rounded-md border border-dashed border-line-strong p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="briefing-heading" className="text-lg font-semibold">Daily briefing</h2>
        <button type="button" onClick={run} disabled={pending} className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium disabled:opacity-60">
          {pending ? "Thinking…" : briefing ? "Refresh" : "Brief me"}
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-bad">{error}</p> : null}
      {briefing ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="whitespace-pre-wrap">{briefing.summary}</p>
          {briefing.priorities.length > 0 ? (
            <ol aria-label="Priorities" className="list-decimal pl-5">
              {briefing.priorities.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
          ) : null}
          <p className="text-xs text-muted">Written by AI from your tasks and renewals. Check the details in the CRM before acting.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          An AI summary of what to do first today. Sends task titles, due dates, clients&apos; first names and upcoming renewals; nothing else.
        </p>
      )}
    </section>
  );
}
