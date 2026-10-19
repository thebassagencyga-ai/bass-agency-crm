import { describe, expect, it } from "vitest";
import { parseContactListParams } from "@/lib/contacts/params";
import { bookSummaries, leadSummaries } from "@/lib/contacts/summaries";
import { resolveTab, tabStatus } from "@/lib/contacts/tabs";

// Phase 24 (ADR-040): Leads | Clients | Former | All, and what each row summarises.
const today = "2026-10-19";

describe("contact tabs", () => {
  it("map to statuses; All shows everyone", () => {
    expect([tabStatus("leads"), tabStatus("clients"), tabStatus("former"), tabStatus("all")]).toEqual(["prospect", "client", "former_client", null]);
  });

  it("open on Leads, but a search or filter with no tab looks across everyone", () => {
    expect(resolveTab({ tab: null, status: null, searching: false })).toBe("leads");
    expect(resolveTab({ tab: null, status: null, searching: true })).toBe("all");
    expect(parseContactListParams({ q: "robin" })).toMatchObject({ tab: "all", status: null });
    expect(parseContactListParams({ tag: "VIP" })).toMatchObject({ tab: "all", status: null });
  });

  it("an explicit tab wins, also while searching; old status links still work", () => {
    expect(parseContactListParams({ tab: "clients", q: "robin" })).toMatchObject({ tab: "clients", status: "client" });
    expect(parseContactListParams({ tab: "all" })).toMatchObject({ tab: "all", status: null });
    expect(parseContactListParams({ status: "former_client" })).toMatchObject({ tab: "former", status: "former_client" });
  });
});

describe("lead rows", () => {
  const stages = new Map([["s-quoted", "Quoted"], ["s-new", "New Lead"]]);

  it("list open deals by line with their stage and quote date, and the soonest open task", () => {
    const s = leadSummaries(
      [
        { contact_id: "a", product_line: "home", stage_id: "s-new", outcome: "open", quote_sent_on: null },
        { contact_id: "a", product_line: "auto", stage_id: "s-quoted", outcome: "open", quote_sent_on: "2026-10-17" },
      ],
      stages,
      [
        { contact_id: "a", title: "Follow up on quote", due_date: "2026-10-20" },
        { contact_id: "a", title: "Make initial contact", due_date: "2026-10-18" },
      ],
      today,
    ).get("a")!;
    expect(s.deals).toEqual([
      { line: "auto", stage: "Quoted", nurture: false, quoteSentOn: "2026-10-17" },
      { line: "home", stage: "New Lead", nurture: false, quoteSentOn: null },
    ]);
    expect(s.nextTask).toEqual({ title: "Make initial contact", due: "2026-10-18", overdue: true });
  });

  it("show nurture deals as nurture, and contacts with nothing open have no summary", () => {
    const m = leadSummaries([{ contact_id: "b", product_line: "life", stage_id: "s-new", outcome: "nurture", quote_sent_on: null }], stages, [], today);
    expect(m.get("b")).toEqual({ deals: [{ line: "life", stage: "New Lead", nurture: true, quoteSentOn: null }], nextTask: null });
    expect(m.get("c")).toBeUndefined();
  });
});

describe("book rows", () => {
  it("lines held, total premium, soonest renewal and cross-sell gaps", () => {
    const s = bookSummaries(
      [
        { contact_id: "a", product_line: "home", estimated_annual_premium: "1200.50", renewal_date: "2027-03-01" },
        { contact_id: "a", product_line: "auto", estimated_annual_premium: 900, renewal_date: "2026-11-08" },
      ],
      [{ contact_id: "a", lacks_line: "life" }, { contact_id: "a", lacks_line: "life" }],
    ).get("a")!;
    expect(s).toEqual({ lines: ["auto", "home"], premium: 2100.5, premiumComplete: true, nextRenewal: "2026-11-08", gaps: ["life"] });
  });

  it("marks the premium as a floor when a policy has none recorded, and null when none has one", () => {
    const m = bookSummaries(
      [
        { contact_id: "a", product_line: "auto", estimated_annual_premium: 800, renewal_date: null },
        { contact_id: "a", product_line: "auto", estimated_annual_premium: null, renewal_date: null },
        { contact_id: "b", product_line: "life", estimated_annual_premium: null, renewal_date: null },
      ],
      [],
    );
    expect(m.get("a")).toMatchObject({ lines: ["auto"], premium: 800, premiumComplete: false, nextRenewal: null });
    expect(m.get("b")).toMatchObject({ premium: null, premiumComplete: false });
  });
});
