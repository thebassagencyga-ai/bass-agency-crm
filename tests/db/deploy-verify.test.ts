import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PUBLIC_FUNCTIONS,
  PUBLIC_FUNCTIONS_SQL,
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

  it("lists exactly the Data API functions, none SECURITY DEFINER or anonymous", async () => {
    const { rows } = await db.query<PublicFunctionRow>(PUBLIC_FUNCTIONS_SQL);
    expect(rows.map((r) => r.name)).toEqual([...PUBLIC_FUNCTIONS]);
    expect(rows.every((r) => !r.security_definer && !r.anon_execute)).toBe(true);
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
