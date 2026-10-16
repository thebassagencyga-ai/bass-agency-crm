// Turns report rows into clients with policies, using the user's column matches (Phase 15).
// Pure and unit tested; the server checks the result again before importing.
import { z } from "zod";
import { formatUsPhone } from "@/lib/contacts/format";
import type { ProductLine } from "@/lib/pipelines";
import { guessLine, type ImportField, type Mapping } from "./fields";
import { parseDate, parseMoney, parseState, parseTerm, splitName } from "./values";

export const MAX_IMPORT_CLIENTS = 1000;
export const MAX_IMPORT_ROWS = 5000;

export interface ImportPolicy {
  line: ProductLine;
  carrier: string | null;
  premium: number | null;
  effective_date: string | null;
  renewal_date: string | null;
  term_months: 6 | 12 | null;
}
export interface ImportContactData {
  contact_type: "individual" | "business";
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  alt_phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lead_source: string | null;
}
export interface ImportClient {
  key: string;
  rows: number[];
  contact: ImportContactData;
  policies: ImportPolicy[];
}
export interface ImportIssue {
  row: number;
  message: string;
  /** true: the row was left out; false: the row is imported with this field left empty. */
  skipped: boolean;
}
/** The user's choice for each policy-type value in the report: a line, or "skip". */
export type LineChoices = Record<string, ProductLine | "skip">;

export const lineKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, " ");

/** The distinct policy-type values in the report, with a guess for each. */
export function distinctLineValues(rows: readonly string[][], mapping: Mapping): { value: string; guess: ProductLine | null; count: number }[] {
  const col = mapping.line;
  if (col === undefined) return [];
  const seen = new Map<string, { value: string; guess: ProductLine | null; count: number }>();
  for (const r of rows) {
    const raw = (r[col] ?? "").trim();
    if (raw === "") continue;
    const k = lineKey(raw);
    const entry = seen.get(k);
    if (entry) entry.count++;
    else seen.set(k, { value: raw, guess: guessLine(raw), count: 1 });
  }
  const k = (v: string) => v.toLowerCase();
  return [...seen.values()].sort((a, b) => b.count - a.count || (k(a.value) < k(b.value) ? -1 : k(a.value) > k(b.value) ? 1 : 0));
}

const isEmail = (s: string) => z.email().safeParse(s).success;
const digits = (s: string) => s.replace(/\D/g, "");

