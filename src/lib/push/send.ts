import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient } from "@/lib/supabase/anon";
import { siteUrl } from "@/lib/env";
import { type DeliveryResult, type Device, deliver } from "./dispatch";
import { NEW_QUOTE_REQUEST_ALERT, TEST_ALERT, dispatchProof, parsePushKey } from "./webpush";

// New-lead alerts (Phase 26, ADR-044). The push key (PUSH_KEY) is an encrypted secret in the
// hosting provider's store; without it alerts are simply off.

export const pushKey = () => parsePushKey(process.env.PUSH_KEY);

/** The VAPID "sub": the app's own address (no email or other personal data). */
const subject = () => siteUrl();

/**
 * After a public quote request: claim the alerts owed (once each) and send them. Runs in the
 * background after the submission has been saved; any failure is ignored, so the submission
 * never depends on it.
 */
export async function sendOwedAlerts(): Promise<DeliveryResult | null> {
  const key = pushKey();
  if (!key) return null;
  try {
    const { data, error } = await createAnonClient().rpc("claim_push_alerts", { p_proof: await dispatchProof(key) });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const devices = (data as { subscription_id: string; endpoint: string; p256dh: string; auth: string }[])
      .map((r) => ({ id: r.subscription_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
    return await deliver(devices, NEW_QUOTE_REQUEST_ALERT, key, subject());
  } catch {
    return null;
  }
}

/** Settings → "Send a test alert": the agent's own devices (RLS); unsubscribed ones are turned off. */
export async function sendTestAlert(supabase: SupabaseClient): Promise<DeliveryResult | "no-key" | "no-devices"> {
  const key = pushKey();
  if (!key) return "no-key";
  const { data, error } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").is("disabled_at", null);
  if (error) throw new Error(`Could not load your devices (${error.code ?? "unknown"}).`);
  const devices = (data ?? []) as Device[];
  if (devices.length === 0) return "no-devices";
  const result = await deliver(devices, TEST_ALERT, key, subject());
  if (result.gone.length > 0) {
    await supabase.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).in("id", result.gone);
  }
  return result;
}
