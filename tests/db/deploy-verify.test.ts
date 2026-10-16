import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PUBLIC_ANON_FUNCTION,
  PUBLIC_FUNCTIONS,
  PUBLIC_FUNCTIONS_SQL,
  ROW_COUNTS_SQL,
  CRM_TABLES,
  VERIFICATION_SQL,
  checkVerification,
  type PublicFunctionRow,
  type VerificationRow,
} from "@/lib/deploy-checks";
import { connect, type Db } from "./helpers";

// The deploy workflow's verification query must pass against a database built from all
// migrations — so the production check and the migrations can never drift apart.
let db: Db;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db.end();
});

describe("deploy verification query", () => {
  it("passes on a freshly migrated database", async () => {
    const { rows } = await db.query<VerificationRow>(VERIFICATION_SQL);
    expect(rows).toHaveLength(1);
    expect(checkVerification(rows[0]!)).toEqual([]);
  });

  it("lists exactly the Data API functions; only the public intake function is SECURITY DEFINER or anonymous", async () => {
    const { rows } = await db.query<PublicFunctionRow>(PUBLIC_FUNCTIONS_SQL);
    expect(rows.map((r) => r.name)).toEqual([...PUBLIC_FUNCTIONS]);
    expect(rows.filter((r) => r.security_definer || r.anon_execute).map((r) => r.name)).toEqual([PUBLIC_ANON_FUNCTION]);
  });

  it("rejects the public intake function if signed-in users could also call it", async () => {
    await db.query("begin");
    try {
      await db.query("grant execute on function public.submit_intake(text, jsonb, boolean) to authenticated");
      expect((await problems()).join(" ")).toContain("public intake function");
    } finally {
      await db.query("rollback");
    }
  });

  it("rejects the public intake function without a pinned search_path", async () => {
    await db.query("begin");
    try {
      await db.query("alter function public.submit_intake(text, jsonb, boolean) reset search_path");
      expect((await problems()).join(" ")).toContain("public intake function");
    } finally {
      await db.query("rollback");
    }
  });

  // Hosted projects with "Enable automatic RLS" have Supabase's own event-trigger function
  // public.rls_auto_enable() (SECURITY DEFINER, executable by anon, but not callable).
  async function withFunction(name: string, returns: string, body: string, check: () => Promise<void>) {
    await db.query("begin");
    try {
      await db.query(`create function public.${name}() returns ${returns} language plpgsql security definer as $$ begin ${body} end $$`);
      await db.query(`grant execute on function public.${name}() to anon`);
      await check();
    } finally {
      await db.query("rollback");
    }
  }
  const problems = async () => checkVerification((await db.query<VerificationRow>(VERIFICATION_SQL)).rows[0]!);

  it("accepts Supabase's automatic-RLS event trigger function", async () => {
    await withFunction("rls_auto_enable", "event_trigger", "", async () => {
      expect(await problems()).toEqual([]);
    });
  });

  it("rejects any other trigger function in public", async () => {
    await withFunction("sneaky_trigger", "event_trigger", "", async () => {
      expect((await problems()).join(" ")).toContain("unknown trigger functions");
    });
  });

  it("still rejects a callable SECURITY DEFINER function, even under the platform name", async () => {
    await withFunction("rls_auto_enable", "integer", "return 1;", async () => {
      const found = (await problems()).join(" ");
      expect(found).toContain("Data API functions");
      expect(found).toContain("bypass RLS");
    });
  });
});

describe("restore drill row counts (Phase 12)", () => {
  it("counts every CRM table and nothing else, as numbers", async () => {
    const counts = (await db.query("select (" + ROW_COUNTS_SQL + ") as c")).rows[0].c as Record<string, number>;
    expect(Object.keys(counts).sort()).toEqual([...CRM_TABLES].sort());
    expect(Object.values(counts).every((n) => Number.isInteger(Number(n)) && Number(n) >= 0)).toBe(true);
    expect(Number(counts.pipeline_stages)).toBe(30);
  });
});
