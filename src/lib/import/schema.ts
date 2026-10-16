// Server-side check of an import before it reaches the database (Phase 15). The client builds
// the rows with build.ts; nothing it sends is trusted.
import { z } from "zod";
import { PRODUCT_LINES } from "@/lib/pipelines";
import { MAX_IMPORT_CLIENTS } from "./build";

const text = (max: number) => z.string().trim().max(max).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const policy = z.object({
  line: z.enum(PRODUCT_LINES),
  carrier: text(100),
  premium: z.number().nonnegative().max(9_999_999).nullable(),
  effective_date: date,
  renewal_date: date,
  term_months: z.union([z.literal(6), z.literal(12)]).nullable(),
});

const contact = z.object({
  contact_type: z.enum(["individual", "business"]),
  first_name: text(100),
  last_name: text(100),
  business_name: text(200),
  email: z.email().max(254).nullable(),
  phone: text(32),
  alt_phone: text(32),
  address_line1: text(200),
  city: text(100),
  state: z.string().regex(/^[A-Z]{2}$/).nullable(),
  postal_code: z.string().regex(/^\d{5}(-\d{4})?$/).nullable(),
  lead_source: text(100),
}).refine((c) => (c.contact_type === "business" ? !!c.business_name : !!(c.first_name || c.last_name)), "A name is required.");

export const importPayloadSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  clients: z.array(z.object({
    existing_contact_id: z.uuid().nullable(),
    contact,
    policies: z.array(policy).max(50),
  })).min(1).max(MAX_IMPORT_CLIENTS),
});
export type ImportPayload = z.infer<typeof importPayloadSchema>;
