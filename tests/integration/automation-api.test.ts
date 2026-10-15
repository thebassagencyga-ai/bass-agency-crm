import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, createTestUser, fullSessionClient } from "../support/supabase";

// The automation engine through the real Data API (Phase 6): changes made with the user's
// own session create and close tasks in the same request.

let ownerEmail = "";
let contactId = "";
let oppId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  const owner = await createTestUser("auto-owner");
  ownerEmail = owner.email;
  const client = await fullSessionClient(owner.email);
  const { data: stages } = await client.from("pipeline_stages").select("id, product_line, code");
  for (const s of (stages ?? []) as { id: string; product_line: string; code: string }[]) stage[`${s.product_line}/${s.code}`] = s.id;
  const { data: contact, error } = await client.from("contacts").insert({ contact_type: "individual", first_name: "Robin", last_name: "Example" }).select("id").single();
  if (error) throw error;
  contactId = contact.id;
  const { data: opp, error: oppError } = await client
    .from("opportunities").insert({ contact_id: contactId, product_line: "auto", stage_id: stage["auto/new_lead"] }).select("id").single();
  if (oppError) throw oppError;
  oppId = opp.id;
});

const titles = async () => {
  const client = await fullSessionClient(ownerEmail);
  const { data } = await client.from("tasks").select("title, status, category").eq("contact_id", contactId).order("title");
  return (data ?? []) as { title: string; status: string; category: string }[];
};

describe("automation via the Data API", () => {
  it("a new lead gets its first-contact task", async () => {
    expect(await titles()).toEqual([{ title: "Make initial contact", status: "open", category: "prospecting" }]);
  });

  it("winning closes prospecting tasks and adds onboarding, review and referral tasks", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { error } = await client.from("opportunities").update({ stage_id: stage["auto/bound"], outcome: "won" }).eq("id", oppId);
    expect(error).toBeNull();
    const tasks = await titles();
    expect(tasks.find((t) => t.title === "Make initial contact")?.status).toBe("cancelled");
    expect(tasks.filter((t) => t.category === "onboarding")).toHaveLength(3);
    expect(tasks.map((t) => t.category)).toEqual(expect.arrayContaining(["review_request", "referral_request"]));
  });

  it("another account's changes never touch these tasks, and it cannot see them", async () => {
    const stranger = await createTestUser("auto-stranger");
    const client = await fullSessionClient(stranger.email);
    expect((await client.from("tasks").select("id").eq("contact_id", contactId)).data).toEqual([]);
    const nothing = await client.rpc("confirm_no_response_follow_up", { p_activity_id: oppId });
    expect(nothing.data).toBe(0);
  });

  it("anonymous callers cannot use the confirmation function", async () => {
    const { error } = await anonClient().rpc("confirm_no_response_follow_up", { p_activity_id: oppId });
    expect(error?.code).toBe("42501");
  });
});
