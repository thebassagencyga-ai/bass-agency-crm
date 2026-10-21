import { describe, expect, it } from "vitest";
import { buildManifest, checkRestoreTarget, planUserRemap, remapUserIds, restoreSql } from "../../src/lib/backup";
import { CRM_TABLES } from "../../src/lib/deploy-checks";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const emptyCrm = Object.fromEntries(CRM_TABLES.map((t) => [t, 0]));

describe("buildManifest", () => {
  it("records counts as numbers, sign-ins and the time", () => {
    const m = buildManifest({ contacts: "3" as unknown as number }, [{ id: A, email: "owner@example.com" }], new Date("2026-10-17T08:23:00Z"));
    expect(m).toEqual({ version: 1, created_at: "2026-10-17T08:23:00.000Z", counts: { contacts: 3 }, users: [{ id: A, email: "owner@example.com" }] });
  });

  it("rejects a malformed sign-in list", () => {
    expect(() => buildManifest({}, [{ id: "not-a-uuid", email: "x@example.com" }], new Date())).toThrow();
    expect(() => buildManifest({}, null, new Date())).toThrow();
  });
});

describe("planUserRemap", () => {
  it("pairs sign-ins by email, ignoring case", () => {
    const plan = planUserRemap(
      [{ id: A, email: "owner@example.com" }, { id: B, email: "agent@example.com" }],
      [{ id: B2, email: "Agent@Example.com" }, { id: A2, email: "owner@example.com" }],
    );
    expect(plan.ok && [...plan.map]).toEqual([[A, A2], [B, B2]]);
  });

  it("refuses when a sign-in has not been re-created", () => {
    const plan = planUserRemap([{ id: A, email: "owner@example.com" }, { id: B, email: "agent@example.com" }], [{ id: A2, email: "owner@example.com" }]);
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("agent@example.com") });
  });

  it("refuses when the target has an extra sign-in (its profile would be lost)", () => {
    const plan = planUserRemap([{ id: A, email: "owner@example.com" }], [{ id: A2, email: "owner@example.com" }, { id: B2, email: "stranger@example.com" }]);
    expect(plan).toEqual({ ok: false, reason: expect.stringContaining("stranger@example.com") });
  });
});

describe("checkRestoreTarget", () => {
  it("accepts a migrated project with only sign-up defaults", () => {
    expect(checkRestoreTarget({ ...emptyCrm, profiles: 1, automation_rules: 12, cross_sell_rules: 4, pipeline_stages: 30, product_lines: 13, audit_log: 5 })).toEqual([]);
  });

  it("refuses a project holding client work", () => {
    expect(checkRestoreTarget({ ...emptyCrm, contacts: 2, tasks: 1 })).toEqual([
      "contacts: has 2 rows (a restore only goes into a project without client data)",
      "tasks: has 1 rows (a restore only goes into a project without client data)",
    ]);
  });

  it("refuses a project without the CRM tables", () => {
    expect(checkRestoreTarget({})).toHaveLength(CRM_TABLES.length);
  });
});

describe("remapUserIds / restoreSql", () => {
  const data = `COPY public.contacts (id, owner_id) FROM stdin;\nc0ffee00-0000-4000-8000-000000000000\t${A}\n\\.\nCOPY public.profiles (id) FROM stdin;\n${A}\n${B}\n\\.\n`;

  it("replaces every occurrence of each old id and nothing else", () => {
    const out = remapUserIds(data, new Map([[A, A2], [B, B2]]));
    expect(out).not.toContain(A);
    expect(out).not.toContain(B);
    expect(out.split(A2)).toHaveLength(3);
    expect(out).toContain("c0ffee00-0000-4000-8000-000000000000");
  });

  it("empties every CRM table first, in the same script", () => {
    const sql = restoreSql(data, new Map([[A, A]]));
    expect(sql.split("\n")[0]).toBe(`truncate ${CRM_TABLES.map((t) => `public.${t}`).join(", ")} cascade;`);
    expect(sql).toContain(data);
  });
});
