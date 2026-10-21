import { describe, expect, it } from "vitest";
import { NEW_PIPELINE_STAGES, parsePipelineForm, toSaveArgs } from "@/lib/opportunities/pipeline-editor";

// Phase 25 (ADR-043): Settings → Pipelines validation mirrors the database rules.
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const form = (stages: unknown, extra: Record<string, unknown> = {}) =>
  parsePipelineForm({ id: "", name: "P&C", lines: ["auto", "home"], stages: JSON.stringify(stages), ...extra });
const errorOf = (r: ReturnType<typeof parsePipelineForm>) => (r.success ? null : r.error.issues[0]!.message);

describe("parsePipelineForm", () => {
  it("accepts the starting stages for a new pipeline", () => {
    const r = form(NEW_PIPELINE_STAGES);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ id: null, name: "P&C", lines: ["auto", "home"] });
  });

  it("tidies names and keeps existing stage ids", () => {
    const r = form([{ id: ID, name: "  New   Lead ", kind: "active" }, { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], { name: "  Personal  Lines " });
    expect(r.data?.name).toBe("Personal Lines");
    expect(r.data?.stages[0]).toEqual({ id: ID, name: "New Lead", kind: "active" });
  });

  it.each([
    ["too few stages", [{ name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], "A pipeline has 3 to 12 stages"],
    ["too many stages", [...Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, kind: "active" })), { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], "A pipeline has 3 to 12 stages"],
    ["no working stage", [{ name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }, { name: "Lost 2", kind: "lost" }], "Add at least one working stage"],
    ["Won not before Lost at the end", [{ name: "A", kind: "active" }, { name: "Lost", kind: "lost" }, { name: "Bound", kind: "won" }], "Keep exactly one Won stage and one Lost stage"],
    ["two quote stages", [{ name: "A", kind: "active", quote: true }, { name: "B", kind: "active", quote: true }, { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], "at most one stage as the quote stage"],
    ["the same name twice", [{ name: "Quoted", kind: "active" }, { name: "quoted", kind: "active" }, { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], "a different name"],
    ["a blank stage name", [{ name: "  ", kind: "active" }, { name: "Bound", kind: "won" }, { name: "Lost", kind: "lost" }], "Enter a name for the stage"],
  ])("refuses %s", (_label, stages, message) => {
    expect(errorOf(form(stages))).toContain(message);
  });

  it("refuses a blank or long pipeline name, an unknown line and broken stage data", () => {
    expect(errorOf(form(NEW_PIPELINE_STAGES, { name: " " }))).toContain("Enter a name for the pipeline");
    expect(errorOf(form(NEW_PIPELINE_STAGES, { name: "x".repeat(41) }))).toContain("40 characters");
    expect(form(NEW_PIPELINE_STAGES, { lines: ["aircraft"] }).success).toBe(false);
    expect(parsePipelineForm({ id: "", name: "P&C", lines: [], stages: "{not json" }).success).toBe(false);
  });
});

describe("toSaveArgs", () => {
  it("sends stages in order; only a working stage can be the quote stage", () => {
    const r = form([{ id: ID, name: "Lead", kind: "active" }, { name: "Quoted", kind: "active", quote: true }, { name: "Bound", kind: "won", quote: true }, { name: "Lost", kind: "lost" }]);
    expect(toSaveArgs(r.data!)).toEqual({
      p_id: null, p_name: "P&C", p_lines: ["auto", "home"],
      p_stages: [
        { id: ID, name: "Lead", kind: "active", quote: false },
        { id: null, name: "Quoted", kind: "active", quote: true },
        { id: null, name: "Bound", kind: "won", quote: false },
        { id: null, name: "Lost", kind: "lost", quote: false },
      ],
    });
  });
});
