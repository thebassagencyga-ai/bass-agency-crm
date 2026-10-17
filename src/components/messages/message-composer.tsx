"use client";

import Link from "next/link";
import { useState } from "react";
import { mailtoHref, smsHref, telHref } from "@/lib/messages/links";
import { renderTemplate, TEMPLATES, type TemplateKey, type TemplateValues } from "@/lib/messages/templates";

const PRIMARY = "flex min-h-11 items-center justify-center rounded-md bg-slate-900 px-4 font-medium text-white dark:bg-slate-100 dark:text-slate-900";
const SECONDARY = "flex min-h-11 items-center justify-center rounded-md border border-slate-900 px-4 font-medium dark:border-slate-100";
const INPUT = "min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

/**
 * Call / Text / Email with a ready-made, editable message (Phase 16, ADR-032). Text and Email open
 * the phone's own Messages and Mail apps pre-filled; the CRM never sends anything itself.
 * `logHref`: where "Log it" goes (the contact page's activity form); null hides it.
 */
export function MessageComposer({
  phone, email, values, templates, initial, logHref,
}: {
  phone: string | null; email: string | null; values: TemplateValues;
  templates: readonly TemplateKey[]; initial: TemplateKey; logHref: string | null;
}) {
  const [key, setKey] = useState<TemplateKey>(initial);
  const [subject, setSubject] = useState(() => renderTemplate(initial, values).subject);
  const [body, setBody] = useState(() => renderTemplate(initial, values).body);
  const [opened, setOpened] = useState<"text_message" | "email" | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  function choose(next: TemplateKey) {
    const filled = renderTemplate(next, values);
    setKey(next);
    setSubject(filled.subject);
    setBody(filled.body);
    setCopied("idle");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  const call = telHref(phone);
  const text = smsHref(phone, body);
  const mail = mailtoHref(email, subject, body);
  const logLink = logHref && opened ? `${logHref}${logHref.includes("?") ? "&" : "?"}log=${opened}&about=${key}#log-activity` : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="message-template" className="text-sm font-medium">Message</label>
        <select id="message-template" value={key} onChange={(e) => choose(e.target.value as TemplateKey)} className={INPUT}>
          {templates.map((t) => <option key={t} value={t}>{TEMPLATES[t].label}</option>)}
        </select>
      </div>
      {email ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="message-subject" className="text-sm font-medium">Email subject</label>
          <input id="message-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="message-body" className="text-sm font-medium">Text</label>
        <textarea id="message-body" value={body} rows={5} maxLength={2000} onChange={(e) => setBody(e.target.value)} className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {text ? <a href={text} onClick={() => setOpened("text_message")} className={PRIMARY}>Text</a> : null}
        {mail ? <a href={mail} onClick={() => setOpened("email")} className={PRIMARY}>Email</a> : null}
        {call ? <a href={call} className={SECONDARY}>Call</a> : null}
        <button type="button" onClick={copy} className={SECONDARY}>Copy</button>
      </div>
      {!text && !mail ? <p className="text-sm text-slate-600 dark:text-slate-400">Add a mobile number or email address to text or email from here.</p> : null}
      <p aria-live="polite" className="text-sm">
        {copied === "copied" ? "Copied." : copied === "failed" ? "Couldn't copy automatically — press and hold the text to copy it." : ""}
      </p>
      {logLink ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900">
          Sent it?
          <Link href={logLink} className="inline-flex min-h-11 items-center font-medium underline">Log this {opened === "email" ? "email" : "text"}</Link>
        </p>
      ) : null}
      <p className="text-xs text-slate-500">
        Text and Email open your phone&apos;s Messages or Mail app with this filled in. Nothing is sent until you press send there,
        and nothing you type here is saved.
      </p>
    </div>
  );
}
