import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient, ownStages } from "../support/supabase";

// Opportunities through the real Data API (Phase 4): ownership, lifecycle rules, search.

const SEARCH = {
  p_query: "", p_product_line: null, p_outcome: null, p_stage_id: null,
  p_closed: "all", p_sort: "updated", p_limit: 25, p_offset: 0,
};

let ownerEmail = "";
let oppId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  const owner = await createTestUser("opps-owner");
  ownerEmail = owner.email;
  const client = await fullSessionClient(owner.email);
  Object.assign(stage, await ownStages(client));

  const { data: contact, error } = await client
    .from("contacts").insert({ contact_type: "individual", first_name: "Quinn", last_name: "Example" }).select("id").single();
  if (error) throw error;
  const { data: opp, error: oppError } = await client
    .from("opportunities")
    .insert({ contact_id: contact.id, product_line: "home", stage_id: stage["home/quoted"], quoted_carrier: "Example Mutual", estimated_annual_premium: 1250 })
    .select("id").single();
  if (oppError) throw oppError;
  oppId = opp.id;
});

describe("opportunities via the Data API", () => {
  it("search returns the owner's opportunity with stage and contact names", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { data, error } = await client.rpc("search_opportunities", { ...SEARCH, p_query: "quinn" });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ id: oppId, stage_name: "Quoted", first_name: "Quinn", quoted_carrier: "Example Mutual" })]);
  });

  it("refuses a stage that is not the agent's own and a product line change", async () => {
    const client = await fullSessionClient(ownerEmail);
    // Phase 25: deals may move between the agent's own pipelines; any other stage is refused.
    const wrongStage = await client.from("opportunities").update({ stage_id: "0f8fad5b-d9cb-469f-a165-70867728950e" }).eq("id", oppId);
    expect(wrongStage.error?.code).toBe("23503");
    const wrongLine = await client.from("opportunities").update({ product_line: "auto", stage_id: stage["auto/quoted"] }).eq("id", oppId);
    expect(wrongLine.error?.code).toBe("23514");
  });

  it("lost then reopened: new cycle, loss reason cleared", async () => {
    const client = await fullSessionClient(ownerEmail);
    const lost = await client.from("opportunities").update({ stage_id: stage["home/lost"], outcome: "lost", loss_reason: "price" }).eq("id", oppId);
    expect(lost.error).toBeNull();
    const reopened = await client
      .from("opportunities").update({ stage_id: stage["home/follow_up"], outcome: "open" }).eq("id", oppId)
      .select("outcome, cycle, loss_reason, closed_at").single();
    expect(reopened.data).toEqual({ outcome: "open", cycle: 2, loss_reason: null, closed_at: null });
  });

  it("another account sees nothing and changes nothing", async () => {
    const stranger = await createTestUser("opps-stranger");
    const client = await fullSessionClient(stranger.email);
    expect((await client.rpc("search_opportunities", SEARCH)).data).toEqual([]);
    expect((await client.from("opportunities").select("id").eq("id", oppId)).data).toEqual([]);
    const changed = await client.from("opportunities").update({ next_action: "x" }).eq("id", oppId).select("id");
    expect(changed.data).toEqual([]);
  });

  it("anonymous and password-only callers get nothing", async () => {
    const anon = await anonClient().rpc("search_opportunities", SEARCH);
    expect(anon.error?.code).toBe("42501");
    const aal1 = anonClient();
    await aal1.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
    expect((await aal1.rpc("search_opportunities", SEARCH)).data).toEqual([]);
    expect((await aal1.from("opportunities").select("id")).data).toEqual([]);
  });
});
