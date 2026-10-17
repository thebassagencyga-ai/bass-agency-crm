import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 17 (ADR-033): tags on contacts and merging duplicate contacts. Fictional data only.

let db: Db;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "tags-alice");
  bob = await createUser(db, "tags-bob");
});
afterAll(async () => {
  await db.end();
});

const setTags = (user: string, id: string, tags: string[]) =>
  asUser(db, user, (q) => q.query("update public.contacts set tags = $2 where id = $1", [id, tags]));
const tagsOf = async (id: string) => (await db.query("select tags from public.contacts where id = $1", [id])).rows[0].tags as string[];
// Phase 20: a contact's tags must be on its owner's list (starter list: VIP, Referral partner,
// Church, Small business, Farm, Family plan, Do not text).
const addOption = (user: string, name: string) =>
  asUser(db, user, (q) => q.query("insert into public.tag_options (name) values ($1)", [name]));
const contactTags = (user: string) =>
  asUser(db, user, async (q) => (await q.query("select tag, contact_count from public.contact_tags()")).rows);
const merge = (user: string, keep: string, dup: string) =>
  asUser(db, user, async (q) => (await q.query("select public.merge_contacts($1, $2) as r", [keep, dup])).rows[0].r);
const errorMessage = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("tags", () => {
  it("are kept on the contact and checked by the database", async () => {
    const id = await insertContact(db, alice, { first_name: "Tagged", tags: ["VIP", "Church"] });
    expect(await tagsOf(id)).toEqual(["VIP", "Church"]);
    for (const bad of [["vip", "VIP"], [" padded"], [""], ["x".repeat(41)], Array.from({ length: 21 }, (_, i) => `t${i}`), ["line\nbreak"]]) {
      expect(await errorCode(setTags(alice, id, bad))).toBe("23514");
    }
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.contacts set tags = array[null]::text[] where id = $1", [id])))).toBe("23514");
    expect(await tagsOf(id)).toEqual(["VIP", "Church"]);
  });

  it("are listed with counts (one spelling per tag), filterable in search, and private to their owner", async () => {
    const carol = await createUser(db, "tags-carol");
    const a = await insertContact(db, carol, { first_name: "Avery", tags: ["VIP", "Referral partner"] });
    await insertContact(db, carol, { first_name: "Blake", tags: ["vip"] });
    await insertContact(db, carol, { first_name: "Casey" });
    await addOption(bob, "Secret");
    await insertContact(db, bob, { first_name: "Bobs", tags: ["VIP", "Secret"] });
    const listed = await contactTags(carol);
    expect(listed).toContainEqual({ tag: "VIP", contact_count: 2 });
    expect(listed).toContainEqual({ tag: "Referral partner", contact_count: 1 });
    expect(listed).toContainEqual({ tag: "Church", contact_count: 0 }); // on the list, unused
    expect(listed.map((t) => t.tag)).not.toContain("Secret");
    const found = await asUser(db, carol, async (q) =>
      (await q.query("select first_name from public.search_contacts(p_tag => 'vip') order by first_name")).rows.map((r) => r.first_name));
    expect(found).toEqual(["Avery", "Blake"]);
    const none = await asUser(db, carol, async (q) => (await q.query("select count(*)::int as n from public.search_contacts(p_tag => 'Secret')")).rows[0].n);
    expect(none).toBe(0);
    expect(await asPasswordOnlyUser(db, carol, async (q) => (await q.query("select count(*)::int as n from public.contact_tags()")).rows[0].n)).toBe(0);
    expect(await errorCode(asAnon(db, (q) => q.query("select * from public.contact_tags()")))).toBe("42501");
    expect(await tagsOf(a)).toEqual(["VIP", "Referral partner"]);
  });

  it("rename_tag renames, folds into an existing tag without repeats, or removes — own contacts only", async () => {
    const dana = await createUser(db, "tags-dana");
    await addOption(dana, "Friends");
    const one = await insertContact(db, dana, { first_name: "One", tags: ["Church", "VIP"] });
    const two = await insertContact(db, dana, { first_name: "Two", tags: ["church", "Friends"] });
    const theirs = await insertContact(db, bob, { first_name: "Theirs", tags: ["Church"] });
    const rename = (from: string, to: string | null) =>
      asUser(db, dana, async (q) => (await q.query("select public.rename_tag($1, $2) as n", [from, to])).rows[0].n);

    expect(await rename("CHURCH", "First Baptist")).toBe(2);
    expect(await tagsOf(one)).toEqual(["First Baptist", "VIP"]);
    expect(await tagsOf(two)).toEqual(["First Baptist", "Friends"]);
    // Folding into a tag the contact already has does not repeat it.
    expect(await rename("Friends", "first baptist")).toBe(1);
    expect(await tagsOf(two)).toEqual(["First Baptist"]);
    expect(await rename("first baptist", "")).toBe(2);
    expect(await tagsOf(one)).toEqual(["VIP"]);
    expect(await tagsOf(two)).toEqual([]);
    expect(await tagsOf(theirs)).toEqual(["Church"]);
    // The list follows: renamed, folded and removed tags.
    const names = (await contactTags(dana)).map((t) => t.tag);
    expect(names).not.toContain("Church");
    expect(names).not.toContain("Friends");
    expect(names).not.toContain("First Baptist");
    expect(await errorCode(rename("Nope", "x"))).toBe("P0002");
    expect(await errorCode(rename(" ", "x"))).toBe("22023");
    expect(await errorCode(rename("VIP", "y".repeat(41)))).toBe("23514");
  });
});

