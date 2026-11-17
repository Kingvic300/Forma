// Excel tables: their look (Excel's built-in table styles), and the edits that keep them whole:
// growing when you type next to them, filling calculated columns, renaming columns and tables
// inside formulas, total rows, and converting back to a plain range.
import { colName, escapeColumn, parseRange, rangeText, resolveStructured, FErr } from "./formula";
import { moveFormula } from "./refs";
import { shiftAxis } from "./ops";
import type { Border, CellFmt, Sheet, SheetTable, SheetsData } from "./types";
import { key } from "./types";

// ---- Styles ------------------------------------------------------------------------------------------

// Office theme accents; index 0 is the neutral (black and grey) variant.
const ACCENTS = ["#000000", "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

function mix(hex: string, toward: string, t: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(toward.slice(i, i + 2), 16));
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

interface Palette {
  family: "Light" | "Medium" | "Dark";
  accent: string;
}
export function stylePalette(style: string | undefined): Palette | null {
  if (style === "") return null;
  const m = /^TableStyle(Light|Medium|Dark)(\d+)$/i.exec(style ?? "TableStyleMedium2");
  if (!m) return { family: "Medium", accent: ACCENTS[1] };
  const family = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as Palette["family"];
  const n = Number(m[2]);
  return { family, accent: ACCENTS[(n - 1) % 7] };
}

/** Styles offered in the gallery: each family in each accent, the way Excel's gallery is laid out. */
export const TABLE_STYLES: string[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `TableStyleLight${n + 7}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `TableStyleLight${n}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `TableStyleMedium${n}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `TableStyleMedium${n + 14}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `TableStyleDark${n}`),
];

export interface TableLook {
  bg?: string;
  color?: string;
  bold?: boolean;
  border?: { t?: Border; b?: Border };
}

/**
 * How a cell inside a table is drawn by the table's style. Formatting set on the cell itself wins.
 * Light 1–7 have lines and no header fill; Light 8–14 fill the header; Medium bands rows in a tint
 * of the accent; Dark uses the accent for everything.
 */
export function tableLook(t: SheetTable, r: number, c: number): TableLook | null {
  const p = stylePalette(t.style);
  if (!p) return null;
  const n = Number(/(\d+)$/.exec(t.style ?? "TableStyleMedium2")?.[1] ?? 2);
  const header = t.header !== false && r === t.r1;
  const total = !!t.totals && r === t.r2;
  const dataIdx = r - t.r1 - (t.header === false ? 0 : 1);
  const colIdx = c - t.c1;
  const neutral = p.accent === "#000000";
  const accent = neutral ? (p.family === "Dark" ? "#404040" : "#000000") : p.accent;
  const tint = neutral ? "#d9d9d9" : mix(p.accent, "#ffffff", 0.8);
  const band = (t.bandRows !== false && dataIdx % 2 === 0) || (!!t.bandCols && colIdx % 2 === 0);
  const line = (color: string, style = "thin"): Border => ({ color, style });
  const edge = (t.firstCol && c === t.c1) || (t.lastCol && c === t.c2);
  if (p.family === "Dark") {
    if (header) return { bg: "#000000", color: "#ffffff", bold: true, border: { b: line("#ffffff", "medium") } };
    if (total) return { bg: mix(accent, "#000000", 0.5), color: "#ffffff", bold: true, border: { t: line("#ffffff", "medium") } };
    return { bg: band ? mix(accent, "#000000", 0.25) : accent, color: "#ffffff", bold: edge || undefined };
  }
  if (p.family === "Medium") {
    const wide = n >= 15;
    if (header) return { bg: wide ? mix(accent, "#000000", 0.25) : accent, color: "#ffffff", bold: true };
    if (total) return { bold: true, bg: wide ? tint : undefined, border: { t: line(accent, "double") } };
    return { bg: band ? tint : undefined, bold: edge || undefined, border: wide ? { b: line("#ffffff") } : undefined };
  }
  // Light
  const filledHeader = n >= 8 && n <= 14;
  if (header) return filledHeader ? { bg: accent, color: "#ffffff", bold: true } : { bold: true, color: neutral ? undefined : mix(accent, "#000000", 0.25), border: { b: line(accent) } };
  if (total) return { bold: true, border: { t: line(accent, "double") } };
  return { bg: band ? tint : undefined, bold: edge || undefined, border: n <= 7 && r === t.r2 ? { b: line(accent) } : undefined };
}

