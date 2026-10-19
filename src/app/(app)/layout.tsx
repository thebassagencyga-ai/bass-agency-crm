import Link from "next/link";
import { BottomNav } from "@/components/bottom-nav";
import { Wordmark } from "@/components/brand";
import { HeaderSearch } from "@/components/header-search";
import { NavLinks } from "@/components/nav-links";
import { requireFullSession } from "@/lib/auth/require";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireFullSession();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-card focus:p-2">Skip to content</a>
      {/* Midnight Ink shell: a compact top bar on phones, a sidebar from tablet width up. */}
      <header className="bg-shell p-3 text-shell-fg md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:overflow-y-auto md:p-4">
        <div className="mb-3 flex items-center justify-between gap-2 md:mb-6">
          <Link href="/dashboard" aria-label="Producr CRM home" className="flex min-h-11 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            <Wordmark tone="shell" />
          </Link>
          <form action={signOut} className="md:hidden">
            <button type="submit" className="min-h-11 rounded-md px-3 text-sm text-shell-muted underline hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">Sign out</button>
          </form>
        </div>
        <div className="md:mb-5">
          <HeaderSearch />
        </div>
        {/* Phones use the bottom bar (BottomNav) instead. */}
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks />
        </nav>
        <div className="mt-auto hidden flex-col gap-1 pt-6 md:flex">
          <p className="truncate text-xs text-shell-muted" title={email}>{email}</p>
          <form action={signOut}>
            <button type="submit" className="min-h-11 rounded-md text-sm text-shell-muted underline hover:text-shell-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">Sign out</button>
          </form>
        </div>
      </header>
      {/* Bottom padding on phones so the fixed bottom bar never covers the end of a page. */}
      <main id="main" className="min-w-0 flex-1 bg-canvas p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">{children}</main>
      <BottomNav />
    </div>
  );
}
