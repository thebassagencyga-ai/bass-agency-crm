"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/navigation";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {NAV_ITEMS.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href} className="shrink-0">
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className="flex min-h-11 items-center rounded-md px-3 text-base hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white dark:hover:bg-slate-800 dark:aria-[current=page]:bg-slate-100 dark:aria-[current=page]:text-slate-900"
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
