// Safety checks for the "Deploy database migrations" GitHub workflow (ADR-014).
// Pure functions so they can be unit tested; scripts/supabase-remote.mts does the I/O.

/** Every table the CRM migrations create in the public schema. */
export const CRM_TABLES = [
  "activities",
  "audit_log",
  "automation_rules",
  "contacts",
  "cross_sell_dismissals",
  "cross_sell_rules",
  "household_members",
  "import_batches",
  "intake_links",
  "intake_submissions",
  "opportunities",
  "pipeline_stages",
  "product_lines",
  "profiles",
  "renewal_outcomes",
  "tasks",
  "vehicles",
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
  mfa_policies: unknown;
  profile_trigger: unknown;
  public_functions: unknown;
  definer_or_anon_functions: unknown;
  public_intake_function: unknown;
  unexpected_trigger_functions: unknown;
  engine_unsafe: unknown;
}

/** Database functions callable through the Data API (SECURITY INVOKER except PUBLIC_ANON_FUNCTION). Update per phase. */
export const PUBLIC_FUNCTIONS = [
  "accept_intake",
  "confirm_no_response_follow_up",
  "contact_lead_sources",
  "cross_sell_prompts",
  "dashboard_summary",
  "discard_intake",
  "dismiss_cross_sell",
  "find_possible_duplicates",
  "import_book",
  "quick_intake",
  "record_renewal_outcome",
  "report_summary",
  "rotate_intake_link",
  "search_contacts",
  "search_opportunities",
  "search_renewals",
  "search_tasks",
  "submit_intake",
  "task_counts",
] as const;

/**
 * The only function anonymous callers may run (Phase 13, ADR-028): the public intake form.
 * SECURITY DEFINER with a pinned search_path; it can only add a submission to an inbox.
 */
export const PUBLIC_ANON_FUNCTION = "submit_intake";

/**
 * Trigger-only functions Supabase itself adds to `public` on hosted projects. They return
 * `trigger`/`event_trigger`, so Postgres refuses to call them directly and the Data API never
 * exposes them. `rls_auto_enable`: the dashboard's "Enable automatic RLS" setting (ADR-002).
 * Any other trigger function in `public` fails verification.
 */
export const PLATFORM_TRIGGER_FUNCTIONS = ["rls_auto_enable"] as const;

const CALLABLE = "p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)";

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
     where table_schema = 'public' and table_type = 'BASE TABLE') as crm_tables,
  (select count(*) from pg_policies
     where schemaname = 'public' and permissive = 'RESTRICTIVE' and qual like '%aal2%') as mfa_policies,
  (select count(*) from pg_trigger
     where tgname = 'on_auth_user_created' and not tgisinternal) as profile_trigger,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and ${CALLABLE}) as public_functions,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${CALLABLE}
     and p.proname <> '${PUBLIC_ANON_FUNCTION}'
     and (p.prosecdef or has_function_privilege('anon', p.oid, 'execute'))) as definer_or_anon_functions,
  -- The public intake function: exactly one, definer, search_path pinned, anon only.
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname = '${PUBLIC_ANON_FUNCTION}' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and 'search_path=""' = any (coalesce(p.proconfig, '{}'))) as public_intake_function,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and not (${CALLABLE})
     and p.proname not in (${PLATFORM_TRIGGER_FUNCTIONS.map((n) => `'${n}'`).join(", ")})) as unexpected_trigger_functions,
  -- Automation engine schema (Phase 6): must exist, run as the caller only, closed to anon.
  (select case when to_regnamespace('crm_engine') is null then 1 else
     (select count(*) from pg_proc p where p.pronamespace = 'crm_engine'::regnamespace
        and (p.prosecdef or has_function_privilege('anon', p.oid, 'execute')))
     + case when has_schema_privilege('anon', 'crm_engine', 'usage') then 1 else 0 end
   end) as engine_unsafe
`;

/** Every function in the public schema, printed by the verify step so a failure names it. */
export const PUBLIC_FUNCTIONS_SQL = `
select p.proname as name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as returns,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname, args
`;

export interface PublicFunctionRow {
  name: string;
  args: string;
  returns: string;
  security_definer: boolean;
  anon_execute: boolean;
}

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
    ["mfa_policies", CRM_TABLES.length, "two-step (aal2) policies"],
    ["profile_trigger", 1, "sign-up profile trigger"],
    ["public_functions", PUBLIC_FUNCTIONS.length, "Data API functions"],
    ["definer_or_anon_functions", 0, "functions that bypass RLS or allow anonymous use"],
    ["public_intake_function", 1, `public intake function (${PUBLIC_ANON_FUNCTION}: SECURITY DEFINER, search_path pinned, anon only)`],
    ["unexpected_trigger_functions", 0, "unknown trigger functions in public"],
    ["engine_unsafe", 0, "problems in the automation engine schema (missing, SECURITY DEFINER or anonymous access)"],
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

/**
 * Row count of every table in public, as one JSON object { table: count }. Counts only — no
 * data — so it is safe to print. Used by the restore drill (Phase 12) on production and on
 * the restored copy.
 */
export const ROW_COUNTS_SQL = `
select coalesce(json_object_agg(c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
  order by c.relname), '{}'::json) as counts
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
`;

export type RowCounts = Record<string, number>;

/** Differences between production and the restored copy; empty means every table matches. */
export function compareRowCounts(production: RowCounts, restored: RowCounts): string[] {
  const problems: string[] = [];
  const tables = [...new Set([...Object.keys(production), ...Object.keys(restored)])].sort();
  for (const t of tables) {
    const p = production[t];
    const r = restored[t];
    if (p === undefined) problems.push(`${t}: only in the restored copy`);
    else if (r === undefined) problems.push(`${t}: missing from the restored copy`);
    else if (Number(p) !== Number(r)) problems.push(`${t}: production ${p} rows, restored ${r}`);
  }
  return problems;
}
