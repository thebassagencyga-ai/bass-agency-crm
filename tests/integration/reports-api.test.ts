import { describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient } from "../support/supabase";

// Reports through the real Data API (Phase 9).

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

describe("report_summary via the Data API", () => {
  it("reports the owner's own records only; nothing for strangers or password-only sessions; refused to anonymous callers", async () => {
    const owner = await createTestUser("report-owner");
    const client = await fullSessionClient(owner.email);
    const t = today();
    const { data: contact } = await client
      .from("contacts").insert({ contact_type: "individual", first_name: "Sky", lead_source: "Website" }).select("id").single();
    const { data: stage } = await client.from("pipeline_stages").select("id").eq("product_line", "home").eq("code", "bound").single();
    const { error: oppError } = await client
      .from("opportunities").insert({ contact_id: contact!.id, product_line: "home", stage_id: stage!.id, outcome: "won", quote_sent_on: t, estimated_annual_premium: 1500 });
    expect(oppError).toBeNull();

    const args = { p_start: t, p_end: t, p_today: t };
    const { data, error } = await client.rpc("report_summary", args);
    expect(error).toBeNull();
    expect(data.new_leads).toEqual([{ source: "Website", contacts: 1, with_opportunity: 1, won: 1 }]);
    expect(data.conversion).toEqual([{ product_line: "home", won: 1, lost: 0, won_premium: 1500, won_with_premium: 1 }]);
    expect(data.quotes[0]).toEqual(expect.objectContaining({ product_line: "home", quoted: 1, won: 1 }));

    const stranger = await fullSessionClient((await createTestUser("report-stranger")).email);
    const theirs = (await stranger.rpc("report_summary", args)).data;
    expect([theirs.new_leads, theirs.conversion, theirs.quotes]).toEqual([[], [], []]);

    const aal1 = anonClient();
    await aal1.auth.signInWithPassword({ email: owner.email, password: PASSWORD });
    expect((await aal1.rpc("report_summary", args)).data.new_leads).toEqual([]);
    expect((await anonClient().rpc("report_summary", args)).error?.code).toBe("42501");
  });
});
