// Structural edits on a workbook. Each one moves everything attached to cells (formats, sizes,
// merges, notes, rules, charts) along with the values, and fixes formulas on every sheet.
import { colName, parseRange, rangeText } from "./formula";
import { moveFormula, renameSheetInFormula, shiftFormula } from "./refs";
import { parseDate, toSerial, fromSerial } from "./format";
import type { CellFmt, Sheet, SheetsData } from "./types";
import { key } from "./types";

export const cloneSheet = (s: Sheet): Sheet => structuredClone(s);

function remapKeys<T>(map: Record<string, T> | undefined, fn: (r: number, c: number) => [number, number] | null): Record<string, T> | undefined {
  if (!map) return map;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(map)) {
    const [r, c] = k.split(",").map(Number);
    const n = fn(r, c);
    if (n) out[key(n[0], n[1])] = v;
  }
  return out;
}
function remapIndex<T>(map: Record<number, T> | undefined, fn: (i: number) => number | null): Record<number, T> | undefined {
  if (!map) return map;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(map)) {
    const n = fn(Number(k));
    if (n !== null) out[n] = v;
  }
  return out;
}
function remapRangeText(range: string, axis: "row" | "col", at: number, count: number): string | null {
  const b = parseRange(range);
  if (!b) return range;
  const [lo, hi] = axis === "row" ? [b.r1, b.r2] : [b.c1, b.c2];
  let nlo = lo, nhi = hi;
  if (count > 0) {
    if (lo >= at) nlo += count;
    if (hi >= at) nhi += count;
  } else {
    const end = at - count - 1;
    if (lo >= at && hi <= end) return null;
    nlo = lo > end ? lo + count : lo >= at ? at : lo;
    nhi = hi > end ? hi + count : hi >= at ? at - 1 : hi;
  }
  return axis === "row" ? rangeText(nlo, b.c1, nhi, b.c2) : rangeText(b.r1, nlo, b.r2, nhi);
}

/** Insert (count > 0) or delete (count < 0) rows or columns at `at` on sheet `si`. */
export function shiftAxis(data: SheetsData, si: number, axis: "row" | "col", at: number, count: number): SheetsData {
  const target = data.sheets[si].name;
  const del = count < 0 ? -count : 0;
  const map = (i: number): number | null => (count > 0 ? (i >= at ? i + count : i) : i < at ? i : i < at + del ? null : i - del);
  const sheets = data.sheets.map((s, i) => {
    // Formulas everywhere follow the moved cells.
    const cells = s.cells.map((row) => row?.map((v) => (v?.startsWith("=") ? shiftFormula(v, s.name, target, axis, at, count) : v)) ?? []);
    if (i !== si) return { ...s, cells };
    const n: Sheet = { ...s };
    if (axis === "row") {
      const out: string[][] = [];
      cells.forEach((row, r) => {
        const m = map(r);
        if (m !== null) out[m] = row;
      });
      n.cells = Array.from(out, (r) => r ?? []);
      n.fmt = remapKeys(s.fmt, (r, c) => (map(r) === null ? null : [map(r)!, c]));
      n.notes = remapKeys(s.notes, (r, c) => (map(r) === null ? null : [map(r)!, c]));
      n.rowH = remapIndex(s.rowH, map);
      n.hiddenRows = s.hiddenRows?.map(map).filter((x): x is number => x !== null);
      if (s.freeze && s.freeze.r > at) n.freeze = { ...s.freeze, r: Math.max(at, s.freeze.r + count) };
    } else {
      n.cells = cells.map((row) => {
        const out: string[] = [];
        row.forEach((v, c) => {
          const m = map(c);
          if (m !== null) out[m] = v;
        });
        return Array.from(out, (v) => v ?? "");
      });
      n.fmt = remapKeys(s.fmt, (r, c) => (map(c) === null ? null : [r, map(c)!]));
      n.notes = remapKeys(s.notes, (r, c) => (map(c) === null ? null : [r, map(c)!]));
      n.colW = remapIndex(s.colW, map);
      n.hiddenCols = s.hiddenCols?.map(map).filter((x): x is number => x !== null);
      if (s.freeze && s.freeze.c > at) n.freeze = { ...s.freeze, c: Math.max(at, s.freeze.c + count) };
    }
    n.merges = s.merges
      ?.map((m) => {
        const t = remapRangeText(rangeText(m.r1, m.c1, m.r2, m.c2), axis, at, count);
        const b = t ? parseRange(t) : null;
        return b && (b.r1 !== b.r2 || b.c1 !== b.c2) ? b : null;
      })
      .filter((m): m is NonNullable<typeof m> => !!m);
    n.cond = s.cond?.map((r) => ({ ...r, range: remapRangeText(r.range, axis, at, count) ?? "" })).filter((r) => r.range);
    n.valid = s.valid?.map((r) => ({ ...r, range: remapRangeText(r.range, axis, at, count) ?? "" })).filter((r) => r.range);
    n.charts = s.charts?.map((ch) => ({ ...ch, range: remapRangeText(ch.range, axis, at, count) ?? ch.range }));
    return n;
  });
  return { ...data, sheets };
}

export function renameSheet(data: SheetsData, si: number, name: string): SheetsData {
  const old = data.sheets[si].name;
  return {
    ...data,
    sheets: data.sheets.map((s, i) => ({
      ...s,
      name: i === si ? name : s.name,
      cells: s.cells.map((row) => row?.map((v) => (v?.startsWith("=") ? renameSheetInFormula(v, old, name) : v)) ?? []),
    })),
    names: data.names && Object.fromEntries(Object.entries(data.names).map(([k, v]) => [k, renameSheetInFormula("=" + v, old, name).slice(1)])),
  };
}

