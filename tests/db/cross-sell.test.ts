import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asPasswordOnlyUser, asUser, connect, createUser, errorCode, insertContact, insertOpportunity, type Db } from "./helpers";

// Phase 8: cross-sell rules are data, evaluated only from recorded opportunities (ADR-023).

let db: Db;
let agent: string;
let today: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Prompt = { contact_id: string; rule_key: string; rule_id: string; reason: string; lacks_line: string; held_lines: string[] };
const prompts = (opts: { contact?: string; on?: string; user?: string } = {}): Promise<Prompt[]> =>
  asUser(db, opts.user ?? agent, async (q) =>
    (await q.query<Prompt>(
      "select contact_id, rule_key, rule_id, reason, lacks_line, held_lines from public.cross_sell_prompts($1::date, $2)",
      [opts.on ?? today, opts.contact ?? null],
    )).rows,
  );
const keysFor = async (contact: string, on?: string) =>
  (await prompts({ contact, on })).map((p) => p.rule_key).sort();
const policy = (contact: string, line: string, more: Record<string, unknown> = {}) =>
  insertOpportunity(db, agent, contact, line, line === "life" ? "placed" : "bound", { outcome: "won", ...more });
const person = (first: string, more: Record<string, unknown> = {}) => insertContact(db, agent, { first_name: first, last_name: "Example", ...more });
const business = (name: string) => insertContact(db, agent, { contact_type: "business", business_name: name });
const dismiss = (contact: string, ruleId: string, user = agent) =>
  asUser(db, user, async (q) => (await q.query("select public.dismiss_cross_sell($1, $2) as n", [contact, ruleId])).rows[0].n as number);

beforeAll(async () => {
  db = await connect();
  agent = await createUser(db, "cross-sell");
  today = (await db.query("select (now() at time zone 'America/New_York')::date::text as d")).rows[0].d;
  // Only cross-sell is under test here: no automatic tasks.
  await asUser(db, agent, (q) => q.query("update public.automation_rules set enabled = false"));
});
afterAll(async () => {
  await db.end();
});

describe("default rules", () => {
  it("every new agent gets the four default rules, all enabled", async () => {
    const rules = await asUser(db, agent, async (q) =>
      (await q.query("select rule_key, has_any_lines, lacks_line, contact_type::text, enabled from public.cross_sell_rules order by rule_key")).rows,
    );
    expect(rules).toEqual([
      { rule_key: "auto_no_home", has_any_lines: ["auto"], lacks_line: "home", contact_type: "individual", enabled: true },
      { rule_key: "commercial_no_life", has_any_lines: ["commercial"], lacks_line: "life", contact_type: "business", enabled: true },
      { rule_key: "home_no_auto", has_any_lines: ["home"], lacks_line: "auto", contact_type: "individual", enabled: true },
      { rule_key: "personal_no_life", has_any_lines: ["auto", "home"], lacks_line: "life", contact_type: "individual", enabled: true },
    ]);
  });
});

describe("each rule", () => {
  it("auto_no_home: an auto-only client is prompted to review home (and life), with the reason", async () => {
    const c = await person("Ash");
    await policy(c, "auto");
    expect(await keysFor(c)).toEqual(["auto_no_home", "personal_no_life"]);
    const p = (await prompts({ contact: c })).find((x) => x.rule_key === "auto_no_home")!;
    expect(p).toEqual(expect.objectContaining({ lacks_line: "home", held_lines: ["auto"] }));
    expect(p.reason).toContain("no home policy");
  });

  it("home_no_auto: a home-only client is prompted to review auto (and life)", async () => {
    const c = await person("Bay");
    await policy(c, "home");
    expect(await keysFor(c)).toEqual(["home_no_auto", "personal_no_life"]);
  });

  it("personal_no_life: auto + home but no life → only the life review", async () => {
    const c = await person("Cam");
    await policy(c, "auto");
    await policy(c, "home");
    expect(await keysFor(c)).toEqual(["personal_no_life"]);
    await policy(c, "life");
    expect(await keysFor(c)).toEqual([]);
  });

  it("commercial_no_life: applies to businesses only", async () => {
    const shop = await business("Example Bakery LLC");
    await policy(shop, "commercial");
    expect(await keysFor(shop)).toEqual(["commercial_no_life"]);
    const individual = await person("Dee");
    await policy(individual, "commercial");
    expect(await keysFor(individual)).toEqual([]);
  });
});

