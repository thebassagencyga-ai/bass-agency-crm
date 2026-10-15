import { describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient } from "../support/supabase";

// Dashboard summary through the real Data API (Phase 7).

const TODAY = "2026-10-15";

describe("dashboard_summary via the Data API", () => {
  it("counts the owner's own work only, and nothing for password-only or anonymous callers", async () => {
    const owner = await createTestUser("dash-owner");
    const client = await fullSessionClient(owner.email);
    const { data: contact } = await client.from("contacts").insert({ contact_type: "individual", first_name: "Lee" }).select("id").single();
    await client.from("tasks").insert({ contact_id: contact!.id, title: "Call Lee", due_date: TODAY });
    const { data, error } = await client.rpc("dashboard_summary", { p_today: TODAY });
    expect(error).toBeNull();
    expect(data.tasks).toEqual({ overdue: 0, due_today: 1, upcoming_7_days: 0 });

    const stranger = await createTestUser("dash-stranger");
    const theirs = await (await fullSessionClient(stranger.email)).rpc("dashboard_summary", { p_today: TODAY });
    expect(theirs.data.tasks).toEqual({ overdue: 0, due_today: 0, upcoming_7_days: 0 });

    const aal1 = anonClient();
    await aal1.auth.signInWithPassword({ email: owner.email, password: PASSWORD });
    expect((await aal1.rpc("dashboard_summary", { p_today: TODAY })).data.tasks).toEqual({ overdue: 0, due_today: 0, upcoming_7_days: 0 });
    expect((await anonClient().rpc("dashboard_summary", { p_today: TODAY })).error?.code).toBe("42501");
  });
});
