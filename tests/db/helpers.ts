import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

// Helpers that reproduce how Supabase's Data API runs queries: inside a transaction, as the
// `anon` or `authenticated` role, with the caller's JWT claims available to auth.uid().

export type Db = pg.Client;

export async function connect(): Promise<Db> {
  const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
  await client.connect();
  return client;
}

/**
 * Fictional test user: inserts into auth.users (as Supabase Auth would); the
 * on_auth_user_created trigger then creates the profile and default rules.
 */
export async function createUser(db: Db, label = "agent"): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${label}-${id.slice(0, 8)}@example.com`,
    JSON.stringify({ display_name: `Test ${label}` }),
  ]);
  return id;
}

/** aal2 = signed in with password + authenticator code (required by RLS); aal1 = password only. */
type Caller = { role: "anon" } | { role: "authenticated"; userId: string; aal?: "aal1" | "aal2" };

/**
 * Runs `fn` as the given API caller inside a transaction, then commits.
 * If `fn` throws, the transaction is rolled back and the error re-thrown.
 */
export async function as<T>(db: Db, caller: Caller, fn: (db: Db) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const claims =
      caller.role === "authenticated"
        ? { sub: caller.userId, role: "authenticated", aal: caller.aal ?? "aal2" }
        : { role: "anon" };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.query(`set local role ${caller.role}`);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export const asUser = <T>(db: Db, userId: string, fn: (db: Db) => Promise<T>) =>
  as(db, { role: "authenticated", userId }, fn);

/** A session that has passed the password but not the authenticator step. */
export const asPasswordOnlyUser = <T>(db: Db, userId: string, fn: (db: Db) => Promise<T>) =>
  as(db, { role: "authenticated", userId, aal: "aal1" }, fn);

export const asAnon = <T>(db: Db, fn: (db: Db) => Promise<T>) => as(db, { role: "anon" }, fn);

/** Postgres error code of a rejected promise (e.g. 42501 insufficient_privilege, 23514 check_violation). */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

/** One of the user's own stages (Phase 25): the stage copied from a built-in one, in the pipeline the line routes to. */
export async function stageId(db: Db, productLine: string, code: string, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select s.id from public.stages s
     join public.pipeline_routes r on r.pipeline_id = s.pipeline_id
     where r.owner_id = $3 and r.product_line = $1 and s.template_code = $2 and s.archived_at is null`,
    [productLine, code, userId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`No stage ${productLine}/${code} for ${userId}`);
  return id;
}

/** Inserts a fictional individual contact as the given user and returns its id. */
export async function insertContact(db: Db, userId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const values = { contact_type: "individual", first_name: "Pat", last_name: "Example", ...overrides };
  const cols = Object.keys(values);
  const params = cols.map((_, i) => `$${i + 1}`);
  return asUser(db, userId, async (q) => {
    const { rows } = await q.query<{ id: string }>(
      `insert into public.contacts (${cols.join(", ")}) values (${params.join(", ")}) returning id`,
      Object.values(values),
    );
    return rows[0]!.id;
  });
}

export async function insertOpportunity(
  db: Db,
  userId: string,
  contactId: string,
  productLine: string,
  stageCode = "new_lead",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const sid = await stageId(db, productLine, stageCode, userId);
  const values = { contact_id: contactId, product_line: productLine, stage_id: sid, ...overrides };
  const cols = Object.keys(values);
  const params = cols.map((_, i) => `$${i + 1}`);
  return asUser(db, userId, async (q) => {
    const { rows } = await q.query<{ id: string }>(
      `insert into public.opportunities (${cols.join(", ")}) values (${params.join(", ")}) returning id`,
      Object.values(values),
    );
    return rows[0]!.id;
  });
}
