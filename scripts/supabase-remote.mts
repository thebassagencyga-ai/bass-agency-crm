// Read-only checks against the hosted Supabase project, used by
// .github/workflows/deploy-migrations.yml (ADR-014).
//
//   node scripts/supabase-remote.mts guard    refuse unless the project is empty or already the CRM
//   node scripts/supabase-remote.mts verify   check the deployed schema matches expectations
//
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. Runs SQL through the Supabase
// Management API over HTTPS. Only SELECT statements are sent. Never prints secrets.
import {
  PUBLIC_TABLES_SQL,
  PUBLIC_FUNCTIONS_SQL,
  VERIFICATION_SQL,
  type PublicFunctionRow,
  checkProjectRef,
  checkTargetProject,
  checkVerification,
  type VerificationRow,
} from "../src/lib/deploy-checks.ts";

const ref = process.env.SUPABASE_PROJECT_REF ?? "";
const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function query<T>(sql: string): Promise<T[]> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    fail(`Supabase API returned ${response.status}: ${body}`);
  }
  return (await response.json()) as T[];
}

const refCheck = checkProjectRef(ref);
if (!refCheck.ok) fail(refCheck.reason);
if (!token) fail("SUPABASE_ACCESS_TOKEN is not set.");

const command = process.argv[2];
if (command === "guard") {
  const tables = (await query<{ table_name: string }>(PUBLIC_TABLES_SQL)).map((r) => r.table_name);
  const result = checkTargetProject(tables);
  if (!result.ok) fail(result.reason);
  console.log(
    result.state === "empty"
      ? "✓ Target project has no tables yet: safe for the first CRM deploy."
      : `✓ Target project contains only CRM tables (${tables.length}): safe to migrate.`,
  );
} else if (command === "verify") {
  const [row] = await query<VerificationRow>(VERIFICATION_SQL);
  if (!row) fail("Verification query returned no rows.");
  console.log("Deployed schema:", JSON.stringify(row));
  // Names only (no data): which functions exist in public, and whether they bypass RLS.
  for (const f of await query<PublicFunctionRow>(PUBLIC_FUNCTIONS_SQL)) {
    console.log(
      `  function public.${f.name}(${f.args}) returns ${f.returns}` +
        `${f.security_definer ? " SECURITY DEFINER" : ""}${f.anon_execute ? " [anon can execute]" : ""}`,
    );
  }
  const problems = checkVerification(row);
  if (problems.length > 0) fail(problems.join(" "));
  console.log(
    "✓ Verification passed: 30 stages, 4 product lines, RLS and two-step policies on every table, " +
      "sign-up trigger present, Data API functions as expected, no anonymous access.",
  );
} else {
  fail("Usage: node scripts/supabase-remote.mts guard|verify");
}
