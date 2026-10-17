// Shapes of contact rows as read through the Data API (see supabase/migrations).
export const CONTACT_TYPES = ["individual", "business"] as const;
export const RELATIONSHIP_STATUSES = ["prospect", "client", "former_client"] as const;
export const CONTACT_METHODS = ["phone", "text", "email", "in_person", "no_preference"] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export interface Contact {
  id: string;
  contact_type: ContactType;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  alt_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  preferred_contact_method: ContactMethod | null;
  lead_source: string | null;
  relationship_status: RelationshipStatus;
  referred_by_contact_id: string | null;
  google_review_left_on: string | null;
  notes: string | null;
  /** Labels such as "VIP" (Phase 17). */
  tags: string[];
  /** Set when this contact was merged into another (Phase 17); it then stays archived. */
  merged_into_contact_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const RELATIONSHIP_LABELS: Readonly<Record<RelationshipStatus, string>> = {
  prospect: "Prospect",
  client: "Client",
  former_client: "Former client",
};

export const CONTACT_METHOD_LABELS: Readonly<Record<ContactMethod, string>> = {
  phone: "Phone call",
  text: "Text message",
  email: "Email",
  in_person: "In person",
  no_preference: "No preference",
};

export const LEAD_SOURCE_SUGGESTIONS = [
  "Referral",
  "Existing client",
  "Walk-in",
  "Phone call",
  "Website",
  "Social media",
  "Community event",
  "Other",
] as const;