// ---- Finding tables ---------------------------------------------------------------------------------------

export const tableAt = (s: Sheet, r: number, c: number) => s.tables?.find((t) => r >= t.r1 && r <= t.r2 && c >= t.c1 && c <= t.c2);
export const dataRows = (t: SheetTable) => ({ d1: t.header === false ? t.r1 : t.r1 + 1, d2: t.totals ? t.r2 - 1 : t.r2 });
const overlaps = (a: { r1: number; c1: number; r2: number; c2: number }, b: typeof a) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

export function allTableNames(data: SheetsData) {
  return data.sheets.flatMap((s) => (s.tables ?? []).map((t) => t.name));
}
export function nextTableName(data: SheetsData, base = "Table") {
  const used = new Set(allTableNames(data).map((n) => n.toUpperCase()));
  let i = 1;
  while (used.has(`${base}${i}`.toUpperCase())) i++;
  return `${base}${i}`;
}
/** Why a name can't be used for a table, or null when it can. */
export function badTableName(data: SheetsData, name: string, self?: string) {
  if (!/^[A-Za-z_\\][\w.]*$/.test(name)) return "Start with a letter and use only letters, numbers, dots and underscores.";
  if (/^[A-Z]{1,3}\d+$/i.test(name) || /^R\d*C\d*$/i.test(name)) return "That looks like a cell reference.";
  const clash = allTableNames(data).some((n) => n.toUpperCase() === name.toUpperCase() && n !== self) || Object.keys(data.names ?? {}).some((n) => n.toUpperCase() === name.toUpperCase());
  return clash ? "Another table or named range already uses that name." : null;
}

