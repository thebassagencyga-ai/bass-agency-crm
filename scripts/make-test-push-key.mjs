// Prints a throwaway alert key (PUSH_KEY) for CI and local test builds only (Phase 26).
// Production keys are made in the owner's browser (Settings → Alerts) and never printed in logs.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(Buffer.from(JSON.stringify({ x: jwk.x, y: jwk.y, d: jwk.d })).toString("base64url"));
