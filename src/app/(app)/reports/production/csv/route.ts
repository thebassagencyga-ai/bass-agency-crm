import { requireFullSession } from "@/lib/auth/require";
import { todayInZone } from "@/lib/dates";
import { toCsv } from "@/lib/import/csv";
import { PRODUCT_LINE_NAMES } from "@/lib/pipelines";
import { PRODUCTION_CSV_COLUMNS, parseMonth, productionCsvRows } from "@/lib/production";
import { getProduction } from "@/lib/production/data";
import { getProfile } from "@/lib/tasks/data";

// Reports → Production → "Download as CSV" (Phase 28): the caller's own figures only (RLS);
// cells a spreadsheet would run as formulas are neutralised by toCsv (ADR-031).
export async function GET(request: Request) {
  const { supabase, userId } = await requireFullSession();
  const today = todayInZone((await getProfile(supabase, userId)).time_zone);
  const month = parseMonth(new URL(request.url).searchParams.get("month") ?? undefined, today);
  const report = await getProduction(supabase, month);
  return new Response(toCsv(PRODUCTION_CSV_COLUMNS, productionCsvRows(report, (l) => PRODUCT_LINE_NAMES[l])), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="producr-production-${month.slice(0, 7)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
