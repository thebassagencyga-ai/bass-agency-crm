import { describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient, ownStage } from "../support/supabase";

// Renewals, retention outcomes and cross-sell through the real Data API (Phase 8).

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("renewals and cross-sell via the Data API", () => {
  it("lists, records and prompts for the owner only; nothing for strangers, password-only or anonymous callers", async () => {
    const owner = await createTestUser("renew-owner");
    const client = await fullSessionClient(owner.email);
    const t = today();
    const { data: contact } = await client
      .from("contacts").insert({ contact_type: "individual", first_name: "Rory", relationship_status: "client" }).select("id").single();
    const stage = { id: await ownStage(client, "auto", "bound") };
    const renewal = addDays(t, 20);
    const { data: policy, error: insertError } = await client
      .from("opportunities")
      .insert({ contact_id: contact!.id, product_line: "auto", stage_id: stage!.id, outcome: "won", renewal_date: renewal, policy_term_months: 6 })
      .select("id").single();
    expect(insertError).toBeNull();

    const list = await client.rpc("search_renewals", { p_today: t, p_days: 30, p_product_line: null });
    expect(list.error).toBeNull();
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([policy!.id]);

    const prompts = await client.rpc("cross_sell_prompts", { p_today: t, p_contact_id: contact!.id });
    expect(prompts.data.map((p: { rule_key: string }) => p.rule_key).sort()).toEqual(["auto_no_home", "personal_no_life"]);

    // A stranger can neither see nor change any of it.
    const stranger = await fullSessionClient((await createTestUser("renew-stranger")).email);
    expect((await stranger.rpc("search_renewals", { p_today: t, p_days: 90, p_product_line: null })).data).toEqual([]);
    expect((await stranger.rpc("cross_sell_prompts", { p_today: t })).data).toEqual([]);
    expect((await stranger.rpc("record_renewal_outcome", { p_opportunity_id: policy!.id, p_outcome: "renewed" })).error?.code).toBe("P0002");
    const autoNoHome = prompts.data.find((p: { rule_key: string }) => p.rule_key === "auto_no_home");
    expect((await stranger.rpc("dismiss_cross_sell", { p_contact_id: contact!.id, p_rule_id: autoNoHome.rule_id })).data).toBe(0);

    // The owner records the renewal: 6-month term rolls forward.
    const recorded = await client.rpc("record_renewal_outcome", { p_opportunity_id: policy!.id, p_outcome: "renewed", p_premium: 980 });
    expect(recorded.error).toBeNull();
    expect(recorded.data.next_renewal_date).not.toBe(renewal);
    const { data: after } = await client.from("opportunities").select("renewal_date").eq("id", policy!.id).single();
    expect(after!.renewal_date).toBe(recorded.data.next_renewal_date);

    expect((await client.rpc("dismiss_cross_sell", { p_contact_id: contact!.id, p_rule_id: autoNoHome.rule_id })).data).toBe(1);
    const left = await client.rpc("cross_sell_prompts", { p_today: t, p_contact_id: contact!.id });
    expect(left.data.map((p: { rule_key: string }) => p.rule_key)).toEqual(["personal_no_life"]);

    // Password-only: sees nothing. Anonymous: refused.
    const aal1 = anonClient();
    await aal1.auth.signInWithPassword({ email: owner.email, password: PASSWORD });
    expect((await aal1.rpc("search_renewals", { p_today: t, p_days: 90, p_product_line: null })).data).toEqual([]);
    expect((await aal1.from("renewal_outcomes").select("id")).data).toEqual([]);
    const anon = anonClient();
    expect((await anon.rpc("search_renewals", { p_today: t, p_days: 90, p_product_line: null })).error?.code).toBe("42501");
    expect((await anon.rpc("record_renewal_outcome", { p_opportunity_id: policy!.id, p_outcome: "lost", p_loss_reason: "price" })).error?.code).toBe("42501");
    expect((await anon.rpc("cross_sell_prompts", { p_today: t })).error?.code).toBe("42501");
    expect((await anon.rpc("dismiss_cross_sell", { p_contact_id: contact!.id, p_rule_id: autoNoHome.rule_id })).error?.code).toBe("42501");
    expect((await anon.from("cross_sell_rules").select("id")).error?.code).toBe("42501");
  });
});
