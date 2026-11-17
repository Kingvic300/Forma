// Pivot tables: read a source range or table, group its rows by the row and column fields,
// aggregate the value fields, and lay the result out as cells (tabular form, like Excel's
// "Show in tabular form") with subtotals and grand totals.
import { Book, FErr, parseRange, str, type Val } from "./formula";
import { fromSerial, isDateFormat } from "./format";
import { dataRows } from "./tables";
import type { CellFmt, Pivot, PivotFn, PivotGroup, PivotShow, SheetsData } from "./types";
import { key } from "./types";

export const FN_LABEL: Record<PivotFn, string> = {
  sum: "Sum",
  count: "Count",
  countNums: "Count numbers",
  average: "Average",
  min: "Min",
  max: "Max",
  distinct: "Distinct count",
  product: "Product",
  stdev: "StdDev",
  var: "Var",
};
export const SHOW_LABEL: Record<PivotShow, string> = {
  none: "No calculation",
  pctTotal: "% of grand total",
  pctRow: "% of row total",
  pctCol: "% of column total",
  running: "Running total",
};
export const valueLabel = (v: { field: string; fn: PivotFn }) => `${FN_LABEL[v.fn]} of ${v.field}`;

export interface PivotSource {
  fields: string[];
  rows: (Val | FErr)[][];
  /** Fields whose values are dates (from the source's number formats). */
  dates: Set<string>;
  numeric: Set<string>;
  /** Number format of each field's first data cell, reused for sums and averages. */
  formats: Record<string, string | undefined>;
}

/** Read a pivot's source: a table name, or a range whose first row names the fields. */
export function readSource(data: SheetsData, book: Book, source: string, here: number): PivotSource | string {
  let si = here, r1: number, c1: number, r2: number, c2: number;
  const table = book.findTable(source);
  if (table) {
    si = table.s;
    const { d2 } = dataRows(table.t);
    ({ r1, c1, c2 } = table.t);
    r2 = d2;
    if (table.t.header === false) return "The source table needs a header row.";
  } else {
    const sheetName = /^'?((?:[^'!]|'')+)'?!/.exec(source)?.[1]?.replace(/''/g, "'");
    if (sheetName) {
      si = data.sheets.findIndex((s) => s.name.toLowerCase() === sheetName.toLowerCase());
      if (si < 0) return `There's no sheet called “${sheetName}”.`;
    }
    const b = parseRange(source.replace(/^.*!/, "").replace(/\$/g, ""));
    if (!b) return "The source should be a range like Sheet1!A1:D40, or a table name.";
    ({ r1, c1, r2, c2 } = b);
    r2 = Math.min(r2, Math.max(r1, book.used(si).rows - 1));
    c2 = Math.min(c2, Math.max(c1, book.used(si).cols - 1));
  }
  if (r2 <= r1) return "The source needs a header row and at least one row of data.";
  const fields: string[] = [];
  const seen = new Map<string, number>();
  for (let c = c1; c <= c2; c++) {
    const v = book.value(si, r1, c);
    let name = v instanceof FErr ? "" : str(v).trim();
    if (!name) name = `Column${c - c1 + 1}`;
    const n = seen.get(name.toUpperCase()) ?? 0;
    seen.set(name.toUpperCase(), n + 1);
    fields.push(n ? `${name}${n + 1}` : name);
  }
  const rows: (Val | FErr)[][] = [];
  for (let r = r1 + 1; r <= r2; r++) {
    const row = fields.map((_, j) => book.value(si, r, c1 + j));
    if (row.every((v) => v === "")) continue;
    rows.push(row);
  }
  const sheet = data.sheets[si];
  const dates = new Set<string>(), numeric = new Set<string>();
  const formats: Record<string, string | undefined> = {};
  fields.forEach((f, j) => {
    const vals = rows.map((r) => r[j]).filter((v) => v !== "");
    if (vals.length && vals.every((v) => typeof v === "number")) numeric.add(f);
    const fm = sheet.fmt?.[key(r1 + 1, c1 + j)]?.num;
    formats[f] = fm;
    const typed = sheet.cells[r1 + 1]?.[c1 + j] ?? "";
    if (numeric.has(f) && ((fm && isDateFormat(fm)) || /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(typed))) dates.add(f);
  });
  return { fields, rows, dates, numeric, formats };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A value's label and sort key once grouped. */