describe("merge_contacts", () => {
  it("moves everything to the kept contact, fills its blanks and archives the duplicate", async () => {
    const referrer = await insertContact(db, alice, { first_name: "Referrer" });
    const keep = await insertContact(db, alice, {
      first_name: "Robin", last_name: "Example", phone: "404-555-0101", notes: "Kept notes.", tags: ["VIP"],
      relationship_status: "prospect",
    });
    const dup = await insertContact(db, alice, {
      first_name: "Rob", last_name: "Example", email: "robin@example.com", phone: "404-555-0102",
      address_line1: "1 Example St", city: "Carrollton", state: "GA", postal_code: "30117",
      lead_source: "Referral", referred_by_contact_id: referrer, relationship_status: "client",
      google_review_left_on: "2026-05-01", notes: "Duplicate notes.", tags: ["vip", "Farm"],
    });
    const referred = await insertContact(db, alice, { first_name: "Friend", referred_by_contact_id: dup });
    const opp = await insertOpportunity(db, alice, dup, "auto", "new_lead");
    await asUser(db, alice, async (q) => {
      await q.query("insert into public.tasks (contact_id, opportunity_id, title, due_date) values ($1, $2, 'Call about auto', current_date)", [dup, opp]);
      await q.query("insert into public.tasks (contact_id, title, due_date) values ($1, 'General check-in', current_date)", [dup]);
      await q.query("insert into public.activities (contact_id, opportunity_id, activity_type) values ($1, $2, 'call')", [dup, opp]);
      await q.query("insert into public.activities (contact_id, activity_type) values ($1, 'note')", [dup]);
      await q.query("insert into public.household_members (contact_id, first_name, relationship) values ($1, 'Sam', 'spouse')", [dup]);
      await q.query("insert into public.vehicles (contact_id, year, make) values ($1, 2019, 'Example')", [dup]);
    });
    const counts = async () => (await db.query(
      `select (select count(*) from public.contacts where owner_id = $1)::int as contacts,
              (select count(*) from public.opportunities where owner_id = $1)::int as opps,
              (select count(*) from public.tasks where owner_id = $1)::int as tasks,
              (select count(*) from public.activities where owner_id = $1)::int as activities`, [alice])).rows[0];
    const before = await counts();

    const r = await merge(alice, keep, dup);
    expect(r).toMatchObject({ kept_id: keep, merged_id: dup, opportunities: 1, household: 1, vehicles: 1, referrals: 1 });
    expect(r.tasks).toBeGreaterThanOrEqual(2); // plus the automation's "Make initial contact"
    expect(r.activities).toBe(2);
    expect(await counts()).toEqual(before); // nothing deleted

    const k = (await db.query("select * from public.contacts where id = $1", [keep])).rows[0];
    expect(k).toMatchObject({
      first_name: "Robin", email: "robin@example.com", phone: "404-555-0101", alt_phone: "404-555-0102",
      address_line1: "1 Example St", city: "Carrollton", state: "GA", postal_code: "30117", lead_source: "Referral",
      referred_by_contact_id: referrer, relationship_status: "client", archived_at: null, merged_into_contact_id: null,
      tags: ["VIP", "Farm"],
    });
    expect(k.notes).toBe("Kept notes.\n\n— Merged from a duplicate contact —\nDuplicate notes.");
    const d = (await db.query("select * from public.contacts where id = $1", [dup])).rows[0];
    expect(d.merged_into_contact_id).toBe(keep);
    expect(d.archived_at).not.toBeNull();
    expect(d.email).toBe("robin@example.com"); // the duplicate itself is kept as it was

    for (const table of ["opportunities", "tasks", "activities", "household_members", "vehicles"]) {
      const left = (await db.query(`select count(*)::int as n from public.${table} where contact_id = $1`, [dup])).rows[0].n;
      expect(left, table).toBe(0);
    }
    expect((await db.query("select referred_by_contact_id from public.contacts where id = $1", [referred])).rows[0].referred_by_contact_id).toBe(keep);
    // Tasks and activities of the moved opportunity still point at it, now with the kept contact.
    expect((await db.query("select count(*)::int as n from public.tasks where opportunity_id = $1 and contact_id = $2", [opp, keep])).rows[0].n).toBeGreaterThanOrEqual(1);
    // Audited.
    expect(Number((await db.query("select count(*) from public.audit_log where table_name = 'contacts' and record_id = $1 and action = 'update'", [dup])).rows[0].count)).toBeGreaterThanOrEqual(1);
    // A merged contact is no longer offered as a possible duplicate, and stays merged and archived.
    const dups = await asUser(db, alice, async (q) => (await q.query("select id from public.find_possible_duplicates('robin@example.com', null, null)")).rows.map((x) => x.id));
    expect(dups).toEqual([keep]);
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.contacts set merged_into_contact_id = null where id = $1", [dup])))).toBe("23514");
    expect(await errorCode(asUser(db, alice, (q) => q.query("update public.contacts set archived_at = null where id = $1", [dup])))).toBe("23514");
    expect(await contactTags(alice)).toContainEqual({ tag: "Farm", contact_count: 1 });
  });

  it("the kept contact's referrer being the duplicate is replaced by the duplicate's own referrer", async () => {
    const dup = await insertContact(db, alice, { first_name: "Dup" });
    const keep = await insertContact(db, alice, { first_name: "Keep", referred_by_contact_id: dup });
    await merge(alice, keep, dup);
    expect((await db.query("select referred_by_contact_id from public.contacts where id = $1", [keep])).rows[0].referred_by_contact_id).toBeNull();
  });

  it("keeps one cross-sell dismissal per rule", async () => {
    const keep = await insertContact(db, alice, { first_name: "Keep" });
    const dup = await insertContact(db, alice, { first_name: "Dup" });
    await asUser(db, alice, async (q) => {
      const rule = (await q.query("select id from public.cross_sell_rules order by rule_key limit 1")).rows[0].id;
      for (const c of [keep, dup]) {
        await q.query("insert into public.cross_sell_dismissals (contact_id, rule_id, dismissed_on, hidden_until) values ($1, $2, current_date, current_date + 365)", [c, rule]);
      }
    });
    await merge(alice, keep, dup);
    expect((await db.query("select count(*)::int as n from public.cross_sell_dismissals where contact_id = $1", [keep])).rows[0].n).toBe(1);
  });

  it("is refused for the same contact, an archived kept contact, an already merged one, or another agent's contact", async () => {
    const a = await insertContact(db, alice, { first_name: "A" });
    const b = await insertContact(db, alice, { first_name: "B" });
    const archived = await insertContact(db, alice, { first_name: "Archived", archived_at: new Date().toISOString() });
    const theirs = await insertContact(db, bob, { first_name: "Theirs" });
    expect(await errorCode(merge(alice, a, a))).toBe("22023");
    expect(await errorMessage(merge(alice, archived, a))).toBe("keep_archived");
    expect(await errorCode(merge(alice, a, theirs))).toBe("P0002");
    expect(await errorCode(merge(alice, theirs, a))).toBe("P0002");
    await merge(alice, a, b);
    expect(await errorMessage(merge(alice, a, b))).toBe("already_merged");
    // An archived duplicate can be merged in.
    await merge(alice, a, archived);
    expect(await errorCode(asAnon(db, (q) => q.query("select public.merge_contacts($1, $2)", [a, b])))).toBe("42501");
    expect(await errorCode(asPasswordOnlyUser(db, alice, (q) => q.query("select public.merge_contacts($1, $2)", [a, b])))).toBe("P0002");
  });

  it("an import cannot be undone once one of its contacts was merged", async () => {
    const r = await asUser(db, alice, async (q) => (await q.query("select public.import_book('m.csv', $1) as r", [JSON.stringify([
      { existing_contact_id: null, contact: { contact_type: "individual", first_name: "Imported", last_name: "Example" }, policies: [{ line: "home" }] },
    ])])).rows[0].r);
    const imported = (await db.query("select id from public.contacts where import_batch_id = $1", [r.batch_id])).rows[0].id;
    const keep = await insertContact(db, alice, { first_name: "Imported", last_name: "Example" });
    await merge(alice, keep, imported);
    expect(await errorMessage(asUser(db, alice, (q) => q.query("update public.import_batches set status = 'undone' where id = $1", [r.batch_id])))).toBe("import_changed");
  });
});
