import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 3: contact search and duplicate detection run as SECURITY INVOKER database functions,
// so row level security (including the two-step requirement) applies to every result.

let db: Db;
let agent: string;
let other: string;
const ids: Record<string, string> = {};

type Row = { id: string };
const search = (userId: string, args: Record<string, unknown> = {}) =>
  asUser(db, userId, async (q) => {
    const a = {
      p_query: "", p_type: null, p_status: null, p_lead_source: null,
      p_archived: "active", p_sort: "name", p_limit: 25, p_offset: 0, ...args,
    };
    const { rows } = await q.query<Row>(
      `select id from public.search_contacts($1, $2::public.contact_type, $3::public.relationship_status, $4, $5, $6, $7, $8)`,
      [a.p_query, a.p_type, a.p_status, a.p_lead_source, a.p_archived, a.p_sort, a.p_limit, a.p_offset],
    );
    return rows.map((r) => r.id);
  });

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "search");
  other = await createUser(db, "search-other");
  ids.adams = await insertContact(db, agent, { first_name: "Avery", last_name: "Adams", email: "avery@example.com", phone: "770-555-0101", lead_source: "Referral", relationship_status: "client" });
  ids.baker = await insertContact(db, agent, { first_name: "Blake", last_name: "Baker", phone: "678-555-0199", lead_source: "Website" });
  ids.hardware = await insertContact(db, agent, { contact_type: "business", first_name: "Casey", last_name: "Cole", business_name: "Carrollton Example Hardware", email: "office@example.com", lead_source: "referral" });
  ids.percent = await insertContact(db, agent, { first_name: "Drew", last_name: "100% Fictional" });
  ids.archived = await insertContact(db, agent, { first_name: "Ellis", last_name: "Archived" });
  await asUser(db, agent, (q) => q.query("update public.contacts set archived_at = now() where id = $1", [ids.archived]));
  ids.othersAdams = await insertContact(db, other, { first_name: "Avery", last_name: "Adams" });
});
afterAll(async () => {
  await db.end();
});

describe("search_contacts", () => {
  it("lists active contacts sorted by last name / business name", async () => {
    expect(await search(agent)).toEqual([ids.percent, ids.adams, ids.baker, ids.hardware]);
  });

  it.each([
    ["first name", "avery", ["adams"]],
    ["last name, any case", "BAKER", ["baker"]],
    ["full name", "blake baker", ["baker"]],
    ["business name", "hardware", ["hardware"]],
    ["business contact person", "casey", ["hardware"]],
    ["email", "office@", ["hardware"]],
    ["phone digits regardless of formatting", "(770) 555-01", ["adams"]],
    ["last four of a phone", "0199", ["baker"]],
  ])("finds by %s", async (_label, query, expected) => {
    expect(await search(agent, { p_query: query })).toEqual(expected.map((k) => ids[k]));
  });

  it("treats % and _ as literal characters, not wildcards", async () => {
    expect(await search(agent, { p_query: "%" })).toEqual([ids.percent]);
    expect(await search(agent, { p_query: "_" })).toEqual([]);
  });

  it("never returns another agent's contacts", async () => {
    const found = await search(agent, { p_query: "adams", p_archived: "all" });
    expect(found).toEqual([ids.adams]);
    expect(found).not.toContain(ids.othersAdams);
  });

  it("filters by type, status and lead source (case-insensitive)", async () => {
    expect(await search(agent, { p_type: "business" })).toEqual([ids.hardware]);
    expect(await search(agent, { p_status: "client" })).toEqual([ids.adams]);
    expect(await search(agent, { p_lead_source: "REFERRAL" })).toEqual([ids.adams, ids.hardware]);
  });

  it("hides archived contacts unless asked", async () => {
    expect(await search(agent, { p_query: "ellis" })).toEqual([]);
    expect(await search(agent, { p_query: "ellis", p_archived: "archived" })).toEqual([ids.archived]);
    expect(await search(agent, { p_archived: "all" })).toHaveLength(5);
  });

  it("sorts by most recently added and paginates", async () => {
    expect(await search(agent, { p_sort: "recent", p_limit: 2 })).toEqual([ids.percent, ids.hardware]);
    expect(await search(agent, { p_sort: "recent", p_limit: 2, p_offset: 2 })).toEqual([ids.baker, ids.adams]);
  });

  it("caps page size at 100 and ignores an unknown sort", async () => {
    expect((await search(agent, { p_limit: 100000 })).length).toBeLessThanOrEqual(100);
    expect(await search(agent, { p_sort: "id; drop table contacts" })).toEqual(await search(agent));
  });

  it("returns nothing to a password-only session", async () => {
    const rows = await asPasswordOnlyUser(db, agent, async (q) =>
      (await q.query("select id from public.search_contacts('', null, null, null, 'all', 'name', 25, 0)")).rows,
    );
    expect(rows).toEqual([]);
  });
});

describe("find_possible_duplicates", () => {
  const dupes = (userId: string, email: string | null, phone: string | null, exclude: string | null = null) =>
    asUser(db, userId, async (q) =>
      (await q.query<Row>("select id from public.find_possible_duplicates($1, $2, $3)", [email, phone, exclude])).rows.map((r) => r.id),
    );

  it("matches the same email regardless of case", async () => {
    expect(await dupes(agent, "AVERY@example.com", null)).toEqual([ids.adams]);
  });

  it("matches the same 10-digit phone in any format, including archived contacts", async () => {
    expect(await dupes(agent, null, "(678) 555 0199")).toEqual([ids.baker]);
    await asUser(db, agent, (q) => q.query("update public.contacts set phone = '404-555-0142' where id = $1", [ids.archived]));
    expect(await dupes(agent, null, "4045550142")).toEqual([ids.archived]);
  });

  it("ignores short phone fragments, excludes the contact being edited, and never sees other agents", async () => {
    expect(await dupes(agent, null, "0101")).toEqual([]);
    expect(await dupes(agent, "avery@example.com", null, ids.adams)).toEqual([]);
    expect(await dupes(other, "avery@example.com", "770-555-0101")).toEqual([]);
  });
});

describe("contact_lead_sources", () => {
  it("returns this agent's distinct lead sources", async () => {
    const rows = await asUser(db, agent, async (q) => (await q.query<{ s: string }>("select s from public.contact_lead_sources() s")).rows.map((r) => r.s));
    expect(rows).toEqual(["Referral", "Website"]);
  });
});

describe("function privileges", () => {
  it.each([
    "select * from public.search_contacts('', null, null, null, 'active', 'name', 25, 0)",
    "select * from public.find_possible_duplicates('a@example.com', null, null)",
    "select * from public.contact_lead_sources()",
  ])("anonymous callers cannot run: %s", async (sql) => {
    expect(await errorCode(asAnon(db, (q) => q.query(sql)))).toBe("42501");
  });

  it("every function in the public schema is SECURITY INVOKER with a fixed search_path, and not executable by anon", async () => {
    const { rows } = await db.query<{ proname: string; prosecdef: boolean; has_path: boolean; anon: boolean }>(
      `select p.proname, p.prosecdef,
              exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as has_path,
              has_function_privilege('anon', p.oid, 'execute') as anon
         from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect({ fn: r.proname, definer: r.prosecdef, path: r.has_path, anon: r.anon }).toEqual({ fn: r.proname, definer: false, path: true, anon: false });
    }
  });
});
