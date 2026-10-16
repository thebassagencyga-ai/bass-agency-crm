import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayInZone } from "@/lib/dates";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, type Db } from "./helpers";

// Phase 13 intake form (ADR-028): the public submit path, the review inbox (accept / discard),
// the agent's quick intake and link replacement. Fictional data only.

let db: Db;
let alice: string;
let bob: string;
let token: string;

const form = (over: Record<string, unknown> = {}) => ({
  first_name: "Robin", last_name: "Example", email: "Robin@Example.com", phone: "(404) 555-0123",
  postal_code: "30117", preferred_contact_method: "text", best_time: "Evenings",
  lines: ["auto", "home"],
  current_coverage: [
    { line: "auto", carrier: "Example Mutual", renews_month: 3 },
    { line: "home", carrier: null, renews_month: null },
  ],
  heard_about: "Referral", referred_by_name: "Casey Sample",
  ...over,
});

const submit = (t: string, f: unknown, consent = true) =>
  asAnon(db, (q) => q.query("select public.submit_intake($1, $2, $3)", [t, f, consent]));
const errorMessage = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};
const newestSubmission = (owner: string) =>
  db.query("select * from public.intake_submissions where owner_id = $1 order by submitted_at desc, id desc limit 1", [owner]).then((r) => r.rows[0]);
const rotate = (user: string) => asUser(db, user, async (q) => (await q.query("select public.rotate_intake_link() as t")).rows[0].t as string);

beforeAll(async () => {
  db = await connect();
  alice = await createUser(db, "intake-alice");
  bob = await createUser(db, "intake-bob");
  token = await rotate(alice);
});
afterAll(async () => {
  await db.end();
});

