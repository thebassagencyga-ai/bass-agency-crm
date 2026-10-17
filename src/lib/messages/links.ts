// sms: and mailto: links (Phase 16). They open the device's own apps pre-filled; nothing is sent
// until the user presses send there.
export { smsHref } from "@/lib/tasks/message";

const EMAIL = /^[^\s@<>,;:"?&#%]+@[^\s@<>,;:"?&#%]+\.[^\s@<>,;:"?&#%]+$/;

/**
 * mailto: link with subject and body. Spaces are %20 (not "+", which Mail shows literally) and
 * line breaks are CRLF as RFC 6068 asks. Returns null when there is no usable address.
 */
export function mailtoHref(email: string | null, subject: string, body: string): string | null {
  const to = email?.trim() ?? "";
  if (!EMAIL.test(to)) return null;
  const params = [
    subject ? `subject=${encodeURIComponent(subject)}` : null,
    body ? `body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}` : null,
  ].filter(Boolean);
  return `mailto:${to}${params.length ? `?${params.join("&")}` : ""}`;
}

/** tel: link, or null without a usable number. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `tel:+1${digits}` : null;
}
