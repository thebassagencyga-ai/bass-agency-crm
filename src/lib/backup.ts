import { z } from "zod";
import { CRM_TABLES, type RowCounts } from "./deploy-checks.ts";

// Free-plan backups (ADR-027). Supabase Free keeps no backups, so a nightly GitHub Actions job
// copies the CRM data (schema `public`) plus a list of sign-ins (id + email only) into an
// encrypted archive. Restoring goes into a project that already has the migrations and the
// same sign-ins re-created by hand; their new ids replace the old ones in the copy.

/** Sign-ins: id and email only (no password hashes, no authenticator secrets). */
export const BACKUP_USERS_SQL = `
select coalesce(json_agg(json_build_object('id', id, 'email', lower(email)) order by lower(email)), '[]'::json) as users
from auth.users
`;

/** Rows whose owner no longer exists as a sign-in (FK checks are paused while loading). */
export const ORPHAN_ROWS_SQL = `
select coalesce(sum(n), 0)::int as orphans from (
  select (xpath('/row/n/text()', query_to_xml(format(
    'select count(*) as n from public.%I x where not exists (select 1 from auth.users u where u.id = x.%I)',
    c.relname, a.attname), false, true, '')))[1]::text::int as n
  from pg_class c join pg_attribute a on a.attrelid = c.oid
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not a.attisdropped
    and ((c.relname = 'profiles' and a.attname = 'id') or a.attname = 'owner_id')
) t
`;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const backupUser = z.object({ id: uuid, email: z.string().min(3).max(320) });
export type BackupUser = z.infer<typeof backupUser>;

export const backupManifest = z.object({
  version: z.literal(1),
  created_at: z.iso.datetime(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  users: z.array(backupUser),
});
export type BackupManifest = z.infer<typeof backupManifest>;

export function buildManifest(counts: RowCounts, users: unknown, now: Date): BackupManifest {
  return backupManifest.parse({
    version: 1,
    created_at: now.toISOString(),
    counts: Object.fromEntries(Object.entries(counts).map(([t, n]) => [t, Number(n)])),
    users,
  });
}

/** Tables holding client work; a restore target must have none of these rows. */
export const BUSINESS_TABLES = ["activities", "contacts", "cross_sell_dismissals", "opportunities", "renewal_outcomes", "tasks"] as const;

export type RemapPlan = { ok: true; map: Map<string, string> } | { ok: false; reason: string };

/**
 * Pairs each backed-up sign-in with the target's sign-in of the same email. The sets must be
 * equal: a missing sign-in would leave rows without an owner; an extra one would lose its
 * profile when the tables are replaced.
 */
export function planUserRemap(backup: BackupUser[], target: BackupUser[]): RemapPlan {
  const byEmail = new Map(target.map((u) => [u.email.toLowerCase(), u.id]));
  const backupEmails = new Set(backup.map((u) => u.email.toLowerCase()));
  const missing = backup.filter((u) => !byEmail.has(u.email.toLowerCase())).map((u) => u.email);
  const extra = target.filter((u) => !backupEmails.has(u.email.toLowerCase())).map((u) => u.email);
  if (missing.length > 0) {
    return { ok: false, reason: `Create these sign-ins in the target first (Authentication → Users → Add user): ${missing.join(", ")}.` };
  }
  if (extra.length > 0) {
    return { ok: false, reason: `The target has sign-ins that are not in the backup: ${extra.join(", ")}. Remove them or restore elsewhere.` };
  }
  return { ok: true, map: new Map(backup.map((u) => [u.id, byEmail.get(u.email.toLowerCase())!])) };
}

/** Problems that make the target unsafe to restore into; empty means it holds no client work. */
export function checkRestoreTarget(counts: RowCounts): string[] {
  const problems: string[] = [];
  for (const t of CRM_TABLES) if (counts[t] === undefined) problems.push(`${t}: table missing (apply the migrations first)`);
  for (const t of BUSINESS_TABLES) {
    const n = Number(counts[t] ?? 0);
    if (n > 0) problems.push(`${t}: has ${n} rows (a restore only goes into a project without client data)`);
  }
  return problems;
}

/** Replaces every old sign-in id in the data copy with the new one. Ids are random UUIDs. */
export function remapUserIds(sql: string, map: Map<string, string>): string {
  let out = sql;
  for (const [from, to] of map) if (from !== to) out = out.split(from).join(to);
  return out;
}

/** Empties every CRM table before the copy is loaded (same transaction as the load). */
export function restoreSql(data: string, map: Map<string, string>): string {
  const tables = CRM_TABLES.map((t) => `public.${t}`).join(", ");
  return `truncate ${tables} cascade;\n${remapUserIds(data, map)}`;
}
