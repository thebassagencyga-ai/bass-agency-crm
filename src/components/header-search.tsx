"use client";

import { usePathname } from "next/navigation";

// Search from any page (Phase 21, ADR-037): a plain GET form to the contacts list, so it works
// before JavaScript loads. Styled for the Midnight Ink shell. Not shown on the contacts list, which has its own search and filters.
export function HeaderSearch() {
  const pathname = usePathname();
  if (pathname === "/contacts") return null;
  return (
    <form method="get" action="/contacts" role="search" aria-label="Find a contact" className="flex gap-2">
      <label htmlFor="header-q" className="sr-only">Find a contact</label>
      <input
        id="header-q" name="q" type="search" maxLength={100} enterKeyHint="search" autoComplete="off"
        placeholder="Find a client"
        className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-white/15 bg-white/10 px-3 text-base text-shell-fg placeholder:text-shell-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      />
      <button type="submit" className="min-h-11 shrink-0 rounded-md bg-brand px-3 font-medium text-on-brand hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        Find
      </button>
    </form>
  );
}
