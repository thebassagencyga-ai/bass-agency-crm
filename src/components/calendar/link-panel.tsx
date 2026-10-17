"use client";

import { useActionState } from "react";
import { createCalendarLink, turnOffCalendarLink, type CalendarLinkState } from "@/app/(app)/settings/calendar-actions";
import { CopyButton } from "@/components/intake/copy-button";

const BUTTON = "min-h-11 rounded-md border border-slate-900 px-4 font-medium disabled:opacity-60 dark:border-slate-100";
const PRIMARY = "flex min-h-11 items-center justify-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900";

/**
 * Settings → Calendar (Phase 18, ADR-034). The link is shown once, right after it is created;
 * only its fingerprint is kept, so to see it again the owner replaces it.
 */
export function CalendarLinkPanel({ active, baseUrl, notice }: {
  active: { since: string; lastUsed: string | null } | null; baseUrl: string; notice?: string;
}) {
  const [state, create, pending] = useActionState<CalendarLinkState>(createCalendarLink, {});
  const https = state.token ? `${baseUrl}/calendar/${state.token}.ics` : null;
  const webcal = https?.replace(/^https?:/, "webcal:");

  return (
    <section id="calendar" aria-labelledby="calendar-heading" className="flex flex-col gap-3">
      <h2 id="calendar-heading" className="text-lg font-semibold">Calendar</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        See your open tasks in your phone&apos;s calendar, each on its due date as &quot;task — client name&quot;. Done tasks drop
        off when the calendar next checks (about every hour; Google Calendar can take up to a day).
      </p>
      {notice === "off" ? <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">The calendar link is off. Your calendar will stop showing CRM tasks.</p> : null}
      {notice === "error" || state.error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{state.error ?? "That didn't work. Please try again."}</p> : null}

      {https && webcal ? (
        <div role="status" className="flex flex-col gap-3 rounded-md border border-green-600 p-3">
          <p className="font-medium">Your calendar link is ready. Any earlier link has stopped working.</p>
          <a href={webcal} className={PRIMARY}>Add to iPhone Calendar</a>
          <label htmlFor="calendar-url" className="text-sm font-medium">Link (for Google Calendar: Other calendars → + → From URL)</label>
          <input id="calendar-url" readOnly value={https} onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
          <CopyButton text={https} />
          <p className="text-xs text-amber-900 dark:text-amber-100">
            Shown only now: the CRM keeps just a fingerprint of it. Anyone with this link can see your open tasks and clients&apos;
            names, so don&apos;t share it. If it gets out, replace it.
          </p>
        </div>
      ) : active ? (
        <p className="text-sm">
          On since {active.since}.{" "}
          {active.lastUsed ? `Last checked by your calendar ${active.lastUsed}.` : "Not used by a calendar yet."}
        </p>
      ) : (
        <p className="text-sm">Off.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={create}>
          <button type="submit" disabled={pending} className={active || https ? BUTTON : PRIMARY}>
            {pending ? "Creating…" : active || https ? "Replace link" : "Create calendar link"}
          </button>
        </form>
        {active || https ? (
          <form action={turnOffCalendarLink}>
            <button type="submit" className="min-h-11 rounded-md border border-red-700 px-4 font-medium text-red-800 dark:border-red-400 dark:text-red-300">Turn off</button>
          </form>
        ) : null}
      </div>
      {active && !https ? <p className="text-xs text-slate-500">Lost the link? Replace it, then subscribe again with the new one (remove the old calendar on your phone).</p> : null}
    </section>
  );
}
