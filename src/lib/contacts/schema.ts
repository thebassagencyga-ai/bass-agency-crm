// Server-side validation for contact forms. Mirrors the database constraints in
// supabase/migrations/20261014150000_core_schema.sql so users see friendly field errors
// before the database would reject the row.
import { z } from "zod";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { formatUsPhone } from "./format";
import { CONTACT_METHODS, CONTACT_TYPES, RELATIONSHIP_STATUSES } from "./types";

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
};

const optionalText = (max: number, label: string) =>
  z.preprocess(blankToNull, z.string().max(max, `${label} is too long (max ${max} characters).`).nullable());

export const contactFormSchema = z
  .object({
    contact_type: z.enum(CONTACT_TYPES, { message: "Choose individual or business." }),
    first_name: optionalText(100, "First name"),
    last_name: optionalText(100, "Last name"),
    business_name: optionalText(200, "Business name"),
    email: z.preprocess(
      (v) => {
        const t = blankToNull(v);
        return typeof t === "string" ? t.toLowerCase() : t;
      },
      z.email("Enter a valid email address.").max(254).nullable(),
    ),
    phone: z.preprocess((v) => blankToNull(typeof v === "string" ? formatUsPhone(v) : v), z.string().max(32, "Phone is too long.").nullable()),
    alt_phone: z.preprocess((v) => blankToNull(typeof v === "string" ? formatUsPhone(v) : v), z.string().max(32, "Phone is too long.").nullable()),
    address_line1: optionalText(200, "Address"),
    address_line2: optionalText(200, "Address line 2"),
    city: optionalText(100, "City"),
    state: z.preprocess(
      (v) => {
        const t = blankToNull(v);
        return typeof t === "string" ? t.toUpperCase() : t;
      },
      z.string().regex(/^[A-Z]{2}$/, "Use the 2-letter state code, e.g. GA.").nullable(),
    ),
    postal_code: z.preprocess(blankToNull, z.string().regex(/^[0-9]{5}(-[0-9]{4})?$/, "Use a 5-digit ZIP code (or ZIP+4).").nullable()),
    preferred_contact_method: z.preprocess(blankToNull, z.enum(CONTACT_METHODS).nullable()),
    lead_source: optionalText(100, "Lead source"),
    relationship_status: z.preprocess(
      (v) => blankToNull(v) ?? undefined,
      z.enum(RELATIONSHIP_STATUSES).default("prospect"),
    ),
    referred_by_contact_id: z.preprocess(blankToNull, z.uuid("Choose the referrer from the list.").nullable()),
    google_review_left_on: z.preprocess(
      blankToNull,
      z
        .string()
        .refine(isIsoDate, "Enter a valid date.")
        .refine((d) => d <= todayInZone(), "This date is in the future.")
        .nullable(),
    ),
    notes: optionalText(5000, "Notes"),
  })
  .superRefine((c, ctx) => {
    if (c.contact_type === "individual" && !c.first_name && !c.last_name) {
      ctx.addIssue({ code: "custom", path: ["first_name"], message: "Enter a first or last name." });
    }
    if (c.contact_type === "business" && !c.business_name) {
      ctx.addIssue({ code: "custom", path: ["business_name"], message: "Enter the business name." });
    }
  });

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export const CONTACT_FORM_FIELDS = [
  "contact_type", "first_name", "last_name", "business_name", "email", "phone", "alt_phone",
  "address_line1", "address_line2", "city", "state", "postal_code", "preferred_contact_method",
  "lead_source", "relationship_status", "referred_by_contact_id", "google_review_left_on", "notes",
] as const;
