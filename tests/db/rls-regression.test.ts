import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 11 RLS regression suite. Driven by the database catalog, so every table and function
// added later is covered automatically: a new table without RLS, without the two-step
// policy, readable by another agent, or writable for another agent fails here.

let db: Db;
let alice: string;
let bob: string;
let tables: string[];
let ownerTables: string[];

// One valid row of alice's per table that API users can insert into. A test below fails if a
// table with INSERT privilege is missing from this list, so new tables must be added.
const insertable = (ids: Record<string, string>): Record<string, Record<string, unknown>> => ({
  contacts: { contact_type: "individual", first_name: "Spoof" },
  opportunities: { contact_id: ids.contact, product_line: "home", stage_id: ids.homeStage },
  tasks: { contact_id: ids.contact, title: "Spoof", due_date: "2026-10-16" },
  activities: { contact_id: ids.contact, activity_type: "note" },
  automation_rules: { rule_key: "spoof_rule", name: "Spoof", trigger_event: "quote_sent", action: "create_task", task_title_template: "x" },
  renewal_outcomes: { opportunity_id: ids.policy, renewal_date: "2027-01-01", outcome: "renewed", next_renewal_date: "2028-01-01", recorded_on: "2026-10-16" },
  cross_sell_rules: { rule_key: "spoof_rule", name: "Spoof", has_any_lines: ["auto"], lacks_line: "life", reason: "x" },
  cross_sell_dismissals: { contact_id: ids.contact, rule_id: ids.rule, dismissed_on: "2026-10-16", hidden_until: "2027-10-16" },
  intake_links: { enabled: false, disabled_at: "2026-10-16T12:00:00Z" },
  household_members: { contact_id: ids.contact, first_name: "Sam", relationship: "spouse" },
  vehicles: { contact_id: ids.contact, year: 2019, make: "Example", model: "Sedan" },
  import_batches: { file_name: "clients.csv" },
  ai_usage: { job: "daily_briefing", model: "claude-opus-5-5", input_tokens: 100, output_tokens: 50, cost_usd: 0.0014 },
  calendar_feeds: { token_hash: "\\x" + "ab".repeat(32), enabled: false, disabled_at: "2026-10-16T12:00:00Z" },
});
let ids: Record<string, string>;

const insertSql = (table: string, row: Record<string, unknown>, owner?: string) => {
  const values = owner ? { ...row, owner_id: owner } : row;
  const cols = Object.keys(values);
  return {
    sql: `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    params: Object.values(values).map((v) => (Array.isArray(v) ? `{${v.join(",")}}` : v)),
  };
};

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "rlsreg-alice");
  bob = await createUser(db, "rlsreg-bob");
  tables = (await db.query<{ t: string }>(
    "select relname as t from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1",
  )).rows.map((r) => r.t);
  ownerTables = (await db.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_attribute a on a.attrelid = c.oid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attname = 'owner_id' and not a.attisdropped order by 1`,
  )).rows.map((r) => r.t);

  // Alice has a row in every owner table (audit_log rows come from the triggers).
  const contact = await insertContact(db, alice, { first_name: "Alex", relationship_status: "client" });
  const policy = await insertOpportunity(db, alice, contact, "auto", "bound", { outcome: "won", renewal_date: "2027-01-01" });
  const homeStage = (await db.query("select id from public.pipeline_stages where product_line = 'home' and code = 'new_lead'")).rows[0].id;
  const rule = await asUser(db, alice, async (q) => {
    await q.query("insert into public.tasks (contact_id, title, due_date) values ($1, 'Call', '2026-10-16')", [contact]);
    await q.query("insert into public.activities (contact_id, activity_type) values ($1, 'call')", [contact]);
    await q.query("select public.record_renewal_outcome($1, 'renewed')", [policy]);
    const r = (await q.query("select id from public.cross_sell_rules where rule_key = 'auto_no_home'")).rows[0].id as string;
    await q.query("select public.dismiss_cross_sell($1, $2)", [contact, r]);
    const r2 = (await q.query("select id from public.cross_sell_rules where rule_key = 'home_no_auto'")).rows[0].id as string;
    return { r, r2 };
  });
  // Phase 15: an import batch.
  await asUser(db, alice, (q) => q.query("insert into public.import_batches (file_name) values ('clients.csv')"));
  // Phase 14: a household member and a vehicle (contact-level details).
  await asUser(db, alice, async (q) => {
    await q.query("insert into public.household_members (contact_id, first_name) values ($1, 'Sam')", [contact]);
    await q.query("insert into public.vehicles (contact_id, year, make) values ($1, 2020, 'Example')", [contact]);
  });
  // Phase 13: an intake link and one public submission (inserted only through submit_intake).
  const token = await asUser(db, alice, async (q) => (await q.query("select public.rotate_intake_link() as t")).rows[0].t as string);
  await asAnon(db, (q) =>
    q.query("select public.submit_intake($1, $2, true)", [token, { first_name: "Pat", last_name: "Sample", email: "pat@example.com", lines: ["auto"] }]),
  );
  // Phase 19: one recorded AI call.
  await asUser(db, alice, (q) => q.query("insert into public.ai_usage (job, model, input_tokens, output_tokens, cost_usd) values ('draft_message', 'claude-opus-5-5', 10, 5, 0.0001)"));
  // Phase 18: a calendar link.
  await asUser(db, alice, (q) => q.query("select public.rotate_calendar_link()"));
  ids = { contact, policy, homeStage, rule: rule.r, rule2: rule.r2 };
});
afterAll(async () => {
  await db.end();
});

