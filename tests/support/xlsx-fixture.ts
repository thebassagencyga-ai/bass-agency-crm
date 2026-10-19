import { strToU8, zipSync } from "fflate";

// Builds a minimal but real .xlsx (what Excel writes) for tests. Fictional data only.
// Cells: strings go through sharedStrings; numbers are numbers; { date } becomes an Excel serial
// with a date style; { inline } is an inline string.
export type Cell = string | number | { date: string } | { inline: string } | null;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);

export function makeXlsx(rows: Cell[][], opts: { extraSheetFirstInZip?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${col(c)}${r + 1}`;
      if (v === null) return "";
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === "string") { shared.push(v); return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`; }
      if ("date" in v) return `<c r="${ref}" s="1"><v>${serial(v.date)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types/>"),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Policies" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/styles.xml": strToU8('<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="m/d/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0"?><sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`),
    // The workbook's FIRST sheet (rId1) is sheet2.xml on purpose: the reader must follow the rels.
    "xl/worksheets/sheet2.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WRONG SHEET</t></is></c></row></sheetData></worksheet>'),
  };
  if (opts.extraSheetFirstInZip) files["xl/worksheets/sheet0.xml"] = strToU8("<worksheet/>");
  return zipSync(files);
}
