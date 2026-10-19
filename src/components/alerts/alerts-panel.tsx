"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { disableAlerts, enableAlerts, sendTest } from "@/app/(app)/settings/alert-actions";
import { FormAlert, useActionForm } from "@/components/form";
import { b64urlDecode, generatePushKey } from "@/lib/push/webpush";

const BUTTON = "min-h-11 rounded-md border border-line-strong bg-card px-4 font-medium hover:bg-subtle disabled:opacity-60";
const PRIMARY = "min-h-11 rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover disabled:opacity-60";

type Support = "checking" | "ok" | "install" | "unsupported" | "denied";

/** What this browser can do; read on the client only ("checking" while rendering on the server). */
function detectSupport(): Support {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return /iphone|ipad/i.test(navigator.userAgent) && !standalone ? "install" : "unsupported";
  }
  return Notification.permission === "denied" ? "denied" : "ok";
}
const noSubscription = () => () => {};

/** Settings → Alerts (Phase 26, ADR-044): turn new-lead alerts on or off for this device; test. */
export function AlertsPanel({ publicKey, devices }: { publicKey: string; devices: { id: string; label: string; since: string; lastAlert: string | null }[] }) {
  const detected = useSyncExternalStore(noSubscription, detectSupport, () => "checking" as Support);
  const [deniedNow, setDeniedNow] = useState(false);
  const support: Support = deniedNow ? "denied" : detected;
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useActionForm(sendTest);

  useEffect(() => {
    if (detectSupport() !== "ok") return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setThisEndpoint(sub?.endpoint ?? null))
      .catch(() => setThisEndpoint(null));
  }, []);

  async function turnOn() {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (permission === "denied") setDeniedNow(true);
        setNote({ ok: false, text: "Alerts need permission to show notifications." });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = b64urlDecode(publicKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with an older alert key cannot receive alerts: replace it.
      const current = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (sub && (!current || current.join() !== key.join())) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key.slice().buffer as ArrayBuffer });
      const result = await enableAlerts(JSON.stringify(sub.toJSON()), navigator.userAgent);
      if (result.error) setNote({ ok: false, text: result.error });
      else {
        setThisEndpoint(sub.endpoint);
        setNote({ ok: true, text: "Alerts are on for this device. Send a test alert to check." });
      }
    } catch {
      setNote({ ok: false, text: "This browser could not turn alerts on. Try again, or use another browser." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await disableAlerts({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setThisEndpoint(null);
      setNote({ ok: true, text: "Alerts are off for this device." });
    } catch {
      setNote({ ok: false, text: "Could not turn alerts off. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3">
      {note ? <p role={note.ok ? "status" : "alert"} className={`rounded-md p-3 text-sm ${note.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{note.text}</p> : null}
      {support === "install" ? (
        <p className="text-sm">On iPhone, alerts work from the Home Screen app: tap Share → <strong>Add to Home Screen</strong>, open Producr from its icon, and come back here.</p>
      ) : support === "unsupported" ? (
        <p className="text-sm">This browser cannot receive alerts. On iPhone, use the Home Screen app (iOS 16.4 or later).</p>
      ) : support === "denied" ? (
        <p className="text-sm">Notifications are blocked for Producr on this device. Allow them in the device&apos;s settings, then come back here.</p>
      ) : null}
      {support === "ok" ? (
        thisEndpoint ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Alerts are on for this device.</span>
            <button type="button" onClick={turnOff} disabled={busy} className={BUTTON}>{busy ? "Turning off…" : "Turn off on this device"}</button>
          </div>
        ) : (
          <button type="button" onClick={turnOn} disabled={busy} className={`${PRIMARY} w-fit`}>{busy ? "Turning on…" : "Turn on alerts on this device"}</button>
        )
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Devices with alerts on</h3>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul aria-label="Devices with alerts on" className="flex flex-col divide-y divide-line rounded-md border border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                <span>{d.label} <span className="text-muted">· since {d.since}{d.lastAlert ? ` · last alert ${d.lastAlert}` : ""}</span></span>
                <button type="button" className={BUTTON} onClick={async () => { await disableAlerts({ id: d.id }); }} aria-label={`Turn off alerts for ${d.label}`}>Turn off</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={test.formAction} onSubmit={test.onSubmit} className="flex flex-col gap-2">
        <FormAlert state={test.state} />
        {test.state.message ? <p role="status" className="rounded-md bg-good-soft p-3 text-sm text-good">{test.state.message}</p> : null}
        <button type="submit" disabled={test.pending || devices.length === 0} className={`${BUTTON} w-fit`}>{test.pending ? "Sending…" : "Send a test alert"}</button>
      </form>
    </div>
  );
}

/** Shown while alerts are not set up: makes the app's alert key in this browser, shown once. */
export function AlertKeyMaker() {
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-3 text-sm">
      <p>Alerts are not set up yet. One-time setup (about 5 minutes):</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Create the alert key below. It is made on this device and shown once; it is not saved anywhere else.</li>
        <li>In Cloudflare: Workers &amp; Pages → <strong>bass-agency-crm</strong> → Settings → Variables and Secrets → Add → type <strong>Secret</strong>, name <strong>PUSH_KEY</strong>, paste the key, Deploy.</li>
        <li>Reload this page and turn alerts on for your iPhone.</li>
      </ol>
      <p className="text-muted">Never paste the key into chat, email or a document.</p>
      {secret ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="alert-key" className="font-medium">Alert key (copy it now)</label>
          <textarea id="alert-key" readOnly value={secret} rows={4} className="w-full min-w-0 rounded-md border border-line-strong bg-subtle p-2 font-mono text-xs break-all" />
          <button type="button" className={`${BUTTON} w-fit`} onClick={async () => { await navigator.clipboard.writeText(secret); setCopied(true); }}>
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      ) : (
        <button type="button" className={`${PRIMARY} w-fit`} onClick={async () => setSecret((await generatePushKey()).secret)}>Create alert key</button>
      )}
    </div>
  );
}
