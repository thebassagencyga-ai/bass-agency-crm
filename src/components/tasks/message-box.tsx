"use client";

import { useState } from "react";

/** Shows a ready-to-send message with Copy, "Text it" and "Email it". The CRM itself never sends it. */
export function MessageBox({ message, smsHref, mailHref = null }: { message: string; smsHref: string | null; mailHref?: string | null }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <section aria-labelledby="message-heading" className="flex flex-col gap-2 rounded-md border border-line p-3 bg-card">
      <h2 id="message-heading" className="text-lg font-semibold">Message</h2>
      <p className="whitespace-pre-wrap break-words rounded-md bg-subtle p-3">{message}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="min-h-11 rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Copy</button>
        {smsHref ? (
          <a href={smsHref} className="flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover">Text it</a>
        ) : (
          <p className="self-center text-sm text-muted">Add a mobile number to the contact to text from here.</p>
        )}
        {mailHref ? (
          <a href={mailHref} className="flex min-h-11 items-center rounded-md border border-line-strong bg-card hover:bg-subtle px-4 font-medium">Email it</a>
        ) : null}
      </div>
      <p aria-live="polite" className="text-sm">
        {copied === "copied" ? "Copied." : copied === "failed" ? "Couldn't copy automatically — press and hold the message to copy it." : ""}
      </p>
      <p className="text-xs text-muted">&quot;Text it&quot; and &quot;Email it&quot; open your phone&apos;s Messages or Mail app with this text filled in. Nothing is sent until you press send there.</p>
    </section>
  );
}
