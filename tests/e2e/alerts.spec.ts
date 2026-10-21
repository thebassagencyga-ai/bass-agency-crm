import { createECDH, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { b64urlEncode, dispatchProof, parsePushKey } from "../../src/lib/push/webpush";
import { anonClient, createTestUser, fullSessionClient, fullSessionCookies } from "../support/supabase";

// Phase 26 (ADR-044): new-lead alerts. A real push service cannot be reached from the test
// machine, so the device here points at an address that never resolves (.invalid): the test shows
// that the alert is handed out in the background after a public quote request, that the request
// is saved whatever happens to the alert, and that Settings reports an unreachable device.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("a quote request hands out its alert in the background; the request never depends on it", async ({ page, context }) => {
  test.setTimeout(120_000);
  const key = parsePushKey(process.env.PUSH_KEY);
  test.skip(!key, "PUSH_KEY is not set for this run");
  const owner = await createTestUser("e2e-alerts");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);

  // Settings → Alerts, before any device: the panel (the key is set), nothing to test yet.
  await page.goto("/settings#alerts");
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await expect(page.getByText("None yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a test alert" })).toBeDisabled();
  expect(await page.content()).not.toContain(process.env.PUSH_KEY!);

  // A device with alerts on (what the browser would register), at an unreachable address.
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const proofHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await dispatchProof(key!))));
  const { data: device, error } = await api.from("push_subscriptions").insert({
    endpoint: `https://push.invalid/${randomBytes(8).toString("hex")}`,
    p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(randomBytes(16)), device_label: "iPhone",
    dispatch_hash: `\\x${Buffer.from(proofHash).toString("hex")}`,
  }).select("id").single();
  expect(error).toBeNull();

  // Test alert: the device cannot be reached, and Settings says so.
  await page.reload();
  await expect(page.getByRole("list", { name: "Devices with alerts on" })).toContainText("iPhone");
  await page.getByRole("button", { name: "Send a test alert" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 could not be reached" })).toBeVisible({ timeout: 20_000 });

  // A public quote request: saved and thanked straight away; the alert is handed out afterwards.
  const { data: token } = await api.rpc("rotate_intake_link");
  const form = await context.newPage();
  await form.goto(`${APP_URL}/quote/${token as string}`);
  await form.getByLabel("First name").fill("Jordan");
  await form.getByLabel("Last name").fill("Example");
  await form.getByRole("textbox", { name: /^Phone/ }).fill("404 555 0177");
  await form.getByRole("checkbox", { name: "Auto", exact: true }).check();
  await form.getByRole("checkbox", { name: /I agree that The Bass Agency may contact me/ }).check();
  await form.getByRole("button", { name: "Send my request" }).click();
  await expect(form.getByText("Thank you — we have your request.")).toBeVisible();

  await expect.poll(async () => (await api.from("push_subscriptions").select("last_alert_at").eq("id", device!.id).single()).data?.last_alert_at ?? null, { timeout: 20_000 })
    .not.toBeNull();
  const { count } = await api.from("intake_submissions").select("id", { count: "exact", head: true });
  expect(count).toBe(1);
  // Handed out once: nothing is left for anyone holding the key.
  const { data: again } = await anonClient().rpc("claim_push_alerts", { p_proof: await dispatchProof(key!) });
  expect((again as { subscription_id: string }[]).filter((r) => r.subscription_id === device!.id)).toEqual([]);

  // Settings shows when the last alert went out; turning the device off removes it from the list.
  await page.reload();
  await expect(page.getByRole("list", { name: "Devices with alerts on" })).toContainText("last alert");
  await page.getByRole("button", { name: "Turn off alerts for iPhone" }).click();
  // Wait for the save before reloading (the reload could otherwise cancel it).
  await expect.poll(async () => (await api.from("push_subscriptions").select("disabled_at").eq("id", device!.id).single()).data?.disabled_at ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await page.reload();
  await expect(page.getByText("None yet.")).toBeVisible();
});

test("turn alerts on and off from Settings (the browser's push system simulated)", async ({ page, context }) => {
  test.skip(!parsePushKey(process.env.PUSH_KEY), "PUSH_KEY is not set for this run");
  const owner = await createTestUser("e2e-alerts-on");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  // What a phone's browser would hand over: a push address and its keys (fictional device).
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(randomBytes(16)) };
  await context.addInitScript((k) => {
    type Sub = { endpoint: string; options: { applicationServerKey: ArrayBuffer | null }; toJSON(): object; unsubscribe(): Promise<boolean> };
    let sub: Sub | null = null;
    const proto = (window as unknown as { PushManager: { prototype: Record<string, unknown> } }).PushManager.prototype;
    proto.getSubscription = async () => sub;
    proto.subscribe = async (opts: { applicationServerKey: ArrayBuffer }) => {
      sub = {
        endpoint: "https://push.invalid/simulated-device",
        options: { applicationServerKey: opts.applicationServerKey },
        toJSON() { return { endpoint: this.endpoint, keys: k }; },
        unsubscribe: async () => { sub = null; return true; },
      };
      return sub;
    };
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    Notification.requestPermission = async () => "granted";
  }, keys);

  await page.goto("/settings#alerts");
  await page.getByRole("button", { name: "Turn on alerts on this device" }).click();
  await expect(page.getByText("Alerts are on for this device. Send a test alert to check.")).toBeVisible();
  const { data: rows } = await api.from("push_subscriptions").select("endpoint, p256dh, auth, device_label, disabled_at");
  expect(rows).toEqual([{ endpoint: "https://push.invalid/simulated-device", p256dh: keys.p256dh, auth: keys.auth, device_label: "iPhone", disabled_at: null }]);

  // Off on this device, then on again: the same device row is turned back on. (No reload in
  // between: the simulated push system lives in the page, unlike a real phone's.)
  await page.getByRole("button", { name: "Turn off on this device" }).click();
  await expect(page.getByText("Alerts are off for this device.")).toBeVisible();
  expect((await api.from("push_subscriptions").select("disabled_at").single()).data!.disabled_at).not.toBeNull();
  await page.getByRole("button", { name: "Turn on alerts on this device" }).click();
  await expect(page.getByText("Alerts are on for this device. Send a test alert to check.")).toBeVisible();
  const { data: again } = await api.from("push_subscriptions").select("disabled_at");
  expect(again).toEqual([{ disabled_at: null }]);
  await page.reload();
  await expect(page.getByRole("list", { name: "Devices with alerts on" })).toContainText("iPhone");
});
