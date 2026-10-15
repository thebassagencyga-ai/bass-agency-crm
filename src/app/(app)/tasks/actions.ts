"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { ACTIVITY_FORM_FIELDS, activitySchema } from "@/lib/activities";
import { requireFullSession } from "@/lib/auth/require";
import { safeNextPath } from "@/lib/auth/routing";
import { isUuid } from "@/lib/contacts/data";
import { TASK_FORM_FIELDS, newTaskSchema, taskFormSchema } from "@/lib/tasks";
import { noResponseNeedsConfirmation } from "@/lib/automation/data";
import { getProfile, getTask } from "@/lib/tasks/data";

// Every action re-checks the full (two-step) session on the server and writes through the
// user's own Supabase client, so RLS and the database constraints apply as well.

function echo(formData: FormData, fields: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of fields) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 5000);
  }
  return values;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

function friendlyDbError(code: string | undefined, what: string): FormState {
  if (code === "23503") return { error: "That contact, opportunity or task could not be found for this contact." };
  if (code === "23514") return { error: "Some details are not valid. Check the fields and try again." };
  if (code === "42501") return { error: "You don't have permission to do that. Sign in again and retry." };
  return { error: `Could not save the ${what}. Please try again.` };
}

function revalidateTask(contactId: string) {
  revalidatePath("/tasks");
  revalidatePath(`/contacts/${contactId}`);
}

export async function createTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echo(formData, [...TASK_FORM_FIELDS, "contact_id"]);
  const raw = Object.fromEntries([...TASK_FORM_FIELDS, "contact_id"].map((f) => [f, formData.get(f)]));
  const parsed = newTaskSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };

  const { data: row, error } = await supabase.from("tasks").insert({ ...parsed.data, origin: "manual" }).select("id").single();
  if (error || !row) return { ...friendlyDbError(error?.code, "task"), values };
  revalidateTask(parsed.data.contact_id);
  redirect(`/tasks/${row.id as string}?saved=1`);
}

export async function updateTask(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = echo(formData, TASK_FORM_FIELDS);
  const task = await getTask(supabase, String(formData.get("id") ?? ""));
  if (!task) return { error: "This task could not be found.", values };
  const parsed = taskFormSchema.safeParse(Object.fromEntries(TASK_FORM_FIELDS.map((f) => [f, formData.get(f)])));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };

  // An automation task whose date the owner changes keeps that date (ADR-008, Phase 6).
  const overridden = task.due_date_overridden || (task.origin === "automation" && parsed.data.due_date !== task.due_date);
  const { error } = await supabase.from("tasks").update({ ...parsed.data, due_date_overridden: overridden }).eq("id", task.id);
  if (error) return { ...friendlyDbError(error.code, "task"), values };
  revalidateTask(task.contact_id);
  redirect(`/tasks/${task.id}?saved=1`);
}

const STATUS_NOTICE = { completed: "completed", open: "reopened", cancelled: "cancelled" } as const;

/** Complete, reopen or cancel. Returns to the page the button was on. */
export async function setTaskStatus(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const status = z.enum(["open", "completed", "cancelled"]).safeParse(formData.get("status"));
  const task = await getTask(supabase, String(formData.get("id") ?? ""));
  const backRaw = String(formData.get("back") ?? "");
  const back = backRaw ? safeNextPath(backRaw) : null;
  const go = (flag: string): never => {
    const target = back ?? `/tasks/${task?.id ?? ""}`;
    return redirect(`${target}${target.includes("?") ? "&" : "?"}${flag}=1`);
  };
  if (!task || !status.success) go("error");
  const { error } = await supabase.from("tasks").update({ status: status.data }).eq("id", task!.id);
  if (error) go("error");
  revalidateTask(task!.contact_id);
  go(STATUS_NOTICE[status.data!]);
}

export async function logActivity(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireFullSession();
  const values = echo(formData, ACTIVITY_FORM_FIELDS);
  const contactId = String(formData.get("contact_id") ?? "");
  if (!isUuid(contactId)) return { fieldErrors: { contact_id: "Choose the contact from the list." }, values };
  const profile = await getProfile(supabase, userId);
  const parsed = activitySchema(profile.time_zone).safeParse(Object.fromEntries(ACTIVITY_FORM_FIELDS.map((f) => [f, formData.get(f)])));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };

  const { data: row, error } = await supabase.from("activities").insert({ ...parsed.data, contact_id: contactId }).select("id").single();
  if (error || !row) return { ...friendlyDbError(error?.code, "activity"), values };
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/tasks");
  // "No response": offer the follow-up when the owner has asked to confirm it (Phase 6 rule).
  const noResponse = parsed.data.outcome === "no_response" || parsed.data.outcome === "no_answer";
  if (noResponse && (await noResponseNeedsConfirmation(supabase))) {
    redirect(`/contacts/${contactId}?logged=1&noresponse=${row.id as string}#follow-up-offer`);
  }
  redirect(`/contacts/${contactId}?logged=1`);
}

const profileSchema = z.object({
  display_name: z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(100, "Keep it under 100 characters.")),
  google_review_url: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
    z
      .string()
      .max(500, "That link is too long.")
      .regex(/^https:\/\/\S+$/, "Paste the full link, starting with https://")
      .nullable(),
  ),
});

export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requireFullSession();
  const values = echo(formData, ["display_name", "google_review_url"]);
  const parsed = profileSchema.safeParse({ display_name: formData.get("display_name"), google_review_url: formData.get("google_review_url") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values };
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", userId);
  if (error) return { error: "Could not save your settings. Please try again.", values };
  revalidatePath("/settings");
  return { message: "Settings saved.", values };
}

/** The owner confirms the "no response" follow-up offered after logging an activity. */
export async function confirmNoResponseFollowUp(formData: FormData): Promise<void> {
  const { supabase } = await requireFullSession();
  const activityId = String(formData.get("activity_id") ?? "");
  const contactId = String(formData.get("contact_id") ?? "");
  if (!isUuid(activityId) || !isUuid(contactId)) redirect("/contacts");
  const { data, error } = await supabase.rpc("confirm_no_response_follow_up", { p_activity_id: activityId });
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/tasks");
  redirect(`/contacts/${contactId}?${error || data === 0 ? "followupnone" : "followup"}=1`);
}
