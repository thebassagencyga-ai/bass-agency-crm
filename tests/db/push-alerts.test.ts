import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, connect, createUser, errorCode, type Db } from "./helpers";

// Phase 26 (ADR-044): a quote request owes one alert; claim_push_alerts hands out the devices
// once, only to the holder of the push key's proof. Fictional data only.

let db: Db;

const PROOF = "p".repeat(43); // stands in for dispatchProof(PUSH_KEY)
const hashOf = (proof: string) => createHash("sha256").update(proof, "utf8").digest();
const P256DH = "B".repeat(87);
const AUTH = "A".repeat(22);

const addDevice = (user: string, endpoint: string, proof = PROOF) =>
  asUser(db, user, async (q) =>
    (await q.query<{ id: string }>(
      "insert into public.push_subscriptions (endpoint, p256dh, auth, device_label, dispatch_hash) values ($1, $2, $3, 'iPhone', $4) returning id",
      [endpoint, P256DH, AUTH, hashOf(proof)],
    )).rows[0]!.id,
  );
const linkFor = (user: string) =>
  asUser(db, user, async (q) => (await q.query("select public.rotate_intake_link() as t")).rows[0].t as string);
const submit = (token: string, first = "Pat") =>
  asAnon(db, (q) => q.query("select public.submit_intake($1, $2, true)", [token, { first_name: first, last_name: "Sample", email: "pat@example.com", lines: ["auto"] }]));
const claim = (proof: string | null) =>
  asAnon(db, async (q) => (await q.query<{ subscription_id: string; endpoint: string }>("select * from public.claim_push_alerts($1) order by endpoint", [proof])).rows);
const owed = (user: string) =>
  db.query("select count(*)::int as n from crm_private.push_alerts where owner_id = $1 and claimed_at is null", [user]).then((r) => r.rows[0].n as number);

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("new quote request alerts (Phase 26)", () => {
  it("no devices with alerts on: the submission is saved and no alert is owed", async () => {
    const agent = await createUser(db, "no-alerts");
    await submit(await linkFor(agent));
    expect(await owed(agent)).toBe(0);
    expect((await db.query("select count(*)::int as n from public.intake_submissions where owner_id = $1", [agent])).rows[0].n).toBe(1);
  });

  it("owes one alert per submission and hands the devices out once, to the proof holder only", async () => {
    const agent = await createUser(db, "alerts");
    const phone = await addDevice(agent, "https://push.example.com/phone");
    const laptop = await addDevice(agent, "https://push.example.com/laptop");
    const off = await addDevice(agent, "https://push.example.com/old");
    await asUser(db, agent, (q) => q.query("update public.push_subscriptions set disabled_at = now() where id = $1", [off]));
    const token = await linkFor(agent);

    await submit(token);
    expect(await owed(agent)).toBe(1);
    expect(await claim("x".repeat(43))).toEqual([]); // wrong proof
    expect(await claim(null)).toEqual([]);
    expect(await claim("short")).toEqual([]);
    expect(await owed(agent)).toBe(1);

    const devices = await claim(PROOF);
    expect(devices.map((d) => d.subscription_id).sort()).toEqual([phone, laptop].sort());
    expect(Object.keys(devices[0]!).sort()).toEqual(["auth", "endpoint", "p256dh", "subscription_id"]); // no customer details
    expect(await claim(PROOF)).toEqual([]); // no duplicates
    const last = (await db.query("select id, last_alert_at is not null as alerted from public.push_subscriptions where owner_id = $1 order by endpoint", [agent])).rows;
    expect(Object.fromEntries(last.map((r) => [r.id, r.alerted]))).toEqual({ [phone]: true, [laptop]: true, [off]: false });
    expect(await owed(agent)).toBe(0);

    // Two requests before the next claim: each device is alerted once.
    await submit(token, "Quinn");
    await submit(token, "Riley");
    expect(await owed(agent)).toBe(2);
    expect((await claim(PROOF)).length).toBe(2);
    expect(await owed(agent)).toBe(0);
  });

  it("an alert more than a day old is claimed but not sent", async () => {
    const agent = await createUser(db, "stale");
    await addDevice(agent, "https://push.example.com/stale");
    await submit(await linkFor(agent));
    await db.query("update crm_private.push_alerts set created_at = now() - interval '2 days' where owner_id = $1", [agent]);
    expect((await claim(PROOF)).filter((d) => d.endpoint.endsWith("/stale"))).toEqual([]);
    expect(await owed(agent)).toBe(0);
  });

  it("devices registered under another key are left alone", async () => {
    const agent = await createUser(db, "other-key");
    await addDevice(agent, "https://push.example.com/other", "q".repeat(43));
    await submit(await linkFor(agent));
    expect((await claim(PROOF)).filter((d) => d.endpoint.endsWith("/other"))).toEqual([]);
    expect(await owed(agent)).toBe(1);
    expect((await claim("q".repeat(43))).map((d) => d.endpoint)).toEqual(["https://push.example.com/other"]);
  });

  it("only anonymous callers (the app's public action) can claim; signed-in users and the API cannot read the outbox", async () => {
    const agent = await createUser(db, "claim-access");
    expect(await errorCode(asUser(db, agent, (q) => q.query("select * from public.claim_push_alerts($1)", [PROOF])))).toBe("42501");
    expect(await errorCode(asUser(db, agent, (q) => q.query("select * from crm_private.push_alerts")))).toBe("42501");
    expect(await errorCode(asAnon(db, (q) => q.query("select * from crm_private.push_alerts")))).toBe("42501");
  });

  it("a device keeps https endpoints and well-formed keys only, and another agent cannot see it", async () => {
    const agent = await createUser(db, "device-checks");
    const other = await createUser(db, "device-other");
    expect(await errorCode(addDevice(agent, "http://push.example.com/plain"))).toBe("23514");
    expect(await errorCode(asUser(db, agent, (q) => q.query(
      "insert into public.push_subscriptions (endpoint, p256dh, auth, dispatch_hash) values ('https://push.example.com/k', 'bad key', $1, $2)", [AUTH, hashOf(PROOF)],
    )))).toBe("23514");
    await addDevice(agent, "https://push.example.com/mine");
    expect(await asUser(db, other, async (q) => (await q.query("select count(*)::int as n from public.push_subscriptions where owner_id = $1", [agent])).rows[0].n)).toBe(0);
    expect(await errorCode(asUser(db, agent, (q) => q.query("delete from public.push_subscriptions")))).toBe("42501");
  });
});