export function buildImport(rows: readonly string[][], mapping: Mapping, lineChoices: LineChoices): {
  clients: ImportClient[];
  issues: ImportIssue[];
  tooMany: boolean;
} {
  const issues: ImportIssue[] = [];
  const byKey = new Map<string, ImportClient>();

  rows.slice(0, MAX_IMPORT_ROWS).forEach((r, index) => {
    const row = index + 2; // the heading is row 1
    const get = (f: ImportField) => {
      const col = mapping[f];
      return col === undefined ? "" : (r[col] ?? "").trim();
    };
    const warn = (message: string) => issues.push({ row, message, skipped: false });
    const skip = (message: string) => issues.push({ row, message, skipped: true });

    // Name: business, separate first/last, or one "insured name" column.
    let name: Pick<ImportContactData, "contact_type" | "first_name" | "last_name" | "business_name">;
    const business = get("business_name");
    if (business !== "") name = { contact_type: "business", business_name: business, first_name: get("first_name") || null, last_name: get("last_name") || null };
    else if (get("first_name") !== "" || get("last_name") !== "") name = { contact_type: "individual", business_name: null, first_name: get("first_name") || null, last_name: get("last_name") || null };
    else if (get("full_name") !== "") {
      const split = splitName(get("full_name"));
      name = "business_name" in split
        ? { contact_type: "business", business_name: split.business_name, first_name: null, last_name: null }
        : { contact_type: "individual", business_name: null, ...split };
    } else return skip("No name.");
    for (const f of ["first_name", "last_name"] as const) {
      if ((name[f] ?? "").length > 100) return skip("Name is longer than 100 characters.");
    }
    if ((name.business_name ?? "").length > 200) return skip("Business name is longer than 200 characters.");

    let email: string | null = get("email").toLowerCase() || null;
    if (email !== null && (email.length > 254 || !isEmail(email))) {
      warn(`Email "${email}" is not valid; left out.`);
      email = null;
    }
    const phoneOf = (f: "phone" | "alt_phone") => {
      const raw = get(f);
      if (raw === "") return null;
      const d = digits(raw);
      if (d.length < 10 || d.length > 11 || raw.length > 32) {
        warn(`Phone "${raw}" is not a full number; left out.`);
        return null;
      }
      return formatUsPhone(raw);
    };
    const text = (f: ImportField, max: number, label: string) => {
      const v = get(f);
      if (v.length > max) {
        warn(`${label} is longer than ${max} characters; left out.`);
        return null;
      }
      return v || null;
    };
    let state: string | null = null;
    if (get("state") !== "") {
      state = parseState(get("state"));
      if (state === null) warn(`State "${get("state")}" is not recognised; left out.`);
    }
    let postal: string | null = get("postal_code") || null;
    if (postal !== null) {
      if (/^\d{4}$/.test(postal)) postal = `0${postal}`; // spreadsheets drop leading zeros
      else if (/^\d{9}$/.test(postal)) postal = `${postal.slice(0, 5)}-${postal.slice(5)}`;
      if (!/^\d{5}(-\d{4})?$/.test(postal)) {
        warn(`ZIP "${get("postal_code")}" is not valid; left out.`);
        postal = null;
      }
    }
    const contact: ImportContactData = {
      ...name, email, phone: phoneOf("phone"), alt_phone: phoneOf("alt_phone"),
      address_line1: text("address_line1", 200, "Street address"), city: text("city", 100, "City"), state,
      postal_code: postal, lead_source: text("lead_source", 100, "Lead source"),
    };

    // Policy (optional): needs a known line.
    let policy: ImportPolicy | null = null;
    const lineRaw = get("line");
    if (lineRaw !== "") {
      const choice = lineChoices[lineKey(lineRaw)] ?? guessLine(lineRaw);
      if (choice === null) return skip(`Policy type "${lineRaw}" is not matched to a line.`);
      if (choice !== "skip") {
        const premium = parseMoney(get("premium"));
        if (premium === undefined) return skip(`Premium "${get("premium")}" is not a number.`);
        const effective = parseDate(get("effective_date"));
        if (effective === undefined) return skip(`Effective date "${get("effective_date")}" is not a date.`);
        const renewal = parseDate(get("renewal_date"));
        if (renewal === undefined) return skip(`Renewal date "${get("renewal_date")}" is not a date.`);
        const term = parseTerm(get("term_months"));
        if (term === undefined) warn(`Term "${get("term_months")}" is not 6 or 12 months; 12 used.`);
        const carrier = get("carrier");
        policy = {
          line: choice, carrier: carrier === "" ? null : carrier.slice(0, 100), premium,
          effective_date: effective, renewal_date: renewal, term_months: term ?? null,
        };
      }
    }

    // One client per person: same name and same email, phone or address.
    const who = (contact.business_name ?? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`).toLowerCase().replace(/\s+/g, " ").trim();
    const key = `${contact.contact_type}|${who}|${contact.email ?? digits(contact.phone ?? "") ?? ""}${contact.email || contact.phone ? "" : `|${(contact.address_line1 ?? "").toLowerCase()}`}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      for (const [k, v] of Object.entries(contact) as [keyof ImportContactData, string | null][]) {
        if (existing.contact[k] === null && v !== null) (existing.contact as unknown as Record<string, string | null>)[k] = v;
      }
      if (policy) existing.policies.push(policy);
    } else {
      byKey.set(key, { key, rows: [row], contact, policies: policy ? [policy] : [] });
    }
  });

  const clients = [...byKey.values()];
  return { clients: clients.slice(0, MAX_IMPORT_CLIENTS), issues, tooMany: clients.length > MAX_IMPORT_CLIENTS || rows.length > MAX_IMPORT_ROWS };
}

export interface ExistingContact {
  id: string;
  label: string;
  email: string | null;
  phone: string | null;
}

/** For each client, an existing contact with the same email or phone number (if any). */
export function matchExisting(clients: readonly ImportClient[], existing: readonly ExistingContact[]): Map<string, ExistingContact> {
  const byEmail = new Map<string, ExistingContact>();
  const byPhone = new Map<string, ExistingContact>();
  for (const e of existing) {
    if (e.email) byEmail.set(e.email.toLowerCase(), e);
    const d = digits(e.phone ?? "").replace(/^1(?=\d{10}$)/, "");
    if (d.length === 10) byPhone.set(d, e);
  }
  const out = new Map<string, ExistingContact>();
  for (const c of clients) {
    const d = digits(c.contact.phone ?? "").replace(/^1(?=\d{10}$)/, "");
    const hit = (c.contact.email && byEmail.get(c.contact.email)) || (d.length === 10 ? byPhone.get(d) : undefined);
    if (hit) out.set(c.key, hit);
  }
  return out;
}
