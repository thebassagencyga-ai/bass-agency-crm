"use client";

import { useActionState } from "react";
import { changeStage } from "@/app/(app)/opportunities/actions";
import { FormAlert, SubmitButton, type FormState } from "@/components/form";
import { LOSS_REASONS, LOSS_REASON_LABELS, type Stage } from "@/lib/opportunities/types";
import type { OpportunityOutcome } from "@/lib/pipelines";

const SELECT =
  "min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

/** Move to another stage of the same pipeline; for a won or lost opportunity this reopens it. */
export function MoveStageForm({ id, stages, currentStageId, outcome }: { id: string; stages: Stage[]; currentStageId: string; outcome: OpportunityOutcome }) {
  const [state, action] = useActionState<FormState, FormData>(changeStage, {});
  const closed = outcome === "won" || outcome === "lost";
  // Closed: reopen at any active stage. Open: any other active stage, or the won stage.
  const choices = stages.filter((s) => s.kind !== "lost" && s.id !== currentStageId && (!closed || s.kind === "active"));
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <label htmlFor="move-stage" className="text-sm font-medium">{closed ? "Reopen at stage" : "Move to stage"}</label>
      <select id="move-stage" name="stage_id" defaultValue={state.values?.stage_id ?? choices[0]?.id} aria-invalid={err.stage_id ? true : undefined} className={SELECT}>
        {choices.map((s) => <option key={s.id} value={s.id}>{s.kind === "won" ? `${s.name} (won)` : s.name}</option>)}
      </select>
      {err.stage_id ? <p className="text-sm text-red-700 dark:text-red-400">{err.stage_id}</p> : null}
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…">{closed ? "Reopen" : "Move"}</SubmitButton>
      </div>
      {closed ? <p className="text-xs text-slate-500">Reopening keeps the history and starts a new follow-up round.</p> : null}
    </form>
  );
}

/** Mark as lost: always asks for a reason. */
export function MarkLostForm({ id, lostStageId }: { id: string; lostStageId: string }) {
  const [state, action] = useActionState<FormState, FormData>(changeStage, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="stage_id" value={lostStageId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="loss_reason" className="text-sm font-medium">Why was it lost?</label>
        <select id="loss_reason" name="loss_reason" defaultValue={state.values?.loss_reason ?? ""} aria-invalid={err.loss_reason ? true : undefined} className={SELECT}>
          <option value="">Choose a reason</option>
          {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>)}
        </select>
        {err.loss_reason ? <p className="text-sm text-red-700 dark:text-red-400">{err.loss_reason}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="loss_reason_detail" className="text-sm font-medium">Details <span className="font-normal text-slate-500">(optional)</span></label>
        <textarea id="loss_reason_detail" name="loss_reason_detail" rows={2} maxLength={1000} defaultValue={state.values?.loss_reason_detail} className={`${SELECT} min-h-16`} />
        {err.loss_reason_detail ? <p className="text-sm text-red-700 dark:text-red-400">{err.loss_reason_detail}</p> : null}
      </div>
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…">Mark as lost</SubmitButton>
      </div>
    </form>
  );
}
