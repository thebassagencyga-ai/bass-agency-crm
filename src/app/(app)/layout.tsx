import { BottomNav } from "@/components/bottom-nav";
import { HeaderSearch } from "@/components/header-search";
import { NavLinks } from "@/components/nav-links";
import { requireFullSession } from "@/lib/auth/require";
import { signOut } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireFullSession();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <header className="border-b border-slate-200 p-3 md:w-60 md:shrink-0 md:border-b-0 md:border-r dark:border-slate-800">
        <div className="mb-2 flex items-center justify-between gap-2 md:mb-4 md:flex-col md:items-start">
          <p className="font-semibold">ZeroLapse CRM</p>
          <form action={signOut}>
            <button type="submit" className="min-h-11 rounded-md px-3 text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Sign out</button>
          </form>
        </div>
        <div className="md:mb-4">
          <HeaderSearch />
        </div>
        {/* Phones use the bottom bar (BottomNav) instead. */}
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks />
        </nav>
        <p className="mt-4 hidden truncate text-xs text-slate-500 md:block" title={email}>{email}</p>
      </header>
      {/* Bottom padding on phones so the fixed bottom bar never covers the end of a page. */}
      <main id="main" className="flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">{children}</main>
      <BottomNav />
    </div>
  );
}
