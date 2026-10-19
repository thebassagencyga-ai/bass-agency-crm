export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <p className="text-center text-lg font-semibold">ZeroLapse CRM</p>
      {children}
    </main>
  );
}
