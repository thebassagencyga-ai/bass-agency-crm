// "Download my data" (Phase 15): which columns each CSV file has. Pure; the route fetches rows.
export const EXPORT_DATASETS = {
  contacts: {
    label: "Contacts",
    table: "contacts",
    select: "id, contact_type, first_name, last_name, business_name, relationship_status, email, phone, alt_phone, address_line1, address_line2, city, state, postal_code, preferred_contact_method, lead_source, referred_by_contact_id, google_review_left_on, notes, tags, merged_into_contact_id, archived_at, created_at",
    columns: [
      { key: "name", label: "Name" }, { key: "contact_type", label: "Type" }, { key: "first_name", label: "First name" },
      { key: "last_name", label: "Last name" }, { key: "business_name", label: "Business name" },
      { key: "relationship_status", label: "Status" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
      { key: "alt_phone", label: "Other phone" }, { key: "address_line1", label: "Street address" },
      { key: "address_line2", label: "Address line 2" }, { key: "city", label: "City" }, { key: "state", label: "State" },
      { key: "postal_code", label: "ZIP" }, { key: "preferred_contact_method", label: "Preferred contact" },
      { key: "lead_source", label: "Lead source" }, { key: "referred_by", label: "Referred by" },
      { key: "google_review_left_on", label: "Google review left on" }, { key: "notes", label: "Notes" },
      { key: "tag_list", label: "Tags" }, { key: "archived", label: "Archived" }, { key: "merged_into", label: "Merged into" },
      { key: "created_at", label: "Added" },
    ],
  },
  opportunities: {
    label: "Opportunities and policies",
    table: "opportunities",
    select: "id, contact_id, product_line, outcome, quoted_carrier, current_carrier, estimated_annual_premium, quote_sent_on, effective_date, renewal_date, policy_term_months, policy_ended_on, loss_reason, description, next_action, closed_at, created_at",
    columns: [
      { key: "contact", label: "Contact" }, { key: "product_line", label: "Line" }, { key: "outcome", label: "Outcome" },
      { key: "quoted_carrier", label: "Carrier" }, { key: "current_carrier", label: "Prospect's current carrier" },
      { key: "estimated_annual_premium", label: "Annual premium" }, { key: "quote_sent_on", label: "Quote sent" },
      { key: "effective_date", label: "Effective date" }, { key: "renewal_date", label: "Renewal date" },
      { key: "policy_term_months", label: "Term (months)" }, { key: "policy_ended_on", label: "Policy ended" },
      { key: "loss_reason", label: "Loss reason" }, { key: "description", label: "Description" },
      { key: "next_action", label: "Next action" }, { key: "closed_at", label: "Closed" }, { key: "created_at", label: "Added" },
    ],
  },
  tasks: {
    label: "Tasks",
    table: "tasks",
    select: "id, contact_id, title, description, due_date, start_date, priority, category, status, completed_at, created_at",
    columns: [
      { key: "contact", label: "Contact" }, { key: "title", label: "Task" }, { key: "description", label: "Details" },
      { key: "due_date", label: "Due" }, { key: "start_date", label: "Starts" }, { key: "priority", label: "Priority" },
      { key: "category", label: "Category" }, { key: "status", label: "Status" }, { key: "completed_at", label: "Completed" },
      { key: "created_at", label: "Added" },
    ],
  },
  activities: {
    label: "Activity history",
    table: "activities",
    select: "id, contact_id, activity_type, outcome, occurred_at, notes, created_at",
    columns: [
      { key: "contact", label: "Contact" }, { key: "activity_type", label: "Activity" }, { key: "outcome", label: "Outcome" },
      { key: "occurred_at", label: "When" }, { key: "notes", label: "Notes" },
    ],
  },
  household: {
    label: "Household / other drivers",
    table: "household_members",
    select: "id, contact_id, first_name, last_name, relationship, archived_at",
    columns: [
      { key: "contact", label: "Contact" }, { key: "first_name", label: "First name" }, { key: "last_name", label: "Last name" },
      { key: "relationship", label: "Relationship" }, { key: "archived", label: "Removed" },
    ],
  },
  vehicles: {
    label: "Vehicles",
    table: "vehicles",
    select: "id, contact_id, year, make, model, archived_at",
    columns: [
      { key: "contact", label: "Contact" }, { key: "year", label: "Year" }, { key: "make", label: "Make" },
      { key: "model", label: "Model" }, { key: "archived", label: "Removed" },
    ],
  },
} as const;
export type ExportDataset = keyof typeof EXPORT_DATASETS;
export const isExportDataset = (v: string): v is ExportDataset => Object.hasOwn(EXPORT_DATASETS, v);
