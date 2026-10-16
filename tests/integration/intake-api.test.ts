import { describe, expect, it } from "vitest";
import { anonClient, createTestUser, fullSessionClient, integrationEnv } from "../support/supabase";

// Phase 13 intake form through the real Data API and the app (ADR-028): the public function is
// reachable with only the publishable key, and nothing else is.

const form = (email: string) => ({
  first_name: "Riley", last_name: "Example", email, phone: "404-555-0144", lines: ["auto"],
  current_coverage: [{ line: "auto", carrier: "Example Mutual", renews_month: 6 }],
});

describe("intake via the Data API", () => {
  it("anonymous: can submit to an enabled link, cannot read or do anything else", async () => {
    const owner = await createTestUser("intake-owner");
    const client = await fullSessionClient(owner.email);
    const { data: token, error: rotateError } = await client.rpc("rotate_intake_link");
    expect(rotateError).toBeNull();
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    const anon = anonClient();
    const sent = await anon.rpc("submit_intake", { p_token: token, p_form: form("riley@example.com"), p_consent: true });
    expect(sent.error).toBeNull();

    // Reading anything is refused, including what was just sent.
    for (const table of ["intake_submissions", "intake_links", "contacts"]) {
      expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    }
    for (const fn of ["accept_intake", "discard_intake", "quick_intake", "rotate_intake_link"]) {
      expect((await anon.rpc(fn, {})).error).not.toBeNull();
    }
    expect((await anon.rpc("submit_intake", { p_token: "0".repeat(32), p_form: form("x@example.com"), p_consent: true })).error?.message).toBe("link_unavailable");
    expect((await anon.rpc("submit_intake", { p_token: token, p_form: form("x@example.com"), p_consent: false })).error?.message).toBe("consent");

    // The owner sees it and accepts it; a stranger cannot.
    const { data: inbox } = await client.from("intake_submissions").select("id, email, status").eq("status", "new");
    expect(inbox).toEqual([{ id: expect.any(String), email: "riley@example.com", status: "new" }]);
    const stranger = await fullSessionClient((await createTestUser("intake-stranger")).email);
    expect((await stranger.from("intake_submissions").select("id")).data).toEqual([]);
    expect((await stranger.rpc("accept_intake", { p_id: inbox![0]!.id })).error?.code).toBe("P0002");

    const accepted = await client.rpc("accept_intake", { p_id: inbox![0]!.id });
    expect(accepted.error).toBeNull();
    const { data: contact } = await client.from("contacts").select("first_name, email").eq("id", accepted.data).single();
    expect(contact).toEqual({ first_name: "Riley", email: "riley@example.com" });
    const { data: erased } = await client.from("intake_submissions").select("status, email").eq("id", inbox![0]!.id).single();
    expect(erased).toEqual({ status: "accepted", email: null });

    // Signed-in users do not use the public function.
    expect((await client.rpc("submit_intake", { p_token: token, p_form: form("y@example.com"), p_consent: true })).error?.code).toBe("42501");
  });
});

describe("the public form page", () => {
  const { appUrl } = integrationEnv();

  it("opens signed out, with the security headers and no database address", async () => {
    const res = await fetch(`${appUrl}/quote/${"a".repeat(32)}`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await res.text();
    expect(html).toContain("Request an insurance quote");
    expect(html).not.toContain("supabase.co");
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("a malformed link is not found; the agent's inbox still needs sign-in", async () => {
    expect((await fetch(`${appUrl}/quote/not-a-token`, { redirect: "manual" })).status).toBe(404);
    const inbox = await fetch(`${appUrl}/intake`, { redirect: "manual" });
    expect(inbox.status).toBe(307);
    expect(inbox.headers.get("location")).toContain("/login?next=%2Fintake");
  });
});
