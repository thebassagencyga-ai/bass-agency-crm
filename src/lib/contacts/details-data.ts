import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HouseholdMember, Vehicle } from "./details";

// Active (not archived) household members and vehicles of one contact; RLS limits to the owner.

export async function listHousehold(supabase: SupabaseClient, contactId: string): Promise<HouseholdMember[]> {
  const { data, error } = await supabase
    .from("household_members").select("id, first_name, last_name, relationship")
    .eq("contact_id", contactId).is("archived_at", null).order("created_at");
  if (error) throw new Error(`Could not load the household (${error.code ?? "unknown"}).`);
  return (data ?? []) as HouseholdMember[];
}

export async function listVehicles(supabase: SupabaseClient, contactId: string): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles").select("id, year, make, model")
    .eq("contact_id", contactId).is("archived_at", null).order("created_at");
  if (error) throw new Error(`Could not load the vehicles (${error.code ?? "unknown"}).`);
  return (data ?? []) as Vehicle[];
}
