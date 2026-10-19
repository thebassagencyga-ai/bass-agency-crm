// Stage and outcome changes (ADR-006). Pure functions: the server action uses them to build
// the update, and the database constraints enforce the same rules independently.
import type { OpportunityOutcome, StageKind } from "@/lib/pipelines";
import type { LossReason } from "./types";

export interface StageChangeInput {
  current: { pipelineId: string; outcome: OpportunityOutcome; stageId: string };
  target: { id: string; pipelineId: string; kind: StageKind; archived?: boolean };
  lossReason?: LossReason | null;
  lossReasonDetail?: string | null;
}

export type StageChangeResult =
  | {
      ok: true;
      update: { stage_id: string; outcome: OpportunityOutcome; loss_reason: LossReason | null; loss_reason_detail: string | null };
      reopened: boolean;
    }
  | { ok: false; field: "stage_id" | "loss_reason"; message: string };

export const isClosed = (outcome: OpportunityOutcome) => outcome === "won" || outcome === "lost";

/**
 * Moving to the won stage wins the opportunity; to Lost needs a reason; to an active stage
 * keeps it open (or in nurture). Moving a closed opportunity to an active stage reopens it.
 * Another pipeline's working stages are allowed too (Phase 25).
 */
export function planStageChange(input: StageChangeInput): StageChangeResult {
  const { current, target } = input;
  if (target.archived) {
    return { ok: false, field: "stage_id", message: "That stage has been removed. Choose another." };
  }
  // Phase 25: a deal can move to another pipeline, into one of its working stages; it is won
  // or lost in the pipeline it is in.
  if (target.pipelineId !== current.pipelineId && target.kind !== "active") {
    return { ok: false, field: "stage_id", message: "Move it into a working stage of the other pipeline first." };
  }
  if (target.id === current.stageId && target.kind !== "lost") {
    return { ok: false, field: "stage_id", message: "The opportunity is already at that stage." };
  }
  if (target.kind === "lost") {
    if (!input.lossReason) return { ok: false, field: "loss_reason", message: "Choose why it was lost." };
    return {
      ok: true,
      update: { stage_id: target.id, outcome: "lost", loss_reason: input.lossReason, loss_reason_detail: input.lossReasonDetail ?? null },
      reopened: false,
    };
  }
  if (target.kind === "won") {
    return { ok: true, update: { stage_id: target.id, outcome: "won", loss_reason: null, loss_reason_detail: null }, reopened: false };
  }
  const outcome: OpportunityOutcome = current.outcome === "nurture" ? "nurture" : "open";
  return {
    ok: true,
    update: { stage_id: target.id, outcome, loss_reason: null, loss_reason_detail: null },
    reopened: isClosed(current.outcome),
  };
}

/** Nurture applies only to opportunities still being worked (active stage). */
export function canToggleNurture(outcome: OpportunityOutcome, stageKind: StageKind): boolean {
  return stageKind === "active" && (outcome === "open" || outcome === "nurture");
}
