"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BOTTOM_NAV, isCurrentPath, MORE_NAV } from "@/lib/navigation";

// Phone navigation (Phase 21, ADR-037): the four pages used every day within thumb reach, plus
// "More" for the rest. Hidden from tablet width up, where the sidebar shows everything.

const ICONS: Record<string, React.ReactNode> = {
  "/dashboard": <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  "/contacts": <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m7.5 8v-1.5a3.5 3.5 0 0 0-2-3.2M14.5 4.3a3.5 3.5 0 0 1 0 6.4" />,
  "/tasks": <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />,
  "/renewals": <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4M12 8v4l3 2" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

const ITEM =
  "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:font-semibold aria-[current=page]:text-link aria-[current=page]:shadow-[inset_0_3px_0_var(--color-brand-primary)]";

export function BottomNav() {
  const pathname = usePathname();
  // The page the menu was opened on: navigating anywhere closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const close = () => setOpenOn(null);
  const menu = useRef<HTMLDivElement>(null);
  const moreCurrent = MORE_NAV.some((item) => isCurrentPath(pathname, item.href));

  // Escape or a tap outside closes it too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onTap = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onTap);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onTap); };
  }, [open]);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-1">
        {BOTTOM_NAV.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined} className={ITEM}>
              <Icon name={item.href} />
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <div ref={menu} className="relative">
            <button
              type="button" aria-expanded={open} aria-controls="more-menu" onClick={() => setOpenOn(open ? null : pathname)}
              aria-current={moreCurrent ? "page" : undefined} className={ITEM}
            >
              <Icon name="more" />
              More
            </button>
            {open ? (
              <ul
                id="more-menu"
                className="absolute bottom-full right-0 mb-2 flex w-52 flex-col gap-1 rounded-md border border-line bg-card p-1 shadow-lg"
              >
                {MORE_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                      className="flex min-h-11 items-center rounded-md px-3 text-base hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus aria-[current=page]:bg-brand aria-[current=page]:text-on-brand"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      </ul>
    </nav>
  );
}
