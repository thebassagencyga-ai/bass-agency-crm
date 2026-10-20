import type { Metadata } from "next";
import Link from "next/link";
import { GoalsForm, RatesForm } from "@/components/production/settings-forms";
import { requireFullSession } from "@/lib/auth/require";
import { RATE_ROWS, rateKey } from "@/lib/production";
import { getRatesAndGoals } from "@/lib/production/data";

export const metadata: Metadata = { title: "Commission and goals · Producr CRM" };

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

export default async function ProductionSettingsPage() {
  const { supabase } = await requireFullSession();
  const { rates, goals } = await getRatesAndGoals(supabase);
  const initialRates: Record<string, string> = {};
  for (const row of RATE_ROWS) {
    const r = rates.find((x) => x.product_line === row.line && (x.life_policy_type ?? null) === row.type);
    initialRates[rateKey(row.line, row.type, "new")] = str(r?.new_rate);
    initialRates[rateKey(row.line, row.type, "renewal")] = str(r?.renewal_rate);
  }
  const initialGoals = {
    premium_per_month: str(goals?.premium_per_month),
    policies_per_month: str(goals?.policies_per_month),
    premium_per_year: str(goals?.premium_per_year),
  };
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/settings" className="flex min-h-11 w-fit items-center text-sm underline text-link">← Settings</Link>
        <h1 className="text-2xl font-bold tracking-tight">Commission and goals</h1>
        <p className="text-sm text-muted">
          Your own figures from your agency agreement, used for the estimates in <Link href="/reports/production" className="underline text-link">Reports → Production</Link>.
          They are not contract terms; carrier statements are the final word. Leave a rate empty if you don&apos;t want it counted.
        </p>
      </div>
      <section aria-labelledby="rates-heading" className="flex flex-col gap-3 rounded-md border border-line bg-card p-4">
        <h2 id="rates-heading" className="text-lg font-semibold">Commission rates</h2>
        <RatesForm initial={initialRates} />
      </section>
      <section aria-labelledby="goals-heading" className="flex flex-col gap-3 rounded-md border border-line bg-card p-4">
        <h2 id="goals-heading" className="text-lg font-semibold">Goals</h2>
        <GoalsForm initial={initialGoals} />
      </section>
    </section>
  );
}
