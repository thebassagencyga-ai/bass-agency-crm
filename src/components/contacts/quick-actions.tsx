"use client";

import { useEffect } from "react";
import type { QuickAction } from "@/lib/contacts/quick-actions";

// Pinned to the top of the screen while scrolling a contact (Phase 21, ADR-037). Text and Log
// open their section on this page (a <details>) and scroll to it; without JavaScript the links
// still jump there.

function openSection(id: string) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLDetailsElement)) return false;
  el.open = true;
  el.scrollIntoView({ block: "start" });
  el.querySelector("summary")?.focus({ preventScroll: true });
  return true;
}

const ICONS: Record<QuickAction["key"], React.ReactNode> = {
  call: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  text: <path d="M4 5h16v11H8l-4 4z" />,
  log: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />,
};

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  // Arriving with #message or #log-activity (e.g. from a bookmark) opens that section too.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (actions.some((a) => a.href === `#${id}`)) openSection(id);
  }, [actions]);

  if (actions.length === 0) return null;
  return (
    <nav
      aria-label="Quick actions"
      className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur md:mx-0 md:px-0 dark:border-slate-800 dark:bg-slate-950/95"
    >
      <ul className="grid grid-flow-col auto-cols-fr gap-2">
        {actions.map((a) => (
          <li key={a.key}>
            <a
              href={a.href}
              aria-label={a.name}
              onClick={(e) => {
                if (a.href.startsWith("#") && openSection(a.href.slice(1))) {
                  e.preventDefault();
                }
              }}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-slate-100 dark:text-slate-900"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[a.key]}
              </svg>
              {a.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