/** Header names, raw, as typed in the header row. */
export const headerTexts = (s: Sheet, t: SheetTable) => Array.from({ length: t.c2 - t.c1 + 1 }, (_, j) => (t.header === false ? `Column${j + 1}` : (s.cells[t.r1]?.[t.c1 + j] ?? "").replace(/^'/, "")));

// ---- Creating ------------------------------------------------------------------------------------------------

/** Make a table over `box`. Without headers, a header row is inserted above the data. */
export function createTable(data: SheetsData, si: number, box: { r1: number; c1: number; r2: number; c2: number }, hasHeader: boolean): SheetsData | string {
  const s0 = data.sheets[si];
  if ((s0.tables ?? []).some((t) => overlaps(t, box))) return "A table can't overlap another table.";
  if ((s0.merges ?? []).some((m) => overlaps(m, box))) return "Unmerge the cells first: tables can't contain merged cells.";
  let d = data;
  let b = { ...box };
  if (!hasHeader) {
    d = shiftAxis(d, si, "row", b.r1, 1);
    b = { ...b, r2: b.r2 + 1 };
  }
  const s = { ...d.sheets[si], cells: d.sheets[si].cells.map((r) => r.slice()) };
  // Every column needs a distinct, non-empty name.
  const seen = new Set<string>();
  for (let c = b.c1; c <= b.c2; c++) {
    let name = (s.cells[b.r1]?.[c] ?? "").trim();
    if (!name || name.startsWith("=")) name = `Column${c - b.c1 + 1}`;
    let unique = name, i = 2;
    while (seen.has(unique.toUpperCase())) unique = `${name}${i++}`;
    seen.add(unique.toUpperCase());
    while (s.cells.length <= b.r1) s.cells.push([]);
    s.cells[b.r1][c] = unique;
  }
  if (b.r2 === b.r1) b.r2++; // At least one data row.
  const t: SheetTable = { name: nextTableName(d), ...b, style: "TableStyleMedium2" };
  s.tables = [...(s.tables ?? []), t];
  return { ...d, sheets: d.sheets.map((x, i) => (i === si ? s : x)) };
}

// ---- Totals ------------------------------------------------------------------------------------------------------

export const TOTAL_FNS: { label: string; code: number }[] = [
  { label: "None", code: 0 },
  { label: "Sum", code: 109 },
  { label: "Average", code: 101 },
  { label: "Count", code: 103 },
  { label: "Count numbers", code: 102 },
  { label: "Max", code: 104 },
  { label: "Min", code: 105 },
  { label: "Std dev", code: 107 },
  { label: "Var", code: 110 },
];
export const totalFormula = (t: SheetTable, column: string, code: number) => (code ? `=SUBTOTAL(${code},${t.name}[${escapeColumn(column)}])` : "");
/** Which total function a total-row cell uses, if it's one of the standard ones. */
export const totalCode = (raw: string) => Number(/^=SUBTOTAL\((\d+),/i.exec(raw)?.[1] ?? 0);

/** Turn the total row on or off. On adds a row under the data with "Total" and a sum of the last column. */
export function setTotals(data: SheetsData, si: number, name: string, on: boolean): SheetsData {
  const s = data.sheets[si];
  const t = s.tables?.find((x) => x.name === name);
  if (!t || !!t.totals === on) return data;
  let d = data;
  if (on) {
    const row = t.r2 + 1;
    // Make room if something is directly underneath.
    const busy = Array.from({ length: t.c2 - t.c1 + 1 }, (_, j) => s.cells[row]?.[t.c1 + j]).some(Boolean);
    if (busy) d = shiftAxis(d, si, "row", row, 1);
    const s2 = d.sheets[si];
    const heads = headerTexts(s2, t);
    const cells = s2.cells.map((r) => r.slice());
    while (cells.length <= row) cells.push([]);
    cells[row][t.c1] = "Total";
    const last = t.c2 - t.c1;
    if (last > 0) cells[row][t.c2] = totalFormula(t, heads[last], 109);
    const tables = (s2.tables ?? []).map((x) => (x.name === name ? { ...x, r2: row, totals: true } : x));
    return { ...d, sheets: d.sheets.map((x, i) => (i === si ? { ...s2, cells, tables } : x)) };
  }
  // Off: the total row's cells are cleared and the table ends at the data.
  const cells = s.cells.map((r, i) => (i === t.r2 ? r.map((v, c) => (c >= t.c1 && c <= t.c2 ? "" : v)) : r));
  const tables = (s.tables ?? []).map((x) => (x.name === name ? { ...x, r2: t.r2 - 1, totals: false } : x));
  return { ...d, sheets: d.sheets.map((x, i) => (i === si ? { ...s, cells, tables } : x)) };
}

// ---- Formulas that mention tables ---------------------------------------------------------------------------------

const SREF = /(^|[^\w.])([A-Za-z_\\][\w.]*)?\[((?:[^[\]']|'.|\[(?:[^[\]']|'.)*\])*)\]/g;

/** Rewrite every structured reference in a formula: `fn(table, spec)` returns the new "Table[spec]" text, or null to keep it. */
export function rewriteStructured(formula: string, fn: (table: string, spec: string) => string | null): string {
  if (!formula.startsWith("=")) return formula;
  return formula
    .split(/("(?:[^"]|"")*")/)
    .map((part) => (part.startsWith('"') ? part : part.replace(SREF, (m, pre: string, table: string | undefined, spec: string) => {
      const out = fn(table ?? "", spec);
      return out === null ? m : pre + out;
    })))
    .join("");
}

const forEachFormula = (data: SheetsData, fn: (f: string, si: number, r: number, c: number) => string): SheetsData => ({
  ...data,
  sheets: data.sheets.map((s, si) => ({ ...s, cells: s.cells.map((row, r) => row?.map((v, c) => (v?.startsWith("=") ? fn(v, si, r, c) : v)) ?? []) })),
});

/** Which table an unnamed [@Col] in cell (si, r, c) belongs to. */
const tableNameAt = (data: SheetsData, si: number, r: number, c: number) => tableAt(data.sheets[si], r, c)?.name ?? "";

export function renameTable(data: SheetsData, from: string, to: string): SheetsData {
  const d = forEachFormula(data, (f) =>
    rewriteStructured(f, (table, spec) => (table.toUpperCase() === from.toUpperCase() ? `${to}[${spec}]` : null))
      // The table's name on its own, e.g. =ROWS(Table1).
      .replace(new RegExp(`(^|[^\\w.\\[])${from.replace(/[.\\]/g, "\\$&")}(?![\\w.\\[(])`, "gi"), `$1${to}`),
  );
  return { ...d, sheets: d.sheets.map((s) => (s.tables?.some((t) => t.name === from) ? { ...s, tables: s.tables.map((t) => (t.name === from ? { ...t, name: to } : t)) } : s)) };
}

/** A column header changed: formulas that named the old column now name the new one. */
export function renameColumn(data: SheetsData, table: string, from: string, to: string): SheetsData {
  if (!from || from === to) return data;
  const esc = escapeColumn(to);
  const swap = (spec: string) => {
    let out = spec.replace(/\[((?:[^[\]']|'.)*)\]/g, (m, inner: string) => (inner.replace(/'(.)/g, "$1").trim().toUpperCase() === from.toUpperCase() ? `[${esc}]` : m));
    const bare = out.trim().replace(/^@/, "").trim();
    if (!bare.startsWith("[") && bare.replace(/'(.)/g, "$1").toUpperCase() === from.toUpperCase()) out = (out.trim().startsWith("@") ? "@" : "") + esc;
    return out;
  };
  return forEachFormula(data, (f, si, r, c) =>
    rewriteStructured(f, (t, spec) => {
      const name = t || tableNameAt(data, si, r, c);
      if (name.toUpperCase() !== table.toUpperCase()) return null;
      const next = swap(spec);
      return next === spec ? null : `${t}[${next}]`;
    }),
  );
}

/** Formulas pointing into the table with structured references get plain A1 references instead. */
function structuredToA1(data: SheetsData, si: number, t: SheetTable): SheetsData {
  const heads = headerTexts(data.sheets[si], t);
  const sheetName = data.sheets[si].name;
  return forEachFormula(data, (f, fsi, r, c) =>
    rewriteStructured(f, (table, spec) => {
      const name = table || tableNameAt(data, fsi, r, c);
      if (name.toUpperCase() !== t.name.toUpperCase()) return null;
      const b = resolveStructured(t, spec, heads, fsi === si ? r : -1);
      if (b instanceof FErr) return "#REF!";
      const pre = fsi === si ? "" : (/^[A-Za-z_]\w*$/.test(sheetName) ? sheetName : `'${sheetName.replace(/'/g, "''")}'`) + "!";
      const abs = (txt: string) => (b.thisRow ? txt : txt.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2"));
      return pre + abs(rangeText(b.r1, b.c1, b.r2, b.c2));
    }),
  );
}

/** Remove the table but keep its look as ordinary cell formatting, and its formulas working. */
export function convertToRange(data: SheetsData, si: number, name: string): SheetsData {
  const t = data.sheets[si].tables?.find((x) => x.name === name);
  if (!t) return data;
  const d = structuredToA1(data, si, t);
  const s = d.sheets[si];
  const fmt = { ...(s.fmt ?? {}) };
  for (let r = t.r1; r <= t.r2; r++)
    for (let c = t.c1; c <= t.c2; c++) {
      const look = tableLook(t, r, c);
      if (!look) continue;
      const cur: CellFmt = { ...(fmt[key(r, c)] ?? {}) };
      if (look.bg && !cur.bg) cur.bg = look.bg;
      if (look.color && !cur.color) cur.color = look.color;
      if (look.bold && cur.bold === undefined) cur.bold = true;
      if (look.border && !cur.border) cur.border = { t: look.border.t, b: look.border.b };
      if (Object.keys(cur).length) fmt[key(r, c)] = cur;
    }
  return { ...d, sheets: d.sheets.map((x, i) => (i === si ? { ...s, fmt, tables: (s.tables ?? []).filter((x2) => x2.name !== name) } : x)) };
}

/** Move a table to a new range (the Resize table command). */
export function resizeTable(data: SheetsData, si: number, name: string, range: string): SheetsData | string {
  const b = parseRange(range);
  if (!b) return "Type a range like A1:D20.";
  const s = data.sheets[si];
  const t = s.tables?.find((x) => x.name === name);
  if (!t) return data;
  if (b.r1 !== t.r1) return "The header row has to stay where it is.";
  if ((s.tables ?? []).some((x) => x.name !== name && overlaps(x, b))) return "A table can't overlap another table.";
  const cells = s.cells.map((r) => r.slice());
  for (let c = b.c1; c <= b.c2; c++) if (t.header !== false && !(cells[b.r1]?.[c] ?? "").trim()) (cells[b.r1] ??= [])[c] = `Column${c - b.c1 + 1}`;
  const tables = (s.tables ?? []).map((x) => (x.name === name ? { ...x, ...b, totals: x.totals && b.r2 === t.r2 ? true : false } : x));
  return { ...data, sheets: data.sheets.map((x, i) => (i === si ? { ...s, cells, tables } : x)) };
}

// ---- Typing next to and inside a table ------------------------------------------------------------------------------

/**
 * After cell (r, c) changed from `old` to `value`: grow a table the cell touches, fill a new
 * calculated column, and follow a renamed column into formulas.
 */
export function afterEdit(data: SheetsData, si: number, r: number, c: number, value: string, old: string): SheetsData {
  let s = data.sheets[si];
  const tables = s.tables ?? [];
  if (!tables.length) return data;
  let d = data;
  const put = (sh: Sheet) => {
    s = sh;
    d = { ...d, sheets: d.sheets.map((x, i) => (i === si ? sh : x)) };
  };
  const inside = tableAt(s, r, c);
  if (inside) {
    const t = inside;
    // Header renamed.
    if (t.header !== false && r === t.r1 && value !== old) {
      let name = value.trim();
      if (!name) {
        name = `Column${c - t.c1 + 1}`;
        const cells = s.cells.map((row) => row.slice());
        cells[r][c] = name;
        put({ ...s, cells });
      }
      d = renameColumn(d, t.name, old, name);
      return d;
    }
    // A formula typed into an otherwise empty column fills the whole column.
    const { d1, d2 } = dataRows(t);
    if (value.startsWith("=") && r >= d1 && r <= d2 && !old) {
      const others = Array.from({ length: d2 - d1 + 1 }, (_, i) => d1 + i).filter((x) => x !== r);
      if (others.length && others.every((x) => !(s.cells[x]?.[c] ?? ""))) {
        const cells = s.cells.map((row) => row.slice());
        for (const x of others) {
          while (cells.length <= x) cells.push([]);
          cells[x][c] = moveFormula(value, x - r, 0);
        }
        put({ ...s, cells });
      }
    }
    return d;
  }
  if (!value) return d;
  // Typed directly under the last data row: the table grows by a row.
  const below = tables.find((t) => !t.totals && r === t.r2 + 1 && c >= t.c1 && c <= t.c2);
  if (below) {
    const t = below;
    const cells = s.cells.map((row) => row.slice());
    const fmt = { ...(s.fmt ?? {}) };
    for (let cc = t.c1; cc <= t.c2; cc++) {
      const prev = cells[t.r2]?.[cc] ?? "";
      // Calculated columns carry on into the new row.
      if (cc !== c && prev.startsWith("=") && !(cells[r]?.[cc] ?? "")) {
        while (cells.length <= r) cells.push([]);
        cells[r][cc] = moveFormula(prev, 1, 0);
      }
      const pf = fmt[key(t.r2, cc)];
      if (pf && !fmt[key(r, cc)]) fmt[key(r, cc)] = pf;
    }
    put({ ...s, cells, fmt, tables: tables.map((x) => (x === t ? { ...x, r2: r } : x)) });
    return d;
  }
  // Typed directly right of the table: it grows by a column.
  const right = tables.find((t) => c === t.c2 + 1 && r >= t.r1 && r <= t.r2);
  if (right) {
    const t = right;
    const cells = s.cells.map((row) => row.slice());
    if (t.header !== false && r !== t.r1 && !(cells[t.r1]?.[c] ?? "")) {
      const heads = new Set(headerTexts(s, t).map((h) => h.toUpperCase()));
      let n = t.c2 - t.c1 + 2;
      while (heads.has(`COLUMN${n}`)) n++;
      (cells[t.r1] ??= [])[c] = `Column${n}`;
    }
    put({ ...s, cells, tables: tables.map((x) => (x === t ? { ...x, c2: c } : x)) });
  }
  return d;
}

/** Shift tables and pivot anchors with inserted or deleted rows and columns on their sheet. */
export function shiftTables(s: Sheet, axis: "row" | "col", at: number, count: number): Pick<Sheet, "tables" | "pivots"> {
  const map = (i: number) => (count > 0 ? (i >= at ? i + count : i) : i < at ? i : i < at - count ? at : i + count);
  const tables = s.tables
    ?.map((t) => {
      const [a, b] = axis === "row" ? [t.r1, t.r2] : [t.c1, t.c2];
      let na = map(a), nb = count < 0 && b >= at && b < at - count ? at - 1 : map(b);
      if (count > 0 && a >= at) na = a + count;
      if (nb < na) return null;
      // Deleting the header row removes the table.
      if (count < 0 && axis === "row" && t.header !== false && t.r1 >= at && t.r1 < at - count) return null;
      return axis === "row" ? { ...t, r1: na, r2: nb } : { ...t, c1: na, c2: nb };
    })
    .filter((t): t is SheetTable => !!t);
  const pivots = s.pivots?.map((p) => (axis === "row" ? { ...p, r: map(p.r) } : { ...p, c: map(p.c) }));
  return { tables, pivots };
}

export const columnLetter = colName;
