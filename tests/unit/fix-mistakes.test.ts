import { describe, expect, it } from "vitest";
import { LINE_CHIP_CLASS, lineClassForName } from "@/components/line-chip";
import { changeLineSchema } from "@/lib/opportunities/schema";
import { PRODUCT_LINES } from "@/lib/pipelines";

// Phase 29 (ADR-047): line colours and the line-correction form. Database rules are tested in
// tests/db/fix-mistakes.test.ts; contrast in tests/unit/brand.test.ts.
const ID = "6f1d1c8e-3c2b-4f2a-9a51-0b7a9d6c1e11";

describe("line colours", () => {
  it("every line has its own soft colour, from the semantic utilities only", () => {
    expect(Object.keys(LINE_CHIP_CLASS).sort()).toEqual([...PRODUCT_LINES].sort());
    expect(new Set(Object.values(LINE_CHIP_CLASS)).size).toBe(PRODUCT_LINES.length);
    for (const c of Object.values(LINE_CHIP_CLASS)) expect(c).toMatch(/^bg-lob-\w+ text-lob-\w+-fg$/);
  });
  it("tags named after a line take its colour, whatever the case; other tags do not", () => {
    expect(lineClassForName("Auto")).toBe(LINE_CHIP_CLASS.auto);
    expect(lineClassForName(" commercial ")).toBe(LINE_CHIP_CLASS.commercial);
    expect(lineClassForName("VIP")).toBeNull();
  });
});

describe("change line form", () => {
  it("accepts a known line only", () => {
    expect(changeLineSchema.parse({ id: ID, product_line: "auto" })).toEqual({ id: ID, product_line: "auto" });
    expect(changeLineSchema.safeParse({ id: ID, product_line: "boat" }).success).toBe(false);
  });
});
