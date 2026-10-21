// Import fields and the guesses that match a report's column headings to them (Phase 15).
import type { ProductLine } from "@/lib/pipelines";

export const IMPORT_FIELDS = [
  { key: "full_name", label: "Full name (insured)", group: "contact" },
  { key: "first_name", label: "First name", group: "contact" },
  { key: "last_name", label: "Last name", group: "contact" },
  { key: "business_name", label: "Business name", group: "contact" },
  { key: "email", label: "Email", group: "contact" },
  { key: "phone", label: "Phone", group: "contact" },
  { key: "alt_phone", label: "Other phone", group: "contact" },
  { key: "address_line1", label: "Street address", group: "contact" },
  { key: "city", label: "City", group: "contact" },
  { key: "state", label: "State", group: "contact" },
  { key: "postal_code", label: "ZIP", group: "contact" },
  { key: "lead_source", label: "Lead source", group: "contact" },
  { key: "line", label: "Line / policy type", group: "policy" },
  { key: "carrier", label: "Carrier", group: "policy" },
  { key: "premium", label: "Annual premium", group: "policy" },
  { key: "effective_date", label: "Effective date", group: "policy" },
  { key: "renewal_date", label: "Renewal / expiration date", group: "policy" },
  { key: "term_months", label: "Policy term (6 or 12 months)", group: "policy" },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type Mapping = Partial<Record<ImportField, number>>;

const SYNONYMS: Record<ImportField, string[]> = {
  full_name: ["insured name", "insured", "name", "client name", "customer name", "named insured", "policyholder", "policy holder", "full name", "client", "customer"],
  first_name: ["first name", "first", "fname", "insured first name", "given name"],
  last_name: ["last name", "last", "lname", "surname", "insured last name", "family name"],
  business_name: ["business name", "company name", "business", "dba", "organization", "organisation"],
  email: ["email", "e mail", "email address", "e mail address"],
  phone: ["phone", "phone number", "home phone", "primary phone", "mobile", "mobile phone", "cell", "cell phone", "telephone"],
  alt_phone: ["work phone", "alternate phone", "alt phone", "other phone", "phone 2", "secondary phone", "business phone"],
  address_line1: ["address", "street", "street address", "address 1", "address line 1", "mailing address", "address1"],
  city: ["city", "town", "mailing city"],
  state: ["state", "st", "mailing state", "province"],
  postal_code: ["zip", "zip code", "postal code", "zipcode", "postcode", "mailing zip"],
  lead_source: ["source", "lead source", "referral source"],
  line: ["line", "line of business", "lob", "policy type", "product", "coverage", "type", "policy line"],
  carrier: ["carrier", "insurer", "writing company", "insurance company", "company"],
  premium: ["premium", "annual premium", "written premium", "total premium", "prem", "annualized premium"],
  effective_date: ["effective date", "eff date", "effective", "eff", "inception date", "policy effective date", "start date"],
  renewal_date: ["renewal date", "expiration date", "exp date", "expiration", "exp", "renewal", "expires", "x date", "xdate", "expiry date", "policy expiration date"],
  term_months: ["term", "policy term", "term months", "term length"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best guess of which column holds each field; each column used at most once. */
export function guessMapping(headers: readonly string[]): Mapping {
  const normalized = headers.map(norm);
  const mapping: Mapping = {};
  const used = new Set<number>();
  // Exact synonym matches first, then headings that contain a longer synonym.
  for (const pass of ["exact", "contains"] as const) {
    for (const { key } of IMPORT_FIELDS) {
      if (mapping[key] !== undefined) continue;
      for (const syn of SYNONYMS[key]) {
        const i = normalized.findIndex((h, idx) => !used.has(idx) && (pass === "exact" ? h === syn : syn.length >= 4 && h.includes(syn)));
        if (i >= 0) {
          mapping[key] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  // A full name and separate first/last names: prefer the separate ones.
  if (mapping.first_name !== undefined && mapping.last_name !== undefined) delete mapping.full_name;
  return mapping;
}

/** The product line a report's policy type most likely means, or null if unsure. */
export function guessLine(raw: string): ProductLine | null {
  const s = norm(raw);
  if (s === "") return null;
  // Phase 30 (ADR-048): the specific lines first, then the families they used to fold into.
  if (/\b(commercial auto|business auto|commercial vehicle|truck fleet|fleet)\b/.test(s)) return "commercial_auto";
  if (/\b(farm|farmowners?|farm owners|ranch|agri\w*)\b/.test(s)) return "farm";
  if (/\b(commercial umbrella|umbrella commercial|business umbrella)\b/.test(s)) return "commercial";
  if (/\b(umbrella|pup|personal umbrella|excess liability)\b/.test(s)) return "umbrella";
  if (/\b(commercial|business|bop|businessowners?|general liability|gl|workers comp|workers compensation|wc|inland marine)\b/.test(s)) return "commercial";
  if (/\b(life|term|whole|universal|ul|wl|final expense|annuity)\b/.test(s)) return "life";
  if (/\b(rv|motorhome|motor home|camper|travel trailer|recreational vehicle)\b/.test(s)) return "rv";
  if (/\b(renters?|tenants?|ho ?4)\b/.test(s)) return "renters";
  if (/\b(condo|condominium|ho ?6)\b/.test(s)) return "condo";
  if (/\b(mobile home|manufactured|mobilehome)\b/.test(s)) return "mobile_home";
  if (/\b(home|homeowners?|ho ?\d|dwelling|dp ?\d|property)\b/.test(s)) return "home";
  if (/\b(motorcycle|motorbike|cycle|scooter)\b/.test(s)) return "motorcycle";
  if (/\b(boat|watercraft|personal watercraft|pwc|jet ski|yacht)\b/.test(s)) return "boat";
  if (/\b(auto|car|vehicle|pap|motor|private passenger|personal auto)\b/.test(s)) return "auto";
  return null;
}
