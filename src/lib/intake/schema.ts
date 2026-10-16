// Server-side validation of the intake form (public and quick intake). The database checks
// everything again (crm_engine.intake_clean): the public function can be called directly
// with the publishable key, so these checks are for friendly messages, not for security.
import { z } from "zod";
import { MAX_HOUSEHOLD, MAX_VEHICLES, householdMemberSchema, vehicleSchema } from "@/lib/contacts/details";
import { formatUsPhone } from "@/lib/contacts/format";
import { type ProductLine } from "@/lib/pipelines";
import {
  HEARD_ABOUT_OPTIONS, INTAKE_CONTACT_METHODS, INTAKE_LINES, type CoverageEntry, type HouseholdEntry, type IntakePayload,
  type VehicleEntry,
} from "./types";

export const INTAKE_TEXT_FIELDS = [
  "first_name", "last_name", "phone", "email", "address_line1", "city", "state", "postal_code",
  "preferred_contact_method", "best_time", "heard_about", "referred_by_name",
] as const;

/** Repeating rows: other people in the household, and vehicles. */
const HOUSEHOLD_FIELDS = ["hh_first", "hh_last", "hh_rel"] as const;
const VEHICLE_FIELDS = ["veh_year", "veh_make", "veh_model"] as const;
const rowNames = (fields: readonly string[], max: number) =>
  Array.from({ length: max }, (_, i) => fields.map((f) => `${f}_${i}`)).flat();

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const orNull = (v: string) => (v === "" ? null : v);

export type IntakeParse =
  | { ok: true; payload: IntakePayload; consent: boolean }
  | { ok: false; fieldErrors: Record<string, string> };

/** Reads and checks the intake fields of a submitted form. `requireConsent`: public form only. */
export function parseIntakeForm(
  formData: FormData,
  { requireConsent, now = new Date() }: { requireConsent: boolean; now?: Date },
): IntakeParse {
  const errors: Record<string, string> = {};
  const first = text(formData.get("first_name"));
  const last = text(formData.get("last_name"));
  if (first === "") errors.first_name = "Enter a first name.";
  else if (first.length > 100) errors.first_name = "First name is too long.";
  if (last === "") errors.last_name = "Enter a last name.";
  else if (last.length > 100) errors.last_name = "Last name is too long.";

  const emailRaw = text(formData.get("email")).toLowerCase();
  const email = orNull(emailRaw);
  if (email !== null && (email.length > 254 || !z.email().safeParse(email).success)) errors.email = "Enter a valid email address.";

  const phoneRaw = text(formData.get("phone"));
  const phone = phoneRaw === "" ? null : formatUsPhone(phoneRaw);
  const digits = phoneRaw.replace(/\D/g, "");
  if (phone !== null && (digits.length < 10 || digits.length > 11 || phone.length > 32)) {
    errors.phone = "Enter a 10-digit phone number, including the area code.";
  }
  if (email === null && phone === null) errors.phone = "Enter a phone number or an email address so we can reach you.";

  const street = orNull(text(formData.get("address_line1")));
  if (street !== null && street.length > 200) errors.address_line1 = "Keep the street address under 200 characters.";
  const city = orNull(text(formData.get("city")));
  if (city !== null && city.length > 100) errors.city = "Keep the city under 100 characters.";
  const stateRaw = orNull(text(formData.get("state")).toUpperCase());
  if (stateRaw !== null && !/^[A-Z]{2}$/.test(stateRaw)) errors.state = "Use the 2-letter state code, for example GA.";
  // A state on its own (the form pre-fills GA) is not an address.
  const state = street !== null || city !== null ? stateRaw : null;

  const postal = orNull(text(formData.get("postal_code")));
  if (postal !== null && !/^[0-9]{5}(-[0-9]{4})?$/.test(postal)) errors.postal_code = "Enter a 5-digit ZIP code.";

  const methodRaw = orNull(text(formData.get("preferred_contact_method")));
  const method = methodRaw !== null && (INTAKE_CONTACT_METHODS as readonly string[]).includes(methodRaw)
    ? (methodRaw as IntakePayload["preferred_contact_method"]) : null;

  const bestTime = orNull(text(formData.get("best_time")));
  if (bestTime !== null && bestTime.length > 100) errors.best_time = "Keep this under 100 characters.";

  const lines = INTAKE_LINES.filter((l) => formData.getAll("lines").includes(l));
  if (lines.length === 0) errors.lines = "Choose at least one type of insurance.";

  const coverage: CoverageEntry[] = [];
  for (const line of lines) {
    const carrier = orNull(text(formData.get(`carrier_${line}`)));
    const monthRaw = text(formData.get(`renews_${line}`));
    const month = /^(?:[1-9]|1[0-2])$/.test(monthRaw) ? Number(monthRaw) : null;
    if (carrier !== null && carrier.length > 100) errors[`carrier_${line}`] = "Keep the company name under 100 characters.";
    if (carrier !== null || month !== null) coverage.push({ line: line as ProductLine, carrier, renews_month: month });
  }

  const heardRaw = orNull(text(formData.get("heard_about")));
  const heard = heardRaw !== null && (HEARD_ABOUT_OPTIONS as readonly string[]).includes(heardRaw) ? heardRaw : null;
  const referredBy = orNull(text(formData.get("referred_by_name")));
  if (referredBy !== null && referredBy.length > 100) errors.referred_by_name = "Keep the name under 100 characters.";

  const household: HouseholdEntry[] = [];
  for (let i = 0; i < MAX_HOUSEHOLD; i++) {
    const firstName = text(formData.get(`hh_first_${i}`));
    const lastName = text(formData.get(`hh_last_${i}`));
    if (firstName === "" && lastName === "") continue; // an empty row
    const row = householdMemberSchema.safeParse({ first_name: firstName, last_name: lastName, relationship: text(formData.get(`hh_rel_${i}`)) });
    if (row.success) household.push(row.data);
    else errors[`household_${i}`] = row.error.issues[0]?.message ?? "Check this person.";
  }

  const vehicles: VehicleEntry[] = [];
  if (lines.includes("auto")) {
    const schema = vehicleSchema(now);
    for (let i = 0; i < MAX_VEHICLES; i++) {
      const year = text(formData.get(`veh_year_${i}`));
      const make = text(formData.get(`veh_make_${i}`));
      const model = text(formData.get(`veh_model_${i}`));
      if (year === "" && make === "" && model === "") continue;
      const row = schema.safeParse({ year, make, model });
      if (row.success) vehicles.push(row.data);
      else errors[`vehicle_${i}`] = row.error.issues[0]?.message ?? "Check this vehicle.";
    }
  }

  const consent = formData.get("consent") === "on";
  if (requireConsent && !consent) errors.consent = "Please tick the box so we may contact you.";

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    consent,
    payload: {
      first_name: first, last_name: last, email, phone, address_line1: street, city, state,
      postal_code: postal, preferred_contact_method: method,
      best_time: bestTime, lines, current_coverage: coverage, heard_about: heard,
      referred_by_name: heard === "Referral" || referredBy !== null ? referredBy : null,
      household, vehicles,
    },
  };
}

