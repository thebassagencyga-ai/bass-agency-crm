"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { isUuid } from "@/lib/contacts/data";
import { parsePipelineForm, toSaveArgs } from "@/lib/opportunities/pipeline-editor";

// Settings → Pipelines (Phase 25). Writes go through the agent's own client (RLS) and the
// save_pipeline function, whose commit-time checks back up the validation here.

/** Our own database messages (raised in the migration) are written for the agent; show them. */
function dbMessage(error: { code?: string; message?: string } | null): string {
  if (error && ["23514", "P0002", "22023"].includes(error.code ?? "") && error.message) return error.message;
  if (error?.code === "23505") return "Another pipeline already has that name.";
  return "Could not save the pipeline. Please try again.";
}

export async function savePipeline(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values = {
    name: String(formData.get("name") ?? "").slice(0, 200),
    stages: String(formData.get("stages") ?? "").slice(0, 10_000),
  };
  const parsed = parsePipelineForm({
    id: formData.get("id"),
    name: formData.get("name"),
    lines: formData.getAll("lines"),
    stages: formData.get("stages"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { fieldErrors, values };
  }
  const { data, error } = await supabase.rpc("save_pipeline", toSaveArgs(parsed.data));
  if (error || typeof data !== "string") return { error: dbMessage(error), values };
  revalidatePath("/settings/pipelines");
  revalidatePath("/opportunities");
  redirect(`/settings/pipelines?saved=${data}`);
}

export async function archivePipeline(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { error: "This pipeline could not be found." };
  const { data, error } = await supabase
    .from("pipelines").update({ archived_at: new Date().toISOString() }).eq("id", id).is("archived_at", null).select("id");
  if (error) return { error: dbMessage(error) };
  if (!data || data.length === 0) return { error: "This pipeline could not be found." };
  revalidatePath("/settings/pipelines");
  revalidatePath("/opportunities");
  redirect("/settings/pipelines?archived=1");
}
