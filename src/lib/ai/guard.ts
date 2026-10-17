// Data minimisation for the AI helpers (Phase 19, CLAUDE.md "Data minimization"): free text the
// user typed is checked before it leaves the CRM. Anything that looks like an SSN, a payment card
// or bank number, or a driver's license number is refused, not sent. Pure; unit tested.

const PATTERNS: [RegExp, string][] = [
  [/\b\d{3}[- ]\d{2}[- ]\d{4}\b/, "a Social Security number"],
  [/\b(?:ssn|social security)\b/i, "a Social Security number"],
  [/\b(?:\d[ -]?){13,19}\b/, "a card or bank account number"],
  [/\b(?:routing|account)\s*(?:no|number|#)/i, "a bank account number"],
  [/\b(?:driver'?s?\s*licen[cs]e|\bDL\s*#?)\s*(?:no|number|#)?\s*[:#]?\s*[A-Z0-9-]{5,}/i, "a driver's license number"],
  [/\b(?:diagnos|prescription|medication|medical condition)/i, "health information"],
];

/** Returns what sensitive kind of data the text seems to contain, or null. */
export function findSensitive(text: string): string | null {
  // A bare 9-digit number with no separators could be an SSN too.
  if (/(?<![\d-])\d{9}(?![\d-])/.test(text)) return "a Social Security number";
  for (const [re, what] of PATTERNS) if (re.test(text)) return what;
  return null;
}
