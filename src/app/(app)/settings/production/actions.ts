"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { requireFullSession } from "@/lib/auth/require";
import { RATE_ROWS, goalsSchema, rateField, rateKey } from "@/lib/production";
import { getRatesAndGoals } from "@/lib/production/data";

// Settings → Commission and goals (Phase 28). Writes through the user's own client (RLS).

function errorsOf(issues: { path: PropertyKey[]; message: string }[], prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[`${prefix}${String(i.path[0] ?? "form")}`] ??= i.message;
  return out;
}

export async function saveRates(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  const parsed: { line: string; type: string | null; new_rate: number | null; renewal_rate: number | null }[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const row of RATE_ROWS) {
    const rate: Record<string, number | null> = {};
    for (const kind of ["new", "renewal"] as const) {
      const key = rateKey(row.line, row.type, kind);
      const raw = formData.get(key);
      if (typeof raw === "string") values[key] = raw.slice(0, 20);
      const r = rateField.safeParse(raw ?? "");
      if (!r.success) fieldErrors[key] = r.error.issues[0]?.message ?? "Use 0 to 100.";
      else rate[kind] = r.data;
    }
    parsed.push({ line: row.line, type: row.type, new_rate: rate.new ?? null, renewal_rate: rate.renewal ?? null });
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, values, error: "Some rates need fixing." };

  const { rates } = await getRatesAndGoals(supabase);
  for (const p of parsed) {
    const existing = rates.find((r) => r.product_line === p.line && (r.life_policy_type ?? null) === p.type);
    const { error } = existing
      ? await supabase.from("commission_rates").update({ new_rate: p.new_rate, renewal_rate: p.renewal_rate }).eq("id", existing.id)
      : p.new_rate === null && p.renewal_rate === null
        ? { error: null }
        : await supabase.from("commission_rates").insert({ product_line: p.line, life_policy_type: p.type, new_rate: p.new_rate, renewal_rate: p.renewal_rate });
    if (error) return { error: "Could not save your rates. Please try again.", values };
  }
  revalidatePath("/settings/production");
  revalidatePath("/reports/production");
  return { message: "Rates saved.", values };
}

export async function saveGoals(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireFullSession();
  const values: Record<string, string> = {};
  for (const k of ["premium_per_month", "policies_per_month", "premium_per_year"]) {
    const v = formData.get(k);
    if (typeof v === "string") values[k] = v.slice(0, 30);
  }
  const parsed = goalsSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: errorsOf(parsed.error.issues), values };
  const { goals } = await getRatesAndGoals(supabase);
  const { error } = goals
    ? await supabase.from("production_goals").update(parsed.data).eq("id", goals.id)
    : await supabase.from("production_goals").insert(parsed.data);
  if (error) return { error: "Could not save your goals. Please try again.", values };
  revalidatePath("/settings/production");
  revalidatePath("/reports/production");
  return { message: "Goals saved.", values };
}
