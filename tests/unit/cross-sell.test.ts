import { describe, expect, it } from "vitest";
import { crossSellRuleSchema, describeCrossSellRule, ruleKeyFromName } from "@/lib/cross-sell";

// Phase 8: cross-sell rule settings (no database). Rule evaluation is tested in tests/db.

describe("crossSellRuleSchema", () => {
  const base = { name: " Auto without home ", reason: "Ask about home.", has_any_lines: ["auto"], lacks_line: "home", contact_type: "individual", enabled: "on" };
  it("parses a rule from the Settings form", () => {
    expect(crossSellRuleSchema.parse(base)).toEqual({
      name: "Auto without home", reason: "Ask about home.", has_any_lines: ["auto"], lacks_line: "home", contact_type: "individual", enabled: true,
    });
  });
  it("'any' contact type is stored as null; an unticked box means off; duplicate lines collapse", () => {
    const r = crossSellRuleSchema.parse({ ...base, contact_type: "any", enabled: null, has_any_lines: ["auto", "auto", "home"], lacks_line: "life" });
    expect(r).toEqual(expect.objectContaining({ contact_type: null, enabled: false, has_any_lines: ["auto", "home"] }));
  });
  it.each([
    [{ has_any_lines: [] }, "has_any_lines"],
    [{ has_any_lines: ["boat"] }, "has_any_lines"],
    [{ lacks_line: "auto" }, "lacks_line"],
    [{ lacks_line: "boat" }, "lacks_line"],
    [{ name: "  " }, "name"],
    [{ reason: "" }, "reason"],
    [{ reason: "x".repeat(301) }, "reason"],
    [{ contact_type: "household" }, "contact_type"],
  ])("rejects %j", (override, field) => {
    const r = crossSellRuleSchema.safeParse({ ...base, ...override });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});

describe("describeCrossSellRule", () => {
  it("summarises the rule in plain English", () => {
    expect(describeCrossSellRule({ has_any_lines: ["auto"], lacks_line: "home", contact_type: "individual" })).toBe("Has Auto, no Home · Individuals only");
    expect(describeCrossSellRule({ has_any_lines: ["auto", "home", "commercial"], lacks_line: "life", contact_type: null })).toBe(
      "Has Auto, Home or Commercial, no Life · Individuals and businesses",
    );
  });
});

describe("ruleKeyFromName", () => {
  it.each([
    ["Auto without home", "auto_without_home"],
    ["  Life → Auto!! ", "life_auto"],
    ["2 cars, no home", "rule_2_cars_no_home"],
    ["X", "x_rule"],
  ])("%j → %s", (name, key) => {
    expect(ruleKeyFromName(name)).toBe(key);
    expect(`${key}_abc123`).toMatch(/^[a-z][a-z0-9_]{2,60}$/);
  });
});
