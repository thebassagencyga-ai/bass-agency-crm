import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { asUser, connect, createUser, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 11: backup restoration rehearsed into a local database. A full pg_dump of the test
// database (schema, data, policies, functions, triggers) is restored into a brand-new local
// database, then checked: every fixture row identical, every security rule present, and the
// restored database still enforces owner-only access and still runs the automation.
// PG_DUMP / PG_RESTORE pick binaries matching the server version (CI uses PostgreSQL 17).
// Local only: TEST_DATABASE_URL is checked to be local by the global setup.

const PG_DUMP = process.env.PG_DUMP ?? "pg_dump";
const PG_RESTORE = process.env.PG_RESTORE ?? "pg_restore";

let db: Db;
let restored: Db;
let restoredName: string;
let admin: pg.Client;
let workdir: string;
let alice: string;
let bob: string;
let aliceContact: string;

/** Rows of this test's users only, so other test files writing in parallel don't matter. */
const FINGERPRINT_SQL = `
  select t.relname as table_name,
    (xpath('/row/c/text()', query_to_xml(format(
      'select count(*) as c from public.%I where %s', t.relname,
      case when exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'owner_id')
           then 'owner_id = any($ids$' || $1 || '$ids$::uuid[])'
           when t.relname = 'profiles' then 'id = any($ids$' || $1 || '$ids$::uuid[])'
           else 'true' end), false, true, '')))[1]::text::int as row_count,
    (xpath('/row/h/text()', query_to_xml(format(
      'select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from (select * from public.%I where %s) x',
      '|', '', t.relname,
      case when exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'owner_id')
           then 'owner_id = any($ids$' || $1 || '$ids$::uuid[])'
           when t.relname = 'profiles' then 'id = any($ids$' || $1 || '$ids$::uuid[])'
           else 'true' end), false, true, '')))[1]::text as checksum
  from pg_class t
  where t.relnamespace = 'public'::regnamespace and t.relkind = 'r'
  order by 1`;

const SECURITY_SQL = `
  select
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity)::int as rls_tables,
    (select count(*) from pg_policies where schemaname = 'public')::int as policies,
    (select string_agg(proname || ':' || prosecdef, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace) as functions,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace) and not t.tgisinternal)::int as triggers,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated')::int as grants,
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon')::int as anon_grants`;

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "backup-alice");
  bob = await createUser(db, "backup-bob");

  // A little of everything, written the way the app writes it (automation included).
  aliceContact = await insertContact(db, alice, { first_name: "Alex", last_name: "Backup", relationship_status: "client", notes: "Fictional — line 1\nline 2 with “quotes” & ünïcode" });
  const policy = await insertOpportunity(db, alice, aliceContact, "auto", "bound", { outcome: "won", estimated_annual_premium: 1234.56, renewal_date: "2027-03-01" });
  await insertOpportunity(db, alice, aliceContact, "home", "new_lead");
  await asUser(db, alice, async (q) => {
    await q.query("insert into public.activities (contact_id, activity_type, outcome, notes) values ($1, 'call', 'connected', 'Fictional call')", [aliceContact]);
    await q.query("select public.record_renewal_outcome($1, 'renewed', null, 1300)", [policy]);
    const rule = (await q.query("select id from public.cross_sell_rules where rule_key = 'personal_no_life'")).rows[0].id;
    await q.query("select public.dismiss_cross_sell($1, $2)", [aliceContact, rule]);
  });
  const bobContact = await insertContact(db, bob, { contact_type: "business", business_name: "Example Bakery LLC" });
  await insertOpportunity(db, bob, bobContact, "commercial", "new_lead");

  // Back up, then restore into a new database on the same local server.
  workdir = mkdtempSync(path.join(tmpdir(), "crm-backup-"));
  const source = inject("testDatabaseUrl");
  const dumpFile = path.join(workdir, "crm.dump");
  execFileSync(PG_DUMP, ["--format=custom", "--file", dumpFile, source], { stdio: "pipe" });

  const server = new URL(source);
  restoredName = `${server.pathname.slice(1)}_restored`;
  server.pathname = "/postgres";
  admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  await admin.query(`create database ${restoredName}`);
  const target = new URL(source);
  target.pathname = `/${restoredName}`;
  execFileSync(PG_RESTORE, ["--exit-on-error", "--dbname", target.toString(), dumpFile], { stdio: "pipe" });
  restored = new pg.Client({ connectionString: target.toString() });
  await restored.connect();
}, 120_000);

afterAll(async () => {
  await restored?.end();
  await db?.end();
  if (admin) {
    await admin.query(`drop database if exists ${restoredName} with (force)`);
    await admin.end();
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("restored database", () => {
  it("has every row of the fixture data, byte for byte", async () => {
    const ids = `{${alice},${bob}}`;
    const before = (await db.query(FINGERPRINT_SQL, [ids])).rows;
    const after = (await restored.query(FINGERPRINT_SQL, [ids])).rows;
    expect(after).toEqual(before);
    const counts = Object.fromEntries(after.map((r) => [r.table_name, r.row_count]));
    for (const t of ["contacts", "opportunities", "tasks", "activities", "renewal_outcomes", "cross_sell_dismissals", "audit_log", "automation_rules", "cross_sell_rules", "profiles"]) {
      expect(counts[t], t).toBeGreaterThan(0);
    }
  });

  it("has the same security rules: RLS, policies, functions, triggers and grants", async () => {
    const before = (await db.query(SECURITY_SQL)).rows[0];
    const after = (await restored.query(SECURITY_SQL)).rows[0];
    expect(after).toEqual(before);
    expect(after.anon_grants).toBe(0);
  });

  it("still enforces owner-only, two-step access", async () => {
    const as = async (userId: string, aal: string, sql: string, params: unknown[] = []) => {
      await restored.query("begin");
      try {
        await restored.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", aal })]);
        await restored.query("set local role authenticated");
        return (await restored.query(sql, params)).rows;
      } finally {
        await restored.query("rollback");
      }
    };
    expect(await as(alice, "aal2", "select id from public.contacts where id = $1", [aliceContact])).toHaveLength(1);
    expect(await as(bob, "aal2", "select id from public.contacts where id = $1", [aliceContact])).toHaveLength(0);
    expect(await as(alice, "aal1", "select id from public.contacts")).toHaveLength(0);
  });

  it("still runs the automation (triggers and engine restored)", async () => {
    await restored.query("begin");
    try {
      await restored.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated", aal: "aal2" })]);
      await restored.query("set local role authenticated");
      const stage = (await restored.query("select s.id from public.stages s join public.pipeline_routes r on r.pipeline_id = s.pipeline_id where r.product_line = 'life' and s.position = 1 and s.archived_at is null")).rows[0].id;
      const opp = (await restored.query("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'life', $2) returning id", [aliceContact, stage])).rows[0].id;
      const tasks = (await restored.query("select title from public.tasks where opportunity_id = $1", [opp])).rows;
      expect(tasks).toEqual([{ title: "Make initial contact" }]);
    } finally {
      await restored.query("rollback");
    }
  });
});
