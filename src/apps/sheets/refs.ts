// Rewriting cell references inside formulas: when a formula is copied or filled (relative
// references move), when rows or columns are inserted or deleted (references follow their
// cells, or become #REF!), and when a sheet is renamed.
import { colIndex, colName } from "./formula";

export interface RefPart {
  sheet?: string;
  /** "cell" A1, "range" A1:B2, "cols" A:C, "rows" 1:3. */
  kind: "cell" | "range" | "cols" | "rows";
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  ar1: boolean;
  ac1: boolean;
  ar2: boolean;
  ac2: boolean;
}

const SHEET = `(?:('(?:[^']|'')+'|[A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*)!)?`;
const CELL = `(\\$?)([A-Z]{1,3})(\\$?)(\\d+)`;
const RE = new RegExp(
  `${SHEET}(?:${CELL}(?::${CELL})?|(\\$?)([A-Z]{1,3}):(\\$?)([A-Z]{1,3})|(\\$?)(\\d+):(\\$?)(\\d+))(?![\\w(!])`,
  "gi",
);

/** Apply `fn` to every reference in a formula, outside string literals. */
export function transformRefs(formula: string, fn: (ref: RefPart) => string | null): string {
  if (!formula.startsWith("=")) return formula;
  let out = "";
  let i = 0;
  // String literals and structured references ([@Q1] is a column name, not cell Q1) are left alone.
  const parts = formula.split(/("(?:[^"]|"")*"|\[(?:[^[\]']|'.|\[(?:[^[\]']|'.)*\])*\])/);
  for (const part of parts) {
    if (part.startsWith('"') || part.startsWith("[")) {
      out += part;
      continue;
    }
    out += part.replace(RE, (m, sheet, a1, c1, a2, r1, b1, c2, b2, r2, x1, cc1, x2, cc2, y1, rr1, y2, rr2, offset: number, whole: string) => {
      // Not a reference when glued to a name before it (e.g. LOG10, or the "1" in SHEET1).
      const prev = whole[offset - 1];
      if (prev && /[\w.$]/.test(prev)) return m;
      let ref: RefPart;
      if (c1) {
        ref = {
          sheet: sheet?.replace(/^'|'$/g, "").replace(/''/g, "'"),
          kind: c2 ? "range" : "cell",
          c1: colIndex(c1), r1: Number(r1) - 1, ac1: !!a1, ar1: !!a2,
          c2: c2 ? colIndex(c2) : colIndex(c1), r2: c2 ? Number(r2) - 1 : Number(r1) - 1, ac2: c2 ? !!b1 : !!a1, ar2: c2 ? !!b2 : !!a2,
        };
      } else if (cc1) {
        ref = { sheet: sheet?.replace(/^'|'$/g, "").replace(/''/g, "'"), kind: "cols", c1: colIndex(cc1), c2: colIndex(cc2), r1: 0, r2: 1048575, ac1: !!x1, ac2: !!x2, ar1: false, ar2: false };
      } else if (rr1) {
        ref = { sheet: sheet?.replace(/^'|'$/g, "").replace(/''/g, "'"), kind: "rows", r1: Number(rr1) - 1, r2: Number(rr2) - 1, c1: 0, c2: 16383, ar1: !!y1, ar2: !!y2, ac1: false, ac2: false };
      } else return m;
      const res = fn(ref);
      return res === null ? "#REF!" : res;
    });
    i++;
  }
  void i;
  return out;
}

const quoteSheet = (s: string) => (/^[A-Za-z_][\w.]*$/.test(s) && !/^[A-Z]{1,3}\d+$/i.test(s) ? s : `'${s.replace(/'/g, "''")}'`);

