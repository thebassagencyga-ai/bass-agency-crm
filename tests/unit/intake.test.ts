import { describe, expect, it } from "vitest";
import { describeCoverage, nextMonthStart, quoteDueDate } from "@/lib/intake/format";
import { echoIntakeValues, intakeDbError, isIntakeToken, parseIntakeForm } from "@/lib/intake/schema";

const fd = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const good: [string, string][] = [
  ["first_name", " Robin "], ["last_name", "Example"], ["phone", "4045550123"], ["email", "Robin@Example.com"],
  ["postal_code", "30117"], ["preferred_contact_method", "text"], ["best_time", "Evenings"],
  ["lines", "home"], ["lines", "auto"], ["carrier_auto", "Example Mutual"], ["renews_auto", "3"],
  ["carrier_home", ""], ["renews_home", ""], ["carrier_life", "Ignored"], ["renews_life", "5"],
  ["heard_about", "Referral"], ["referred_by_name", "Casey Sample"], ["consent", "on"],
];

describe("parseIntakeForm", () => {
  it("cleans a complete form", () => {
    expect(parseIntakeForm(fd(good), { requireConsent: true })).toEqual({
      ok: true,
      consent: true,
      payload: {
        first_name: "Robin", last_name: "Example", email: "robin@example.com", phone: "404-555-0123",
        postal_code: "30117", preferred_contact_method: "text", best_time: "Evenings",
        lines: ["auto", "home"],
        // Only chosen lines with something filled in; "life" was not chosen.
        current_coverage: [{ line: "auto", carrier: "Example Mutual", renews_month: 3 }],
        heard_about: "Referral", referred_by_name: "Casey Sample",
        address_line1: null, city: null, state: null, household: [], vehicles: [],
      },
    });
  });

  it("reads the address, household rows and vehicles (auto only), skipping empty rows", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const entries: [string, string][] = [
      ...good, ["address_line1", " 1 Example St "], ["city", "Carrollton"], ["state", "ga"],
      ["hh_first_0", "Sam"], ["hh_last_0", "Example"], ["hh_rel_0", "spouse"],
      ["hh_first_1", ""], ["hh_last_1", ""], ["hh_rel_1", "child"],
      ["hh_first_2", "Kit"], ["hh_last_2", ""], ["hh_rel_2", ""],
      ["veh_year_0", "2019"], ["veh_make_0", "Example"], ["veh_model_0", "Sedan"],
      ["veh_year_1", ""], ["veh_make_1", ""], ["veh_model_1", ""],
      ["veh_year_2", "2028"], ["veh_make_2", "Future"], ["veh_model_2", ""],
    ];
    const result = parseIntakeForm(fd(entries), { requireConsent: true, now });
    expect(result).toMatchObject({
      ok: true,
      payload: {
        address_line1: "1 Example St", city: "Carrollton", state: "GA",
        household: [
          { first_name: "Sam", last_name: "Example", relationship: "spouse" },
          { first_name: "Kit", last_name: null, relationship: "other" },
        ],
        vehicles: [{ year: 2019, make: "Example", model: "Sedan" }, { year: 2028, make: "Future", model: null }],
      },
    });
  });

  it.each([
    [[["hh_first_0", ""], ["hh_last_0", "Example"]], "household_0", "Enter a first name."],
    [[["hh_first_3", "x".repeat(200)]], "household_3", "Keep the first name under 100 characters."],
    [[["hh_first_0", "A"], ["hh_rel_0", "cousin"]], "household_0", "Choose a relationship."],
    [[["veh_year_0", "1850"], ["veh_make_0", "Old"]], "vehicle_0", "Enter a year from 1900 to 2028."],
    [[["veh_year_0", "2029"], ["veh_make_0", "New"]], "vehicle_0", "Enter a year from 1900 to 2028."],
    [[["veh_year_1", "19"], ["veh_make_1", "Short"]], "vehicle_1", "Enter the 4-digit year."],
    [[["veh_year_0", "2020"], ["veh_make_0", ""], ["veh_model_0", "Sedan"]], "vehicle_0", "Enter the make, for example Ford."],
    [[["state", "Georgia"], ["city", "Carrollton"]], "state", "Use the 2-letter state code, for example GA."],
  ] as [string, string][][] | unknown[])("explains a bad row %#", (extra, field, message) => {
    const result = parseIntakeForm(fd([...good, ...(extra as [string, string][])]), { requireConsent: true, now: new Date("2026-10-16T12:00:00Z") });
    expect(result).toEqual({ ok: false, fieldErrors: { [field as string]: message } });
  });

  it("ignores vehicles when no auto quote is wanted, and a state with no address", () => {
    const entries: [string, string][] = [
      ...good.filter(([k, v]) => !(k === "lines" && v === "auto")), ["veh_year_0", "1850"], ["veh_make_0", "Old"], ["state", "GA"],
    ];
    const result = parseIntakeForm(fd(entries), { requireConsent: true });
    expect(result).toMatchObject({ ok: true, payload: { vehicles: [], state: null } });
  });

  it.each([
    ["first_name", "", "Enter a first name."],
    ["last_name", "", "Enter a last name."],
    ["email", "nope", "Enter a valid email address."],
    ["phone", "555-0123", "Enter a 10-digit phone number, including the area code."],
    ["postal_code", "301", "Enter a 5-digit ZIP code."],
    ["best_time", "x".repeat(101), "Keep this under 100 characters."],
    ["carrier_auto", "x".repeat(101), "Keep the company name under 100 characters."],
  ])("explains a bad %s", (field, value, message) => {
    const entries = good.map(([k, v]): [string, string] => (k === field ? [k, value] : [k, v]));
    const result = parseIntakeForm(fd(entries), { requireConsent: true });
    expect(result).toEqual({ ok: false, fieldErrors: { [field]: message } });
  });

  it("needs a phone number or an email", () => {
    const entries = good.filter(([k]) => k !== "phone" && k !== "email");
    expect(parseIntakeForm(fd(entries), { requireConsent: true })).toEqual({
      ok: false, fieldErrors: { phone: "Enter a phone number or an email address so we can reach you." },
    });
  });

  it("needs at least one known line", () => {
    const entries: [string, string][] = [...good.filter(([k]) => k !== "lines"), ["lines", "boat"]];
    expect(parseIntakeForm(fd(entries), { requireConsent: true })).toMatchObject({ ok: false, fieldErrors: { lines: expect.any(String) } });
  });

  it("requires consent on the public form only", () => {
    const entries = good.filter(([k]) => k !== "consent");
    expect(parseIntakeForm(fd(entries), { requireConsent: true })).toMatchObject({ ok: false, fieldErrors: { consent: expect.any(String) } });
    expect(parseIntakeForm(fd(entries), { requireConsent: false })).toMatchObject({ ok: true, consent: false });
  });

  it("ignores unknown choices instead of storing them", () => {
    const entries = good.map(([k, v]): [string, string] =>
      k === "preferred_contact_method" ? [k, "carrier pigeon"] : k === "heard_about" ? [k, "<script>"] : k === "renews_auto" ? [k, "13"] : [k, v]);
    const result = parseIntakeForm(fd(entries), { requireConsent: true });
    expect(result.ok && result.payload.preferred_contact_method).toBeNull();
    expect(result.ok && result.payload.heard_about).toBeNull();
    expect(result.ok && result.payload.current_coverage).toEqual([{ line: "auto", carrier: "Example Mutual", renews_month: null }]);
  });
});

