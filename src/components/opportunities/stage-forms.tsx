"use client";

import { useState } from "react";
import { changeStage } from "@/app/(app)/opportunities/actions";
import { FormAlert, SubmitButton, useActionForm } from "@/components/form";
import { LOSS_REASONS, LOSS_REASON_LABELS, type Pipeline, type Stage } from "@/lib/opportunities/types";
import { suggestedQuoteDate } from "@/lib/opportunities/quote-date";
import type { OpportunityOutcome } from "@/lib/pipelines";

const SELECT =
  "min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-card px-3 py-2 text-base text-fg";

/**
 * Move to another stage of the same pipeline; for a won or lost opportunity this reopens it.
 * Phase 25: another pipeline's working stages are offered too.
 */
export function MoveStageForm({ id, stages, otherPipelines = [], currentStageId, outcome, quoteSentOn, today }: {
  id: string; stages: Stage[]; otherPipelines?: Pipeline[]; currentStageId: string; outcome: OpportunityOutcome; quoteSentOn: string | null; today: string;
}) {
  const { state, formAction, pending, onSubmit } = useActionForm(changeStage);
  const closed = outcome === "won" || outcome === "lost";
  // Closed: reopen at any active stage. Open: any other active stage, or the won stage.
  const choices = stages.filter((s) => s.kind !== "lost" && s.id !== currentStageId && (!closed || s.kind === "active"));
  const elsewhere = otherPipelines.map((p) => ({ ...p, stages: p.stages.filter((s) => s.kind === "active") })).filter((p) => p.stages.length > 0);
  const all = [...choices, ...elsewhere.flatMap((p) => p.stages)];
  const [selected, setSelected] = useState(state.values?.stage_id ?? choices[0]?.id ?? all[0]?.id ?? "");
  // A quote stage asks for the quote date (Phase 23): today unless already recorded this round.
  const quoteStage = all.find((s) => s.id === selected)?.is_quote_stage ?? false;
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-2">
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <label htmlFor="move-stage" className="text-sm font-medium">{closed ? "Reopen at stage" : "Move to stage"}</label>
      <select
        id="move-stage" name="stage_id" value={selected} onChange={(e) => setSelected(e.target.value)}
        aria-invalid={err.stage_id ? true : undefined} className={SELECT}
      >
        {choices.map((s) => <option key={s.id} value={s.id}>{s.kind === "won" ? `${s.name} (won)` : s.name}</option>)}
        {elsewhere.map((p) => (
          <optgroup key={p.id} label={`Move to ${p.name}`}>
            {p.stages.map((s) => <option key={s.id} value={s.id}>{p.name}: {s.name}</option>)}
          </optgroup>
        ))}
      </select>
      {err.stage_id ? <p className="text-sm text-bad">{err.stage_id}</p> : null}
      {quoteStage ? (
        <div className="flex flex-col gap-1 sm:w-64">
          <label htmlFor="move-quote-date" className="text-sm font-medium">Quote sent on</label>
          <input
            id="move-quote-date" name="quote_sent_on" type="date" max={today}
            defaultValue={state.values?.quote_sent_on ?? suggestedQuoteDate({ existing: quoteSentOn, reopening: closed, today })}
            aria-invalid={err.quote_sent_on ? true : undefined} aria-describedby="move-quote-date-hint"
            className={`${SELECT} appearance-none [&::-webkit-date-and-time-value]:text-left`}
          />
          <p id="move-quote-date-hint" className="text-xs text-muted">The quote follow-up task is scheduled from this date.</p>
          {err.quote_sent_on ? <p className="text-sm text-bad">{err.quote_sent_on}</p> : null}
        </div>
      ) : null}
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>{closed ? "Reopen" : "Move"}</SubmitButton>
      </div>
      {closed ? <p className="text-xs text-muted">Reopening keeps the history and starts a new follow-up round.</p> : null}
    </form>
  );
}

/** Mark as lost: always asks for a reason. */
export function MarkLostForm({ id, lostStageId }: { id: string; lostStageId: string }) {
  const { state, formAction, pending, onSubmit } = useActionForm(changeStage);
  const err = state.fieldErrors ?? {};
  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormAlert state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="stage_id" value={lostStageId} />
      <div className="flex flex-col gap-1">
        <label htmlFor="loss_reason" className="text-sm font-medium">Why was it lost?</label>
        <select id="loss_reason" name="loss_reason" defaultValue={state.values?.loss_reason ?? ""} aria-invalid={err.loss_reason ? true : undefined} className={SELECT}>
          <option value="">Choose a reason</option>
          {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>)}
        </select>
        {err.loss_reason ? <p className="text-sm text-bad">{err.loss_reason}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="loss_reason_detail" className="text-sm font-medium">Details <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="loss_reason_detail" name="loss_reason_detail" rows={2} maxLength={1000} defaultValue={state.values?.loss_reason_detail} className={`${SELECT} min-h-16`} />
        {err.loss_reason_detail ? <p className="text-sm text-bad">{err.loss_reason_detail}</p> : null}
      </div>
      <div className="sm:w-48">
        <SubmitButton pendingText="Saving…" pending={pending}>Mark as lost</SubmitButton>
      </div>
    </form>
  );
}