/** Sort rows r1..r2 by one or more columns. Formats and notes travel with their rows. */
export function sortRange(s: Sheet, r1: number, r2: number, c1: number, c2: number, keys: { col: number; desc: boolean }[], evalAt: (r: number, c: number) => unknown): Sheet {
  const rows = Array.from({ length: r2 - r1 + 1 }, (_, i) => r1 + i);
  const val = (r: number, c: number) => {
    const v = evalAt(r, c);
    return v === undefined || v === null ? "" : v;
  };
  rows.sort((a, b) => {
    for (const k of keys) {
      const x = val(a, k.col), y = val(b, k.col);
      // Blanks always last.
      if (x === "" || y === "") {
        if (x === y) continue;
        return x === "" ? 1 : -1;
      }
      let d: number;
      if (typeof x === "number" && typeof y === "number") d = x - y;
      else if (typeof x === "number") d = -1;
      else if (typeof y === "number") d = 1;
      else d = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      if (d) return k.desc ? -d : d;
    }
    return a - b;
  });
  const n = cloneSheet(s);
  rows.forEach((from, i) => {
    const to = r1 + i;
    for (let c = c1; c <= c2; c++) {
      const v = s.cells[from]?.[c] ?? "";
      (n.cells[to] ??= [])[c] = v.startsWith("=") ? moveFormula(v, to - from, 0) : v;
      const f = s.fmt?.[key(from, c)];
      if (n.fmt) delete n.fmt[key(to, c)];
      if (f) (n.fmt ??= {})[key(to, c)] = f;
      const note = s.notes?.[key(from, c)];
      if (n.notes) delete n.notes[key(to, c)];
      if (note) (n.notes ??= {})[key(to, c)] = note;
    }
  });
  return n;
}

// ---- Fill ----------------------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const LISTS = [MONTHS, MONTHS.map((m) => m.slice(0, 3)), DAYS, DAYS.map((d) => d.slice(0, 3)), ["q1", "q2", "q3", "q4"]];
const matchCase = (sample: string, word: string) =>
  sample === sample.toUpperCase() ? word.toUpperCase() : sample[0] === sample[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;

/**
 * Values for `count` cells continuing a series, Excel-style: numbers and dates step by the
 * pattern's difference, "Item 1" counts up, month and weekday names cycle, formulas move,
 * anything else repeats.
 */
export function extendSeries(seed: string[], count: number, step: { dr: number; dc: number }, back = false): string[] {
  const out: string[] = [];
  const n = seed.length;
  const nums = seed.map((v) => (v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null));
  const dates = seed.map((v) => parseDate(v));
  const allNum = nums.every((x) => x !== null);
  const allDate = !allNum && dates.every((d) => d && !/h/.test(d.fmt));
  const textNum = seed.map((v) => /^(.*?)(\d+)$/.exec(v));
  const list = LISTS.find((l) => seed.every((v) => l.includes(v.toLowerCase())));
  for (let i = 1; i <= count; i++) {
    const k = back ? -i : n - 1 + i;
    const idx = ((k % n) + n) % n;
    const src = seed[idx];
    // Cells between this one and the seed cell it repeats.
    const dist = k - idx;
    if (src.startsWith("=")) out.push(moveFormula(src, step.dr * dist, step.dc * dist));
    else if (allNum && n === 1) out.push(String(nums[0]));
    else if (allNum) {
      const diff = (nums[n - 1]! - nums[0]!) / (n - 1);
      const v = nums[0]! + diff * k;
      out.push(String(Number(v.toPrecision(15))));
    } else if (allDate) {
      const s0 = dates[0]!.serial, s1 = dates[n - 1]!.serial;
      const d0 = fromSerial(s0), d1 = fromSerial(s1);
      const monthStep = n > 1 && d0.getUTCDate() === d1.getUTCDate() && (s1 - s0) >= 28 ? ((d1.getUTCFullYear() - d0.getUTCFullYear()) * 12 + d1.getUTCMonth() - d0.getUTCMonth()) / (n - 1) : 0;
      let serial: number;
      if (monthStep) {
        const t = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + monthStep * k, d0.getUTCDate()));
        serial = toSerial(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
      } else serial = s0 + (n > 1 ? (s1 - s0) / (n - 1) : 1) * k;
      const d = fromSerial(serial);
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
    } else if (list) {
      const i0 = list.indexOf(seed[0].toLowerCase());
      const stepL = n > 1 ? (list.indexOf(seed[n - 1].toLowerCase()) - i0 + list.length) % list.length / (n - 1) || 1 : 1;
      out.push(matchCase(seed[0], list[(((i0 + stepL * k) % list.length) + list.length) % list.length]));
    } else if (textNum.every((m) => m) && textNum.every((m) => m![1] === textNum[0]![1])) {
      const a = Number(textNum[0]![2]), b = Number(textNum[n - 1]![2]);
      const diff = n > 1 ? (b - a) / (n - 1) : 1;
      out.push(textNum[0]![1] + String(Math.max(0, a + diff * k)).padStart(textNum[0]![2].length, "0"));
    } else out.push(src);
  }
  return out;
}

/** Copy formats from one cell key to another. */
export const copyFmt = (fmt: Record<string, CellFmt> | undefined, from: string, to: string) => {
  if (!fmt) return fmt;
  const out = { ...fmt };
  if (fmt[from]) out[to] = fmt[from];
  else delete out[to];
  return out;
};

export const colLabel = colName;
