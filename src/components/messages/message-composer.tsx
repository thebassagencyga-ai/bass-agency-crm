"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { aiDraftMessage } from "@/app/(app)/ai/actions";
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
  phone, email, values, templates, initial, logHref, ai = null,
}: {
  phone: string | null; email: string | null; values: TemplateValues;
  templates: readonly TemplateKey[]; initial: TemplateKey; logHref: string | null;
  /** AI drafting (Phase 19), only when the helpers are connected and the message is about a saved contact. */
  ai?: { contactId: string; opportunityId: string | null } | null;
}) {
  const [key, setKey] = useState<TemplateKey>(initial);
  const [subject, setSubject] = useState(() => renderTemplate(initial, values).subject);
  const [body, setBody] = useState(() => renderTemplate(initial, values).body);
  const [opened, setOpened] = useState<"text_message" | "email" | null>(null);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [instruction, setInstruction] = useState("");
  const [channel, setChannel] = useState<"text" | "email">(phone || !email ? "text" : "email");
  const [aiNote, setAiNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafting, startDraft] = useTransition();

  function draftWithAi() {
    if (!ai) return;
    setAiNote(null);
    startDraft(async () => {
      const result = await aiDraftMessage({
        contactId: ai.contactId, opportunityId: ai.opportunityId, purpose: TEMPLATES[key].label,
        currentText: body, instruction, channel,
      });
      if (result.ok) {
        setBody(result.value.body);
        if (result.value.subject) setSubject(result.value.subject);
        setAiNote({ ok: true, text: "AI draft below. Read it and change anything before you send it." });
      } else setAiNote({ ok: false, text: result.error });
    });
  }

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
      {ai ? (
        <details className="rounded-md border border-dashed border-slate-300 p-2 dark:border-slate-600">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Draft with AI…</summary>
          <div className="flex flex-col gap-2">
            <label htmlFor="ai-channel" className="text-sm font-medium">Draft a</label>
            <select id="ai-channel" value={channel} onChange={(e) => setChannel(e.target.value as "text" | "email")} className={INPUT}>
              <option value="text">Text message</option><option value="email">Email</option>
            </select>
            <label htmlFor="ai-instruction" className="text-sm font-medium">What should it say? <span className="font-normal text-slate-500">(optional)</span></label>
            <input id="ai-instruction" value={instruction} maxLength={300} onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. mention I can review their home policy too" className={INPUT} />
            <button type="button" onClick={draftWithAi} disabled={drafting} className={`${SECONDARY} disabled:opacity-60`}>{drafting ? "Drafting…" : "Write a draft"}</button>
            <p className="text-xs text-slate-500">Sends the client&apos;s first name, the line and renewal date, the text below and your note to the AI. Nothing is sent to the client.</p>
          </div>
        </details>
      ) : null}
      {aiNote ? <p role={aiNote.ok ? "status" : "alert"} className={`text-sm ${aiNote.ok ? "" : "text-red-700 dark:text-red-400"}`}>{aiNote.text}</p> : null}
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
        and the CRM keeps no copy of what you type here.
      </p>
    </div>
  );
}
