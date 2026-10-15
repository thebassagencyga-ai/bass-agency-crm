import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/contacts/data";
import { DEFAULT_TIME_ZONE } from "@/lib/dates";
import { TASKS_PAGE_SIZE, type TaskListParams } from "./params";
import type { Task, TaskListRow } from "./types";

// Reads go through the signed-in user's Supabase client, so RLS decides what is visible.

export interface Profile {
  id: string;
  display_name: string;
  time_zone: string;
  google_review_url: string | null;
}

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("id, display_name, time_zone, google_review_url").eq("id", userId).maybeSingle();
  if (error) throw new Error(`Could not load your profile (${error.code ?? "unknown"}).`);
  return (data as Profile | null) ?? { id: userId, display_name: "", time_zone: DEFAULT_TIME_ZONE, google_review_url: null };
}

export async function listTasks(supabase: SupabaseClient, p: TaskListParams, today: string) {
  const { data, error } = await supabase.rpc("search_tasks", {
    p_view: p.view,
    p_today: today,
    p_product_line: p.line,
    p_priority: p.priority,
    p_category: p.category,
    p_contact_id: null,
    p_limit: TASKS_PAGE_SIZE + 1,
    p_offset: (p.page - 1) * TASKS_PAGE_SIZE,
  });
  if (error) throw new Error(`Could not load tasks (${error.code ?? "unknown"}).`);
  const rows = (data ?? []) as TaskListRow[];
  return { rows: rows.slice(0, TASKS_PAGE_SIZE), hasMore: rows.length > TASKS_PAGE_SIZE };
}

export async function taskCounts(supabase: SupabaseClient, today: string) {
  const { data, error } = await supabase.rpc("task_counts", { p_today: today });
  if (error) throw new Error(`Could not count tasks (${error.code ?? "unknown"}).`);
  const row = (data as { overdue: number | string; due_today: number | string; upcoming: number | string }[] | null)?.[0];
  return { overdue: Number(row?.overdue ?? 0), today: Number(row?.due_today ?? 0), upcoming: Number(row?.upcoming ?? 0) };
}

export async function getTask(supabase: SupabaseClient, id: string): Promise<Task | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the task (${error.code ?? "unknown"}).`);
  return (data as Task | null) ?? null;
}

/** All of a contact's tasks (open first by due date, then done), for the contact page. */
export async function tasksForContact(supabase: SupabaseClient, contactId: string): Promise<Task[]> {
  const { data, error } = await supabase.from("tasks").select("*").eq("contact_id", contactId).order("due_date");
  if (error) throw new Error(`Could not load tasks (${error.code ?? "unknown"}).`);
  return (data ?? []) as Task[];
}

/** Message templates of the review and referral rules (seeded per user, ADR-013). */
export async function messageTemplates(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("automation_rules")
    .select("rule_key, config")
    .in("rule_key", ["review_request", "referral_request"]);
  if (error) throw new Error(`Could not load message templates (${error.code ?? "unknown"}).`);
  const templates: Record<string, string> = {};
  for (const row of (data ?? []) as { rule_key: string; config: { message_template?: unknown } | null }[]) {
    const t = row.config?.message_template;
    if (typeof t === "string") templates[row.rule_key] = t;
  }
  return templates;
}
