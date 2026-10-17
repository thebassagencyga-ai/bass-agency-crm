// The four AI helpers (Phase 19, ADR-035): what each sends, what it must return, and how the
// answer is checked. Pure; unit tested. Each job sends the minimum needed — never last names,
// phone numbers, email or street addresses, never notes or policy details beyond what is listed
// here — and its answer is only ever a suggestion the user reviews.
import { z } from "zod";
import { ACTIVITY_OUTCOMES, ACTIVITY_TYPES } from "@/lib/activities/types";
import { addDays, isIsoDate } from "@/lib/dates";
import { IMPORT_FIELDS, type ImportField } from "@/lib/import/fields";
import { PRODUCT_LINES } from "@/lib/pipelines";

export const AI_JOBS = ["draft_message", "notes_to_activity", "daily_briefing", "import_cleanup"] as const;
export type AiJob = (typeof AI_JOBS)[number];

export interface JobRequest<T> {
  job: AiJob;
  system: string;
  user: string;
  maxTokens: number;
  /** Shape the model must answer in (structured output). Kept simple: limits are checked by `check`. */
  output: z.ZodType<T>;
}

const SHARED_RULES =
  "You help an independent insurance agent in Georgia, USA run their practice. Write plain, warm, professional US English. " +
  "Never invent facts, prices, coverage details or promises. Never ask for or mention Social Security numbers, dates of birth, " +
  "driver's license numbers, bank or card details, or health information.";

// ---------------------------------------------------------------------------
// 1. Draft a message (text or email). Sent: purpose, first name, agent name, line, renewal date,
//    the current text and the user's instruction. Nothing is sent or saved by the CRM.
// ---------------------------------------------------------------------------
export const draftInput = z.object({
  purpose: z.string().min(1).max(60),
  first_name: z.string().max(100).nullable(),
  agent_name: z.string().max(100).nullable(),
  line: z.string().max(30).nullable(),
  renewal_date: z.string().max(40).nullable(),
  current_text: z.string().max(2000),
  instruction: z.string().max(300),
  channel: z.enum(["text", "email"]),
});
export type DraftInput = z.infer<typeof draftInput>;
export const draftOutput = z.object({ subject: z.string(), body: z.string() });

export function draftRequest(input: DraftInput): JobRequest<z.infer<typeof draftOutput>> {
  return {
    job: "draft_message",
    system: `${SHARED_RULES} Draft a short ${input.channel === "text" ? "text message (under 320 characters, no subject needed)" : "email (a subject line and a body of a few short paragraphs)"} from the agent to a client or prospect. Sign with the agent's name when given. Return only the message.`,
    user: JSON.stringify({
      purpose: input.purpose,
      client_first_name: input.first_name,
      agent_name: input.agent_name,
      insurance_line: input.line,
      renewal: input.renewal_date,
      current_draft: input.current_text,
      agent_instruction: input.instruction || null,
    }),
    maxTokens: 1500,
    output: draftOutput,
  };
}

export function checkDraft(out: z.infer<typeof draftOutput>, channel: "text" | "email") {
  const body = out.body.trim().slice(0, channel === "text" ? 640 : 2000);
  const subject = channel === "email" ? out.subject.trim().slice(0, 200) : "";
  return body ? { subject, body } : null;
}

// ---------------------------------------------------------------------------
// 2. Call notes → activity. Sent: the notes the user typed (checked by guard.ts first) and
//    today's date. Returned values fill the "Log activity" form; the user saves it.
// ---------------------------------------------------------------------------
export const notesInput = z.object({ notes: z.string().trim().min(10, "Write a little more first.").max(3000), today: z.string().refine(isIsoDate) });
export const notesOutput = z.object({
  activity_type: z.enum(ACTIVITY_TYPES),
  outcome: z.enum(ACTIVITY_OUTCOMES).nullable(),
  follow_up_date: z.string().nullable(),
  summary: z.string(),
});
export type ActivitySuggestion = { activity_type: (typeof ACTIVITY_TYPES)[number]; outcome: (typeof ACTIVITY_OUTCOMES)[number] | null; requested_follow_up_on: string | null; notes: string };

export function notesRequest(input: z.infer<typeof notesInput>): JobRequest<z.infer<typeof notesOutput>> {
  return {
    job: "notes_to_activity",
    system:
      `${SHARED_RULES} Turn the agent's rough notes about one interaction into a CRM activity: what kind of contact it was, ` +
      "the outcome if clear, a follow-up date only if one was agreed (as YYYY-MM-DD, resolving words like \"next Tuesday\" from today's date), " +
      "and a clean summary of the notes in the agent's voice, keeping every fact and adding none. Leave out anything sensitive (see above).",
    user: JSON.stringify({ today: input.today, notes: input.notes }),
    maxTokens: 2000,
    output: notesOutput,
  };
}

