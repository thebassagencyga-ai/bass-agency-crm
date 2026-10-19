import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
// http_ece is the encryption library used by the standard Node "web-push" package: an
// independent implementation of RFC 8188/8291, used here only to decrypt what we send.
// @ts-expect-error: the package ships no type declarations
import ece from "http_ece";
import {
  NEW_QUOTE_REQUEST_ALERT, b64urlDecode, b64urlEncode, dispatchProof, encryptPayload, generatePushKey, isAcceptableEndpoint,
  parsePushKey, pushRequest, subscriptionGone, vapidJwt,
} from "@/lib/push/webpush";

// Phase 26 (ADR-044): Web Push encryption and VAPID signatures.

/** A fictional device: its ECDH key pair and auth secret, as a browser subscription would hold. */
function device() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, p256dh: b64urlEncode(ecdh.getPublicKey()), authB64: b64urlEncode(auth) };
}

const decrypt = (body: Uint8Array, d: ReturnType<typeof device>) =>
  (ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: d.ecdh, authSecret: d.auth }) as Buffer).toString("utf8");

describe("base64url", () => {
  it("round-trips bytes and refuses other alphabets", () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
    expect(b64urlEncode(bytes)).toBe("APv_Pj8B");
    expect(b64urlDecode("APv_Pj8B")).toEqual(bytes);
    expect(() => b64urlDecode("AP+/")).toThrow();
  });
});

describe("push key", () => {
  it("is made in the browser, parsed back, and its proof never contains it", async () => {
    const { secret, publicKey } = await generatePushKey();
    const key = parsePushKey(secret)!;
    expect(key.publicKey).toHaveLength(65);
    expect(b64urlEncode(key.publicKey)).toBe(publicKey);
    const proof = await dispatchProof(key);
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret).not.toContain(proof);
    expect(proof).not.toContain(key.jwk.d!);
    expect(await dispatchProof(parsePushKey(secret)!)).toBe(proof); // stable
  });

  it("refuses missing or malformed keys", () => {
    expect(parsePushKey(undefined)).toBeNull();
    expect(parsePushKey("")).toBeNull();
    expect(parsePushKey("not-a-key")).toBeNull();
    expect(parsePushKey(b64urlEncode(new TextEncoder().encode(JSON.stringify({ x: "AA", y: "AA", d: "AA" }))))).toBeNull();
  });
});

describe("encryption (RFC 8291, aes128gcm)", () => {
  it("decrypts with http_ece exactly as a device would", async () => {
    const d = device();
    const message = JSON.stringify(NEW_QUOTE_REQUEST_ALERT);
    const body = await encryptPayload({ uaPublic: d.ecdh.getPublicKey(), authSecret: d.auth, plaintext: new TextEncoder().encode(message) });
    expect(decrypt(body, d)).toBe(message);
    // Header: salt (16) | record size 4096 | key id length 65 | sender key (65).
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
    expect(body[21]).toBe(4);
  });

  it("uses a fresh salt and sender key every time", async () => {
    const d = device();
    const p = new TextEncoder().encode("same");
    const a = await encryptPayload({ uaPublic: d.ecdh.getPublicKey(), authSecret: d.auth, plaintext: p });
    const b = await encryptPayload({ uaPublic: d.ecdh.getPublicKey(), authSecret: d.auth, plaintext: p });
    expect(b64urlEncode(a.slice(0, 86))).not.toBe(b64urlEncode(b.slice(0, 86)));
  });

  it("refuses a bad subscription key, auth secret or an oversized message", async () => {
    const d = device();
    await expect(encryptPayload({ uaPublic: new Uint8Array(64), authSecret: d.auth, plaintext: new Uint8Array(1) })).rejects.toThrow();
    await expect(encryptPayload({ uaPublic: d.ecdh.getPublicKey(), authSecret: new Uint8Array(8), plaintext: new Uint8Array(1) })).rejects.toThrow();
    await expect(encryptPayload({ uaPublic: d.ecdh.getPublicKey(), authSecret: d.auth, plaintext: new Uint8Array(3001) })).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a 12-hour ES256 token for the push service's origin, verifiable with the public key", async () => {
    const key = parsePushKey((await generatePushKey()).secret)!;
    const now = Date.UTC(2026, 9, 19, 12);
    const jwt = await vapidJwt("https://web.push.apple.com/QGuQyavXut/abc", key, "https://crm.example.com", now);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(c)))).toEqual({
      aud: "https://web.push.apple.com", exp: now / 1000 + 43200, sub: "https://crm.example.com",
    });
    const pub = await crypto.subtle.importKey("raw", key.publicKey.slice().buffer as ArrayBuffer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s).slice().buffer as ArrayBuffer, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("pushRequest", () => {
  it("builds the delivery request: VAPID header, aes128gcm body the device can read, a day to live", async () => {
    const key = parsePushKey((await generatePushKey()).secret)!;
    const d = device();
    const { url, init } = await pushRequest({ endpoint: "https://web.push.apple.com/x", p256dh: d.p256dh, auth: d.authB64 }, NEW_QUOTE_REQUEST_ALERT, key, "https://crm.example.com");
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://web.push.apple.com/x");
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${b64urlEncode(key.publicKey)}$`));
    expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "86400", Urgency: "high" });
    const sent = JSON.parse(decrypt(new Uint8Array(init.body as ArrayBuffer), d));
    expect(sent).toEqual({ title: "New quote request", body: "Open Producr CRM to review it.", url: "/intake" });
  });

  it("the new-request alert carries no customer details", () => {
    expect(Object.keys(NEW_QUOTE_REQUEST_ALERT).sort()).toEqual(["body", "title", "url"]);
  });
});

describe("helpers", () => {
  it("treats 404 and 410 as an unsubscribed device", () => {
    expect([200, 201, 404, 410, 429, 500].map(subscriptionGone)).toEqual([false, false, true, true, false, false]);
  });
  it("accepts only public https endpoints", () => {
    expect(isAcceptableEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAcceptableEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    for (const bad of ["http://web.push.apple.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://10.0.0.1/a", "https://192.168.1.2/a", "ftp://x/y", "nope"]) {
      expect(isAcceptableEndpoint(bad)).toBe(false);
    }
  });
});