export function refText(ref: RefPart): string {
  const pre = ref.sheet !== undefined ? quoteSheet(ref.sheet) + "!" : "";
  const cell = (c: number, r: number, ac: boolean, ar: boolean) => `${ac ? "$" : ""}${colName(c)}${ar ? "$" : ""}${r + 1}`;
  switch (ref.kind) {
    case "cell":
      return pre + cell(ref.c1, ref.r1, ref.ac1, ref.ar1);
    case "range":
      return pre + cell(ref.c1, ref.r1, ref.ac1, ref.ar1) + ":" + cell(ref.c2, ref.r2, ref.ac2, ref.ar2);
    case "cols":
      return `${pre}${ref.ac1 ? "$" : ""}${colName(ref.c1)}:${ref.ac2 ? "$" : ""}${colName(ref.c2)}`;
    case "rows":
      return `${pre}${ref.ar1 ? "$" : ""}${ref.r1 + 1}:${ref.ar2 ? "$" : ""}${ref.r2 + 1}`;
  }
}

/** A formula copied dr rows down and dc columns right: relative references move with it. */
export function moveFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return transformRefs(formula, (ref) => {
    const n = { ...ref };
    if (ref.kind !== "cols") {
      if (!n.ar1) n.r1 += dr;
      if (!n.ar2) n.r2 += dr;
    }
    if (ref.kind !== "rows") {
      if (!n.ac1) n.c1 += dc;
      if (!n.ac2) n.c2 += dc;
    }
    if (n.r1 < 0 || n.c1 < 0 || n.r2 < 0 || n.c2 < 0) return null;
    return refText(n);
  });
}

/**
 * Rows or columns inserted (count > 0) or deleted (count < 0) at `at` on sheet `target`.
 * `here` is the sheet the formula lives on, so unprefixed references can be matched.
 */
export function shiftFormula(formula: string, here: string, target: string, axis: "row" | "col", at: number, count: number): string {
  const same = (s?: string) => (s ?? here).toLowerCase() === target.toLowerCase();
  return transformRefs(formula, (ref) => {
    if (!same(ref.sheet)) return refText(ref);
    if ((axis === "row" && ref.kind === "cols") || (axis === "col" && ref.kind === "rows")) return refText(ref);
    const n = { ...ref };
    const [k1, k2] = axis === "row" ? (["r1", "r2"] as const) : (["c1", "c2"] as const);
    if (count > 0) {
      if (n[k1] >= at) n[k1] += count;
      if (n[k2] >= at) n[k2] += count;
      return refText(n);
    }
    const del = -count, end = at + del - 1;
    const shift = (x: number) => (x > end ? x - del : x);
    if (ref.kind === "cell") {
      if (n[k1] >= at && n[k1] <= end) return null;
      n[k1] = n[k2] = shift(n[k1]);
      return refText(n);
    }
    // Ranges shrink; a range entirely inside the deleted band becomes #REF!.
    if (n[k1] >= at && n[k2] <= end) return null;
    const lo = n[k1] >= at && n[k1] <= end ? at : shift(n[k1]);
    const hi = n[k2] >= at && n[k2] <= end ? at - 1 : shift(n[k2]);
    n[k1] = lo;
    n[k2] = Math.max(lo, hi);
    return refText(n);
  });
}

export function renameSheetInFormula(formula: string, from: string, to: string): string {
  return transformRefs(formula, (ref) => refText(ref.sheet !== undefined && ref.sheet.toLowerCase() === from.toLowerCase() ? { ...ref, sheet: to } : ref));
}

/** Toggle F4-style absolute references on the reference at `pos` in a formula being typed. */
export function cycleAbsolute(formula: string, pos: number): { text: string; pos: number } {
  const re = /(\$?)([A-Z]{1,3})(\$?)(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    const start = m.index, end = start + m[0].length;
    if (pos < start || pos > end) continue;
    const state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0);
    // A1 → $A$1 → A$1 → $A1 → A1
    const next = [3, 2, 0, 1][state];
    const text = `${next === 3 || next === 2 ? "$" : ""}${m[2]}${next === 3 || next === 1 ? "$" : ""}${m[4]}`;
    return { text: formula.slice(0, start) + text + formula.slice(end), pos: start + text.length };
  }
  return { text: formula, pos };
}