describe("echoIntakeValues", () => {
  it("returns typed values, the chosen lines and consent", () => {
    const v = echoIntakeValues(fd(good));
    expect(v).toMatchObject({ first_name: " Robin ", lines: "home,auto", carrier_auto: "Example Mutual", renews_auto: "3", consent: "on" });
  });
});

describe("intakeDbError", () => {
  it("maps the database's reasons to friendly messages", () => {
    expect(intakeDbError("link_unavailable").error).toContain("no longer active");
    expect(intakeDbError("rate_limited").error).toContain("try again in an hour");
    expect(intakeDbError("reach").fieldErrors?.phone).toContain("phone number or an email");
    expect(intakeDbError("email").fieldErrors).toEqual({ email: "Please check this field." });
    expect(intakeDbError("anything else").error).toContain("Please try again");
    expect(intakeDbError("vehicles").fieldErrors).toEqual({ vehicle_0: "Please check the vehicles listed." });
    expect(intakeDbError("state").fieldErrors).toEqual({ state: "Please check this field." });
  });
});

describe("tokens and dates", () => {
  it("accepts only 32 lowercase hex characters as a link token", () => {
    expect(isIntakeToken("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isIntakeToken("0123456789ABCDEF0123456789abcdef")).toBe(false);
    expect(isIntakeToken("../../etc/passwd")).toBe(false);
  });

  it("puts a renewal month on its next occurrence (this month counts)", () => {
    expect(nextMonthStart(3, "2026-10-16")).toBe("2027-03-01");
    expect(nextMonthStart(10, "2026-10-16")).toBe("2026-10-01");
    expect(nextMonthStart(12, "2026-10-16")).toBe("2026-12-01");
  });

  it("dues the quote 30 days before renewal, never in the past", () => {
    expect(quoteDueDate("2027-03-01", "2026-10-16")).toBe("2027-01-30");
    expect(quoteDueDate("2026-11-01", "2026-10-16")).toBe("2026-10-16");
  });

  it("describes current coverage", () => {
    expect(describeCoverage({ line: "auto", carrier: "Example Mutual", renews_month: 3 })).toBe("Auto: Example Mutual, renews in March");
    expect(describeCoverage({ line: "life", carrier: null, renews_month: 12 })).toBe("Life: renews in December");
  });
});
