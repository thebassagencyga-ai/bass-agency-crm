// Server-side validation for logging an activity. Times are typed in the user's zone.
import { z } from "zod";
import { DEFAULT_TIME_ZONE, isIsoDate, zonedLocalToIso } from "@/lib/dates";
import { ACTIVITY_OUTCOMES, ACTIVITY_TYPES } from "./types";

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};

/** Builds the schema for a given time zone and clock (injectable for tests). */
export function activitySchema(timeZone: string = DEFAULT_TIME_ZONE, now: () => Date = () => new Date()) {
  return z
    .object({
      activity_type: z.enum(ACTIVITY_TYPES, { message: "Choose what happened." }),
      occurred_at: z.preprocess(
        blankToNull,
        z
          .string({ message: "Enter when it happened." })
          .transform((local, ctx) => {
            const iso = zonedLocalToIso(local, timeZone);
            if (!iso) {
              ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
              return z.NEVER;
            }
            return iso;
          })
          // A few minutes of leeway for clock differences.
          .refine((iso) => new Date(iso).getTime() <= now().getTime() + 5 * 60_000, "This is in the future."),
      ),
      outcome: z.preprocess(blankToNull, z.enum(ACTIVITY_OUTCOMES).nullable()),
      requested_follow_up_on: z.preprocess(blankToNull, z.string().refine(isIsoDate, "Enter a valid date.").nullable()),
      notes: z.preprocess(blankToNull, z.string().max(5000, "Notes are too long (max 5,000 characters).").nullable()),
      opportunity_id: z.preprocess(blankToNull, z.uuid().nullable()),
      task_id: z.preprocess(blankToNull, z.uuid().nullable()),
    })
    .superRefine((a, ctx) => {
      if (a.outcome === "requested_follow_up" && !a.requested_follow_up_on) {
        ctx.addIssue({ code: "custom", path: ["requested_follow_up_on"], message: "Enter the date they asked you to follow up." });
      }
      if (a.requested_follow_up_on && a.outcome !== "requested_follow_up") {
        ctx.addIssue({ code: "custom", path: ["requested_follow_up_on"], message: "Only used when they asked for a follow-up on a date." });
      }
    });
}

export const ACTIVITY_FORM_FIELDS = ["activity_type", "occurred_at", "outcome", "requested_follow_up_on", "notes", "opportunity_id", "task_id"] as const;
