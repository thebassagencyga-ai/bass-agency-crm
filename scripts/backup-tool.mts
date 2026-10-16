// Free-plan backups and restores (ADR-027), used by .github/workflows/backup.yml,
// restore-drill.yml and restore-backup.yml. Prints counts only, never client data.
//
//   node scripts/backup-tool.mts manifest <counts.json> <users.json> <manifest.json>
//   node scripts/backup-tool.mts seed-users <dir>        local drill only: re-create the sign-ins (new ids)
//   node scripts/backup-tool.mts prepare <dir> local|remote
//        check the target (CRM schema present, no client work, same sign-ins) and write
//        <dir>/restore.sql: empty the CRM tables, then the copy with sign-in ids remapped
//   node scripts/backup-tool.mts check <dir> local|remote
//        after loading: schema verification, row counts equal the backup's, every row has an owner
//
// <dir> holds manifest.json and data.sql (an unpacked backup).
// local  = RESTORE_DATABASE_URL, which must point at this machine.
// remote = the hosted project in SUPABASE_PROJECT_REF, via the Management API.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  BACKUP_USERS_SQL, ORPHAN_ROWS_SQL, backupManifest, buildManifest, checkRestoreTarget, planUserRemap, restoreSql,
  type BackupManifest, type BackupUser,
} from "../src/lib/backup.ts";
import { ROW_COUNTS_SQL, VERIFICATION_SQL, checkVerification, compareRowCounts, type RowCounts, type VerificationRow } from "../src/lib/deploy-checks.ts";
import { fail, query as remoteQuery, requireProject } from "./supabase-api.mts";

type Run = <T>(sql: string) => Promise<T[]>;

async function withTarget<R>(kind: string | undefined, fn: (run: Run) => Promise<R>): Promise<R> {
  if (kind === "remote") {
    requireProject();
    return fn(remoteQuery);
  }
  if (kind !== "local") fail("Target must be 'local' or 'remote'.");
  const db = new pg.Client({ connectionString: localUrl() });
  await db.connect();
  try {
    return await fn(async <T,>(sql: string) => (await db.query(sql)).rows as T[]);
  } finally {
    await db.end();
  }
}

function localUrl(): string {
  const url = process.env.RESTORE_DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    fail("RESTORE_DATABASE_URL is not a database URL.");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) fail(`Refusing to use a non-local database (${host}).`);
  return url;
}

function readManifest(dir: string): BackupManifest {
  const parsed = backupManifest.safeParse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")));
  if (!parsed.success) fail("manifest.json in the backup is not valid.");
  return parsed.data;
}

const total = (counts: RowCounts) => Object.values(counts).reduce((a, b) => a + Number(b), 0);
const firstRow = async <T,>(run: Run, sql: string): Promise<T> => {
  const [row] = await run<T>(sql);
  if (!row) fail("Query returned no rows.");
  return row;
};

const [command, a1, a2, a3] = process.argv.slice(2);

if (command === "manifest" && a1 && a2 && a3) {
  const counts = JSON.parse(readFileSync(a1, "utf8")) as RowCounts;
  const users = JSON.parse(readFileSync(a2, "utf8")) as unknown;
  const manifest = buildManifest(counts, users, new Date());
  writeFileSync(a3, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`Backup contents: ${Object.keys(manifest.counts).length} tables, ${total(manifest.counts)} rows, ${manifest.users.length} sign-in(s).`);
} else if (command === "seed-users" && a1) {
  const manifest = readManifest(a1);
  const db = new pg.Client({ connectionString: localUrl() });
  await db.connect();
  try {
    for (const u of manifest.users) await db.query("insert into auth.users (id, email) values (gen_random_uuid(), $1)", [u.email]);
  } finally {
    await db.end();
  }
  console.log(`Re-created ${manifest.users.length} sign-in(s) with new ids in the throwaway database.`);
} else if (command === "prepare" && a1) {
  const manifest = readManifest(a1);
  await withTarget(a2, async (run) => {
    const verification = checkVerification(await firstRow<VerificationRow>(run, VERIFICATION_SQL));
    if (verification.length > 0) fail(`The target's database is not the current CRM schema (run Deploy database migrations first):\n${verification.join("\n")}`);
    const counts = (await firstRow<{ counts: RowCounts }>(run, ROW_COUNTS_SQL)).counts;
    const problems = checkRestoreTarget(counts);
    if (problems.length > 0) fail(`Refusing to restore into this database:\n${problems.join("\n")}`);
    const users = (await firstRow<{ users: BackupUser[] }>(run, BACKUP_USERS_SQL)).users;
    const plan = planUserRemap(manifest.users, users);
    if (!plan.ok) fail(plan.reason);
    const data = readFileSync(path.join(a1, "data.sql"), "utf8");
    writeFileSync(path.join(a1, "restore.sql"), restoreSql(data, plan.map), { mode: 0o600 });
    console.log(`✓ Target is safe to restore into: CRM schema present, no client records, ${users.length} matching sign-in(s).`);
  });
} else if (command === "check" && a1) {
  const manifest = readManifest(a1);
  await withTarget(a2, async (run) => {
    const row = await firstRow<VerificationRow>(run, VERIFICATION_SQL);
    console.log("Restored schema:", JSON.stringify(row));
    const counts = (await firstRow<{ counts: RowCounts }>(run, ROW_COUNTS_SQL)).counts;
    console.log("Backup rows:  ", JSON.stringify(manifest.counts));
    console.log("Restored rows:", JSON.stringify(counts));
    const orphans = Number((await firstRow<{ orphans: number }>(run, ORPHAN_ROWS_SQL)).orphans);
    const problems = [
      ...checkVerification(row),
      ...compareRowCounts(manifest.counts, counts),
      ...(orphans > 0 ? [`${orphans} rows belong to no sign-in`] : []),
    ];
    if (problems.length > 0) fail(`Restore check failed:\n${problems.join("\n")}`);
    console.log(
      `✓ Restore check passed: ${Object.keys(counts).length} tables, ${total(counts)} rows, all matching the backup of ` +
        `${manifest.created_at}; every row has its owner; security checks pass.`,
    );
  });
} else {
  fail("Usage: node scripts/backup-tool.mts manifest|seed-users|prepare|check … (see the top of this file)");
}
