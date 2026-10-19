import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliver } from "@/lib/push/dispatch";
import { deviceLabel, subscriptionSchema } from "@/lib/push/device";
import { NEW_QUOTE_REQUEST_ALERT, b64urlEncode, generatePushKey, parsePushKey } from "@/lib/push/webpush";

// Phase 26 (ADR-044): delivering to devices, and what Settings accepts from the browser.

function device(id: string, endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { id, endpoint, p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(randomBytes(16)) };
}

describe("deliver", () => {
  it("sorts devices into sent, gone (404/410) and failed (errors, other statuses), never throwing", async () => {
    const key = parsePushKey((await generatePushKey()).secret)!;
    const devices = [
      device("ok", "https://push.example.com/ok"), device("gone", "https://push.example.com/gone"),
      device("busy", "https://push.example.com/busy"), device("down", "https://push.example.com/down"),
    ];
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/down")) throw new Error("network");
      return new Response(null, { status: url.endsWith("/ok") ? 201 : url.endsWith("/gone") ? 410 : 429 });
    }) as unknown as typeof fetch;
    const r = await deliver(devices, NEW_QUOTE_REQUEST_ALERT, key, "https://crm.example.com", fetcher);
    expect(r).toEqual({ sent: ["ok"], gone: ["gone"], failed: expect.arrayContaining(["busy", "down"]) });
    expect(calls.sort()).toEqual(devices.map((d) => d.endpoint).sort());
  });

  it("a device with broken keys fails on its own; the others still get the alert", async () => {
    const key = parsePushKey((await generatePushKey()).secret)!;
    const good = device("good", "https://push.example.com/good");
    const r = await deliver([{ ...good, id: "bad", p256dh: "AAAA" }, good], NEW_QUOTE_REQUEST_ALERT, key, "https://crm.example.com",
      (async () => new Response(null, { status: 201 })) as unknown as typeof fetch);
    expect(r).toEqual({ sent: ["good"], gone: [], failed: ["bad"] });
  });
});

describe("subscriptionSchema", () => {
  const ok = { endpoint: "https://web.push.apple.com/QG/abc", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
  it("accepts a browser subscription", () => {
    expect(subscriptionSchema.safeParse(ok).success).toBe(true);
  });
  it.each([
    ["an http endpoint", { ...ok, endpoint: "http://web.push.apple.com/x" }],
    ["a local endpoint", { ...ok, endpoint: "https://127.0.0.1/x" }],
    ["a bad key", { ...ok, keys: { ...ok.keys, p256dh: "not a key" } }],
    ["a missing auth", { ...ok, keys: { p256dh: ok.keys.p256dh } }],
  ])("refuses %s", (_label, value) => {
    expect(subscriptionSchema.safeParse(value).success).toBe(false);
  });
});

describe("deviceLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "iPad"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0", "Windows (Edge)"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Windows (Chrome)"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Mac (Safari)"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", "Android (Chrome)"],
    ["curl/8", "This device"],
  ])("%s → %s", (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});
