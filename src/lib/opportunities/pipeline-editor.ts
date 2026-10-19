// Settings → Pipelines (Phase 25, ADR-043): validation for saving a pipeline. Mirrors the
// database rules (save_pipeline and the commit-time checks) so the agent sees field errors first.
import { z } from "zod";
import { PRODUCT_LINES } from "@/lib/pipelines";

export const MAX_PIPELINES = 10;
export const MIN_STAGES = 3;
export const MAX_STAGES = 12;
export const MAX_NAME = 40;

const name = (label: string) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, `Enter a name for the ${label}.`).max(MAX_NAME, `Keep the ${label} name to ${MAX_NAME} characters.`));

const stageSchema = z.object({
  id: z.uuid().nullable().optional(),
  name: name("stage"),
  kind: z.enum(["active", "won", "lost"]),
  quote: z.boolean().optional(),
});

export type StageDraft = z.input<typeof stageSchema>;

export const pipelineFormSchema = z
  .object({
    id: z.uuid().nullable(),
    name: name("pipeline"),
    lines: z.array(z.enum(PRODUCT_LINES)).max(PRODUCT_LINES.length),
    stages: z.array(stageSchema),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["stages"], message });
    const kinds = v.stages.map((s) => s.kind);
    if (v.stages.length < MIN_STAGES || v.stages.length > MAX_STAGES) {
      issue(`A pipeline has ${MIN_STAGES} to ${MAX_STAGES} stages, Won and Lost included.`);
    } else if (!kinds.includes("active")) {
      issue("Add at least one working stage before Won and Lost.");
    } else if (kinds.filter((k) => k === "won").length !== 1 || kinds.filter((k) => k === "lost").length !== 1
      || kinds.at(-2) !== "won" || kinds.at(-1) !== "lost") {
      issue("Keep exactly one Won stage and one Lost stage, at the end.");
    } else if (v.stages.filter((s) => s.quote && s.kind === "active").length > 1) {
      issue("Mark at most one stage as the quote stage.");
    }
    const names = v.stages.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length) issue("Give each stage a different name.");
  });

export type PipelineForm = z.output<typeof pipelineFormSchema>;

/** Reads the editor's form: name, ticked lines and the stages (sent as JSON). */
export function parsePipelineForm(form: { id: unknown; name: unknown; lines: unknown[]; stages: unknown }) {
  let stages: unknown = [];
  try {
    stages = typeof form.stages === "string" ? JSON.parse(form.stages) : [];
  } catch {
    stages = null;
  }
  return pipelineFormSchema.safeParse({
    id: typeof form.id === "string" && form.id !== "" ? form.id : null,
    name: typeof form.name === "string" ? form.name : "",
    lines: form.lines.filter((l) => typeof l === "string"),
    stages,
  });
}

/** What the database function takes: stages in order; existing ones keep their kind. */
export function toSaveArgs(f: PipelineForm) {
  return {
    p_id: f.id,
    p_name: f.name,
    p_lines: f.lines,
    p_stages: f.stages.map((s) => ({ id: s.id ?? null, name: s.name, kind: s.kind, quote: s.kind === "active" && Boolean(s.quote) })),
  };
}

/** A new pipeline starts with these; the agent renames, adds or removes before saving. */
export const NEW_PIPELINE_STAGES: StageDraft[] = [
  { name: "New Lead", kind: "active" },
  { name: "Contacted", kind: "active" },
  { name: "Quoted", kind: "active", quote: true },
  { name: "Follow Up", kind: "active" },
  { name: "Bound", kind: "won" },
  { name: "Lost", kind: "lost" },
];
