import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 20 (ADR-036): tags are picked from a list each agent keeps. Fictional data only.

let db: Db;
let alice: string;
let bob: string;
const options = (user: string) =>
  asUser(db, user, async (q) => (await q.query("select name from public.tag_options where archived_at is null order by lower(name)")).rows.map((r) => r.name as string));
const addOption = (user: string, name: string) =>
  asUser(db, user, (q) => q.query("insert into public.tag_options (name) values ($1)", [name]));

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "tagopt-alice");
  bob = await createUser(db, "tagopt-bob");
});
afterAll(async () => {
  await db.end();
});

describe("tag list", () => {
  it("every new agent starts with the starter list", async () => {
    expect(await options(alice)).toEqual(["Church", "Do not text", "Family plan", "Farm", "Referral partner", "Small business", "VIP"]);
  });

  it("a contact can only gain tags that are on its owner's list (any case)", async () => {
    const id = await insertContact(db, alice, { first_name: "Listed", tags: ["vip", "Farm"] });
    expect((await db.query("select tags from public.contacts where id = $1", [id])).rows[0].tags).toEqual(["vip", "Farm"]);
    expect(await errorCode(insertContact(db, alice, { first_name: "Stray", tags: ["Golf buddy"] }))).toBe("23514");
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.contacts set tags = tags || '{Golf buddy}' where id = $1", [id])))).toBe("23514");
    // Another agent's list does not count.
    await addOption(bob, "Golf buddy");
    expect(await errorCode(insertContact(db, alice, { first_name: "Stray2", tags: ["Golf buddy"] }))).toBe("23514");
    await addOption(alice, "Golf buddy");
    await asUser(db, alice, (q) => q.query("update public.contacts set tags = tags || '{Golf buddy}' where id = $1", [id]));
  });

  it("names are checked and unique per agent (ignoring case)", async () => {
    for (const bad of ["", " padded", "a,b", "x".repeat(41), "line\nbreak"]) expect(await errorCode(addOption(alice, bad)), bad).toBe("23514");
    expect(await errorCode(addOption(alice, "vip"))).toBe("23505");
  });

  it("removing a tag takes it off every contact and archives it; a contact keeps a tag only if it was there before", async () => {
    const carol = await createUser(db, "tagopt-carol");
    const id = await insertContact(db, carol, { first_name: "Kept", tags: ["Church", "VIP"] });
    expect(await asUser(db, carol, async (q) => (await q.query("select public.rename_tag('Church', '') as n")).rows[0].n)).toBe(1);
    expect((await db.query("select tags from public.contacts where id = $1", [id])).rows[0].tags).toEqual(["VIP"]);
    expect(await options(carol)).not.toContain("Church");
    expect(Number((await db.query("select count(*) from public.tag_options where owner_id = $1 and name = 'Church' and archived_at is not null", [carol])).rows[0].count)).toBe(1);
    expect(await errorCode(asUser(db, carol, (q) => q.query("update public.contacts set tags = '{VIP,Church}' where id = $1", [id])))).toBe("23514");
    // It can be added again later.
    await addOption(carol, "Church");
    expect(await options(carol)).toContain("Church");
  });

  it("is each agent's own; no deletes; closed to password-only and anonymous sessions", async () => {
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.tag_options where owner_id = $1", [alice])).rows[0].n)).toBe(0);
    expect(await asUser(db, bob, async (q) => (await q.query("update public.tag_options set name = 'Hacked' where owner_id = $1", [alice])).rowCount)).toBe(0);
    expect(await errorCode(asUser(db, alice, (q) => q.query("delete from public.tag_options where owner_id = $1", [alice])))).toBe("42501");
    expect(await errorCode(asUser(db, alice, (q) => q.query("insert into public.tag_options (owner_id, name) values ($1, 'Spoof')", [bob])))).toBe("42501");
    expect(await errorCode(asPasswordOnlyUser(db, alice, (q) => q.query("insert into public.tag_options (name) values ('Aal1')")))).toBe("42501");
    expect(await errorCode(asAnon(db, (q) => q.query("select 1 from public.tag_options")))).toBe("42501");
  });
});
