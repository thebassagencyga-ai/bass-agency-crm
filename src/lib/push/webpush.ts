// Web Push (Phase 26, ADR-044): message encryption (RFC 8291, aes128gcm per RFC 8188) and the
// VAPID signature (RFC 8292), with nothing but WebCrypto, so it runs the same in the Cloudflare
// Worker, the browser and the tests. Pure apart from randomness; unit tested against an
// independent implementation (http_ece) in tests/unit/webpush.test.ts.

const enc = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url.");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

// TS 5.9's Uint8Array<ArrayBufferLike> is not accepted where WebCrypto wants a BufferSource.
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;

/** The app's push key (Cloudflare secret PUSH_KEY): base64url of the JSON {x, y, d} of a P-256 key. */
export interface PushKey {
  /** Uncompressed public key (65 bytes): the browser's applicationServerKey and VAPID "k". */
  publicKey: Uint8Array;
  jwk: JsonWebKey;
}

export function parsePushKey(secret: string | undefined): PushKey | null {
  if (!secret) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(b64urlDecode(secret.trim()))) as { x?: unknown; y?: unknown; d?: unknown };
    if (typeof raw.x !== "string" || typeof raw.y !== "string" || typeof raw.d !== "string") return null;
    const x = b64urlDecode(raw.x);
    const y = b64urlDecode(raw.y);
    if (x.length !== 32 || y.length !== 32 || b64urlDecode(raw.d).length !== 32) return null;
    return {
      publicKey: concat(new Uint8Array([4]), x, y),
      jwk: { kty: "EC", crv: "P-256", x: raw.x, y: raw.y, d: raw.d, ext: true },
    };
  } catch {
    return null;
  }
}

/** A new push key, made in the agent's browser (Settings → Alerts); shown once, never stored. */
export async function generatePushKey(): Promise<{ secret: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const secret = b64urlEncode(enc.encode(JSON.stringify({ x: jwk.x, y: jwk.y, d: jwk.d })));
  return { secret, publicKey: b64urlEncode(parsePushKey(secret)!.publicKey) };
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf(data)));
}

/**
 * Proof that the caller holds the push key, without revealing it: the database keeps only the
 * SHA-256 of this value, and hands queued alerts only to whoever presents it.
 */
export async function dispatchProof(key: PushKey): Promise<string> {
  return b64urlEncode(await sha256(enc.encode(`producr-push-dispatch:${key.jwk.d}`)));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, length * 8));
}

export interface EncryptInput {
  /** The subscription's p256dh key (65 bytes) and auth secret (16 bytes). */
  uaPublic: Uint8Array;
  authSecret: Uint8Array;
  plaintext: Uint8Array;
  /** Fixed only in tests; random otherwise. */
  salt?: Uint8Array;
  senderKeys?: CryptoKeyPair;
}

/** One aes128gcm record (RFC 8188) holding the message, keyed as RFC 8291 describes. */
export async function encryptPayload(input: EncryptInput): Promise<Uint8Array> {
  if (input.uaPublic.length !== 65 || input.uaPublic[0] !== 4) throw new Error("Bad subscription key.");
  if (input.authSecret.length !== 16) throw new Error("Bad subscription auth secret.");
  if (input.plaintext.length > 3000) throw new Error("Message too long.");
  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = input.senderKeys
    ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", buf(input.uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256));

  const ikm = await hkdf(input.authSecret, ecdh, concat(enc.encode("WebPush: info\0"), input.uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // Last (only) record: the message followed by the 0x02 delimiter, no padding.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, aes, buf(concat(input.plaintext, new Uint8Array([2])))));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/** VAPID JWT (ES256) for the push service's origin, valid for 12 hours. */
export async function vapidJwt(endpoint: string, key: PushKey, subject: string, now = Date.now()): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: subject,
  })));
  const signingKey = await crypto.subtle.importKey("jwk", key.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto returns r||s (64 bytes), which is exactly the JWS ES256 signature format.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, buf(enc.encode(`${header}.${claims}`))));
  return `${header}.${claims}.${b64urlEncode(signature)}`;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The HTTP request that delivers one message to one device. */
export async function pushRequest(sub: PushSubscriptionKeys, message: object, key: PushKey, subject: string): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload({
    uaPublic: b64urlDecode(sub.p256dh),
    authSecret: b64urlDecode(sub.auth),
    plaintext: enc.encode(JSON.stringify(message)),
  });
  return {
    url: sub.endpoint,
    init: {
      method: "POST",
      headers: {
        Authorization: `vapid t=${await vapidJwt(sub.endpoint, key, subject)}, k=${b64urlEncode(key.publicKey)}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high",
      },
      body: buf(body),
    },
  };
}

/** Push services answer 404/410 when the device has unsubscribed: that subscription is gone. */
export const subscriptionGone = (status: number) => status === 404 || status === 410;

/** Only https endpoints on the public internet are accepted from browsers. */
export function isAcceptableEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && endpoint.length <= 1000 && !/^(localhost|127\.|10\.|192\.168\.|\[)/.test(u.hostname);
  } catch {
    return false;
  }
}

/** The alert itself: no customer details, ever (owner decision, ADR-039). */
export const NEW_QUOTE_REQUEST_ALERT = { title: "New quote request", body: "Open Producr CRM to review it.", url: "/intake" } as const;
export const TEST_ALERT = { title: "Producr CRM alerts are on", body: "This is a test. New quote requests will show up like this.", url: "/settings#alerts" } as const;
