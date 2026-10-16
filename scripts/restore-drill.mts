// Restore drill, second half (Phase 12, ADR-026): checks the copy of production that
// .github/workflows/restore-drill.yml restored into a throwaway LOCAL database.
//
//   node scripts/restore-drill.mts <production-counts.json>
//
// Reads RESTORE_DATABASE_URL (must be local), runs the same verification as a deploy, and
// compares row counts table by table with production's. Prints counts only, never data.
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  ROW_COUNTS_SQL, VERIFICATION_SQL, checkVerification, compareRowCounts, type RowCounts, type VerificationRow,
} from "../src/lib/deploy-checks.ts";

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const url = process.env.RESTORE_DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  fail("RESTORE_DATABASE_URL is not a database URL.");
}
if (!["127.0.0.1", "localhost"].includes(host)) fail(`Refusing to check a non-local database (${host}).`);

const production = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as RowCounts;
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const row = (await db.query<VerificationRow>(VERIFICATION_SQL)).rows[0];
  if (!row) fail("Verification query returned no rows.");
  console.log("Restored schema:", JSON.stringify(row));
  const schemaProblems = checkVerification(row);

  const restored = (await db.query<{ counts: RowCounts }>(ROW_COUNTS_SQL)).rows[0]?.counts ?? {};
  console.log("Production rows:", JSON.stringify(production));
  console.log("Restored rows:  ", JSON.stringify(restored));
  const countProblems = compareRowCounts(production, restored);

  const problems = [...schemaProblems, ...countProblems];
  if (problems.length > 0) fail(`Restore drill failed:\n${problems.join("\n")}`);
  const total = Object.values(restored).reduce((a, b) => a + Number(b), 0);
  console.log(`✓ Restore drill passed: ${Object.keys(restored).length} tables, ${total} rows, all matching production; security checks pass on the copy.`);
} finally {
  await db.end();
}
