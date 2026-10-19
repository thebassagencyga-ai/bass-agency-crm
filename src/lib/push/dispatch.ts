// Delivering alerts (Phase 26, ADR-044). The I/O (claiming from the database, HTTP) is passed in,
// so the logic is unit tested and the server-only module (send.ts) stays a thin wrapper.
import { type PushKey, type PushSubscriptionKeys, pushRequest, subscriptionGone } from "./webpush";

export interface Device extends PushSubscriptionKeys {
  id: string;
}

export interface DeliveryResult {
  sent: string[];
  /** The device unsubscribed (404/410): turn it off. */
  gone: string[];
  failed: string[];
}

/** Sends one message to each device, at most 5 seconds each; never throws. */
export async function deliver(
  devices: Device[], message: object, key: PushKey, subject: string, fetcher: typeof fetch = fetch,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: [], gone: [], failed: [] };
  await Promise.all(devices.map(async (d) => {
    try {
      const { url, init } = await pushRequest(d, message, key, subject);
      const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(5000) });
      if (res.ok) result.sent.push(d.id);
      else if (subscriptionGone(res.status)) result.gone.push(d.id);
      else result.failed.push(d.id);
    } catch {
      result.failed.push(d.id);
    }
  }));
  return result;
}
