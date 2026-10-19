// Contacts split into Leads | Clients | Former | All (Phase 24, ADR-040). Pure; unit tested.
// A tab is a relationship status; "All" shows everyone. Contacts opens on Leads, but a search or
// filter with no tab chosen looks across everyone (search from the header must find clients too).
import type { RelationshipStatus } from "./types";

export const CONTACT_TABS = ["leads", "clients", "former", "all"] as const;
export type ContactTab = (typeof CONTACT_TABS)[number];

export const CONTACT_TAB_LABELS: Record<ContactTab, string> = {
  leads: "Leads",
  clients: "Clients",
  former: "Former",
  all: "All",
};

const STATUS_OF: Record<ContactTab, RelationshipStatus | null> = {
  leads: "prospect",
  clients: "client",
  former: "former_client",
  all: null,
};
const TAB_OF: Record<RelationshipStatus, ContactTab> = { prospect: "leads", client: "clients", former_client: "former" };

export const tabStatus = (tab: ContactTab): RelationshipStatus | null => STATUS_OF[tab];

/**
 * The tab to show: an explicit tab; else an old-style status filter; else "all" when searching or
 * filtering; else Leads.
 */
export function resolveTab(input: { tab: string | null; status: RelationshipStatus | null; searching: boolean }): ContactTab {
  if (input.tab && (CONTACT_TABS as readonly string[]).includes(input.tab)) return input.tab as ContactTab;
  if (input.status) return TAB_OF[input.status];
  return input.searching ? "all" : "leads";
}
