import { describe, expect, it } from "vitest";
import { buildImport, distinctLineValues, matchExisting } from "@/lib/import/build";
import { csvCell, parseCsv, toCsv } from "@/lib/import/csv";
import { guessLine, guessMapping } from "@/lib/import/fields";
import { parseDate, parseMoney, parseState, parseTerm, splitName } from "@/lib/import/values";

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes, CRLF, a BOM and skips blank lines", () => {
    const text = '﻿Name,Notes\r\n"Example, Robin","said ""hi"""\r\n\r\nSam Example,"two\nlines"\n';
    expect(parseCsv(text)).toEqual([["Name", "Notes"], ["Example, Robin", 'said "hi"'], ["Sam Example", "two\nlines"]]);
  });

  it("detects semicolon and tab separators", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps a last line without a line break", () => {
    expect(parseCsv("a,b\n1,")).toEqual([["a", "b"], ["1", ""]]);
  });
});

describe("csv export", () => {
  it("quotes when needed and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell(-5)).toBe("-5"); // numbers are not text formulas
    expect(csvCell(null)).toBe("");
  });

  it("writes a BOM, a heading row and CRLF line ends", () => {
    expect(toCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: 1, b: "x,y" }])).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });
});

describe("guessMapping / guessLine", () => {
  it("matches typical report headings", () => {
    const headers = ["Insured Name", "Policy Type", "Writing Company", "Annual Premium", "Eff Date", "Exp Date", "Phone Number", "E-Mail", "Mailing Address", "City", "ST", "Zip Code", "Term"];
    expect(guessMapping(headers)).toEqual({
      full_name: 0, line: 1, carrier: 2, premium: 3, effective_date: 4, renewal_date: 5, phone: 6, email: 7,
      address_line1: 8, city: 9, state: 10, postal_code: 11, term_months: 12,
    });
  });

  it("prefers separate first and last names over a full-name column", () => {
    expect(guessMapping(["Name", "First Name", "Last Name"])).toEqual({ first_name: 1, last_name: 2 });
  });

  it.each([
    ["Personal Auto", "auto"], ["PAP", "auto"], ["HO3", "home"], ["Homeowners", "home"], ["DP-3", "home"], ["Renters", "home"],
    ["Term Life", "life"], ["Whole Life", "life"], ["BOP", "commercial"], ["Commercial Auto", "commercial"], ["Farmowners", "commercial"],
    ["Boat", null], ["", null],
  ])("%s → %s", (raw, line) => {
    expect(guessLine(raw)).toBe(line);
  });
});

describe("values", () => {
  it.each([
    ["2026-03-01", "2026-03-01"], ["3/1/2026", "2026-03-01"], ["03-01-2026", "2026-03-01"], ["3/1/26", "2026-03-01"],
    ["2026-03-01T00:00:00", "2026-03-01"], ["", null], ["2/30/2026", undefined], ["March 1", undefined],
  ])("parseDate(%s)", (raw, out) => expect(parseDate(raw)).toBe(out));

  it("parses money, terms, states and names", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("-5")).toBeUndefined();
    expect(parseMoney("12abc")).toBeUndefined();
    expect(parseTerm("6 months")).toBe(6);
    expect(parseTerm("Semi-Annual")).toBe(6);
    expect(parseTerm("Annual")).toBe(12);
    expect(parseTerm("3")).toBeUndefined();
    expect(parseState("Georgia")).toBe("GA");
    expect(parseState("ga")).toBe("GA");
    expect(parseState("Gorgia")).toBeNull();
    expect(splitName("Example, Robin A")).toEqual({ first_name: "Robin A", last_name: "Example" });
    expect(splitName("Robin A Example")).toEqual({ first_name: "Robin A", last_name: "Example" });
    expect(splitName("Example Farms LLC")).toEqual({ business_name: "Example Farms LLC" });
    expect(splitName("First Example Church")).toEqual({ business_name: "First Example Church" });
  });
});

