import { describe, expect, it } from "vitest";
import {
  CRM_TABLES,
  checkProjectRef,
  checkTargetProject,
  checkVerification,
} from "@/lib/deploy-checks";

describe("checkProjectRef", () => {
  it("accepts a 20-letter Supabase project ref", () => {
    expect(checkProjectRef("abcdefghijklmnopqrst")).toEqual({ ok: true });
  });
  it.each(["", "short", "ABCDEFGHIJKLMNOPQRST", "abcdefghijklmnopqrs1", "https://abcdefghijklmnopqrst.supabase.co"])(
    "rejects %j",
    (ref) => {
      expect(checkProjectRef(ref).ok).toBe(false);
    },
  );
});

describe("checkTargetProject", () => {
  it("allows an empty project (first deploy)", () => {
    expect(checkTargetProject([])).toEqual({ ok: true, state: "empty" });
  });

  it("allows a project that already holds only CRM tables", () => {
    expect(checkTargetProject([...CRM_TABLES])).toEqual({ ok: true, state: "crm" });
    expect(checkTargetProject(["contacts", "profiles"])).toEqual({ ok: true, state: "crm" });
  });

  it("refuses a project with any non-CRM table, naming the tables", () => {
    const result = checkTargetProject(["profiles", "teams", "commissions", "history"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("commissions");
      expect(result.reason).toContain("teams");
      expect(result.reason).toContain("history");
      expect(result.reason).not.toContain("profiles,");
    }
  });
});

describe("checkVerification", () => {
  const good = {
    stages: 30, product_lines: 4, tables_without_rls: 0, anon_grants: 0, crm_tables: 9,
    mfa_policies: 9, profile_trigger: 1, public_functions: 7, definer_or_anon_functions: 0,
    unexpected_trigger_functions: 0, engine_unsafe: 0,
  };

  it("passes the expected post-migration state", () => {
    expect(checkVerification(good)).toEqual([]);
  });

  it("accepts numbers returned as strings by the API", () => {
    expect(
      checkVerification({
        stages: "30", product_lines: "4", tables_without_rls: "0", anon_grants: "0", crm_tables: "9",
        mfa_policies: "9", profile_trigger: "1", public_functions: "7", definer_or_anon_functions: "0",
        unexpected_trigger_functions: "0", engine_unsafe: "0",
      }),
    ).toEqual([]);
  });

  it.each([
    [{ stages: 29 }, "pipeline stages"],
    [{ product_lines: 3 }, "product lines"],
    [{ tables_without_rls: 1 }, "row level security"],
    [{ anon_grants: 2 }, "anon"],
    [{ crm_tables: 8 }, "CRM tables"],
    [{ mfa_policies: 8 }, "two-step"],
    [{ profile_trigger: 0 }, "sign-up profile trigger"],
    [{ public_functions: 2 }, "Data API functions"],
    [{ definer_or_anon_functions: 1 }, "bypass RLS"],
    [{ unexpected_trigger_functions: 1 }, "unknown trigger functions"],
    [{ engine_unsafe: 1 }, "automation engine"],
  ])("reports %j", (override, message) => {
    const problems = checkVerification({ ...good, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(message);
  });

  it("reports a missing value instead of passing", () => {
    expect(checkVerification({ ...good, stages: undefined })).not.toEqual([]);
  });
});