describe("public submission (anonymous)", () => {
  it("lands in the link owner's inbox, cleaned", async () => {
    await submit(token, form());
    const s = await newestSubmission(alice);
    expect(s).toMatchObject({
      status: "new", first_name: "Robin", last_name: "Example", email: "robin@example.com",
      phone: "(404) 555-0123", postal_code: "30117", preferred_contact_method: "text",
      lines: ["auto", "home"], heard_about: "Referral", referred_by_name: "Casey Sample", consent_version: "v1",
    });
    // Entries with nothing in them are dropped.
    expect(s.current_coverage).toEqual([{ line: "auto", carrier: "Example Mutual", renews_month: 3 }]);
    expect(s.consent_at).not.toBeNull();
  });

  it("returns nothing and cannot read anything", async () => {
    const rows = await asAnon(db, async (q) => (await q.query("select public.submit_intake($1, $2, true) as r", [token, form({ email: "r2@example.com" })])).rows);
    expect(rows).toEqual([{ r: "" }]);
    for (const t of ["intake_links", "intake_submissions", "contacts"]) {
      expect(await errorCode(asAnon(db, (q) => q.query(`select 1 from public.${t}`)))).toBe("42501");
    }
    expect(await errorCode(asAnon(db, (q) => q.query("insert into public.intake_submissions (owner_id) values ($1)", [alice])))).toBe("42501");
  });

  it.each([
    ["no consent", form(), false, "consent"],
    ["no name", form({ last_name: " " }), true, "last_name"],
    ["no way to reach them", form({ email: null, phone: "" }), true, "reach"],
    ["a bad email", form({ email: "not-an-email" }), true, "email"],
    ["a short phone number", form({ phone: "555-0123" }), true, "phone"],
    ["a bad ZIP", form({ postal_code: "301" }), true, "postal_code"],
    ["an unknown line", form({ lines: ["boat"] }), true, "lines"],
    ["no lines", form({ lines: [] }), true, "lines"],
    ["coverage for a line not chosen", form({ lines: ["auto"], current_coverage: [{ line: "life", carrier: "X", renews_month: 1 }] }), true, "current_coverage"],
    ["a month out of range", form({ current_coverage: [{ line: "auto", renews_month: 13 }] }), true, "current_coverage"],
    ["a fractional month", form({ current_coverage: [{ line: "auto", renews_month: 2.5 }] }), true, "current_coverage"],
    ["a huge month", form({ current_coverage: [{ line: "auto", renews_month: 1e20 }] }), true, "current_coverage"],
    ["a long field", form({ best_time: "x".repeat(101) }), true, "best_time"],
    ["a non-text field", form({ first_name: { a: 1 } }), true, "first_name"],
    ["an oversized form", form({ padding: "x".repeat(7000) }), true, "form"],
    ["an in-person contact preference", form({ preferred_contact_method: "in_person" }), true, "preferred_contact_method"],
  ])("refuses %s", async (_label, f, consent, reason) => {
    expect(await errorMessage(submit(token, f, consent))).toBe(reason);
  });

  it("refuses an unknown, malformed or replaced link", async () => {
    expect(await errorMessage(submit("0".repeat(32), form()))).toBe("link_unavailable");
    expect(await errorMessage(submit("../../etc", form()))).toBe("link_unavailable");
    const fresh = await rotate(bob);
    await submit(fresh, form({ email: "bob-lead@example.com" }));
    const replacement = await rotate(bob);
    expect(await errorMessage(submit(fresh, form()))).toBe("link_unavailable");
    await submit(replacement, form({ email: "bob-lead2@example.com" }));
    expect((await newestSubmission(bob)).email).toBe("bob-lead2@example.com");
  });

  it("refuses a turned-off link until it is turned back on", async () => {
    const t = await rotate(bob);
    const off = (enabled: boolean) =>
      asUser(db, bob, (q) => q.query("update public.intake_links set enabled = $1, disabled_at = case when $1 then null else now() end where token = $2", [enabled, t]));
    await off(false);
    expect(await errorMessage(submit(t, form()))).toBe("link_unavailable");
    await off(true);
    await submit(t, form({ email: "back-on@example.com" }));
  });

  it("limits a link to 10 submissions an hour", async () => {
    const carol = await createUser(db, "intake-carol");
    const t = await rotate(carol);
    for (let i = 0; i < 10; i++) await submit(t, form({ email: `lead${i}@example.com` }));
    expect(await errorMessage(submit(t, form()))).toBe("rate_limited");
    // …and 50 a day: older submissions in the last 24 hours count too.
    await db.query("update public.intake_submissions set submitted_at = now() - interval '2 hours' where owner_id = $1", [carol]);
    for (let i = 0; i < 10; i++) await submit(t, form({ email: `day${i}@example.com` }));
    await db.query("update public.intake_submissions set submitted_at = now() - interval '3 hours' where owner_id = $1 and submitted_at > now() - interval '1 hour'", [carol]);
    const more = Array.from({ length: 30 }, (_, i) => i);
    for (const i of more) {
      if (i % 10 === 0) await db.query("update public.intake_submissions set submitted_at = now() - interval '4 hours' where owner_id = $1 and submitted_at > now() - interval '1 hour'", [carol]);
      await submit(t, form({ email: `more${i}@example.com` }));
    }
    await db.query("update public.intake_submissions set submitted_at = now() - interval '5 hours' where owner_id = $1 and submitted_at > now() - interval '1 hour'", [carol]);
    expect(Number((await db.query("select count(*) from public.intake_submissions where owner_id = $1", [carol])).rows[0].count)).toBe(50);
    expect(await errorMessage(submit(t, form()))).toBe("rate_limited");
  });

  it("is not callable by signed-in users (only the public form uses it)", async () => {
    expect(await errorCode(asUser(db, alice, (q) => q.query("select public.submit_intake($1, $2, true)", [token, form()])))).toBe("42501");
  });
});

