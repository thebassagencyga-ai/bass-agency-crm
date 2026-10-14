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
});
