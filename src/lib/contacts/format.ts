import type { Contact } from "./types";

/** Formats a 10-digit US number (optionally with +1) as 770-555-0101; leaves anything else as typed. */
export function formatUsPhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/[a-z]/i.test(trimmed)) return trimmed; // extensions and notes are kept as typed
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return trimmed;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

type NameFields = Pick<Contact, "contact_type" | "first_name" | "last_name" | "business_name">;

export function contactDisplayName(c: NameFields): string {
  if (c.contact_type === "business" && c.business_name) return c.business_name;
  const name = [c.first_name, c.last_name].filter((p) => p && p.trim()).join(" ");
  return name || c.business_name || "(No name)";
}

/** Secondary line for a business: the person you deal with, if recorded. */
export function contactPersonName(c: NameFields): string | null {
  if (c.contact_type !== "business") return null;
  const name = [c.first_name, c.last_name].filter((p) => p && p.trim()).join(" ");
  return name || null;
}