function groupOf(v: Val | FErr, g: PivotGroup | undefined, isDate: boolean): { label: string; sort: number | string } {
  if (v instanceof FErr) return { label: v.code, sort: "￿" + v.code };
  if (v === "") return { label: "(blank)", sort: "￿￿" };
  if (typeof v === "number" && g !== undefined) {
    if (typeof g === "number" && g > 0) {
      const lo = Math.floor(v / g) * g;
      const hi = Number((lo + g).toPrecision(12));
      return { label: `${Number(lo.toPrecision(12))}–${hi}`, sort: lo };
    }
    if (isDate) {
      const d = fromSerial(v);
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      switch (g) {
        case "year": return { label: String(y), sort: y };
        case "quarter": return { label: `${y} Q${Math.floor(m / 3) + 1}`, sort: y * 10 + Math.floor(m / 3) };
        case "month": return { label: `${MONTHS[m]} ${y}`, sort: y * 100 + m };
        case "day": return { label: `${y}-${String(m + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`, sort: Math.floor(v) };
      }
    }
  }
  if (typeof v === "number" && isDate) {
    const d = fromSerial(v);
    return { label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`, sort: v };
  }
  if (typeof v === "number") return { label: String(Number(v.toPrecision(15))), sort: v };
  if (typeof v === "boolean") return { label: v ? "TRUE" : "FALSE", sort: v ? "TRUE" : "FALSE" };
  return { label: v, sort: v.toLowerCase() };
}

/** Every distinct (grouped) label of a field, in order, for filter lists. */
export function fieldItems(src: PivotSource, field: string, g?: PivotGroup): string[] {
  const j = src.fields.indexOf(field);
  if (j < 0) return [];
  const map = new Map<string, number | string>();
  for (const row of src.rows) {
    const k = groupOf(row[j], g, src.dates.has(field));
    map.set(k.label, k.sort);
  }
  return [...map.entries()].sort((a, b) => cmp(a[1], b[1])).map(([l]) => l);
}

const cmp = (a: number | string, b: number | string) =>
  typeof a === "number" && typeof b === "number" ? a - b : typeof a === "number" ? -1 : typeof b === "number" ? 1 : a.localeCompare(b, undefined, { numeric: true });

function aggregate(fn: PivotFn, vals: (Val | FErr)[]): number | FErr {
  const nums = vals.filter((v): v is number => typeof v === "number");
  const err = vals.find((v): v is FErr => v instanceof FErr);
  if (err && fn !== "count" && fn !== "distinct") return err;
  switch (fn) {
    case "count": return vals.filter((v) => v !== "").length;
    case "countNums": return nums.length;
    case "distinct": return new Set(vals.filter((v) => v !== "").map((v) => (v instanceof FErr ? v.code : String(v)))).size;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "product": return nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
    case "average": return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : new FErr("#DIV/0!");
    case "min": return nums.length ? Math.min(...nums) : 0;
    case "max": return nums.length ? Math.max(...nums) : 0;
    case "stdev":
    case "var": {
      if (nums.length < 2) return new FErr("#DIV/0!");
      const m = nums.reduce((a, b) => a + b, 0) / nums.length;
      const v = nums.reduce((a, b) => a + (b - m) ** 2, 0) / (nums.length - 1);
      return fn === "var" ? v : Math.sqrt(v);
    }
  }
}

export interface PivotOutput {
  cells: string[][];
  fmt: Record<string, CellFmt>;
}

const HEADER: CellFmt = { bold: true, bg: "#dde5f3", border: { b: { color: "#8ea9db", style: "thin" } } };
const SUBTOTAL: CellFmt = { bold: true, bg: "#f2f5fb" };
const GRAND: CellFmt = { bold: true, bg: "#dde5f3", border: { t: { color: "#8ea9db", style: "thin" } } };

/** Lay out a pivot table. Cells are relative to its top-left corner. */
export function computePivot(src: PivotSource, p: Pivot): PivotOutput {
  const cells: string[][] = [];
  const fmt: Record<string, CellFmt> = {};
  const set = (r: number, c: number, v: string, f?: CellFmt) => {
    (cells[r] ??= [])[c] = v;
    if (f) fmt[key(r, c)] = { ...(fmt[key(r, c)] ?? {}), ...f };
  };
  const idx = (f: string) => src.fields.indexOf(f);
  const rowF = p.rows.filter((f) => idx(f) >= 0);
  const colF = p.cols.filter((f) => idx(f) >= 0);
  const vals = p.values.filter((v) => idx(v.field) >= 0);
  if (!rowF.length && !colF.length && !vals.length) {
    set(0, 0, "PivotTable: choose fields in the panel on the right", { italic: true, color: "#666666" });
    return { cells, fmt };
  }
  const grp = (f: string, v: Val | FErr) => groupOf(v, p.group?.[f], src.dates.has(f));
  // Filtered rows.
  const hidden = p.filters.map((fl) => ({ j: idx(fl.field), field: fl.field, hide: new Set(fl.hidden) })).filter((x) => x.j >= 0 && x.hide.size);
  const rows = src.rows.filter((row) => hidden.every((h) => !h.hide.has(grp(h.field, row[h.j]).label)));

  // Keys: tuples of group labels, with sort keys.
  type K = { labels: string[]; sorts: (number | string)[] };
  const rowKeys = new Map<string, K>(), colKeys = new Map<string, K>();
  const buckets = new Map<string, (Val | FErr)[][]>(); // `${rk}\u0001${ck}` → per value field list
  const keyOf = (fs: string[], row: (Val | FErr)[]) => {
    const g = fs.map((f) => grp(f, row[idx(f)]));
    return { id: g.map((x) => x.label).join("\u0002"), k: { labels: g.map((x) => x.label), sorts: g.map((x) => x.sort) } };
  };
  const add = (rk: string, ck: string, row: (Val | FErr)[]) => {
    const id = `${rk}\u0001${ck}`;
    let b = buckets.get(id);
    if (!b) buckets.set(id, (b = vals.map(() => [])));
    vals.forEach((v, i) => b![i].push(row[idx(v.field)]));
  };
  for (const row of rows) {
    const rk = keyOf(rowF, row), ck = keyOf(colF, row);
    rowKeys.set(rk.id, rk.k);
    colKeys.set(ck.id, ck.k);
    // Every prefix of the row key (for subtotals) and the totals.
    for (let n = 0; n <= rowF.length; n++) {
      const rp = rk.k.labels.slice(0, n).join("\u0002") + (n < rowF.length ? `\u0003${n}` : "");
      add(rp, ck.id, row);
      add(rp, "\u0004", row);
    }
  }
  const leafKey = (labels: string[]) => labels.join("\u0002");
  const prefixKey = (labels: string[], n: number) => labels.slice(0, n).join("\u0002") + (n < rowF.length ? `\u0003${n}` : "");
  const value = (rk: string, ck: string, i: number): number | FErr | "" => {
    const b = buckets.get(`${rk}\u0001${ck}`);
    if (!b) return "";
    return aggregate(vals[i].fn, b[i]);
  };

  // Order of rows and columns.
  const sortKeys = (m: Map<string, K>, byValue?: (id: string) => number) =>
    [...m.entries()].sort((a, b) => {
      for (let i = 0; i < a[1].sorts.length; i++) {
        // Outer levels by label (or by their subtotal when sorting by value), inner likewise.
        const byV = byValue && i === a[1].sorts.length - 1;
        const d = byV ? byValue(b[0]) - byValue(a[0]) : cmp(a[1].sorts[i], b[1].sorts[i]);
        if (d) return (byV && p.sort === "valueAsc") || (!byV && p.sort === "desc") ? -d : d;
      }
      return 0;
    });
  const byVal = p.sort === "valueDesc" || p.sort === "valueAsc" ? (id: string) => {
    const v = value(id, "\u0004", 0);
    return typeof v === "number" ? v : -Infinity;
  } : undefined;
  const rowList = sortKeys(rowKeys, byVal);
  const colList = sortKeys(colKeys);
  const nV = Math.max(1, vals.length);
  const grandCols = p.grandCols !== false && colF.length > 0;
  const grandRows = p.grandRows !== false;
  const subtotals = p.subtotals !== false && rowF.length > 1;

  // Header rows.
  const left = Math.max(1, rowF.length);
  const headRows = colF.length ? 2 : 1;
  const colStart = left;
  const colPos = new Map<string, number>();
  colList.forEach(([id], i) => colPos.set(id, colStart + i * nV));
  const grandCol = colStart + colList.length * nV;
  const vl = (i: number) => (vals[i] ? valueLabel(vals[i]) + (vals[i].show && vals[i].show !== "none" ? ` (${SHOW_LABEL[vals[i].show!]})` : "") : "");
  if (colF.length) {
    set(0, 0, nV === 1 && vals.length ? vl(0) : vals.length ? "Values" : "", HEADER);
    for (let c = 1; c < grandCol + (grandCols ? nV : 0); c++) set(0, c, "", HEADER);
    // One value field: the top row names the column fields; several: it names each column group.
    if (nV === 1) set(0, colStart, colF.join(" · "), HEADER);
    else {
      colList.forEach(([id, k]) => set(0, colPos.get(id)!, k.labels.join(" · "), HEADER));
      if (grandCols) set(0, grandCol, "Grand Total", HEADER);
    }
    rowF.forEach((f, i) => set(1, i, f, HEADER));
    if (!rowF.length) set(1, 0, "", HEADER);
    colList.forEach(([id, k]) => vals.forEach((_, i) => set(1, colPos.get(id)! + i, nV === 1 ? k.labels.join(" · ") : vl(i), { ...HEADER, align: "right" })));
    if (!vals.length) colList.forEach(([id, k]) => set(1, colPos.get(id)!, k.labels.join(" · "), HEADER));
    if (grandCols) vals.forEach((_, i) => set(1, grandCol + i, nV === 1 ? "Grand Total" : `Total ${vl(i)}`, { ...HEADER, align: "right" }));
  } else {
    rowF.forEach((f, i) => set(0, i, f, HEADER));
    if (!rowF.length) set(0, 0, "", HEADER);
    vals.forEach((_, i) => set(0, colStart + i, vl(i), { ...HEADER, align: "right" }));
  }

  // Number formats for values.
  const numFmt = (i: number): string | undefined => {
    const v = vals[i];
    if (v.show && v.show !== "none" && v.show !== "running") return "0.00%";
    if (v.fn === "count" || v.fn === "countNums" || v.fn === "distinct") return "#,##0";
    const f = src.formats[v.field];
    if (f && !isDateFormat(f)) return f;
    if (v.fn === "average" || v.fn === "stdev" || v.fn === "var") return "#,##0.00";
    return undefined;
  };
  const grandTotal = vals.map((_, i) => value(prefixKey([], 0), "\u0004", i));
  const show = (i: number, v: number | FErr | "", rk: string, ck: string): string => {
    if (v === "" || v instanceof FErr) return v instanceof FErr ? v.code : "";
    const s = vals[i].show ?? "none";
    const div = (d: number | FErr | "") => (typeof d === "number" && d !== 0 ? String(v / d) : "#DIV/0!");
    switch (s) {
      case "pctTotal": return div(grandTotal[i]);
      case "pctRow": return div(value(rk, "\u0004", i));
      case "pctCol": return div(value(prefixKey([], 0), ck, i));
      default: return String(Number(v.toPrecision(15)));
    }
  };
  const running = vals.map(() => new Map<string, number>());

  let r = headRows;
  const writeRow = (rk: string, labels: string[], depth: number, style?: CellFmt, leaf = false) => {
    for (let i = 0; i < left; i++) set(r, i, "", style);
    if (style === GRAND) set(r, 0, "Grand Total", style);
    else if (!leaf) set(r, depth, `${labels[depth]} Total`, style);
    else labels.forEach((l, i) => set(r, i, l, style));
    const cols: [string, number][] = colF.length ? colList.map(([id]) => [id, colPos.get(id)!]) : [["\u0004", colStart]];
    for (const [ck, pos] of cols)
      vals.forEach((v, i) => {
        let cell = show(i, value(rk, ck, i), rk, ck);
        if (leaf && v.show === "running") {
          const raw = value(rk, ck, i);
          const acc = (running[i].get(ck) ?? 0) + (typeof raw === "number" ? raw : 0);
          running[i].set(ck, acc);
          cell = String(Number(acc.toPrecision(15)));
        }
        set(r, pos + i, cell, { ...style, num: numFmt(i) });
      });
    if (grandCols) vals.forEach((_, i) => set(r, grandCol + i, show(i, value(rk, "\u0004", i), rk, "\u0004"), { ...style, bold: true, num: numFmt(i) }));
    r++;
  };

  if (rowF.length) {
    let prev: string[] = [];
    rowList.forEach(([, k], n) => {
      // Close subtotal groups that end before this row.
      if (subtotals && n > 0) {
        for (let d = rowF.length - 2; d >= 0; d--) {
          if (prev.slice(0, d + 1).join("\u0002") !== k.labels.slice(0, d + 1).join("\u0002")) writeRow(prefixKey(prev, d + 1), prev, d, SUBTOTAL);
        }
      }
      // Repeat outer labels only when they change.
      const start = r;
      writeRow(leafKey(k.labels), k.labels, rowF.length - 1, undefined, true);
      k.labels.forEach((_, d) => {
        if (d < rowF.length - 1 && prev.slice(0, d + 1).join("\u0002") === k.labels.slice(0, d + 1).join("\u0002")) set(start, d, "");
      });
      prev = k.labels;
    });
    if (subtotals && prev.length) for (let d = rowF.length - 2; d >= 0; d--) writeRow(prefixKey(prev, d + 1), prev, d, SUBTOTAL);
  }
  if (grandRows || !rowF.length) writeRow(prefixKey([], 0), [], 0, GRAND);
  // Make the grid rectangular.
  const width = Math.max(...cells.map((x) => x?.length ?? 0));
  for (let i = 0; i < cells.length; i++) cells[i] = Array.from({ length: width }, (_, j) => cells[i]?.[j] ?? "");
  return { cells, fmt };
}

/** Write a pivot's output into its sheet, clearing what the previous refresh wrote. */
export function refreshPivot(data: SheetsData, si: number, id: string): { data: SheetsData; error?: string } {
  const s = data.sheets[si];
  const p = s.pivots?.find((x) => x.id === id);
  if (!p) return { data };
  const book = new Book(data);
  const src = readSource(data, book, p.source, si);
  const out: PivotOutput = typeof src === "string" ? { cells: [[`PivotTable: ${src}`]], fmt: {} } : computePivot(src, p);
  const cells = s.cells.map((row) => row.slice());
  const fmt = { ...(s.fmt ?? {}) };
  const old = p.size ?? { rows: 0, cols: 0 };
  for (let r = 0; r < old.rows; r++)
    for (let c = 0; c < old.cols; c++) {
      if (cells[p.r + r]) cells[p.r + r][p.c + c] = "";
      delete fmt[key(p.r + r, p.c + c)];
    }
  out.cells.forEach((row, r) =>
    row.forEach((v, c) => {
      while (cells.length <= p.r + r) cells.push([]);
      cells[p.r + r][p.c + c] = v;
    }),
  );
  for (const [k, f] of Object.entries(out.fmt)) {
    const [r, c] = k.split(",").map(Number);
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as CellFmt;
    if (Object.keys(clean).length) fmt[key(p.r + r, p.c + c)] = clean;
  }
  const size = { rows: out.cells.length, cols: Math.max(0, ...out.cells.map((x) => x.length)) };
  // Widen narrow columns so labels fit (not for the "choose fields" placeholder).
  const colW = { ...(s.colW ?? {}) };
  const empty = !p.rows.length && !p.cols.length && !p.values.length;
  for (let c = 0; c < (empty || typeof src === "string" ? 0 : size.cols); c++) {
    const longest = Math.max(...out.cells.map((row) => (row[c] ?? "").length));
    const want = Math.min(280, Math.max(100, longest * 8.4 + 22));
    if ((colW[p.c + c] ?? 100) < want) colW[p.c + c] = Math.round(want);
  }
  const pivots = (s.pivots ?? []).map((x) => (x.id === id ? { ...x, size } : x));
  // Trim trailing empty rows.
  while (cells.length && cells[cells.length - 1].every((v) => !v)) cells.pop();
  return { data: { ...data, sheets: data.sheets.map((x, i) => (i === si ? { ...s, cells, fmt, colW, pivots } : x)) }, error: typeof src === "string" ? src : undefined };
}

/** Is (r, c) inside a pivot's last output? */
export const pivotAt = (s: { pivots?: Pivot[] }, r: number, c: number) => s.pivots?.find((p) => r >= p.r && c >= p.c && r < p.r + Math.max(1, p.size?.rows ?? 1) && c < p.c + Math.max(1, p.size?.cols ?? 1));

/** Labels of a field after grouping, for the filter checklist. */
export function pivotItems(data: SheetsData, si: number, p: Pivot, field: string): string[] {
  const src = readSource(data, new Book(data), p.source, si);
  return typeof src === "string" ? [] : fieldItems(src, field, p.group?.[field]);
}
