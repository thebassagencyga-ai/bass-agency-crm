// Read-only checks against the hosted Supabase project, used by
// .github/workflows/deploy-migrations.yml (ADR-014).
//
//   node scripts/supabase-remote.mts guard    refuse unless the project is empty or already the CRM
//   node scripts/supabase-remote.mts verify   check the deployed schema matches expectations
//   node scripts/supabase-remote.mts counts   print row counts per table as JSON (no data; backups)
//   node scripts/supabase-remote.mts users    print sign-ins (id + email) as JSON (backups; stdout
//                                             goes to a file inside the encrypted backup, never the log)
//
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. Runs SQL through the Supabase
// Management API over HTTPS. Only SELECT statements are sent. Never prints secrets.
import {
  ROW_COUNTS_SQL,
  PUBLIC_TABLES_SQL,
  PUBLIC_FUNCTIONS_SQL,
  VERIFICATION_SQL,
  type PublicFunctionRow,
  checkTargetProject,
  checkVerification,
  type VerificationRow,
} from "../src/lib/deploy-checks.ts";
import { BACKUP_USERS_SQL } from "../src/lib/backup.ts";
import { fail, query, requireProject } from "./supabase-api.mts";

requireProject();

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
    "✓ Verification passed: 30 stages, 13 product lines, RLS and two-step policies on every table, " +
      "sign-up trigger present, Data API functions as expected, automation engine safe, no anonymous access.",
  );
} else if (command === "counts") {
  const [row] = await query<{ counts: Record<string, number> }>(ROW_COUNTS_SQL);
  if (!row) fail("Row-count query returned no rows.");
  console.log(JSON.stringify(row.counts));
} else if (command === "users") {
  const [row] = await query<{ users: unknown }>(BACKUP_USERS_SQL);
  if (!row) fail("Sign-in query returned no rows.");
  console.log(JSON.stringify(row.users));
} else {
  fail("Usage: node scripts/supabase-remote.mts guard|verify|counts|users");
}
