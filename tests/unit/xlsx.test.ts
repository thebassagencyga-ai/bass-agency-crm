import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { guessMapping } from "@/lib/import/fields";
import { readXlsx, serialToIsoDate, sniffFile, XlsxError } from "@/lib/import/xlsx";
import { makeXlsx } from "../support/xlsx-fixture";

// Excel (.xlsx) import (fix after Phase 15): the owner's report was uploaded as .xlsx and read as
// text. Fictional data only.

describe("sniffFile", () => {
  it("tells .xlsx, old .xls, text and other binary files apart by their first bytes", () => {
    expect(sniffFile(makeXlsx([["Insured Name"]]))).toBe("xlsx");
    expect(sniffFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe("xls");
    expect(sniffFile(strToU8("Insured Name,Phone\nRobin Example,404-555-0101\n"))).toBe("text");
    expect(sniffFile(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toBe("binary");
  });
});

describe("serialToIsoDate", () => {
  it("matches Excel's calendar, including its 1900 quirk and the 1904 system", () => {
    expect(serialToIsoDate(1)).toBe("1900-01-01");
    expect(serialToIsoDate(59)).toBe("1900-02-28");
    expect(serialToIsoDate(61)).toBe("1900-03-01");
    expect(serialToIsoDate(46326)).toBe("2026-10-31");
    expect(serialToIsoDate(46326.75)).toBe("2026-10-31");
    expect(serialToIsoDate(0, true)).toBe(null);
    expect(serialToIsoDate(44864, true)).toBe("2026-10-31");
  });
});

describe("readXlsx", () => {
  it("reads the workbook's first sheet: text, numbers, dates, gaps and special characters", () => {
    const rows = readXlsx(makeXlsx([
      ["Insured Name", "Phone", "Policy Type", "Premium", "Expiration Date", "Notes"],
      ["Example, Robin", "404-555-0101", "Personal Auto", 1250.5, { date: "2027-03-01" }, { inline: "Church & school <board>" }],
      ["Sample Hardware LLC", null, "Commercial Package", 3400, { date: "2026-12-15" }, null],
    ]));
    expect(rows).toEqual([
      ["Insured Name", "Phone", "Policy Type", "Premium", "Expiration Date", "Notes"],
      ["Example, Robin", "404-555-0101", "Personal Auto", "1250.5", "2027-03-01", "Church & school <board>"],
      ["Sample Hardware LLC", "", "Commercial Package", "3400", "2026-12-15", ""],
    ]);
  });

  it("feeds the same column guessing as CSV", () => {
    const rows = readXlsx(makeXlsx([["Insured Name", "Policy Type", "Expiration Date"], ["Robin Example", "Homeowners", { date: "2027-01-01" }]]));
    const mapping = guessMapping(rows[0]!);
    expect(mapping.full_name).toBe(0);
  });

  it("drops empty rows at the end and pads short rows", () => {
    const rows = readXlsx(makeXlsx([["A", "B", "C"], ["1"], [null, null, null]]));
    expect(rows).toEqual([["A", "B", "C"], ["1", "", ""]]);
  });

  it("refuses a file that is not a workbook, a damaged one, and one that expands too far", () => {
    expect(() => readXlsx(zipSync({ "word/document.xml": strToU8("<w/>") }))).toThrow(XlsxError);
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(XlsxError);
    const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(41 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(() => readXlsx(bomb)).toThrow(/too large/);
  });
});
