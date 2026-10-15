// Server-side validation for task forms. Mirrors the database constraints.
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "./types";

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};

export const taskFormSchema = z
  .object({
    title: z.preprocess(blankToNull, z.string({ message: "Enter what needs doing." }).max(200, "Keep the title under 200 characters.")),
    description: z.preprocess(blankToNull, z.string().max(2000, "Details are too long (max 2,000 characters).").nullable()),
    due_date: z.preprocess(blankToNull, z.string({ message: "Choose a due date." }).refine(isIsoDate, "Enter a valid date.")),
    start_date: z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable()),
    priority: z.preprocess((v) => blankToNull(v) ?? undefined, z.enum(TASK_PRIORITIES).default("normal")),
    category: z.preprocess((v) => blankToNull(v) ?? undefined, z.enum(TASK_CATEGORIES).default("other")),
    opportunity_id: z.preprocess(blankToNull, z.uuid("Choose an opportunity from the list.").nullable()),
  })
  .superRefine((t, ctx) => {
    if (t.start_date && t.due_date && t.start_date > t.due_date) {
      ctx.addIssue({ code: "custom", path: ["start_date"], message: "The start date can't be after the due date." });
    }
  });

export const newTaskSchema = taskFormSchema.and(z.object({ contact_id: z.uuid("Choose a contact.") }));

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export const TASK_FORM_FIELDS = ["title", "description", "due_date", "start_date", "priority", "category", "opportunity_id"] as const;
