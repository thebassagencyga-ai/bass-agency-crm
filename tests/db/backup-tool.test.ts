import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { BACKUP_USERS_SQL } from "../../src/lib/backup";
import { ROW_COUNTS_SQL } from "../../src/lib/deploy-checks";
import { asUser, connect, createUser, insertContact, insertOpportunity, type Db } from "./helpers";

// Free-plan backups (ADR-027), end to end with the real scripts the workflows run:
// copy (data only, like `supabase db dump --data-only`) → manifest → encrypt → decrypt →
// fresh database with the sign-ins re-created under NEW ids → prepare (checks + id remap) →
// load in one transaction → check. Then: owners are remapped, access rules still hold, and a
// wrong passphrase or a target holding client work is refused.

const PG_DUMP = process.env.PG_DUMP ?? "pg_dump";
const PG_RESTORE = process.env.PG_RESTORE ?? "pg_restore";
const PSQL = process.env.PSQL ?? "psql";
const PASSPHRASE = "fictional-test-passphrase-0123456789";

let db: Db;
let admin: pg.Client;
let target: pg.Client;
let targetUrl: string;
let targetName: string;
let work: string;
let alice: string;
let aliceEmail: string;
let aliceContact: string;
let manifest: { counts: Record<string, number>; users: { id: string; email: string }[] };

const env = (extra: Record<string, string> = {}) => ({ ...process.env, BACKUP_PASSPHRASE: PASSPHRASE, PSQL, ...extra });
const run = (cmd: string, args: string[], extra: Record<string, string> = {}) =>
  execFileSync(cmd, args, { env: env(extra), stdio: "pipe", encoding: "utf8" });
const tool = (args: string[]) => run("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/backup-tool.mts", ...args], { RESTORE_DATABASE_URL: targetUrl });
const failure = (fn: () => unknown) => {
  try {
    fn();
    return "";
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
};

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "bkp-alice");
  aliceEmail = (await db.query("select email from auth.users where id = $1", [alice])).rows[0].email;
  const bob = await createUser(db, "bkp-bob");
  aliceContact = await insertContact(db, alice, { first_name: "Alex", last_name: "Backup", relationship_status: "client", notes: "Fictional — “quotes”, tabs\tand ünïcode" });
  const policy = await insertOpportunity(db, alice, aliceContact, "auto", "bound", { outcome: "won", renewal_date: "2027-03-01" });
  await asUser(db, alice, (q) => q.query("select public.record_renewal_outcome($1, 'renewed')", [policy]));
  await insertContact(db, bob, { contact_type: "business", business_name: "Example Bakery LLC" });

  // 1. Copy: counts, sign-ins and data from ONE snapshot (other test files write in parallel).
  work = mkdtempSync(path.join(tmpdir(), "crm-bkp-"));
  const source = inject("testDatabaseUrl");
  const snap = new pg.Client({ connectionString: source });
  await snap.connect();
  await snap.query("begin isolation level repeatable read");
  const snapshot = (await snap.query("select pg_export_snapshot() as s")).rows[0].s;
  writeFileSync(path.join(work, "counts.json"), JSON.stringify((await snap.query(ROW_COUNTS_SQL)).rows[0].counts));
  writeFileSync(path.join(work, "users.json"), JSON.stringify((await snap.query(BACKUP_USERS_SQL)).rows[0].users));
  run(PG_DUMP, ["--data-only", "--schema", "public", "--snapshot", snapshot, "--file", path.join(work, "data.sql"), source]);
  await snap.query("commit");
  await snap.end();

  // 2. Manifest + encrypted archive, then unpack it elsewhere (what the restore workflows do).
  tool(["manifest", path.join(work, "counts.json"), path.join(work, "users.json"), path.join(work, "manifest.json")]);
  run("bash", ["scripts/backup-archive.sh", "pack", work, path.join(work, "backup.tar.gpg")]);
  run("bash", ["scripts/backup-archive.sh", "unpack", path.join(work, "backup.tar.gpg"), path.join(work, "out")]);
  manifest = JSON.parse(readFileSync(path.join(work, "out", "manifest.json"), "utf8"));

  // 3. A fresh database: CRM schema + reference rows (as after the migrations), no sign-ins.
  const server = new URL(source);
  targetName = `${server.pathname.slice(1)}_bkp_target`;
  server.pathname = "/postgres";
  admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  await admin.query(`create database ${targetName}`);
  const t = new URL(source);
  t.pathname = `/${targetName}`;
  targetUrl = t.toString();
  run(PG_DUMP, ["--schema-only", "--format=custom", "--file", path.join(work, "schema.dump"), source]);
  run(PG_RESTORE, ["--exit-on-error", "--dbname", targetUrl, path.join(work, "schema.dump")]);
  run(PG_DUMP, ["--data-only", "-t", "public.product_lines", "-t", "public.pipeline_stages", "--file", path.join(work, "ref.sql"), source]);
  run(PSQL, [targetUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path.join(work, "ref.sql")]);
  target = new pg.Client({ connectionString: targetUrl });
  await target.connect();
}, 180_000);

