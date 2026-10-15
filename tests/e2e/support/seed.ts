import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestUser, fullSessionClient, fullSessionCookies } from "../../support/supabase";

// A signed-in owner with a little of everything (fictional data), so pages render their
// full layouts for the responsive, touch-target and accessibility audits (Phase 10).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function stage(client: SupabaseClient, line: string, code: string): Promise<string> {
  const { data, error } = await client.from("pipeline_stages").select("id").eq("product_line", line).eq("code", code).single();
  if (error || !data) throw error ?? new Error(`No stage ${line}/${code}`);
  return data.id as string;
}

export interface SeededOwner {
  email: string;
  cookies: Awaited<ReturnType<typeof fullSessionCookies>>;
  contactId: string;
  policyId: string;
  openOppId: string;
  taskId: string;
}

export async function seededOwner(label: string, appUrl: string): Promise<SeededOwner> {
  const owner = await createTestUser(label);
  const client = await fullSessionClient(owner.email);
  const insert = async (table: string, values: Record<string, unknown>) => {
    const { data, error } = await client.from(table).insert(values).select("id").single();
    if (error || !data) throw error ?? new Error(`insert into ${table} failed`);
    return data.id as string;
  };

  const referrer = await insert("contacts", { contact_type: "individual", first_name: "Robin", last_name: "Example", relationship_status: "client" });
  const contactId = await insert("contacts", {
    contact_type: "individual", first_name: "Jordan", last_name: "Example", phone: "(555) 010-0123",
    email: "jordan@example.com", city: "Carrollton", state: "GA", postal_code: "30117", lead_source: "Website",
    referred_by_contact_id: referrer, relationship_status: "client",
  });
  await insert("contacts", { contact_type: "business", business_name: "Example Hardware LLC", phone: "(555) 010-0144" });

  const policyId = await insert("opportunities", {
    contact_id: contactId, product_line: "auto", stage_id: await stage(client, "auto", "bound"), outcome: "won",
    estimated_annual_premium: 1200, renewal_date: inDays(20), quoted_carrier: "Example Mutual",
  });
  const openOppId = await insert("opportunities", {
    contact_id: contactId, product_line: "home", stage_id: await stage(client, "home", "quoted"),
    quote_sent_on: inDays(-1), estimated_annual_premium: 900, description: "Fictional home quote",
  });
  const taskId = await insert("tasks", { contact_id: contactId, opportunity_id: openOppId, title: "Call about the home quote", due_date: inDays(0), priority: "high" });
  await insert("tasks", { contact_id: contactId, title: "Overdue check-in", due_date: inDays(-3) });
  await insert("activities", { contact_id: contactId, activity_type: "call", outcome: "connected", notes: "Fictional call notes." });

  const cookies = await fullSessionCookies(owner.email, appUrl);
  return { email: owner.email, cookies, contactId, policyId, openOppId, taskId };
}

/** The signed-in pages audited at phone widths. */
export function keyPages(s: SeededOwner): string[] {
  return [
    "/dashboard", "/contacts", `/contacts/${s.contactId}`, "/contacts/new",
    "/opportunities", "/opportunities?view=table", `/opportunities/${s.openOppId}`,
    "/tasks", `/tasks/${s.taskId}`, "/tasks/new", "/activities/new",
    "/renewals", `/renewals/${s.policyId}`, "/reports", "/settings",
  ];
}
