import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, stageId, type Db,
} from "./helpers";

// Row level security and privilege tests (SECURITY.md §4 and §8).

const BUSINESS_TABLES = [
  "contacts", "opportunities", "tasks", "activities", "automation_rules",
  "renewal_outcomes", "cross_sell_rules", "cross_sell_dismissals", "intake_links", "intake_submissions",
  "household_members", "vehicles", "import_batches",
] as const;

let db: Db;
let alice: string;
let bob: string;
let aliceContact: string;
let aliceOpp: string;
let aliceTask: string;
let aliceActivity: string;
let aliceRule: string;

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "alice");
  bob = await createUser(db, "bob");
  aliceContact = await insertContact(db, alice, { first_name: "Alex", last_name: "Sample" });
  aliceOpp = await insertOpportunity(db, alice, aliceContact, "auto");
  ({ aliceTask, aliceActivity, aliceRule } = await asUser(db, alice, async (q) => {
    const t = await q.query<{ id: string }>(
      "insert into public.tasks (contact_id, opportunity_id, title, due_date) values ($1, $2, 'Call Alex', current_date) returning id",
      [aliceContact, aliceOpp],
    );
    const a = await q.query<{ id: string }>(
      "insert into public.activities (contact_id, activity_type, notes) values ($1, 'call', 'Fictional call') returning id",
      [aliceContact],
    );
    const r = await q.query<{ id: string }>("select id from public.automation_rules limit 1");
    return { aliceTask: t.rows[0]!.id, aliceActivity: a.rows[0]!.id, aliceRule: r.rows[0]!.id };
  }));
  // Phase 14: a household member and a vehicle on alice's contact.
  await asUser(db, alice, async (q) => {
    await q.query("insert into public.household_members (contact_id, first_name, relationship) values ($1, 'Sam', 'spouse')", [aliceContact]);
    await q.query("insert into public.vehicles (contact_id, year, make, model) values ($1, 2019, 'Example', 'Sedan')", [aliceContact]);
  });
  // Phase 15: an import batch (nothing in it).
  await asUser(db, alice, (q) => q.query("insert into public.import_batches (file_name) values ('clients.csv')"));
  // Phase 13: an intake link and one public submission to it.
  const token = await asUser(db, alice, async (q) => (await q.query("select public.rotate_intake_link() as t")).rows[0].t as string);
  await asAnon(db, (q) =>
    q.query("select public.submit_intake($1, $2, true)", [token, { first_name: "Pat", last_name: "Sample", phone: "404-555-0101", lines: ["home"] }]),
  );
});

afterAll(async () => {
  await db.end();
});

