import type { Metadata } from "next";
import { QuickIntakeForm } from "@/components/intake/quick-form";
import { requireFullSession } from "@/lib/auth/require";

export const metadata: Metadata = { title: "Quick intake · Producr CRM" };

export default async function QuickIntakePage() {
  await requireFullSession();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Quick intake</h1>
      <p className="text-sm text-muted">
        For a call or a walk-in: adds the contact, a New lead for each line and a quote task before any renewal month you enter.
      </p>
      <QuickIntakeForm />
    </section>
  );
}
