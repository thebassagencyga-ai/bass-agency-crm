import { describe, expect, it } from "vitest";
import {
  BASE_LINES,
  LINE_FAMILY,
  PIPELINES,
  PRODUCT_LINE_NAMES,
  PRODUCT_LINES,
  SIX_MONTH_LINES,
  isProductLine,
  linesToShow,
  isOutcomeAllowedForStage,
  type StageKind,
} from "@/lib/pipelines";

describe("pipeline definitions", () => {
  it("defines stage templates for the four starting lines", () => {
    expect(Object.keys(PIPELINES).sort()).toEqual([...BASE_LINES].sort());
  });

  it("Phase 30: thirteen lines, each with a name and a starting line it joins", () => {
    expect(PRODUCT_LINES).toHaveLength(13);
    expect(Object.keys(PRODUCT_LINE_NAMES).sort()).toEqual([...PRODUCT_LINES].sort());
    for (const b of BASE_LINES) expect(LINE_FAMILY[b]).toBe(b);
    expect(PRODUCT_LINES.filter((l) => LINE_FAMILY[l] === "auto")).toEqual(["auto", "motorcycle", "boat", "rv"]);
    expect(PRODUCT_LINES.filter((l) => LINE_FAMILY[l] === "home")).toEqual(["home", "renters", "condo", "mobile_home", "umbrella"]);
    expect(PRODUCT_LINES.filter((l) => LINE_FAMILY[l] === "commercial")).toEqual(["commercial", "commercial_auto", "farm"]);
    expect(SIX_MONTH_LINES).toEqual(["auto", "motorcycle"]);
    expect(isProductLine("umbrella")).toBe(true);
    expect(isProductLine("aircraft")).toBe(false);
  });

  it("shows the four main lines always and another line only when it has something", () => {
    expect(linesToShow(() => false)).toEqual(["auto", "home", "commercial", "life"]);
    expect(linesToShow((l) => l === "umbrella" || l === "boat")).toEqual(["auto", "boat", "home", "umbrella", "commercial", "life"]);
  });

  it.each(BASE_LINES)("%s starts at New Lead and has exactly one won and one lost stage", (line) => {
    const stages = PIPELINES[line];
    expect(stages[0]?.name).toBe("New Lead");
    expect(stages.filter((s) => s.kind === "won")).toHaveLength(1);
    expect(stages.filter((s) => s.kind === "lost")).toHaveLength(1);
    expect(stages.at(-1)?.kind).toBe("lost");
  });

  it.each(BASE_LINES)("%s has unique stage codes", (line) => {
    const codes = PIPELINES[line].map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("matches the spec's stage names and order", () => {
    const names = (line: keyof typeof PIPELINES) => PIPELINES[line].map((s) => s.name);
    expect(names("auto")).toEqual(["New Lead", "Contacted", "Info Needed", "Quoted", "Follow Up", "Bound", "Lost"]);
    expect(names("home")).toEqual([
      "New Lead", "Contacted", "Property Info Needed", "Quoted", "Follow Up", "Bound", "Lost",
    ]);
    expect(names("commercial")).toEqual([
      "New Lead", "Discovery", "Info Needed", "Marketing or Quoting", "Proposal Presented", "Follow Up", "Bound", "Lost",
    ]);
    expect(names("life")).toEqual([
      "New Lead", "Contacted", "Appointment Set", "Needs Review", "Application Process", "Decision Pending", "Placed", "Lost",
    ]);
  });

  it("never treats a submitted life application as placed", () => {
    const life = PIPELINES.life;
    const kindOf = (code: string) => life.find((s) => s.code === code)?.kind;
    expect(kindOf("application_process")).toBe("active");
    expect(kindOf("decision_pending")).toBe("active");
    expect(kindOf("placed")).toBe("won");
  });
});

describe("isOutcomeAllowedForStage", () => {
  const cases: [StageKind, Parameters<typeof isOutcomeAllowedForStage>[1], boolean][] = [
    ["active", "open", true],
    ["active", "nurture", true],
    ["active", "won", false],
    ["active", "lost", false],
    ["won", "won", true],
    ["won", "open", false],
    ["lost", "lost", true],
    ["lost", "nurture", false],
  ];
  it.each(cases)("stage kind %s with outcome %s → %s", (kind, outcome, expected) => {
    expect(isOutcomeAllowedForStage(kind, outcome)).toBe(expected);
  });
});
