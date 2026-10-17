import { describe, expect, it } from "vitest";
import { MERGE_NOTE_SEPARATOR, mergedFields } from "@/lib/contacts/merge";
import { cleanTag, parseTagName, pickTags } from "@/lib/contacts/tags";
import type { Contact } from "@/lib/contacts/types";

describe("tags", () => {
  it("keeps only ticked tags that are on the list (or already on the contact), in the list's spelling", () => {
    expect(pickTags(["vip", " Church ", "VIP", "Made up"], ["VIP", "Church", "Farm"])).toEqual({ tags: ["VIP", "Church"], error: null });
    expect(pickTags([], ["VIP"])).toEqual({ tags: [], error: null });
    expect(cleanTag("a\tb\u0000c")).toBe("a b c");
  });

  it("refuses more than 20", () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(pickTags(many, many).error).toBe("Choose at most 20 tags.");
    expect(pickTags(many.slice(0, 20), many).error).toBeNull();
  });

  it("checks a single tag name for renaming", () => {
    expect(parseTagName("  First  Baptist ")).toEqual({ name: "First Baptist", error: null });
    expect(parseTagName("a,b").error).toMatch(/comma/);
    expect(parseTagName("")).toEqual({ name: "", error: null });
  });
});

const base: Contact = {
  id: "k", contact_type: "individual", first_name: null, last_name: null, business_name: null, email: null, phone: null,
  alt_phone: null, address_line1: null, address_line2: null, city: null, state: null, postal_code: null,
  preferred_contact_method: null, lead_source: null, relationship_status: "prospect", referred_by_contact_id: null,
  google_review_left_on: null, notes: null, tags: [], merged_into_contact_id: null, archived_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

describe("mergedFields (mirrors public.merge_contacts)", () => {
  it("keeps the kept contact's values and fills its blanks", () => {
    const keep: Contact = { ...base, first_name: "Robin", last_name: "Example", phone: "404-555-0101", notes: "Kept.", tags: ["VIP"] };
    const dup: Contact = {
      ...base, id: "d", first_name: "Rob", email: "robin@example.com", phone: "404-555-0102", city: "Carrollton", state: "GA",
      relationship_status: "client", referred_by_contact_id: "r", google_review_left_on: "2026-05-01", notes: "Dup.", tags: ["vip", "Church"],
    };
    const { result, filled } = mergedFields(keep, dup);
    expect(result).toMatchObject({
      first_name: "Robin", email: "robin@example.com", phone: "404-555-0101", alt_phone: "404-555-0102", city: "Carrollton",
      state: "GA", relationship_status: "client", referred_by_contact_id: "r", google_review_left_on: "2026-05-01",
      notes: `Kept.${MERGE_NOTE_SEPARATOR}Dup.`, tags: ["VIP", "Church"],
    });
    expect(filled).toEqual(["email", "alt_phone", "city", "state", "relationship_status", "referred_by_contact_id", "google_review_left_on", "notes", "tags"]);
  });

  it("an address is taken as a whole, only when the kept contact has none", () => {
    const keep: Contact = { ...base, city: "Atlanta" };
    const dup: Contact = { ...base, id: "d", address_line1: "1 Example St", city: "Carrollton", postal_code: "30117" };
    expect(mergedFields(keep, dup).result).toMatchObject({ address_line1: null, city: "Atlanta", postal_code: null });
  });

  it("the same phone is not copied twice; a referrer pointing at the other contact is dropped; earliest review wins", () => {
    const keep: Contact = { ...base, phone: "(404) 555-0101", referred_by_contact_id: "d", google_review_left_on: "2026-06-01", relationship_status: "former_client" };
    const dup: Contact = { ...base, id: "d", phone: "1-404-555-0101", alt_phone: "404-555-0109", referred_by_contact_id: "k", google_review_left_on: "2026-03-01" };
    expect(mergedFields(keep, dup).result).toMatchObject({
      alt_phone: "404-555-0109", referred_by_contact_id: null, google_review_left_on: "2026-03-01", relationship_status: "former_client",
    });
  });
});
