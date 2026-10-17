"use server";

import { z } from "zod";
import { runJob, type AiResult } from "@/lib/ai/run";
import { findSensitive } from "@/lib/ai/guard";
import {
  briefingRequest, checkBriefing, checkDraft, checkImport, checkNotes, draftRequest, importInput, importRequest,
  notesInput, notesRequest, type ActivitySuggestion,
} from "@/lib/ai/jobs";
import { requireFullSession } from "@/lib/auth/require";
import { getContact, isUuid } from "@/lib/contacts/data";
import { formatDateOnly, todayInZone } from "@/lib/dates";
import { countNewSubmissions } from "@/lib/intake/data";
import { valuesFor } from "@/lib/messages/templates";
import { getOpportunity } from "@/lib/opportunities/data";
import { PRODUCT_LINE_NAMES, type ProductLine } from "@/lib/pipelines";
import { getProfile } from "@/lib/tasks/data";
import type { ImportField } from "@/lib/import/fields";

// AI helpers (Phase 19, ADR-035). Each action re-checks the two-step session, gathers only the
// data its job needs (from the database, not from the browser), and returns a suggestion. None of
// them saves, changes or sends anything.

const sensitive = (text: string): AiResult<never> | null => {
  const what = findSensitive(text);
  return what ? { ok: false, error: `This looks like it contains ${what}. Remove it first — it must not be sent to the AI (or stored in the CRM).` } : null;
};

const draftArgs = z.object({
  contactId: z.string().refine(isUuid),
  opportunityId: z.string().refine(isUuid).nullable(),
  purpose: z.string().min(1).max(60),
  currentText: z.string().max(2000),
  instruction: z.string().max(300),
  channel: z.enum(["text", "email"]),
});

export async function aiDraftMessage(args: z.input<typeof draftArgs>): Promise<AiResult<{ subject: string; body: string }>> {
  const { supabase, userId } = await requireFullSession();
  const parsed = draftArgs.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Something about the request wasn't right. Please try again." };
  const a = parsed.data;
  const blocked = sensitive(`${a.instruction}\n${a.currentText}`);
  if (blocked) return blocked;
  const [contact, profile, opp] = await Promise.all([
    getContact(supabase, a.contactId), getProfile(supabase, userId), a.opportunityId ? getOpportunity(supabase, a.opportunityId) : Promise.resolve(null),
  ]);
  if (!contact) return { ok: false, error: "This contact could not be found." };
  const v = valuesFor(contact, profile.display_name, opp && opp.contact_id === contact.id ? opp : null, formatDateOnly);
  const result = await runJob(supabase, draftRequest({
    purpose: a.purpose, first_name: v.first_name, agent_name: v.agent_name, line: v.line, renewal_date: v.renewal_date,
    current_text: a.currentText, instruction: a.instruction.trim(), channel: a.channel,
  }));
  if (!result.ok) return result;
  const draft = checkDraft(result.value, a.channel);
  return draft ? { ok: true, value: draft } : { ok: false, error: "The AI returned an empty message. Please try again." };
}

export async function aiNotesToActivity(notes: string): Promise<AiResult<ActivitySuggestion>> {
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const parsed = notesInput.safeParse({ notes, today });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the notes and try again." };
  const blocked = sensitive(parsed.data.notes);
  if (blocked) return blocked;
  const result = await runJob(supabase, notesRequest(parsed.data));
  return result.ok ? { ok: true, value: checkNotes(result.value, today) } : result;
}

export async function aiDailyBriefing(): Promise<AiResult<{ summary: string; priorities: string[] }>> {
  const { supabase, userId } = await requireFullSession();
  const profile = await getProfile(supabase, userId);
  const today = todayInZone(profile.time_zone);
  const tasksFor = async (view: "overdue" | "today") => {
    const { data } = await supabase.rpc("search_tasks", {
      p_view: view, p_today: today, p_product_line: null, p_priority: null, p_category: null, p_contact_id: null, p_limit: 25, p_offset: 0,
    });
    return (data ?? []) as { title: string; first_name: string | null; business_name: string | null; due_date: string; priority: string }[];
  };
  const [overdue, dueToday, renewals, newRequests] = await Promise.all([
    tasksFor("overdue"), tasksFor("today"),
    supabase.rpc("search_renewals", { p_today: today, p_days: 30, p_product_line: null }).then(({ data }) =>
      ((data ?? []) as { first_name: string | null; business_name: string | null; product_line: ProductLine; renewal_date: string; outcome: string }[])),
    countNewSubmissions(supabase).catch(() => 0),
  ]);
  // First names only (or the business name): no last names, phones, emails or notes.
  const who = (r: { first_name: string | null; business_name: string | null }) => r.first_name ?? r.business_name ?? null;
  const result = await runJob(supabase, briefingRequest({
    today,
    tasks: [...overdue, ...dueToday].map((t) => ({ title: t.title, first_name: who(t), due: t.due_date, priority: t.priority })),
    renewals: renewals.filter((r) => r.outcome === "won").map((r) => ({ first_name: who(r), line: PRODUCT_LINE_NAMES[r.product_line], renews: r.renewal_date })),
    new_requests: newRequests,
  }));
  return result.ok ? { ok: true, value: checkBriefing(result.value) } : result;
}

export async function aiSuggestImport(headers: string[], policyTypes: string[]): Promise<AiResult<{ mapping: Partial<Record<ImportField, number>>; lines: Record<string, string> }>> {
  const { supabase } = await requireFullSession();
  const parsed = importInput.safeParse({ headers, policy_types: policyTypes });
  if (!parsed.success) return { ok: false, error: "The file's headings could not be read for suggestions." };
  const blocked = sensitive([...parsed.data.headers, ...parsed.data.policy_types].join("\n"));
  if (blocked) return blocked;
  const result = await runJob(supabase, importRequest(parsed.data));
  return result.ok ? { ok: true, value: checkImport(result.value, parsed.data) } : result;
}
