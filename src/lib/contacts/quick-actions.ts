// The pinned Call · Text · Log bar on a contact page (Phase 21, ADR-037). Pure; unit tested.
// Text and Log jump to (and open) sections already on the page; Call opens the phone app.
import { mailtoHref, telHref } from "@/lib/messages/links";

export type QuickAction = { key: "call" | "text" | "log"; label: string; name: string; href: string };

export function quickActions(c: {
  name: string; phone: string | null; email: string | null; archived: boolean; merged: boolean;
}): QuickAction[] {
  if (c.merged) return []; // kept for reference only; everything lives on the kept contact
  const tel = telHref(c.phone);
  const canMessage = !c.archived && (tel !== null || mailtoHref(c.email, "", "") !== null);
  return [
    ...(tel ? [{ key: "call" as const, label: "Call", name: `Call ${c.name}`, href: tel }] : []),
    ...(canMessage ? [{ key: "text" as const, label: "Text", name: `Text or email ${c.name}`, href: "#message" }] : []),
    { key: "log", label: "Log", name: `Log a call or visit with ${c.name}`, href: "#log-activity" },
  ];
}
