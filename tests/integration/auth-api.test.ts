import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, adminClient, anonClient, createTestUser, enrollTotp } from "../support/supabase";
import { totp, waitForNextTotpWindow } from "../support/totp";

// Through Supabase's real Auth and Data APIs (local stack in CI). Proves the security
// foundation holds outside the app: sign-up is closed, anonymous callers and
// password-only sessions get nothing, and one account cannot reach another's data.

let alice: { id: string; email: string };
let bob: { id: string; email: string };
let aliceSecret = "";

beforeAll(async () => {
  alice = await createTestUser("alice");
  bob = await createTestUser("bob");
});

async function signedIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe("sign-up", () => {
  it("is closed to the public", async () => {
    const email = `stranger-${randomUUID().slice(0, 8)}@example.com`;
    const { data, error } = await anonClient().auth.signUp({ email, password: PASSWORD });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
    const { data: list } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
    expect(list.users.some((u) => u.email === email)).toBe(false);
  });
});

describe("new users", () => {
  it("get a profile and the 15 default rules automatically (12 + 3 Focus rules, Phase 27)", async () => {
    const admin = adminClient();
    const { data: profile } = await admin.from("profiles").select("display_name").eq("id", alice.id).single();
    expect(profile?.display_name).toBe("Test alice");
    const { count } = await admin.from("automation_rules").select("*", { count: "exact", head: true }).eq("owner_id", alice.id);
    expect(count).toBe(15);
  });
});

describe("anonymous callers", () => {
  it.each(["contacts", "profiles", "pipeline_stages", "audit_log"])("are refused by %s", async (table) => {
    const { data, error } = await anonClient().from(table).select("*");
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });
});

describe("password-only session (aal1)", () => {
  it("reads nothing and cannot write", async () => {
    const client = await signedIn(alice.email);
    const { data: claims } = await client.auth.getClaims();
    expect(claims?.claims.aal).toBe("aal1");
    const read = await client.from("profiles").select("id");
    expect(read.data).toEqual([]);
    const write = await client.from("contacts").insert({ contact_type: "individual", first_name: "Blocked" });
    expect(write.error?.code).toBe("42501");
  });
});

describe("full session (aal2)", () => {
  it("can create and read its own contact; another user cannot see or change it", async () => {
    const a = await signedIn(alice.email);
    aliceSecret = await enrollTotp(a);
    const { data: claims } = await a.auth.getClaims();
    expect(claims?.claims.aal).toBe("aal2");

    const { data: created, error } = await a.from("contacts").insert({ contact_type: "individual", first_name: "Integration" }).select("id").single();
    expect(error).toBeNull();
    const own = await a.from("contacts").select("id").eq("id", created!.id);
    expect(own.data).toHaveLength(1);

    const b = await signedIn(bob.email);
    await enrollTotp(b);
    const peek = await b.from("contacts").select("id").eq("id", created!.id);
    expect(peek.data).toEqual([]);
    const tamper = await b.from("contacts").update({ first_name: "Hacked" }).eq("id", created!.id).select("id");
    expect(tamper.data).toEqual([]);
    const del = await b.from("contacts").delete().eq("id", created!.id);
    expect(del.error?.code).toBe("42501");
  });

  it("keeps aal2 after a token refresh, and cannot refresh after signing out", async () => {
    const client = await signedIn(alice.email);
    const { data: factors } = await client.auth.mfa.listFactors();
    const factor = factors?.totp[0];
    expect(factor).toBeDefined();
    await waitForNextTotpWindow(); // never reuse the code from the previous test
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor!.id, code: totp(aliceSecret) });
    expect(verified.error).toBeNull();

    const refreshed = await client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const { data: claims } = await client.auth.getClaims();
    expect(claims?.claims.aal).toBe("aal2");

    const refreshToken = refreshed.data.session!.refresh_token;
    await client.auth.signOut({ scope: "local" });
    const reuse = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    expect(reuse.error).not.toBeNull();
  }, 60_000);
});
