import { describe, expect, it } from "vitest";
import {
  contactFormSchema,
  contactDisplayName,
  formatUsPhone,
  parseContactListParams,
  LEAD_SOURCE_SUGGESTIONS,
} from "@/lib/contacts";

const individual = { contact_type: "individual", first_name: "Pat", last_name: "Example" };

describe("formatUsPhone", () => {
  it.each([
    ["7705550101", "770-555-0101"],
    ["(770) 555-0101", "770-555-0101"],
    ["+1 770.555.0101", "770-555-0101"],
    ["1-770-555-0101", "770-555-0101"],
    ["770 555 0101 ext 12", "770 555 0101 ext 12"],
    ["555-0101", "555-0101"],
    ["", ""],
  ])("%j → %j", (input, expected) => {
    expect(formatUsPhone(input)).toBe(expected);
  });
});

describe("contactFormSchema", () => {
  it("accepts a quick-add individual with just a name", () => {
    const r = contactFormSchema.safeParse(individual);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.relationship_status).toBe("prospect");
      expect(r.data.email).toBeNull();
    }
  });

  it("accepts a business with just a business name", () => {
    expect(contactFormSchema.safeParse({ contact_type: "business", business_name: "Example Hardware LLC" }).success).toBe(true);
  });

  it("normalises fields the way the database expects", () => {
    const r = contactFormSchema.safeParse({
      ...individual,
      email: "  Pat@Example.COM ",
      phone: "(770) 555-0101",
      state: "ga",
      postal_code: " 30117 ",
      lead_source: "  Referral ",
      notes: "  ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toMatchObject({
        email: "pat@example.com", phone: "770-555-0101", state: "GA", postal_code: "30117",
        lead_source: "Referral", notes: null,
      });
    }
  });

  it.each([
    ["individual without any name", { contact_type: "individual", first_name: " ", last_name: "" }, "first_name"],
    ["business without a business name", { contact_type: "business", first_name: "Pat" }, "business_name"],
    ["bad email", { ...individual, email: "nope" }, "email"],
    ["bad state", { ...individual, state: "Georgia" }, "state"],
    ["bad ZIP", { ...individual, postal_code: "3011" }, "postal_code"],
    ["notes too long", { ...individual, notes: "x".repeat(5001) }, "notes"],
    ["unknown contact type", { ...individual, contact_type: "other" }, "contact_type"],
    ["referrer not a UUID", { ...individual, referred_by_contact_id: "123" }, "referred_by_contact_id"],
    ["review date in the future", { ...individual, google_review_left_on: "2999-01-01" }, "google_review_left_on"],
    ["review date malformed", { ...individual, google_review_left_on: "10/20/2026" }, "google_review_left_on"],
  ])("rejects %s", (_label, input, field) => {
    const r = contactFormSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it("drops business-only and individual-only noise consistently (empty strings become null)", () => {
    const r = contactFormSchema.safeParse({ ...individual, business_name: "", alt_phone: "", referred_by_contact_id: "" });
    expect(r.success && r.data).toMatchObject({ business_name: null, alt_phone: null, referred_by_contact_id: null });
  });
});

describe("contactDisplayName", () => {
  it.each([
    [{ contact_type: "individual", first_name: "Pat", last_name: "Example", business_name: null }, "Pat Example"],
    [{ contact_type: "individual", first_name: null, last_name: "Example", business_name: null }, "Example"],
    [{ contact_type: "business", first_name: "Pat", last_name: "Example", business_name: "Example Hardware LLC" }, "Example Hardware LLC"],
  ] as const)("%j → %j", (contact, expected) => {
    expect(contactDisplayName(contact)).toBe(expected);
  });
});

describe("parseContactListParams", () => {
  it("defaults to active leads sorted by name, first page (Phase 24: Contacts opens on Leads)", () => {
    expect(parseContactListParams({})).toEqual({
      q: "", tab: "leads", type: null, status: "prospect", leadSource: null, tag: null, archived: "active", sort: "name", page: 1,
    });
  });

  it("accepts valid values and ignores invalid ones instead of failing", () => {
    expect(
      parseContactListParams({ q: "  pat  ", type: "business", status: "client", source: "Referral", tag: " VIP ", archived: "all", sort: "recent", page: "3" }),
    ).toEqual({ q: "pat", tab: "clients", type: "business", status: "client", leadSource: "Referral", tag: "VIP", archived: "all", sort: "recent", page: 3 });
    expect(
      parseContactListParams({ type: "robot", status: "x", archived: "sometimes", sort: "drop table", page: "-4", tab: "vip" }),
    ).toEqual({ q: "", tab: "leads", type: null, status: "prospect", leadSource: null, tag: null, archived: "active", sort: "name", page: 1 });
  });

  it("limits the search text length", () => {
    expect(parseContactListParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(parseContactListParams({ q: ["first", "second"] }).q).toBe("first");
  });
});

describe("lead source suggestions", () => {
  it("offers a short, sensible default list", () => {
    expect(LEAD_SOURCE_SUGGESTIONS).toContain("Referral");
    expect(new Set(LEAD_SOURCE_SUGGESTIONS).size).toBe(LEAD_SOURCE_SUGGESTIONS.length);
  });
});