/** Echoes the typed values back after a validation error (React resets the form). */
export function echoIntakeValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  const names = [
    ...INTAKE_TEXT_FIELDS, ...INTAKE_LINES.flatMap((l) => [`carrier_${l}`, `renews_${l}`]),
    ...rowNames(HOUSEHOLD_FIELDS, MAX_HOUSEHOLD), ...rowNames(VEHICLE_FIELDS, MAX_VEHICLES),
  ];
  for (const name of names) {
    const v = formData.get(name);
    if (typeof v === "string") values[name] = v.slice(0, 200);
  }
  values.lines = formData.getAll("lines").filter((v): v is string => typeof v === "string").join(",");
  if (formData.get("consent") === "on") values.consent = "on";
  return values;
}

/** Turns the database's short refusal reasons into messages for the person filling the form. */
export function intakeDbError(message: string | undefined): { error?: string; fieldErrors?: Record<string, string> } {
  switch (message) {
    case "link_unavailable":
      return { error: "This form link is no longer active. Please contact The Bass Agency directly." };
    case "rate_limited":
      return { error: "We've received a lot of requests through this form. Please try again in an hour, or contact The Bass Agency directly." };
    case "consent":
      return { fieldErrors: { consent: "Please tick the box so we may contact you." } };
    case "first_name": case "last_name": case "email": case "phone": case "postal_code": case "best_time": case "referred_by_name":
    case "address_line1": case "city": case "state":
      return { fieldErrors: { [message]: "Please check this field." } };
    case "reach":
      return { fieldErrors: { phone: "Enter a phone number or an email address so we can reach you." } };
    case "lines":
      return { fieldErrors: { lines: "Choose at least one type of insurance." } };
    case "household":
      return { fieldErrors: { household_0: "Please check the people listed." } };
    case "vehicles":
      return { fieldErrors: { vehicle_0: "Please check the vehicles listed." } };
    default:
      return { error: "Something went wrong sending your request. Please try again." };
  }
}

/** A valid link token: 32 lowercase hex characters. */
export const isIntakeToken = (token: string) => /^[0-9a-f]{32}$/.test(token);
