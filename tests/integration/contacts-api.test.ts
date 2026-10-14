import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient } from "../support/supabase";

// Contact search and duplicate functions through the real Data API (Phase 3).

const SEARCH = {
  p_query: "", p_type: null, p_status: null, p_lead_source: null,
  p_archived: "all", p_sort: "name", p_limit: 25, p_offset: 0,
};

let ownerEmail = "";
let ownerContactId = "";

beforeAll(async () => {
  const owner = await createTestUser("contacts-owner");
  ownerEmail = owner.email;
  const client = await fullSessionClient(owner.email);
  const { data, error } = await client
    .from("contacts")
    .insert({ contact_type: "individual", first_name: "Integration", last_name: "Contact", phone: "770-555-0123", email: "integration@example.com" })
    .select("id")
    .single();
  if (error) throw error;
  ownerContactId = data.id;
});

describe("search_contacts via the Data API", () => {
  it("returns the owner's contact", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { data, error } = await client.rpc("search_contacts", { ...SEARCH, p_query: "integration" });
    expect(error).toBeNull();
    expect((data as { id: string }[]).map((r) => r.id)).toEqual([ownerContactId]);
  });

  it("returns nothing of it to another account", async () => {
    const stranger = await createTestUser("contacts-stranger");
    const client = await fullSessionClient(stranger.email);
    const search = await client.rpc("search_contacts", { ...SEARCH, p_query: "integration" });
    expect(search.data).toEqual([]);
    const dupes = await client.rpc("find_possible_duplicates", { p_email: "integration@example.com", p_phone: "7705550123", p_exclude_id: null });
    expect(dupes.data).toEqual([]);
    const direct = await client.from("contacts").select("id").eq("id", ownerContactId);
    expect(direct.data).toEqual([]);
  });

  it("refuses anonymous callers", async () => {
    const { data, error } = await anonClient().rpc("search_contacts", SEARCH);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("returns nothing to a password-only session", async () => {
    const client = anonClient();
    await client.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
    const { data } = await client.rpc("search_contacts", SEARCH);
    expect(data).toEqual([]);
  });

  it("records the change in the audit log with the acting user", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { data: user } = await client.auth.getUser();
    const { data } = await client.from("audit_log").select("action, actor_id").eq("record_id", ownerContactId);
    expect(data).toEqual([{ action: "insert", actor_id: user.user!.id }]);
  });
});
