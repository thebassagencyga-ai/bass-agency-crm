"use client";

import { useState, useTransition } from "react";
import { aiNotesToActivity } from "@/app/(app)/ai/actions";
import { LogActivityForm } from "@/components/tasks/log-activity-form";

type Props = Parameters<typeof LogActivityForm>[0];

/**
 * "Log activity" with an AI helper (Phase 19): paste rough notes, the AI fills in the form, the
 * user checks it and presses Log activity. Nothing is saved until then.
 */
export function LogActivityWithAi(props: Props) {
  const [notes, setNotes] = useState("");
  const [defaults, setDefaults] = useState(props.defaults);
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function fill() {
    setMessage(null);
    start(async () => {
      const result = await aiNotesToActivity(notes);
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      const s = result.value;
      setDefaults({
        ...props.defaults, activity_type: s.activity_type, notes: s.notes,
        outcome: s.outcome ?? undefined, requested_follow_up_on: s.requested_follow_up_on ?? undefined,
      });
      setRound((r) => r + 1);
      setMessage({ ok: true, text: "Filled in from your notes. Check every field, then press Log activity." });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <details className="rounded-md border border-dashed border-line-strong p-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Fill in from my notes (AI)…</summary>
        <div className="flex flex-col gap-2">
          <label htmlFor="ai-notes" className="text-sm font-medium">Rough notes</label>
          <textarea
            id="ai-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={3000}
            placeholder="e.g. called, left vm. she called back, wants auto quote compared, call her back thurs after 3"
            className="min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base"
          />
          <button
            type="button" onClick={fill} disabled={pending || notes.trim().length < 10}
            className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium disabled:opacity-60"
          >
            {pending ? "Reading…" : "Fill in the form"}
          </button>
          <p className="text-xs text-muted">
            Sends only these notes and today&apos;s date to the AI. Notes that look like an SSN, card, bank, license or health detail are refused.
          </p>
        </div>
      </details>
      {message ? <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-bad"}`}>{message.text}</p> : null}
      <LogActivityForm key={round} {...props} defaults={defaults} />
    </div>
  );
}
