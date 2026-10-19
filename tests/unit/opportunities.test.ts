import { describe, expect, it } from "vitest";
import {
  canToggleNurture,
  formatMoney,
  newOpportunitySchema,
  opportunityDetailsSchema,
  parseMoney,
  parseOpportunityListParams,
  planStageChange,
  stageChangeSchema,
} from "@/lib/opportunities";

const UUID = "3f1c8e0a-6b2d-4c4e-9a1f-2b3c4d5e6f70";
const UUID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("parseMoney / formatMoney", () => {
  it.each([
    ["1250", 1250],
    ["$1,250.50", 1250.5],
    [" 1,000 ", 1000],
    ["0", 0],
    ["", null],
    ["$", null],
  ])("parses %j", (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });

  it.each(["abc", "12.345", "-5", "1.2.3"])("rejects %j", (raw) => {
    expect(parseMoney(raw)).toBeNaN();
  });

  it("formats numbers and Postgres numeric strings", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney(1234.5, { whole: true })).toBe("$1,235");
    expect(formatMoney(null)).toBe("");
    expect(formatMoney("not a number")).toBe("");
  });
});

describe("opportunity details validation", () => {
  const ok = { description: "", quoted_carrier: "", quote_sent_on: "", estimated_annual_premium: "", next_action: "", effective_date: "", renewal_date: "" };

  it("accepts an empty form and turns blanks into nulls", () => {
    const r = opportunityDetailsSchema.safeParse(ok);
    expect(r.success && r.data).toEqual({
      description: null, quoted_carrier: null, quote_sent_on: null, estimated_annual_premium: null,
      next_action: null, effective_date: null, renewal_date: null, policy_term_months: 12,
    });
  });

  it("parses a formatted premium", () => {
    const r = opportunityDetailsSchema.safeParse({ ...ok, estimated_annual_premium: "$2,400" });
    expect(r.success && r.data.estimated_annual_premium).toBe(2400);
  });

  it.each([
    ["unreadable premium", { estimated_annual_premium: "lots" }, "estimated_annual_premium"],
    ["negative premium", { estimated_annual_premium: "-1" }, "estimated_annual_premium"],
    ["invalid date", { effective_date: "2026-02-30" }, "effective_date"],
    ["quote date in the future", { quote_sent_on: "2999-01-01" }, "quote_sent_on"],
    ["renewal not after effective", { effective_date: "2026-11-01", renewal_date: "2026-11-01" }, "renewal_date"],
    ["carrier too long", { quoted_carrier: "x".repeat(101) }, "quoted_carrier"],
  ])("rejects %s", (_label, override, field) => {
    const r = opportunityDetailsSchema.safeParse({ ...ok, ...override });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it("new opportunity needs a contact, product line and stage", () => {
    const r = newOpportunitySchema.safeParse({ ...ok, contact_id: "nope", product_line: "boat", stage_id: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0]).sort()).toEqual(["contact_id", "product_line", "stage_id"]);
    expect(newOpportunitySchema.safeParse({ ...ok, contact_id: UUID, product_line: "life", stage_id: UUID2 }).success).toBe(true);
  });

  it("stage change accepts a loss reason only from the list", () => {
    expect(stageChangeSchema.safeParse({ id: UUID, stage_id: UUID2, loss_reason: "price" }).success).toBe(true);
    expect(stageChangeSchema.safeParse({ id: UUID, stage_id: UUID2, loss_reason: "bribery" }).success).toBe(false);
  });
});

describe("planStageChange", () => {
  const current = { pipelineId: "p-auto", outcome: "open" as const, stageId: "s-new" };
  const active = { id: "s-quoted", pipelineId: "p-auto", kind: "active" as const };
  const won = { id: "s-bound", pipelineId: "p-auto", kind: "won" as const };
  const lost = { id: "s-lost", pipelineId: "p-auto", kind: "lost" as const };

  it("moves between active stages and stays open", () => {
    expect(planStageChange({ current, target: active })).toEqual({
      ok: true, reopened: false,
      update: { stage_id: "s-quoted", outcome: "open", loss_reason: null, loss_reason_detail: null },
    });
  });

  it("keeps nurture when moving between active stages", () => {
    const r = planStageChange({ current: { ...current, outcome: "nurture" }, target: active });
    expect(r.ok && r.update.outcome).toBe("nurture");
  });

  it("wins at the won stage", () => {
    const r = planStageChange({ current, target: won });
    expect(r.ok && r.update.outcome).toBe("won");
  });

  it("requires a loss reason for Lost", () => {
    expect(planStageChange({ current, target: lost })).toMatchObject({ ok: false, field: "loss_reason" });
    const r = planStageChange({ current, target: lost, lossReason: "price", lossReasonDetail: "Fictional" });
    expect(r.ok && r.update).toEqual({ stage_id: "s-lost", outcome: "lost", loss_reason: "price", loss_reason_detail: "Fictional" });
  });

  it("moves to another pipeline's working stage, but wins or loses only in its own (Phase 25)", () => {
    expect(planStageChange({ current, target: { ...active, pipelineId: "p-pnc" } })).toMatchObject({ ok: true, update: { outcome: "open" } });
    expect(planStageChange({ current, target: { ...won, pipelineId: "p-pnc" } })).toMatchObject({ ok: false, field: "stage_id" });
    expect(planStageChange({ current, target: { ...lost, pipelineId: "p-pnc" }, lossReason: "price" })).toMatchObject({ ok: false, field: "stage_id" });
  });

  it("refuses a removed stage", () => {
    expect(planStageChange({ current, target: { ...active, archived: true } })).toMatchObject({ ok: false, field: "stage_id" });
  });

  it("refuses moving to the stage it is already at", () => {
    expect(planStageChange({ current: { ...current, stageId: "s-quoted" }, target: active })).toMatchObject({ ok: false });
  });

  it("reopens a won or lost opportunity at an active stage", () => {
    for (const outcome of ["won", "lost"] as const) {
      const r = planStageChange({ current: { ...current, outcome, stageId: "s-bound" }, target: active });
      expect(r).toMatchObject({ ok: true, reopened: true, update: { outcome: "open", loss_reason: null } });
    }
  });

  it("nurture is available only on active stages that are being worked", () => {
    expect(canToggleNurture("open", "active")).toBe(true);
    expect(canToggleNurture("nurture", "active")).toBe(true);
    expect(canToggleNurture("won", "won")).toBe(false);
    expect(canToggleNurture("lost", "lost")).toBe(false);
  });
});

describe("parseOpportunityListParams", () => {
  it("defaults to the board; the page picks the pipeline (Phase 25)", () => {
    expect(parseOpportunityListParams({})).toMatchObject({ view: "board", pipeline: null, line: null, sort: "updated", page: 1 });
  });

  it("reads a pipeline id and an old ?line= link; anything else is ignored", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(parseOpportunityListParams({ pipeline: id.toUpperCase() })).toMatchObject({ pipeline: id });
    expect(parseOpportunityListParams({ pipeline: "drop table", line: "home" })).toMatchObject({ pipeline: null, line: "home" });
  });

  it("table may show all product lines; bad values fall back", () => {
    expect(parseOpportunityListParams({ view: "table", line: "boat", outcome: "maybe", sort: "x", page: "-3" })).toMatchObject({
      view: "table", line: null, outcome: null, sort: "updated", page: 1,
    });
    expect(parseOpportunityListParams({ view: "table", line: "life", outcome: "won", sort: "premium", page: "2", q: "  ann " })).toMatchObject({
      line: "life", outcome: "won", sort: "premium", page: 2, q: "ann",
    });
  });
});