describe("buildImport", () => {
  const header = ["Insured Name", "Policy Type", "Carrier", "Premium", "Eff Date", "Exp Date", "Phone", "Email", "ZIP", "State"];
  const mapping = guessMapping(header);
  const rows = [
    ["Example, Robin", "Personal Auto", "Example Mutual", "$1,200.00", "3/1/2026", "9/1/2026", "(404) 555-0101", "Robin@Example.com", "30117", "Georgia"],
    ["Example, Robin", "HO3", "Example Mutual", "900", "1/1/2026", "1/1/2027", "404-555-0101", "robin@example.com", "", ""],
    ["Example Bakery LLC", "BOP", "Sample Ins", "3000", "", "", "404-555-0102", "", "6511", "GA"],
    ["", "Auto", "", "", "", "", "", "", "", ""],
    ["Sam Example", "Boat", "", "", "", "", "", "bad-email", "", "Gorgia"],
    ["Kit Example", "Auto", "", "lots", "", "", "", "", "", ""],
    ["Lee Example", "Auto", "", "", "13/45/2026", "", "", "", "", ""],
  ];

  it("groups a person's policies, reads values and explains every problem", () => {
    const { clients, issues, tooMany } = buildImport(rows, mapping, { boat: "skip" });
    expect(tooMany).toBe(false);
    expect(clients).toHaveLength(3);
    const robin = clients[0]!;
    expect(robin.rows).toEqual([2, 3]);
    expect(robin.contact).toMatchObject({ contact_type: "individual", first_name: "Robin", last_name: "Example", email: "robin@example.com", phone: "404-555-0101", state: "GA", postal_code: "30117" });
    expect(robin.policies).toEqual([
      { line: "auto", carrier: "Example Mutual", premium: 1200, effective_date: "2026-03-01", renewal_date: "2026-09-01", term_months: null },
      { line: "home", carrier: "Example Mutual", premium: 900, effective_date: "2026-01-01", renewal_date: "2027-01-01", term_months: null },
    ]);
    expect(clients[1]!.contact).toMatchObject({ contact_type: "business", business_name: "Example Bakery LLC", postal_code: "06511" });
    expect(clients[1]!.policies[0]!.line).toBe("commercial");
    // Sam: the boat policy is skipped by choice; the contact is still imported, bad email/state left out.
    expect(clients[2]!.contact).toMatchObject({ first_name: "Sam", email: null, state: null });
    expect(clients[2]!.policies).toEqual([]);
    expect(issues).toEqual([
      { row: 5, message: "No name.", skipped: true },
      { row: 6, message: 'Email "bad-email" is not valid; left out.', skipped: false },
      { row: 6, message: 'State "Gorgia" is not recognised; left out.', skipped: false },
      { row: 7, message: 'Premium "lots" is not a number.', skipped: true },
      { row: 8, message: 'Effective date "13/45/2026" is not a date.', skipped: true },
    ]);
  });

  it("refuses a policy type nobody matched", () => {
    const { clients, issues } = buildImport([["Sam Example", "Boat", "", "", "", "", "", "", "", ""]], mapping, {});
    expect(clients).toEqual([]);
    expect(issues).toEqual([{ row: 2, message: 'Policy type "Boat" is not matched to a line.', skipped: true }]);
  });

  it("lists the report's policy types with guesses and counts", () => {
    expect(distinctLineValues(rows, mapping).map((v) => [v.value, v.guess, v.count])).toEqual([
      ["Auto", "auto", 3], ["Boat", null, 1], ["BOP", "commercial", 1], ["HO3", "home", 1], ["Personal Auto", "auto", 1],
    ]);
  });

  it("flags more than 1,000 clients", () => {
    const many = Array.from({ length: 1001 }, (_, i) => [`Person${i} Example`]);
    const result = buildImport(many, { full_name: 0 }, {});
    expect(result.tooMany).toBe(true);
    expect(result.clients).toHaveLength(1000);
  });
});

describe("matchExisting", () => {
  it("matches by email or by phone digits", () => {
    const { clients } = buildImport(
      [["Robin Example", "robin@example.com", ""], ["Sam Example", "", "1 (404) 555-0199"], ["New Person", "new@example.com", ""]],
      { full_name: 0, email: 1, phone: 2 }, {});
    const matches = matchExisting(clients, [
      { id: "a", label: "Robin E.", email: "ROBIN@example.com", phone: null },
      { id: "b", label: "Sam E.", email: null, phone: "404-555-0199" },
    ]);
    expect([...matches.values()].map((m) => m.id)).toEqual(["a", "b"]);
    expect(matches.has(clients[2]!.key)).toBe(false);
  });
});
