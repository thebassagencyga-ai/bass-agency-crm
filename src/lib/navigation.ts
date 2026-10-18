// Main navigation (spec §12). The sidebar (tablet and desktop) shows every item; phones get a
// bottom bar with the four daily pages and a "More" menu for the rest (Phase 21, ADR-037).
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/intake", label: "Intake" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/tasks", label: "Tasks" },
  { href: "/renewals", label: "Renewals" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
] as const;

export type NavHref = (typeof NAV_ITEMS)[number]["href"];

/** Phone bottom bar, left to right ("Today" is the dashboard). */
export const BOTTOM_NAV: readonly { href: NavHref; label: string }[] = [
  { href: "/dashboard", label: "Today" },
  { href: "/contacts", label: "Contacts" },
  { href: "/tasks", label: "Tasks" },
  { href: "/renewals", label: "Renewals" },
];

/** Everything not on the bottom bar, in sidebar order, behind "More". */
export const MORE_NAV = NAV_ITEMS.filter((item) => !BOTTOM_NAV.some((b) => b.href === item.href));

/** A nav item is current on its own page and any page beneath it. */
export function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
