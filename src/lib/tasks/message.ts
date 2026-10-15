// Review and referral request messages (ADR-013). The CRM never sends anything: it shows the
// text, a Copy button and an sms: link that opens the phone's Messages app pre-filled.

export interface MessageValues {
  first_name: string | null;
  agent_name: string | null;
  review_link: string | null;
}

const PLACEHOLDERS: Record<keyof MessageValues, string> = {
  first_name: "there",
  agent_name: "The Bass Agency",
  review_link: "[add your Google review link in Settings]",
};

/** Fills {first_name}, {agent_name} and {review_link}; unknown placeholders are left as typed. */
export function renderMessage(template: string, values: MessageValues): string {
  return template.replace(/\{(first_name|agent_name|review_link)\}/g, (_match, key: keyof MessageValues) => {
    const value = values[key]?.trim();
    return value ? value : PLACEHOLDERS[key];
  });
}

/**
 * sms: link with a pre-filled body. "?&body=" is understood by both iPhone and Android
 * Messages. Returns null when there is no usable phone number.
 */
export function smsHref(phone: string | null, body: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `sms:+1${digits}?&body=${encodeURIComponent(body)}`;
}

/** Rule key whose message template a task category uses, if any. */
export function messageRuleFor(category: string): "review_request" | "referral_request" | null {
  return category === "review_request" || category === "referral_request" ? category : null;
}