describe("catalog checks", () => {
  it("every table in the public schema has RLS enabled", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("anon has no privileges on any public table or view", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`,
    );
    expect(rows).toEqual([]);
  });

  it("authenticated has no DELETE, TRUNCATE or TRIGGER privilege anywhere in public", async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type in ('DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')`,
    );
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function pins its search_path", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p
        where p.prosecdef and p.pronamespace in ('public'::regnamespace, 'crm_private'::regnamespace)
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("API roles cannot use the private helper schema", async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
      `select has_schema_privilege('anon', 'crm_private', 'usage') as anon,
              has_schema_privilege('authenticated', 'crm_private', 'usage') as authenticated`,
    );
    expect(rows[0]).toEqual({ anon: false, authenticated: false });
  });

  it("no column stores sensitive data the spec forbids", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select table_name || '.' || column_name as column_name from information_schema.columns
        where table_schema = 'public'
          and column_name ~* '(ssn|social_security|birth|dob|card|bank|routing|account_number|health|medical|diagnos|license|password)'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("anonymous callers", () => {
  it.each([...BUSINESS_TABLES, "profiles", "audit_log", "product_lines", "pipeline_stages"])(
    "cannot read %s",
    async (table) => {
      expect(await errorCode(asAnon(db, (q) => q.query(`select * from public.${table}`)))).toBe("42501");
    },
  );

  it("cannot insert a contact", async () => {
    const code = await errorCode(
      asAnon(db, (q) =>
        q.query("insert into public.contacts (owner_id, contact_type, first_name) values ($1, 'individual', 'X')", [alice]),
      ),
    );
    expect(code).toBe("42501");
  });
});

describe("cross-account isolation", () => {
  it.each(BUSINESS_TABLES)("bob sees none of alice's %s", async (table) => {
    const count = await asUser(db, bob, async (q) => {
      const { rows } = await q.query<{ n: string }>(`select count(*) as n from public.${table} where owner_id = $1`, [alice]);
      return Number(rows[0]!.n);
    });
    expect(count).toBe(0);
  });

  it("alice does see her own rows", async () => {
    const ids = await asUser(db, alice, async (q) => {
      const c = await q.query("select id from public.contacts where id = $1", [aliceContact]);
      const o = await q.query("select id from public.opportunities where id = $1", [aliceOpp]);
      const t = await q.query("select id from public.tasks where id = $1", [aliceTask]);
      const a = await q.query("select id from public.activities where id = $1", [aliceActivity]);
      return [c.rowCount, o.rowCount, t.rowCount, a.rowCount];
    });
    expect(ids).toEqual([1, 1, 1, 1]);
  });

  it.each([
    ["contacts", "first_name = 'Hacked'", () => aliceContact],
    ["opportunities", "description = 'Hacked'", () => aliceOpp],
    ["tasks", "title = 'Hacked'", () => aliceTask],
    ["activities", "notes = 'Hacked'", () => aliceActivity],
    ["automation_rules", "enabled = false", () => aliceRule],
  ] as const)("bob's update of alice's %s affects zero rows", async (table, set, id) => {
    const affected = await asUser(db, bob, async (q) => {
      const r = await q.query(`update public.${table} set ${set} where id = $1`, [id()]);
      return r.rowCount;
    });
    expect(affected).toBe(0);
  });

  it.each(BUSINESS_TABLES)("nobody can delete from %s (no DELETE privilege)", async (table) => {
    expect(await errorCode(asUser(db, alice, (q) => q.query(`delete from public.${table}`)))).toBe("42501");
  });

  it("bob cannot insert a row owned by alice", async () => {
    const code = await errorCode(
      asUser(db, bob, (q) =>
        q.query("insert into public.contacts (owner_id, contact_type, first_name) values ($1, 'individual', 'Spoof')", [alice]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("bob cannot attach his opportunity to alice's contact", async () => {
    const sid = await stageId(db, "home", "new_lead");
    const code = await errorCode(
      asUser(db, bob, (q) =>
        q.query("insert into public.opportunities (contact_id, product_line, stage_id) values ($1, 'home', $2)", [aliceContact, sid]),
      ),
    );
    // Composite FK (contact_id, owner_id) fails: no contact with that id is owned by bob.
    expect(code).toBe("23503");
  });

  it("bob cannot log an activity or task against alice's contact", async () => {
    const activity = await errorCode(
      asUser(db, bob, (q) =>
        q.query("insert into public.activities (contact_id, activity_type) values ($1, 'note')", [aliceContact]),
      ),
    );
    const task = await errorCode(
      asUser(db, bob, (q) =>
        q.query("insert into public.tasks (contact_id, title, due_date) values ($1, 'x', current_date)", [aliceContact]),
      ),
    );
    expect([activity, task]).toEqual(["23503", "23503"]);
  });

  it("an owner cannot transfer a record to another owner", async () => {
    const code = await errorCode(
      asUser(db, alice, (q) => q.query("update public.contacts set owner_id = $1 where id = $2", [bob, aliceContact])),
    );
    expect(code).toBe("42501");
  });
});

describe("profiles", () => {
  it("a user sees only their own profile", async () => {
    const ids = await asUser(db, alice, async (q) => (await q.query<{ id: string }>("select id from public.profiles")).rows.map((r) => r.id));
    expect(ids).toEqual([alice]);
  });

  it("a user can update their display name and time zone but not another user's", async () => {
    const own = await asUser(db, alice, (q) =>
      q.query("update public.profiles set display_name = 'Alice B.', time_zone = 'America/Chicago' where id = $1", [alice]),
    );
    const other = await asUser(db, alice, (q) => q.query("update public.profiles set display_name = 'x' where id = $1", [bob]));
    expect([own.rowCount, other.rowCount]).toEqual([1, 0]);
  });

  it("a user cannot change their profile id or create profiles", async () => {
    const changeId = await errorCode(
      asUser(db, alice, (q) => q.query("update public.profiles set id = gen_random_uuid() where id = $1", [alice])),
    );
    const create = await errorCode(
      asUser(db, alice, (q) => q.query("insert into public.profiles (id) values (gen_random_uuid())")),
    );
    expect([changeId, create]).toEqual(["42501", "42501"]);
  });
});

describe("reference tables are read-only for users", () => {
  it.each([
    "insert into public.pipeline_stages (product_line, code, name, position, kind) values ('auto', 'x_stage', 'X', 99, 'active')",
    "update public.pipeline_stages set name = 'Renamed'",
    "insert into public.product_lines (code, name, sort_order) values ('boat', 'Boat', 9)",
  ])("rejects: %s", async (sql) => {
    expect(await errorCode(asUser(db, alice, (q) => q.query(sql)))).toBe("42501");
  });
});