afterAll(async () => {
  await target?.end();
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${targetName} with (force)`);
    await admin.end();
  }
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("backup archive", () => {
  it("holds the data and the sign-ins, and the copy has no password hashes", () => {
    const data = readFileSync(path.join(work, "out", "data.sql"), "utf8");
    expect(data).toContain("Example Bakery LLC");
    expect(data).not.toContain("auth.users");
    expect(manifest.users.map((u) => u.email)).toContain(aliceEmail);
    expect(manifest.counts.contacts).toBeGreaterThanOrEqual(2);
  });

  it("is not readable without the passphrase, and refuses a wrong one", () => {
    expect(readFileSync(path.join(work, "backup.tar.gpg")).includes("Example Bakery LLC")).toBe(false);
    const err = failure(() => run("bash", ["scripts/backup-archive.sh", "unpack", path.join(work, "backup.tar.gpg"), path.join(work, "bad")], { BACKUP_PASSPHRASE: "wrong-passphrase-0123456789" }));
    expect(err).toContain("Could not decrypt the backup");
  });

  it("refuses a short passphrase", () => {
    expect(failure(() => run("bash", ["scripts/backup-archive.sh", "pack", work, path.join(work, "x.gpg")], { BACKUP_PASSPHRASE: "short" }))).toContain("shorter than 20");
  });
});

describe("restore into a fresh database", () => {
  it("refuses until the sign-ins exist there", () => {
    expect(failure(() => tool(["prepare", path.join(work, "out"), "local"]))).toContain("Create these sign-ins in the target first");
  });

  it("restores every row under the new sign-in ids", async () => {
    tool(["seed-users", path.join(work, "out")]);
    expect(tool(["prepare", path.join(work, "out"), "local"])).toContain("✓ Target is safe to restore into");
    expect(run("bash", ["scripts/restore-load.sh", targetUrl, path.join(work, "out")])).toContain("✓ Backup loaded");
    expect(tool(["check", path.join(work, "out"), "local"])).toContain("✓ Restore check passed");

    const newAlice = (await target.query("select id from auth.users where email = $1", [aliceEmail])).rows[0].id;
    expect(newAlice).not.toBe(alice);
    const contact = (await target.query("select owner_id, notes from public.contacts where id = $1", [aliceContact])).rows[0];
    expect(contact).toEqual({ owner_id: newAlice, notes: "Fictional — “quotes”, tabs\tand ünïcode" });
    expect((await target.query("select count(*)::int as n from public.contacts where owner_id = $1", [alice])).rows[0].n).toBe(0);
  });

  it("still enforces owner-only, two-step access with the new ids", async () => {
    const newAlice = (await target.query("select id from auth.users where email = $1", [aliceEmail])).rows[0].id;
    const visible = async (sub: string, aal: string) => {
      await target.query("begin");
      try {
        await target.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated", aal })]);
        await target.query("set local role authenticated");
        return (await target.query("select id from public.contacts where id = $1", [aliceContact])).rowCount;
      } finally {
        await target.query("rollback");
      }
    };
    expect(await visible(newAlice, "aal2")).toBe(1);
    expect(await visible(newAlice, "aal1")).toBe(0);
    expect(await visible(alice, "aal2")).toBe(0);
  });

  it("refuses to restore again over client records", () => {
    expect(failure(() => tool(["prepare", path.join(work, "out"), "local"]))).toContain("Refusing to restore into this database");
  });

  it("refuses a non-local database for the local commands", () => {
    const err = failure(() => run("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/backup-tool.mts", "seed-users", path.join(work, "out")], { RESTORE_DATABASE_URL: "postgres://u@db.example.com:5432/postgres" }));
    expect(err).toContain("Refusing to use a non-local database");
  });
});
