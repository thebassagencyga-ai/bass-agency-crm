// Household members and vehicles on a contact (Phase 14, ADR-029). Names and relationship
// only; year, make and model only. Never dates of birth, license numbers or VINs.
import { z } from "zod";

export const HOUSEHOLD_RELATIONSHIPS = ["spouse", "child", "parent", "other"] as const;
export type HouseholdRelationship = (typeof HOUSEHOLD_RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<HouseholdRelationship, string> = {
  spouse: "Spouse or partner",
  child: "Child",
  parent: "Parent",
  other: "Other",
};

export const MAX_HOUSEHOLD = 6;
export const MAX_VEHICLES = 4;

export interface HouseholdMember {
  id: string;
  first_name: string;
  last_name: string | null;
  relationship: HouseholdRelationship;
}
export interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string | null;
}

/** Oldest and newest model year accepted (matches the database: 1900 … this year + 2). */
export const vehicleYearRange = (now: Date = new Date()) => ({ min: 1900, max: now.getUTCFullYear() + 2 });

const text = (max: number, message: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max, message));
const optional = (max: number, message: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null), z.string().max(max, message).nullable());

export const householdMemberSchema = z.object({
  first_name: text(100, "Keep the first name under 100 characters.").pipe(z.string().min(1, "Enter a first name.")),
  last_name: optional(100, "Keep the last name under 100 characters."),
  relationship: z.preprocess((v) => (v === "" || v === null || v === undefined ? "other" : v), z.enum(HOUSEHOLD_RELATIONSHIPS, { message: "Choose a relationship." })),
});

export function vehicleSchema(now: Date = new Date()) {
  const { min, max } = vehicleYearRange(now);
  return z.object({
    year: z.preprocess(
      (v) => (typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : v),
      z.number({ message: "Enter the 4-digit year." }).int().min(min, `Enter a year from ${min} to ${max}.`).max(max, `Enter a year from ${min} to ${max}.`),
    ),
    make: text(50, "Keep the make under 50 characters.").pipe(z.string().min(1, "Enter the make, for example Ford.")),
    model: optional(50, "Keep the model under 50 characters."),
  });
}
