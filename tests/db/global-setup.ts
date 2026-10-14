import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import type { TestProject } from "vitest/node";

// Builds a fresh, disposable database from supabase/migrations for every test run.
//
// TEST_DATABASE_URL must point at a LOCAL server where the user can create databases
// (scripts/local-db.sh, or the Postgres service in CI). The URL's database is used only to
// create and drop the throwaway database; nothing else on that server is touched.

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

function assertLocal(url: URL): void {
  const host = url.hostname;
  if (!["127.0.0.1", "localhost", "::1", "postgres"].includes(host)) {
    throw new Error(
      `Refusing to run database tests against non-local host "${host}". ` +
        "Database tests create and drop databases; point TEST_DATABASE_URL at a local server.",
    );
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Run `npm run db:local:start` and export the URL it prints.",
    );
  }
  const serverUrl = new URL(raw);
  assertLocal(serverUrl);

  const dbName = `crm_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: serverUrl.toString() });
  await admin.connect();
  await admin.query(`create database ${dbName}`);

  const testUrl = new URL(serverUrl.toString());
  testUrl.pathname = `/${dbName}`;

  const db = new pg.Client({ connectionString: testUrl.toString() });
  await db.connect();
  try {
    await db.query(readFileSync(path.join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{14}_.+\.sql$/.test(f))
      .sort();
    if (migrations.length === 0) throw new Error("No migrations found");
    for (const file of migrations) {
      try {
        await db.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }

  project.provide("testDatabaseUrl", testUrl.toString());

  return async () => {
    if (process.env.KEEP_TEST_DATABASE === "1") {
      console.log(`Kept test database ${dbName}`);
    } else {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    }
    await admin.end();
  };
}
