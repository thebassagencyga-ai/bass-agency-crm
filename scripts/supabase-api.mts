// Runs SQL on the hosted CRM project through the Supabase Management API over HTTPS.
// Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. Never prints secrets.
import { checkProjectRef } from "../src/lib/deploy-checks.ts";

export function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

export function requireProject(): void {
  const refCheck = checkProjectRef(process.env.SUPABASE_PROJECT_REF ?? "");
  if (!refCheck.ok) fail(refCheck.reason);
  if (!process.env.SUPABASE_ACCESS_TOKEN) fail("SUPABASE_ACCESS_TOKEN is not set.");
}

export async function query<T>(sql: string): Promise<T[]> {
  const ref = process.env.SUPABASE_PROJECT_REF ?? "";
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    fail(`Supabase API returned ${response.status}: ${body}`);
  }
  return (await response.json()) as T[];
}
