import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 2: profiles created by Supabase Auth sign-up, and mandatory two-step login enforced
// by the database (ADR-016).

let db: Db;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

const TABLES = [
  "profiles", "product_lines", "pipeline_stages", "contacts", "opportunities",
  "automation_rules", "tasks", "activities", "audit_log",
  "renewal_outcomes", "cross_sell_rules", "cross_sell_dismissals", "intake_links", "intake_submissions",
  "household_members", "vehicles", "import_batches", "calendar_feeds", "ai_usage", "tag_options",
];

describe("profile creation", () => {
  it("creates a profile and the 12 default rules when Supabase Auth adds a user", async () => {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id, `new-${id.slice(0, 8)}@example.com`, JSON.stringify({ display_name: "Jordan Example" }),
    ]);
    const profile = await db.query("select display_name, time_zone from public.profiles where id = $1", [id]);
    expect(profile.rows[0]).toEqual({ display_name: "Jordan Example", time_zone: "America/New_York" });
    const rules = await db.query("select count(*)::int as n from public.automation_rules where owner_id = $1", [id]);
    expect(rules.rows[0].n).toBe(12);
  });

  it("falls back to the part of the email before @ when no display name is given", async () => {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `casey.sample-${id.slice(0, 4)}@example.com`]);
    const { rows } = await db.query("select display_name from public.profiles where id = $1", [id]);
    expect(rows[0].display_name).toBe(`casey.sample-${id.slice(0, 4)}`);
  });

  it("truncates an over-long display name instead of failing sign-up", async () => {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id, `long-${id.slice(0, 8)}@example.com`, JSON.stringify({ display_name: "x".repeat(300) }),
    ]);
    const { rows } = await db.query("select char_length(display_name) as n from public.profiles where id = $1", [id]);
    expect(rows[0].n).toBe(100);
  });
});

describe("two-step login enforced by the database", () => {
  it("every table has a restrictive policy requiring aal2", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
        where schemaname = 'public' and permissive = 'RESTRICTIVE'
          and qual like '%aal%' and qual like '%aal2%'`,
    );
    expect(new Set(rows.map((r) => r.tablename))).toEqual(new Set(TABLES));
  });

  it("a password-only session reads nothing, not even its own records or reference data", async () => {
    const user = await createUser(db, "aal1");
    await insertContact(db, user);
    const counts = await asPasswordOnlyUser(db, user, async (q) => {
      const out: Record<string, number> = {};
      for (const t of TABLES) {
        out[t] = (await q.query(`select 1 from public.${t}`)).rowCount ?? 0;
      }
      return out;
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it("a password-only session cannot write", async () => {
    const user = await createUser(db, "aal1-write");
    const insert = await errorCode(
      asPasswordOnlyUser(db, user, (q) =>
        q.query("insert into public.contacts (contact_type, first_name) values ('individual', 'Blocked')"),
      ),
    );
    expect(insert).toBe("42501");
    const contact = await insertContact(db, user);
    const update = await asPasswordOnlyUser(db, user, (q) =>
      q.query("update public.contacts set first_name = 'Changed' where id = $1", [contact]),
    );
    expect(update.rowCount).toBe(0);
  });

  it("the same user with a completed second step has normal access", async () => {
    const user = await createUser(db, "aal2");
    const contact = await insertContact(db, user);
    const rows = await asUser(db, user, async (q) => (await q.query("select id from public.contacts")).rows);
    expect(rows.map((r) => r.id)).toEqual([contact]);
  });
});