describe("every table", () => {
  it("has RLS and the restrictive two-step (aal2) policy", async () => {
    const { rows } = await db.query<{ t: string; rls: boolean; mfa: boolean }>(
      `select c.relname as t, c.relrowsecurity as rls,
              exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                        and p.permissive = 'RESTRICTIVE' and p.qual like '%aal2%') as mfa
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`,
    );
    expect(rows.filter((r) => !r.rls || !r.mfa).map((r) => r.t)).toEqual([]);
    expect(rows.length).toBe(tables.length);
  });

  it("is closed to anonymous callers", async () => {
    const codes: Record<string, string | undefined> = {};
    for (const t of tables) codes[t] = await errorCode(asAnon(db, (q) => q.query(`select 1 from public.${t} limit 1`)));
    expect(Object.entries(codes).filter(([, c]) => c !== "42501")).toEqual([]);
  });

  it("shows nothing to a password-only (aal1) session", async () => {
    const visible: string[] = [];
    for (const t of tables) {
      const n = await asPasswordOnlyUser(db, alice, async (q) => (await q.query(`select 1 from public.${t} limit 1`)).rowCount ?? 0);
      if (n > 0) visible.push(t);
    }
    expect(visible).toEqual([]);
  });

  it("has no DELETE or TRUNCATE privilege for signed-in users", async () => {
    const { rows } = await db.query(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('DELETE', 'TRUNCATE')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("every owner table", () => {
  it("alice sees her rows; bob sees none of them", async () => {
    const result: Record<string, [number, number]> = {};
    for (const t of ownerTables) {
      const count = (u: string) =>
        asUser(db, u, async (q) => Number((await q.query(`select count(*) as n from public.${t} where owner_id = $1`, [alice])).rows[0].n));
      result[t] = [await count(alice), await count(bob)];
    }
    expect(Object.entries(result).filter(([, [mine]]) => mine === 0).map(([t]) => t)).toEqual([]);
    expect(Object.entries(result).filter(([, [, theirs]]) => theirs !== 0).map(([t]) => t)).toEqual([]);
  });

  it("bob's update of alice's rows changes nothing", async () => {
    const changed: string[] = [];
    for (const t of ownerTables) {
      const code = await errorCode(
        asUser(db, bob, async (q) => {
          const r = await q.query(`update public.${t} set owner_id = owner_id where owner_id = $1`, [alice]);
          if ((r.rowCount ?? 0) > 0) changed.push(t);
        }),
      );
      if (code && code !== "42501") changed.push(`${t} (${code})`);
    }
    expect(changed).toEqual([]);
  });

  it("every table that accepts inserts has a spoof check below (keep the list complete)", async () => {
    const { rows } = await db.query<{ t: string }>(
      `select distinct table_name as t from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'INSERT' order by 1`,
    );
    expect(rows.map((r) => r.t)).toEqual(Object.keys(insertable(ids)).sort());
  });

  it("bob cannot insert a row owned by alice, or attach his row to her records", async () => {
    const accepted: string[] = [];
    for (const [t, row] of Object.entries(insertable(ids))) {
      const spoofOwner = insertSql(t, row, alice);
      const asOwner = await errorCode(asUser(db, bob, (q) => q.query(spoofOwner.sql, spoofOwner.params)));
      if (!asOwner) accepted.push(`${t}: owner_id = alice`);
      // Rows that point at alice's records (contact, policy, rule) must not be accepted for bob either.
      if (["opportunities", "tasks", "activities", "renewal_outcomes", "cross_sell_dismissals", "household_members", "vehicles"].includes(t)) {
        const own = insertSql(t, row);
        const attach = await errorCode(asUser(db, bob, (q) => q.query(own.sql, own.params)));
        if (!attach) accepted.push(`${t}: linked to alice's record`);
      }
    }
    expect(accepted).toEqual([]);
  });

  it("alice herself can insert each of those rows (the spoof checks are not vacuous)", async () => {
    const failed: string[] = [];
    for (const [t, row] of Object.entries(insertable(ids))) {
            // Different keys from alice's existing rows, so unique constraints do not interfere.
      const fresh = t === "renewal_outcomes" ? { renewal_date: "2029-01-01", next_renewal_date: "2030-01-01" }
        : t === "cross_sell_dismissals" ? { rule_id: ids.rule2 } : {};
      const own = insertSql(t, { ...row, ...fresh });
      const code = await errorCode(
        asUser(db, alice, async (q) => {
          await q.query(own.sql, own.params);
          throw Object.assign(new Error("rollback"), { code: "ok" }); // undo: keep fixtures unchanged
        }),
      );
      if (code !== "ok") failed.push(`${t}: ${code}`);
    }
    expect(failed).toEqual([]);
  });
});

describe("every function", () => {
  it("API-visible and engine functions run as the caller, pin search_path and refuse anon (except the intake form and calendar feed)", async () => {
    const { rows } = await db.query<{ f: string }>(
      `select n.nspname || '.' || p.proname as f
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'crm_engine')
          and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
          and not (n.nspname = 'public' and p.proname in ('submit_intake', 'calendar_feed'))
          and (p.prosecdef
               or has_function_privilege('anon', p.oid, 'execute')
               or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))`,
    );
    expect(rows.map((r) => r.f)).toEqual([]);
  });

  it("anonymous callers can run exactly two functions: the intake form and the calendar feed", async () => {
    const { rows } = await db.query<{ f: string; definer: boolean; pinned: boolean }>(
      `select n.nspname || '.' || p.proname as f, p.prosecdef as definer,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as pinned
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'extensions')
          and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
          and has_function_privilege('anon', p.oid, 'execute')
          and has_schema_privilege('anon', n.oid, 'usage')`,
    );
    expect(rows.sort((a, b) => (a.f < b.f ? -1 : 1))).toEqual([
      { f: "public.calendar_feed", definer: true, pinned: true },
      { f: "public.submit_intake", definer: true, pinned: true },
    ]);
  });

  it("private helpers cannot be called by API roles", async () => {
    const { rows } = await db.query<{ f: string }>(
      `select p.proname as f from pg_proc p
        where p.pronamespace = 'crm_private'::regnamespace
          and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(rows.map((r) => r.f)).toEqual([]);
  });
});
