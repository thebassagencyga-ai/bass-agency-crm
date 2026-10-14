import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { totp, waitForNextTotpWindow } from "./totp";

// Helpers for tests against a LOCAL Supabase stack (`supabase start` in CI). The secret key
// belongs to that throwaway local stack only; never point these tests at production.

export function integrationEnv() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const appUrl = process.env.APP_URL ?? "http://127.0.0.1:8787";
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Integration tests need SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (local stack).");
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(`Refusing to run integration tests against non-local Supabase host ${host}.`);
  }
  return { url, publishableKey, secretKey, appUrl };
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const PASSWORD = "Fictional-Pass-2026";

export function adminClient(): SupabaseClient {
  const env = integrationEnv();
  return createClient(env.url, env.secretKey, noPersist);
}

export function anonClient(): SupabaseClient {
  const env = integrationEnv();
  return createClient(env.url, env.publishableKey, noPersist);
}

/** Creates a confirmed, fictional user the way the owner would in the dashboard. */
export async function createTestUser(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: `Test ${label}` },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email };
}

/** Enrolls and verifies a TOTP factor on a signed-in client; returns its secret. */
export async function enrollTotp(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `t-${randomUUID().slice(0, 6)}` });
  if (error || !data) throw new Error(`enroll failed: ${error?.message}`);
  const verify = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) });
  if (verify.error) throw new Error(`verify failed: ${verify.error.message}`);
  return data.totp.secret;
}

/** A Supabase client that stores its session in a cookie jar, exactly as the app's server does. */
export function cookieJarClient() {
  const env = integrationEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const header = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  return { client, jar, header };
}

// TOTP secrets of factors enrolled by these helpers, so a second sign-in by the same user
// verifies the existing factor (Supabase refuses a new enrollment without an aal2 session).
const totpSecrets = new Map<string, string>();
const fullSessionClients = new Map<string, Promise<SupabaseClient>>();

/** Raises a password-signed-in client to aal2: enrolls on first use, verifies afterwards. */
async function upgradeToAal2(client: SupabaseClient, email: string): Promise<void> {
  const secret = totpSecrets.get(email);
  if (!secret) {
    totpSecrets.set(email, await enrollTotp(client));
    return;
  }
  const { data, error } = await client.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  if (error || !factor) throw new Error(`no verified factor: ${error?.message}`);
  // A TOTP code is accepted once; wait for a fresh one rather than reuse the last.
  await waitForNextTotpWindow();
  const verify = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(secret) });
  if (verify.error) throw new Error(`verify failed: ${verify.error.message}`);
}

/**
 * A Data API client with a full two-step (aal2) session for the given test user. One client
 * per user is shared within a test file.
 */
export function fullSessionClient(email: string): Promise<SupabaseClient> {
  let pending = fullSessionClients.get(email);
  if (!pending) {
    pending = (async () => {
      const client = anonClient();
      const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw error;
      await upgradeToAal2(client, email);
      return client;
    })();
    fullSessionClients.set(email, pending);
  }
  return pending;
}

/**
 * Cookies for a full two-step session, as the app itself would set them, ready to add to a
 * Playwright browser context. Avoids the 30-second authenticator wait in browser tests.
 */
export async function fullSessionCookies(email: string, appUrl: string) {
  const session = cookieJarClient();
  const { error } = await session.client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  await upgradeToAal2(session.client, email);
  const { hostname } = new URL(appUrl);
  return [...session.jar].map(([name, value]) => ({
    name, value, domain: hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" as const,
  }));
}
