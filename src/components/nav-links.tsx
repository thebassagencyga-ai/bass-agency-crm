"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentPath, NAV_ITEMS } from "@/lib/navigation";

// Sidebar navigation on the Midnight Ink shell; the current page gets an Electric Blue marker.
export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
            className="flex min-h-11 items-center rounded-md px-3 text-base text-shell-muted hover:bg-white/5 hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand aria-[current=page]:bg-white/10 aria-[current=page]:font-semibold aria-[current=page]:text-shell-fg aria-[current=page]:shadow-[inset_3px_0_0_var(--color-brand-primary)]"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
