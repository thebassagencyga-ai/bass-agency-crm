import { TAGLINE, Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Wordmark size="lg" />
          <p className="text-sm text-muted">{TAGLINE}</p>
        </div>
        <div className="flex flex-col gap-6 rounded-xl border border-line bg-card p-5 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
