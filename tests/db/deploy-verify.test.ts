import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VERIFICATION_SQL, checkVerification, type VerificationRow } from "@/lib/deploy-checks";
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
});