export function checkNotes(out: z.infer<typeof notesOutput>, today: string): ActivitySuggestion {
  const date = out.follow_up_date && isIsoDate(out.follow_up_date) && out.follow_up_date >= today && out.follow_up_date <= addDays(today, 730)
    ? out.follow_up_date : null;
  return {
    activity_type: out.activity_type,
    outcome: date && !out.outcome ? "requested_follow_up" : out.outcome,
    requested_follow_up_on: date,
    notes: out.summary.trim().slice(0, 5000),
  };
}

// ---------------------------------------------------------------------------
// 3. Daily briefing. Sent: today's open/overdue task titles with the client's FIRST name, due
//    dates and priority; renewals in the next 30 days (first name, line, date); the number of new
//    quote requests. Shown on the dashboard; nothing is saved.
// ---------------------------------------------------------------------------
export interface BriefingInput {
  today: string;
  tasks: { title: string; first_name: string | null; due: string; priority: string }[];
  renewals: { first_name: string | null; line: string; renews: string }[];
  new_requests: number;
}
export const briefingOutput = z.object({ summary: z.string(), priorities: z.array(z.string()) });

export function briefingRequest(input: BriefingInput): JobRequest<z.infer<typeof briefingOutput>> {
  return {
    job: "daily_briefing",
    system:
      `${SHARED_RULES} Write the agent's morning briefing from the CRM data given: a two- or three-sentence overview of the day, ` +
      "then up to five priorities in order, each one short line saying what to do and why now (overdue first, then today's high priority, " +
      "then renewals coming up). Use only the data given.",
    user: JSON.stringify({ ...input, tasks: input.tasks.slice(0, 40), renewals: input.renewals.slice(0, 20) }),
    maxTokens: 2000,
    output: briefingOutput,
  };
}

export function checkBriefing(out: z.infer<typeof briefingOutput>) {
  return { summary: out.summary.trim().slice(0, 1500), priorities: out.priorities.map((p) => p.trim().slice(0, 300)).filter(Boolean).slice(0, 5) };
}

// ---------------------------------------------------------------------------
// 4. Import clean-up. Sent: the CSV's column headings and its distinct policy-type values only —
//    never a client row. Suggestions fill the column and policy-type choices; the user checks them.
// ---------------------------------------------------------------------------
export const importInput = z.object({
  headers: z.array(z.string().max(80)).min(1).max(60),
  policy_types: z.array(z.string().max(80)).max(60),
});
const FIELD_KEYS = IMPORT_FIELDS.map((f) => f.key) as [ImportField, ...ImportField[]];
export const importOutput = z.object({
  columns: z.array(z.object({ field: z.enum(FIELD_KEYS), column: z.number().int().nullable() })),
  policy_types: z.array(z.object({ value: z.string(), line: z.enum([...PRODUCT_LINES, "skip"]) })),
});

export function importRequest(input: z.infer<typeof importInput>): JobRequest<z.infer<typeof importOutput>> {
  return {
    job: "import_cleanup",
    system:
      `${SHARED_RULES} Match the columns of a client/policy report exported from an insurance carrier's system to CRM fields, ` +
      "and each policy type in the report to a line: auto, home (homeowners, renters, dwelling, condo), commercial (business, farm, BOP), " +
      "life, or skip (anything else, e.g. boat, umbrella, motorcycle). Give each field the 0-based index of the matching column, or null " +
      "if no column fits. Use a column for at most one field. Prefer separate first/last name columns over a full-name column when both exist.",
    user: JSON.stringify({
      crm_fields: IMPORT_FIELDS.map((f) => ({ field: f.key, meaning: f.label })),
      columns: input.headers.map((h, i) => ({ index: i, heading: h })),
      policy_types: input.policy_types,
    }),
    maxTokens: 3000,
    output: importOutput,
  };
}

export function checkImport(out: z.infer<typeof importOutput>, input: z.infer<typeof importInput>) {
  const used = new Set<number>();
  const mapping: Partial<Record<ImportField, number>> = {};
  for (const { field, column } of out.columns) {
    if (column === null || column < 0 || column >= input.headers.length || used.has(column) || field in mapping) continue;
    used.add(column);
    mapping[field] = column;
  }
  const known = new Set(input.policy_types);
  const lines: Record<string, (typeof PRODUCT_LINES)[number] | "skip"> = {};
  for (const { value, line } of out.policy_types) if (known.has(value)) lines[value] = line;
  return { mapping, lines };
}