describe("review inbox", () => {
  it("shows submissions only to their owner, and only with two-step sign-in", async () => {
    const mine = await asUser(db, alice, async (q) => (await q.query("select count(*)::int as n from public.intake_submissions")).rows[0].n);
    expect(mine).toBeGreaterThan(0);
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.intake_submissions where owner_id = $1", [alice])).rows[0].n)).toBe(0);
    expect(await asPasswordOnlyUser(db, alice, async (q) => (await q.query("select count(*)::int as n from public.intake_submissions")).rows[0].n)).toBe(0);
  });

  it("accept: new contact, a New lead per line, a quote task before the known renewal; details erased", async () => {
    await submit(token, form({ email: "accept-me@example.com" }));
    const s = await newestSubmission(alice);
    const referrer = await insertContact(db, alice, { first_name: "Casey", last_name: "Sample", relationship_status: "client" });
    const cid = await asUser(db, alice, async (q) => (await q.query("select public.accept_intake($1, null, $2) as c", [s.id, referrer])).rows[0].c as string);

    const contact = (await db.query("select * from public.contacts where id = $1", [cid])).rows[0];
    expect(contact).toMatchObject({
      owner_id: alice, contact_type: "individual", first_name: "Robin", last_name: "Example",
      email: "accept-me@example.com", phone: "(404) 555-0123", postal_code: "30117",
      preferred_contact_method: "text", lead_source: "Referral", referred_by_contact_id: referrer, relationship_status: "prospect",
    });
    expect(contact.notes).toContain("agreed to be contacted by phone, text or email");
    expect(contact.notes).toContain("Best time to reach: Evenings.");
    expect(contact.notes).toContain("Referred by (as written): Casey Sample.");

    const opps = (await db.query(
      `select o.product_line, o.current_carrier, o.current_policy_renews_on::text as renews, o.outcome, s.position
         from public.opportunities o join public.pipeline_stages s on s.id = o.stage_id
        where o.contact_id = $1 order by o.product_line`, [cid])).rows;
    const today = todayInZone("America/New_York");
    const [y, m] = today.split("-").map(Number) as [number, number];
    const march = `${m <= 3 ? y : y + 1}-03-01`;
    expect(opps).toEqual([
      { product_line: "auto", current_carrier: "Example Mutual", renews: march, outcome: "open", position: 1 },
      { product_line: "home", current_carrier: null, renews: null, outcome: "open", position: 1 },
    ]);

    const tasks = (await db.query("select title, category, due_date::text as due, description from public.tasks where contact_id = $1 order by title", [cid])).rows;
    // The New lead automation adds "Make initial contact" for each opportunity.
    expect(tasks.filter((t) => t.title === "Make initial contact")).toHaveLength(2);
    const quote = tasks.find((t) => t.title === "Quote Auto before the current policy renews");
    expect(quote).toMatchObject({ category: "prospecting", description: expect.stringContaining("with Example Mutual") });
    const due = new Date(`${march}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() - 30);
    expect(quote!.due).toBe([today, due.toISOString().slice(0, 10)].sort().at(-1));

    const after = (await db.query("select * from public.intake_submissions where id = $1", [s.id])).rows[0];
    expect(after).toMatchObject({
      status: "accepted", contact_id: cid, first_name: null, last_name: null, email: null, phone: null,
      postal_code: null, best_time: null, lines: null, current_coverage: null, heard_about: null, referred_by_name: null,
    });
    expect(after.reviewed_at).not.toBeNull();
    expect(after.consent_at).not.toBeNull();
  });

  it("accept into an existing contact fills only empty details and keeps theirs", async () => {
    await submit(token, form({ email: "new-address@example.com", lines: ["life"], current_coverage: [] }));
    const s = await newestSubmission(alice);
    const existing = await insertContact(db, alice, { first_name: "Robin", last_name: "Example", email: "robin.old@example.com", notes: "Met at the fair." });
    await asUser(db, alice, (q) => q.query("select public.accept_intake($1, $2)", [s.id, existing]));
    const c = (await db.query("select email, phone, postal_code, notes from public.contacts where id = $1", [existing])).rows[0];
    expect(c.email).toBe("robin.old@example.com");
    expect(c.phone).toBe("(404) 555-0123");
    expect(c.postal_code).toBe("30117");
    expect(c.notes).toMatch(/^Met at the fair\.\n\nIntake form /);
    expect((await db.query("select product_line from public.opportunities where contact_id = $1", [existing])).rows).toEqual([{ product_line: "life" }]);
  });

  it("accept is all-or-nothing: an archived target contact leaves the submission untouched", async () => {
    await submit(token, form({ email: "atomic@example.com" }));
    const s = await newestSubmission(alice);
    const archived = await insertContact(db, alice, { first_name: "Old", last_name: "Record" });
    await db.query("update public.contacts set archived_at = now() where id = $1", [archived]);
    expect(await errorCode(asUser(db, alice, (q) => q.query("select public.accept_intake($1, $2)", [s.id, archived])))).toBe("P0002");
    expect((await db.query("select status, email from public.intake_submissions where id = $1", [s.id])).rows[0]).toEqual({ status: "new", email: "atomic@example.com" });
    expect(Number((await db.query("select count(*) from public.opportunities where contact_id = $1", [archived])).rows[0].count)).toBe(0);
  });

  it("discard erases the details; a handled submission cannot be handled again", async () => {
    const s = await newestSubmission(alice);
    await asUser(db, alice, (q) => q.query("select public.discard_intake($1)", [s.id]));
    const after = (await db.query("select status, first_name, email, phone, lines, reviewed_at from public.intake_submissions where id = $1", [s.id])).rows[0];
    expect(after).toMatchObject({ status: "discarded", first_name: null, email: null, phone: null, lines: null });
    expect(after.reviewed_at).not.toBeNull();
    expect(await errorCode(asUser(db, alice, (q) => q.query("select public.discard_intake($1)", [s.id])))).toBe("P0002");
    expect(await errorCode(asUser(db, alice, (q) => q.query("select public.accept_intake($1)", [s.id])))).toBe("P0002");
  });

  it("another agent cannot accept or discard alice's submissions", async () => {
    await submit(token, form({ email: "private@example.com" }));
    const s = await newestSubmission(alice);
    expect(await errorCode(asUser(db, bob, (q) => q.query("select public.accept_intake($1)", [s.id])))).toBe("P0002");
    expect(await errorCode(asUser(db, bob, (q) => q.query("select public.discard_intake($1)", [s.id])))).toBe("P0002");
    expect((await db.query("select status from public.intake_submissions where id = $1", [s.id])).rows[0].status).toBe("new");
  });

  it("submissions are not written to the audit log (erasure must be real)", async () => {
    const n = await db.query("select count(*)::int as n from public.audit_log where table_name = 'intake_submissions'");
    expect(n.rows[0].n).toBe(0);
  });
});

describe("quick intake (the agent, on a call)", () => {
  it("creates the contact and opportunities directly, with the same rules", async () => {
    const cid = await asUser(db, alice, async (q) =>
      (await q.query("select public.quick_intake($1) as c", [form({ first_name: "Quinn", email: "quinn@example.com", lines: ["commercial"], current_coverage: [{ line: "commercial", carrier: "Sample Ins", renews_month: 12 }] })])).rows[0].c as string);
    const c = (await db.query("select first_name, email, owner_id, notes from public.contacts where id = $1", [cid])).rows[0];
    expect(c).toMatchObject({ first_name: "Quinn", email: "quinn@example.com", owner_id: alice });
    expect(c.notes).toMatch(/^Quick intake \d{4}-\d{2}-\d{2}: best time to reach: Evenings\./);
    expect((await db.query("select product_line, current_carrier from public.opportunities where contact_id = $1", [cid])).rows)
      .toEqual([{ product_line: "commercial", current_carrier: "Sample Ins" }]);
  });

  it("validates like the public form", async () => {
    expect(await errorCode(asUser(db, alice, (q) => q.query("select public.quick_intake($1)", [form({ lines: [] })])))).toBe("22023");
  });

  it("needs a two-step session and cannot be used by anonymous callers", async () => {
    expect(await errorCode(asAnon(db, (q) => q.query("select public.quick_intake($1)", [form()])))).toBe("42501");
    // Password-only: refused (reference data and every table need the two-step session).
    const before = (await db.query("select count(*)::int as n from public.contacts where owner_id = $1", [alice])).rows[0].n;
    expect(await errorCode(asPasswordOnlyUser(db, alice, (q) => q.query("select public.quick_intake($1)", [form()])))).toBeDefined();
    expect((await db.query("select count(*)::int as n from public.contacts where owner_id = $1", [alice])).rows[0].n).toBe(before);
  });
});

describe("links", () => {
  it("one enabled link per agent; replacing keeps the old one, disabled", async () => {
    const dave = await createUser(db, "intake-dave");
    const first = await rotate(dave);
    const second = await rotate(dave);
    expect(first).not.toBe(second);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    const rows = (await db.query("select token, enabled, disabled_at is not null as disabled from public.intake_links where owner_id = $1 order by created_at, enabled", [dave])).rows;
    expect(rows).toEqual([{ token: first, enabled: false, disabled: true }, { token: second, enabled: true, disabled: false }]);
  });

  it("an agent cannot see or change another agent's link", async () => {
    expect(await asUser(db, bob, async (q) => (await q.query("select count(*)::int as n from public.intake_links where owner_id = $1", [alice])).rows[0].n)).toBe(0);
    const changed = await asUser(db, bob, async (q) => (await q.query("update public.intake_links set enabled = false, disabled_at = now() where token = $1", [token])).rowCount);
    expect(changed).toBe(0);
    expect(await errorCode(asUser(db, bob, (q) => q.query("update public.intake_links set token = $1 where owner_id = $2", ["f".repeat(32), bob])))).toBe("42501");
  });
});
