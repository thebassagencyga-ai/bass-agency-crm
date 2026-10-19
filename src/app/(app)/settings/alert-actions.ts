"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { deviceLabel, subscriptionSchema } from "@/lib/push/device";
import { pushKey, sendTestAlert } from "@/lib/push/send";
import { dispatchProof } from "@/lib/push/webpush";

// Settings → Alerts (Phase 26, ADR-044). Each device's row is the agent's own (RLS).

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Turns alerts on for the device that sent its browser subscription (JSON). */
export async function enableAlerts(subscriptionJson: string, userAgent: string): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const key = pushKey();
  if (!key) return { error: "Alerts are not set up yet. Create the alert key first." };
  let raw: unknown;
  try {
    raw = JSON.parse(subscriptionJson);
  } catch {
    raw = null;
  }
  const parsed = subscriptionSchema.safeParse(raw);
  if (!parsed.success) return { error: "This browser did not give a usable push address. Try again, or use another browser." };
  const sub = parsed.data;
  // The database keeps only the SHA-256 of the proof (claim_push_alerts compares it).
  const proofHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await dispatchProof(key))));
  const row = {
    p256dh: sub.keys.p256dh, auth: sub.keys.auth, device_label: deviceLabel(userAgent.slice(0, 500)),
    dispatch_hash: `\\x${hex(proofHash)}`,
  };
  const { data: existing } = await supabase.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle();
  // A new device is inserted with only the columns the app may write (no disabled_at); a device
  // turned on again is re-enabled by clearing disabled_at.
  const { error } = existing
    ? await supabase.from("push_subscriptions").update({ ...row, disabled_at: null }).eq("id", existing.id as string)
    : await supabase.from("push_subscriptions").insert({ endpoint: sub.endpoint, ...row });
  if (error) return { error: "Could not turn alerts on. Please try again." };
  revalidatePath("/settings");
  return { message: "on" };
}

/** Turns alerts off for one device (by id from the list, or by this browser's address). */
export async function disableAlerts(target: { id?: string; endpoint?: string }): Promise<FormState> {
  const { supabase } = await requireFullSession();
  let query = supabase.from("push_subscriptions").update({ disabled_at: new Date().toISOString() }).is("disabled_at", null);
  if (target.id && isUuid(target.id)) query = query.eq("id", target.id);
  else if (target.endpoint && target.endpoint.length <= 1000) query = query.eq("endpoint", target.endpoint);
  else return { error: "That device could not be found." };
  const { error } = await query;
  if (error) return { error: "Could not turn alerts off. Please try again." };
  revalidatePath("/settings");
  return { message: "off" };
}

export async function sendTest(): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const result = await sendTestAlert(supabase);
  revalidatePath("/settings");
  if (result === "no-key") return { error: "Alerts are not set up yet. Create the alert key first." };
  if (result === "no-devices") return { error: "Turn alerts on for a device first." };
  const parts = [`Test alert sent to ${result.sent.length} ${result.sent.length === 1 ? "device" : "devices"}.`];
  if (result.gone.length > 0) parts.push(`${result.gone.length} no longer accepted alerts and ${result.gone.length === 1 ? "was" : "were"} turned off.`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} could not be reached; try again later.`);
  return result.sent.length > 0 ? { message: parts.join(" ") } : { error: parts.join(" ") };
}
