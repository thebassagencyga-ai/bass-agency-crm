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
  await form.getByRole("checkbox", { name: "Auto" }).check();
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
  await page.reload();
  await expect(page.getByText("None yet.")).toBeVisible();
});
