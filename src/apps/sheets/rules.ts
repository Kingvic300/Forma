// Conditional formatting and data validation: which cells a rule applies to and what it does.
import { Book, FErr, parseRange, type Val } from "./formula";
import { criteria } from "./functions";
import { parseInput } from "./format";
import { moveFormula } from "./refs";
import type { CondRule, Sheet, Validation } from "./types";

export interface CondLook {
  bg?: string;
  color?: string;
  bold?: boolean;
  bar?: { pct: number; color: string };
}

const inRange = (b: { r1: number; c1: number; r2: number; c2: number }, r: number, c: number) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** Builds a lookup that says how conditional formatting changes each cell. */
export function makeCondEval(sheet: Sheet, book: Book, si: number) {
  const rules = (sheet.cond ?? []).map((rule) => {
    const b = parseRange(rule.range);
    return b ? { rule, b, stats: undefined as undefined | ReturnType<typeof stats> } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!rules.length) return () => null;

  function stats(rule: CondRule, b: { r1: number; c1: number; r2: number; c2: number }) {
    const vals: Val[] = [];
    const rows = Math.min(b.r2, b.r1 + 20000);
    for (let r = b.r1; r <= rows; r++) for (let c = b.c1; c <= b.c2; c++) {
      const v = book.value(si, r, c);
      if (!(v instanceof FErr)) vals.push(v);
    }
    const nums = vals.filter((v): v is number => typeof v === "number").sort((x, y) => x - y);
    const min = nums[0] ?? 0, max = nums[nums.length - 1] ?? 0;
    const avg = nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0;
    const counts = new Map<string, number>();
    vals.forEach((v) => {
      if (v === "") return;
      const k = typeof v === "string" ? v.toLowerCase() : String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    let cut = 0;
    if (rule.type === "top" || rule.type === "bottom") {
      const n = Number(rule.a ?? 10);
      const k = rule.percent ? Math.max(1, Math.floor((nums.length * n) / 100)) : n;
      cut = rule.type === "top" ? nums[Math.max(0, nums.length - k)] ?? Infinity : nums[Math.min(nums.length - 1, k - 1)] ?? -Infinity;
    }
    const mid = nums.length ? nums[Math.floor((nums.length - 1) / 2)] : 0;
    return { min, max, avg, counts, cut, mid };
  }

  const num = (s?: string, r = 0, c = 0, b?: { r1: number; c1: number }) => {
    if (s === undefined || s === "") return NaN;
    if (s.startsWith("=")) {
      const v = book.formula(si, b ? moveFormula(s, r - b.r1, c - b.c1) : s, r, c);
      return typeof v === "number" ? v : NaN;
    }
    const t = parseInput(s).value;
    return typeof t === "number" ? t : NaN;
  };

  return (r: number, c: number): CondLook | null => {
    let look: CondLook = {};
    for (const x of rules) {
      if (!inRange(x.b, r, c)) continue;
      const { rule, b } = x;
      const v = book.value(si, r, c);
      if (v instanceof FErr && rule.type !== "formula") continue;
      const val = v as Val;
      let hit = false;
      switch (rule.type) {
        case "gt": hit = typeof val === "number" && val > num(rule.a, r, c, b); break;
        case "lt": hit = typeof val === "number" && val < num(rule.a, r, c, b); break;
        case "eq": hit = typeof val === "number" ? val === num(rule.a, r, c, b) : String(val).toLowerCase() === (rule.a ?? "").toLowerCase(); break;
        case "ne": hit = typeof val === "number" ? val !== num(rule.a, r, c, b) : String(val).toLowerCase() !== (rule.a ?? "").toLowerCase(); break;
        case "between": {
          const lo = num(rule.a, r, c, b), hi = num(rule.b, r, c, b);
          hit = typeof val === "number" && val >= Math.min(lo, hi) && val <= Math.max(lo, hi);
          break;
        }
        case "contains": hit = String(val).toLowerCase().includes((rule.a ?? "").toLowerCase()); break;
        case "notContains": hit = !String(val).toLowerCase().includes((rule.a ?? "").toLowerCase()); break;
        case "begins": hit = String(val).toLowerCase().startsWith((rule.a ?? "").toLowerCase()); break;
        case "ends": hit = String(val).toLowerCase().endsWith((rule.a ?? "").toLowerCase()); break;
        case "blank": hit = val === ""; break;
        case "notBlank": hit = val !== ""; break;
        case "duplicate": case "unique": {
          x.stats ??= stats(rule, b);
          if (val === "") break;
          const n = x.stats.counts.get(typeof val === "string" ? val.toLowerCase() : String(val)) ?? 0;
          hit = rule.type === "duplicate" ? n > 1 : n === 1;
          break;
        }
        case "top": case "bottom":
          x.stats ??= stats(rule, b);
          hit = typeof val === "number" && (rule.type === "top" ? val >= x.stats.cut : val <= x.stats.cut);
          break;
        case "aboveAvg": case "belowAvg":
          x.stats ??= stats(rule, b);
          hit = typeof val === "number" && (rule.type === "aboveAvg" ? val > x.stats.avg : val < x.stats.avg);
          break;
        case "formula": {
          const res = book.formula(si, moveFormula(rule.a ?? "", r - b.r1, c - b.c1), r, c);
          hit = res === true || (typeof res === "number" && res !== 0);
          break;
        }
        case "scale2": case "scale3": {
          if (typeof val !== "number") break;
          x.stats ??= stats(rule, b);
          const { min, max, mid } = x.stats;
          const cols = rule.colors ?? ["#f8696b", "#63be7b"];
          let bg: string;
          if (rule.type === "scale3" && cols.length >= 3) bg = val <= mid ? mix(cols[0], cols[1], mid === min ? 1 : (val - min) / (mid - min)) : mix(cols[1], cols[2], max === mid ? 1 : (val - mid) / (max - mid));
          else bg = mix(cols[0], cols[cols.length - 1], max === min ? 1 : (val - min) / (max - min));
          look = { ...look, bg };
          continue;
        }
        case "bar": {
          if (typeof val !== "number") break;
          x.stats ??= stats(rule, b);
          const { min, max } = x.stats;
          const lo = Math.min(0, min);
          look = { ...look, bar: { pct: max === lo ? 1 : (val - lo) / (max - lo), color: rule.colors?.[0] ?? "#638ec6" } };
          continue;
        }
      }
      if (hit) {
        look = { ...look, ...(rule.style?.bg ? { bg: rule.style.bg } : {}), ...(rule.style?.color ? { color: rule.style.color } : {}), ...(rule.style?.bold ? { bold: true } : {}) };
        if (rule.stop) break;
      }
    }
    return Object.keys(look).length ? look : null;
  };
}

// ---- Data validation ---------------------------------------------------------------------------------

export function validationAt(sheet: Sheet, r: number, c: number): Validation | undefined {
  return sheet.valid?.find((v) => {
    const b = parseRange(v.range);
    return b && inRange(b, r, c);
  });
}

/** The choices of a list rule: "a,b,c" or a range like $A$1:$A$9. */
export function listItems(v: Validation, book: Book, si: number): string[] {
  const src = (v.list ?? "").replace(/^=/, "").trim();
  if (/^(?:'?[^'!]+'?!)?\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i.test(src)) {
    const sheetName = /^'?([^'!]+)'?!/.exec(src)?.[1];
    const s = book.sheetIndex(sheetName, si);
    const b = parseRange(src);
    if (!b || s < 0) return [];
    const out: string[] = [];
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
      const x = book.value(s, r, c);
      if (!(x instanceof FErr) && x !== "") out.push(String(x));
    }
    return out;
  }
  return src.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Whether a typed value passes the cell's validation rule. */
export function checkValid(v: Validation, raw: string, book: Book, si: number, r: number, c: number): boolean {
  if (raw === "") return true;
  if (v.type === "list") return listItems(v, book, si).some((x) => x.toLowerCase() === raw.toLowerCase());
  if (v.type === "formula") {
    const b = parseRange(v.range);
    const res = book.formula(si, moveFormula(v.min ?? "", b ? r - b.r1 : 0, b ? c - b.c1 : 0), r, c);
    return res === true || (typeof res === "number" && res !== 0);
  }
  const typed = parseInput(raw).value;
  let x: number;
  if (v.type === "length") x = raw.length;
  else if (typeof typed !== "number") return false;
  else x = typed;
  if (v.type === "whole" && !Number.isInteger(x)) return false;
  const bound = (s?: string) => {
    if (!s) return NaN;
    if (s.startsWith("=")) {
      const res = book.formula(si, s, r, c);
      return typeof res === "number" ? res : NaN;
    }
    const t = parseInput(s).value;
    return typeof t === "number" ? t : NaN;
  };
  const lo = bound(v.min), hi = bound(v.max);
  switch (v.op ?? "between") {
    case "between": return x >= lo && x <= hi;
    case "notBetween": return x < lo || x > hi;
    case "eq": return x === lo;
    case "ne": return x !== lo;
    case "gt": return x > lo;
    case "lt": return x < lo;
    case "ge": return x >= lo;
    case "le": return x <= lo;
  }
}

export { criteria };
