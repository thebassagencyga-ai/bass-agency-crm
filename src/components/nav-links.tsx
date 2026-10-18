"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentPath, NAV_ITEMS } from "@/lib/navigation";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
            className="flex min-h-11 items-center rounded-md px-3 text-base hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white dark:hover:bg-slate-800 dark:aria-[current=page]:bg-slate-100 dark:aria-[current=page]:text-slate-900"
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
