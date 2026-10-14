// Safety checks for the "Deploy database migrations" GitHub workflow (ADR-014).
// Pure functions so they can be unit tested; scripts/supabase-remote.mts does the I/O.

/** Every table the CRM migrations create in the public schema. */
export const CRM_TABLES = [
  "activities",
  "audit_log",
  "automation_rules",
  "contacts",
  "opportunities",
  "pipeline_stages",
  "product_lines",
  "profiles",
  "tasks",
] as const;

type Result = { ok: true } | { ok: false; reason: string };

export function checkProjectRef(ref: string): Result {
  return /^[a-z]{20}$/.test(ref)
    ? { ok: true }
    : { ok: false, reason: "SUPABASE_PROJECT_REF must be the 20-letter project ID (Project Settings → General)." };
}

/**
 * Decides whether the target database is safe to migrate: either empty, or already the CRM.
 * Any other table means we may be pointed at the wrong project (e.g. ProducerIQ), so refuse.
 */
export function checkTargetProject(
  publicTables: readonly string[],
): { ok: true; state: "empty" | "crm" } | { ok: false; reason: string } {
  const known = new Set<string>(CRM_TABLES);
  const unknown = publicTables.filter((t) => !known.has(t)).sort();
  if (unknown.length > 0) {
    return {
      ok: false,
      reason:
        `This project contains tables that are not part of the CRM: ${unknown.join(", ")}. ` +
        "It does not look like the CRM project, so nothing was changed. Check SUPABASE_PROJECT_REF.",
    };
  }
  return { ok: true, state: publicTables.length === 0 ? "empty" : "crm" };
}

export interface VerificationRow {
  stages: unknown;
  product_lines: unknown;
  tables_without_rls: unknown;
  anon_grants: unknown;
  crm_tables: unknown;
}

/** SQL whose single result row is checked by checkVerification. */
export const VERIFICATION_SQL = `
select
  (select count(*) from public.pipeline_stages) as stages,
  (select count(*) from public.product_lines) as product_lines,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace
     and relkind = 'r' and not relrowsecurity) as tables_without_rls,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon') as anon_grants,
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE') as crm_tables
`;

export const PUBLIC_TABLES_SQL = `
select table_name from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name
`;

/** Returns a list of problems; empty means the deployed schema looks right. */
export function checkVerification(row: VerificationRow): string[] {
  const expectations: [keyof VerificationRow, number, string][] = [
    ["stages", 30, "pipeline stages"],
    ["product_lines", 4, "product lines"],
    ["tables_without_rls", 0, "tables without row level security"],
    ["anon_grants", 0, "privileges granted to anon"],
    ["crm_tables", CRM_TABLES.length, "CRM tables"],
  ];
  const problems: string[] = [];
  for (const [key, expected, label] of expectations) {
    const raw = row[key];
    const actual = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
    if (actual !== expected) {
      problems.push(`Expected ${expected} ${label}, found ${raw === undefined ? "nothing" : String(raw)}.`);
    }
  }
  return problems;
}
