import { describe, expect, it } from "vitest";
import { quickActions } from "@/lib/contacts/quick-actions";
import { BOTTOM_NAV, isCurrentPath, MORE_NAV, NAV_ITEMS } from "@/lib/navigation";

describe("phone navigation (Phase 21)", () => {
  it("puts the four daily pages on the bottom bar and everything else under More", () => {
    expect(BOTTOM_NAV.map((i) => i.label)).toEqual(["Today", "Contacts", "Tasks", "Renewals"]);
    expect(MORE_NAV.map((i) => i.label)).toEqual(["Intake", "Opportunities", "Reports", "Settings"]);
    const reachable = [...BOTTOM_NAV, ...MORE_NAV].map((i) => i.href).sort();
    expect(reachable).toEqual(NAV_ITEMS.map((i) => i.href).sort());
  });

  it("marks a section current on its own page and the pages beneath it only", () => {
    expect(isCurrentPath("/contacts", "/contacts")).toBe(true);
    expect(isCurrentPath("/contacts/abc/merge", "/contacts")).toBe(true);
    expect(isCurrentPath("/contactsx", "/contacts")).toBe(false);
    expect(isCurrentPath("/dashboard", "/contacts")).toBe(false);
  });
});

describe("contact quick actions (Phase 21)", () => {
  const base: Parameters<typeof quickActions>[0] = { name: "Robin Example", phone: "(404) 555-0101", email: "robin@example.com", archived: false, merged: false };
  const keys = (c: typeof base) => quickActions(c).map((a) => a.key);

  it("offers Call, Text and Log with accessible names that start with the visible label", () => {
    const actions = quickActions(base);
    expect(actions.map((a) => [a.label, a.href])).toEqual([
      ["Call", "tel:+14045550101"], ["Text", "#message"], ["Log", "#log-activity"],
    ]);
    for (const a of actions) expect(a.name.startsWith(a.label)).toBe(true);
  });

  it("leaves out Call without a usable number, and Text without any way to message", () => {
    expect(keys({ ...base, phone: null })).toEqual(["text", "log"]);
    expect(keys({ ...base, phone: "555-01" })).toEqual(["text", "log"]);
    expect(keys({ ...base, phone: null, email: null })).toEqual(["log"]);
    expect(keys({ ...base, phone: null, email: "not an email" })).toEqual(["log"]);
  });

  it("drops Text on archived contacts (no composer there) and everything on merged ones", () => {
    expect(keys({ ...base, archived: true })).toEqual(["call", "log"]);
    expect(keys({ ...base, archived: true, merged: true })).toEqual([]);
  });
});