describe("evaluated only from recorded opportunities", () => {
  it("a prospect with no policy gets no prompts", async () => {
    const c = await person("Eli");
    await insertOpportunity(db, agent, c, "auto", "quoted");
    expect(await keysFor(c)).toEqual([]);
  });

  it("an open or nurture opportunity in the suggested line hides the prompt", async () => {
    const c = await person("Fay");
    await policy(c, "auto");
    await insertOpportunity(db, agent, c, "home", "new_lead");
    await insertOpportunity(db, agent, c, "life", "needs_review", { outcome: "nurture" });
    expect(await keysFor(c)).toEqual([]);
  });

  it("a recent loss in the suggested line hides it for 12 months", async () => {
    const c = await person("Gil");
    await policy(c, "auto");
    await insertOpportunity(db, agent, c, "home", "lost", { outcome: "lost", loss_reason: "price" });
    expect(await keysFor(c)).toEqual(["personal_no_life"]);
    expect(await keysFor(c, addDays(today, 366))).toEqual(["auto_no_home", "personal_no_life"]);
  });

  it("an ended policy no longer counts as held", async () => {
    const c = await person("Hal", { relationship_status: "client" });
    const auto = await policy(c, "auto", { renewal_date: addDays(today, 30) });
    expect(await keysFor(c)).toEqual(["auto_no_home", "personal_no_life"]);
    await asUser(db, agent, (q) => q.query("select public.record_renewal_outcome($1, 'lost', 'price')", [auto]));
    expect(await keysFor(c)).toEqual([]);
  });

  it("archived contacts are not prompted", async () => {
    const c = await person("Ivy");
    await policy(c, "auto");
    await asUser(db, agent, (q) => q.query("update public.contacts set archived_at = now() where id = $1", [c]));
    expect(await keysFor(c)).toEqual([]);
  });
});

describe("configurable", () => {
  it("a disabled rule stops prompting; re-enabling brings it back", async () => {
    const c = await person("Jo");
    await policy(c, "home");
    await asUser(db, agent, (q) => q.query("update public.cross_sell_rules set enabled = false where rule_key = 'home_no_auto'"));
    expect(await keysFor(c)).toEqual(["personal_no_life"]);
    await asUser(db, agent, (q) => q.query("update public.cross_sell_rules set enabled = true where rule_key = 'home_no_auto'"));
    expect(await keysFor(c)).toEqual(["home_no_auto", "personal_no_life"]);
  });

  it("an agent can add a rule of their own", async () => {
    await asUser(db, agent, (q) =>
      q.query(
        `insert into public.cross_sell_rules (rule_key, name, has_any_lines, lacks_line, reason)
         values ('life_no_auto', 'Life client without auto', array['life'], 'auto', 'Has life with you; ask about their vehicles.')`,
      ),
    );
    const c = await business("Example Florist LLC");
    await policy(c, "life");
    expect(await keysFor(c)).toEqual(["life_no_auto"]);
  });

  it("rejects a rule that suggests a line it requires, or an unknown line", async () => {
    const insert = (lines: string, lacks: string) =>
      errorCode(asUser(db, agent, (q) =>
        q.query(
          `insert into public.cross_sell_rules (rule_key, name, has_any_lines, lacks_line, reason) values ('bad_rule', 'Bad', $1::text[], $2, 'x')`,
          [lines, lacks],
        ),
      ));
    expect(await insert("{auto,home}", "home")).toBe("23514");
    expect(await insert("{aircraft}", "home")).toBe("23514");
    expect(await insert("{auto}", "aircraft")).toBe("23503");
  });
});

describe("dismissing", () => {
  it("hides one prompt for one contact for 12 months; dismissing again restarts the 12 months", async () => {
    const c = await person("Kit");
    const other = await person("Lou");
    await policy(c, "auto");
    await policy(other, "auto");
    const p = (await prompts({ contact: c })).find((x) => x.rule_key === "auto_no_home")!;

    expect(await dismiss(c, p.rule_id)).toBe(1);
    expect(await keysFor(c)).toEqual(["personal_no_life"]);
    expect(await keysFor(other)).toEqual(["auto_no_home", "personal_no_life"]);

    const until = await asUser(db, agent, async (q) =>
      (await q.query("select dismissed_on::text, hidden_until::text from public.cross_sell_dismissals where contact_id = $1", [c])).rows,
    );
    expect(until).toHaveLength(1);
    expect(until[0]!.dismissed_on).toBe(today);
    const hidden = until[0]!.hidden_until as string;
    expect(await keysFor(c, addDays(hidden, -1))).toEqual(["personal_no_life"]);
    expect(await keysFor(c, hidden)).toEqual(["auto_no_home", "personal_no_life"]);

    expect(await dismiss(c, p.rule_id)).toBe(1);
    const rows = await asUser(db, agent, async (q) => (await q.query("select count(*)::int as n from public.cross_sell_dismissals where contact_id = $1", [c])).rows[0].n);
    expect(rows).toBe(1);
  });

  it("another agent cannot see or dismiss someone else's prompts", async () => {
    const c = await person("Max");
    await policy(c, "auto");
    const p = (await prompts({ contact: c }))[0]!;
    const intruder = await createUser(db, "cross-sell-intruder");
    expect(await prompts({ user: intruder })).toEqual([]);
    expect(await dismiss(c, p.rule_id, intruder)).toBe(0);
    expect(await keysFor(c)).toEqual(["auto_no_home", "personal_no_life"]);
  });

  it("anonymous callers cannot run the functions; a password-only session sees nothing", async () => {
    const anon = await errorCode(asAnon(db, (q) => q.query("select * from public.cross_sell_prompts(current_date)")));
    const anonDismiss = await errorCode(asAnon(db, (q) => q.query("select public.dismiss_cross_sell(gen_random_uuid(), gen_random_uuid())")));
    const aal1 = await asPasswordOnlyUser(db, agent, async (q) => (await q.query("select * from public.cross_sell_prompts($1::date)", [today])).rowCount);
    expect([anon, anonDismiss, aal1]).toEqual(["42501", "42501", 0]);
  });
});
