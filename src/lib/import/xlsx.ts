// Reads the first sheet of an Excel workbook (.xlsx) into rows of text, in the browser, so the
// import wizard can treat it exactly like a CSV (fix after Phase 15: the owner uploaded .xlsx).
// Pure apart from unzipping; unit tested. Dates stored as Excel serial numbers become YYYY-MM-DD.
//
// .xlsx is a zip of XML files written by Excel/Sheets/Numbers, so a small, strict reader is
// enough: shared strings, inline strings, numbers, booleans, formula results, and the cell
// styles that mark a number as a date. Nothing leaves the browser until the agent imports.
import { unzipSync } from "fflate";

/** Unzipped size limit: a 2 MB upload that expands past this is refused (zip bomb guard). */
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_COLUMNS = 200;

export type FileKind = "xlsx" | "xls" | "text" | "binary";

/** What a file is, from its first bytes (not its name): zip → .xlsx, OLE → old .xls. */
export function sniffFile(bytes: Uint8Array): FileKind {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  // Text files have no NUL bytes in their first few KB (UTF-8 and ANSI CSV alike).
  const head = bytes.subarray(0, 4096);
  return head.includes(0) ? "binary" : "text";
}

export class XlsxError extends Error {}

const decoder = new TextDecoder("utf-8");

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Text of every <t> inside a fragment (handles rich text runs; skips phonetic <rPh> runs). */
function textOf(fragment: string): string {
  const withoutPhonetic = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : null;
};

/** Built-in number formats that are dates (ECMA-376 §18.8.30), plus any custom format with d/m/y. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function dateStyles(stylesXml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!stylesXml) return dates;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = attr(m[0], "formatCode") ?? "";
    custom.set(id, code);
  }
  const isDateFormat = (id: number) => {
    if (BUILTIN_DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    // Ignore quoted text, escapes and colour/condition sections, then look for day/month/year.
    const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
    // A day or year part makes it a date (times alone, like mm:ss, have neither).
    return /[dy]/i.test(bare);
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  let index = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*\/?>/g)) {
    if (isDateFormat(Number(attr(m[0], "numFmtId") ?? "0"))) dates.add(index);
    index++;
  }
  return dates;
}

/** Excel serial date → YYYY-MM-DD (1900 or 1904 date system). */
export function serialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // 1900 system: day 1 = 1900-01-01, and Excel counts a non-existent 1900-02-29 (serial 60).
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  const epoch = Date.UTC(1899, 11, 30); // makes serial 61 = 1900-03-01, matching Excel
  const ms = epoch + (days < 61 && !date1904 ? days + 1 : days) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Column letters → 0-based index ("A" → 0, "AB" → 27). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function formatNumber(v: string): string {
  // Avoid 1234.5000000001-style noise from binary floats while keeping real precision.
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

/** First worksheet of an .xlsx file as rows of strings (empty trailing rows dropped). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new XlsxError("This Excel file is too large once opened. Split it into smaller files.");
        return /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof XlsxError) throw e;
    throw new XlsxError("This Excel file could not be opened. Save it again in Excel, or save it as CSV.");
  }
  const text = (name: string) => (files[name] ? decoder.decode(files[name]) : undefined);

  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new XlsxError("This file is not an Excel workbook. Save it as .xlsx or CSV.");
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);

  // First sheet in the workbook's tab order → its file, through the relationships.
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const relId = firstSheet ? attr(firstSheet, "r:id") : null;
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rels = text("xl/_rels/workbook.xml.rels");
  if (relId && rels) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], "Id") === relId) {
        const target = (attr(m[0], "Target") ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
        sheetPath = `xl/${target}`;
      }
    }
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new XlsxError("The workbook's first sheet could not be read. Save it as CSV and try again.");

  const shared: string[] = [];
  for (const m of (text("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(textOf(m[1] ?? ""));
  const dateStyleIds = dateStyles(text("xl/styles.xml"));

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowTag = rowMatch[1] ?? rowMatch[3] ?? "";
    const r = Number(attr(`<row ${rowTag}>`, "r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    let next = 0;
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tag = `<c ${c[1] ?? c[2] ?? ""}>`;
      const body = c[3] ?? "";
      const ref = attr(tag, "r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col < 0 || col >= MAX_COLUMNS) continue;
      const type = attr(tag, "t");
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
      else if (type === "str" || type === "e") value = raw === undefined ? "" : decodeXml(raw);
      else if (raw !== undefined) {
        const style = Number(attr(tag, "s") ?? "0");
        value = dateStyleIds.has(style) ? (serialToIsoDate(Number(raw), date1904) ?? "") : formatNumber(decodeXml(raw));
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  // Same shape as the CSV parser: drop blank rows at the end, pad rows to the header width.
  while (rows.length > 0 && rows[rows.length - 1]!.every((v) => v.trim() === "")) rows.pop();
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r));
}
