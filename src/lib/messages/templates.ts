// Ready-made messages for the device's own Messages and Mail apps (Phase 16, ADR-032).
// The CRM never sends anything: it builds sms:/mailto: links and the user presses send.

export const TEMPLATE_KEYS = ["checkin", "quote_follow_up", "renewal", "xdate", "thank_you", "intake_reply", "blank"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateValues {
  first_name: string | null;
  agent_name: string | null;
  /** Product line in lower case ("auto", "home"…). */
  line: string | null;
  /** Already formatted, e.g. "March 1, 2027". */
  renewal_date: string | null;
}

export interface MessageTemplate {
  label: string;
  subject: string;
  body: string;
}

export const TEMPLATES: Readonly<Record<TemplateKey, MessageTemplate>> = {
  checkin: {
    label: "Check-in",
    subject: "Checking in",
    body: "Hi {first_name}, this is {agent_name}. Just checking in — is there anything I can help you with on your insurance?",
  },
  quote_follow_up: {
    label: "Quote follow-up",
    subject: "Your {line} quote",
    body: "Hi {first_name}, this is {agent_name}. I wanted to follow up on your {line} quote. Do you have any questions, or would you like to go ahead? Happy to help either way.",
  },
  renewal: {
    label: "Renewal check-in",
    subject: "Your {line} policy renews {renewal_date}",
    body: "Hi {first_name}, this is {agent_name}. Your {line} policy renews {renewal_date}. I'd like to do a quick review to make sure your coverage still fits. When is a good time to talk?",
  },
  xdate: {
    label: "Current policy renewing",
    subject: "Your {line} insurance renews {renewal_date}",
    body: "Hi {first_name}, this is {agent_name}. You mentioned your current {line} policy renews {renewal_date}. Would you like me to put together a quote before then?",
  },
  thank_you: {
    label: "Thank you",
    subject: "Thank you",
    body: "Hi {first_name}, thank you for choosing us for your insurance. If you ever have a question, just reply to this message. — {agent_name}",
  },
  intake_reply: {
    label: "Quote request received",
    subject: "Your quote request",
    body: "Hi {first_name}, this is {agent_name}. Thanks for your quote request — I have your information and will be in touch shortly. If it's easier to talk by phone, let me know a good time.",
  },
  blank: { label: "Blank", subject: "", body: "" },
};

const FALLBACKS: Record<keyof TemplateValues, string> = {
  first_name: "there",
  agent_name: "The Bass Agency",
  line: "insurance",
  renewal_date: "soon",
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** Fills the placeholders; a missing value falls back to a neutral word ("there", "soon"…). */
export function fillTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{(first_name|agent_name|line|renewal_date)\}/g, (_m, key: keyof TemplateValues) => {
    const value = values[key]?.trim();
    return value ? value : FALLBACKS[key];
  });
}

export function renderTemplate(key: TemplateKey, values: TemplateValues): { subject: string; body: string } {
  const t = TEMPLATES[key];
  return { subject: fillTemplate(t.subject, values), body: fillTemplate(t.body, values) };
}

/** The best starting template for an opportunity, by where it stands. */
export function templateForOpportunity(o: { outcome: string; renewal_date: string | null; quote_sent_on: string | null; current_policy_renews_on?: string | null }): TemplateKey {
  if (o.outcome === "won") return o.renewal_date ? "renewal" : "thank_you";
  if (o.outcome === "open" || o.outcome === "nurture") {
    if (o.quote_sent_on) return "quote_follow_up";
    if (o.current_policy_renews_on) return "xdate";
  }
  return "checkin";
}

/** The best starting template for a task type. */
export function templateForTaskCategory(category: string): TemplateKey {
  if (category === "prospecting") return "quote_follow_up";
  if (category === "renewal") return "renewal";
  if (category === "onboarding") return "thank_you";
  return "checkin";
}

/** Placeholder values for a contact, optionally about one of their opportunities. */
export function valuesFor(
  contact: { first_name: string | null },
  agentName: string | null,
  opp: { product_line: string; outcome: string; renewal_date: string | null; current_policy_renews_on: string | null } | null,
  formatDate: (d: string | null) => string,
): TemplateValues {
  const date = opp ? (opp.outcome === "won" ? opp.renewal_date : opp.current_policy_renews_on) : null;
  return {
    first_name: contact.first_name,
    agent_name: agentName,
    line: opp ? LINE_WORDS[opp.product_line] ?? null : null,
    renewal_date: date ? `on ${formatDate(date)}` : null,
  };
}

const LINE_WORDS: Record<string, string> = {
  auto: "auto", motorcycle: "motorcycle", boat: "boat", rv: "RV",
  home: "home", renters: "renters", condo: "condo", mobile_home: "mobile home", umbrella: "umbrella",
  commercial: "business", commercial_auto: "commercial auto", farm: "farm",
  life: "life",
};
