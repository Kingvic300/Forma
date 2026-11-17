// Spreadsheet formula engine: Excel-style syntax and semantics. References (A1, $A$1,
// Sheet2!A1, 'My sheet'!A1:B9, A:A, 1:1, A1#), named ranges, array constants {1,2;3,4},
// dynamic arrays that spill into neighbouring cells, LET and LAMBDA, and the function library
// in functions.ts. Errors are values (#DIV/0!, #N/A…) that flow through calculations.
import { FUNCTIONS } from "./functions";
import { parseInput } from "./format";

export type Val = number | string | boolean;
export class FErr {
  constructor(public code: string) {}
}
/** A rectangular block of values, row-major. */
export class Arr {
  constructor(public rows: number, public cols: number, public v: (Val | FErr)[]) {}
  at(r: number, c: number): Val | FErr {
    // Single rows and columns broadcast, as in Excel.
    const rr = this.rows === 1 ? 0 : r, cc = this.cols === 1 ? 0 : c;
    if (rr >= this.rows || cc >= this.cols) return new FErr("#N/A");
    return this.v[rr * this.cols + cc];
  }
  static of(rows: (Val | FErr)[][]) {
    const cols = Math.max(1, ...rows.map((r) => r.length));
    return new Arr(rows.length, cols, rows.flatMap((r) => Array.from({ length: cols }, (_, i) => r[i] ?? new FErr("#N/A"))));
  }
  row(r: number) {
    return this.v.slice(r * this.cols, (r + 1) * this.cols);
  }
  col(c: number) {
    return Array.from({ length: this.rows }, (_, r) => this.v[r * this.cols + c]);
  }
  map(fn: (x: Val | FErr, r: number, c: number) => Val | FErr) {
    return new Arr(this.rows, this.cols, this.v.map((x, i) => fn(x, Math.floor(i / this.cols), i % this.cols)));
  }
}
export class Lambda {
  constructor(public params: string[], public body: Node, public env: Env) {}
}
export type V = Val | FErr | Arr | Lambda;
export type Env = Map<string, V>;

export function colName(i: number) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
export function colIndex(letters: string) {
  let c = 0;
  for (const ch of letters.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}
export function parseRef(ref: string) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  const r = Number(m[2]) - 1, c = colIndex(m[1]);
  if (r < 0 || c > 16383) return null;
  return { r, c };
}
/** "A1:C9" (or a single cell) to bounds. */
export function parseRange(s: string) {
  const [a, b = a] = s.replace(/^.*!/, "").split(":");
  const p = parseRef(a), q = parseRef(b);
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}
export const rangeText = (r1: number, c1: number, r2: number, c2: number) => `${colName(c1)}${r1 + 1}` + (r1 !== r2 || c1 !== c2 ? `:${colName(c2)}${r2 + 1}` : "");

// ---- Tokens ---------------------------------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "err"; v: string }
  | { t: "ref"; v: string; sheet?: string }
  | { t: "id"; v: string; sheet?: string }
  | { t: "op"; v: string };

const ERRORS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!", "#GETTING_DATA"];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\./i.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (src[i] === '"') break;
        else s += src[i++];
      }
      if (src[i] !== '"') throw new FErr("#ERROR!");
      i++;
      out.push({ t: "str", v: s });
      continue;
    }
    if (ch === "#") {
      const e = ERRORS.find((x) => src.slice(i, i + x.length).toUpperCase() === x);
      if (e) {
        out.push({ t: "err", v: e });
        i += e.length;
        continue;
      }
      out.push({ t: "op", v: "#" });
      i++;
      continue;
    }
    // Sheet prefix: 'My sheet'!A1 or Sheet2!A1.
    let sheet: string | undefined;
    if (ch === "'") {
      const m = /^'((?:[^']|'')+)'!/.exec(src.slice(i));
      if (m) {
        sheet = m[1].replace(/''/g, "'");
        i += m[0].length;
      }
    } else {
      const m = /^([A-Za-z_À-￿][\w.À-￿]*)!/.exec(src.slice(i));
      if (m) {
        sheet = m[1];
        i += m[0].length;
      }
    }
    const word = /^\$?[A-Za-z_\\À-￿][A-Za-z0-9_.À-￿]*(\$?\d+)?/.exec(src.slice(i)) ?? (sheet ? /^\$?\d+/.exec(src.slice(i)) : null);
    if (word) {
      const w = word[0];
      if (parseRef(w)) out.push({ t: "ref", v: w.toUpperCase(), sheet });
      else out.push({ t: "id", v: w.toUpperCase(), sheet });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>(),:%{};@".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    throw new FErr("#ERROR!");
  }
  return out;
}

// ---- Parser -----------------------------------------------------------------------------------------

export type Node =
  | { k: "lit"; v: Val | FErr }
  | { k: "ref"; s?: string; r: number; c: number }
  | { k: "range"; s?: string; r1: number; c1: number; r2: number; c2: number; wholeCol?: boolean; wholeRow?: boolean }
  | { k: "spill"; s?: string; r: number; c: number }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node }
  | { k: "pct"; a: Node }
  | { k: "call"; name: string; args: Node[] }
  | { k: "invoke"; fn: Node; args: Node[] }
  | { k: "name"; name: string; s?: string }
  | { k: "arr"; rows: Node[][] }
  | { k: "omit" };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FErr("#ERROR!");
    p++;
  };
  const binary = (next: () => Node, ops: string[]) => () => {
    let a = next();
    while (peek()?.t === "op" && ops.includes(String(peek().v))) {
      const op = String(toks[p++].v);
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  };
  const args = (): Node[] => {
    const out: Node[] = [];
    if (isOp(")")) return out;
    for (;;) {
      out.push(isOp(",") || isOp(")") ? { k: "omit" } : expr());
      if (isOp(",")) {
        p++;
        continue;
      }
      break;
    }
    return out;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FErr("#ERROR!");
    if (t.t === "num") {
      // Row range: 1:5.
      if (isOp(":") && toks[p + 1]?.t === "num" && Number.isInteger(t.v)) {
        p++;
        const b = toks[p++] as { v: number };
        return { k: "range", r1: Math.min(t.v, b.v) - 1, c1: 0, r2: Math.max(t.v, b.v) - 1, c2: 16383, wholeRow: true };
      }
      return { k: "lit", v: t.v };
    }
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "err") return { k: "lit", v: new FErr(t.v) };
    if (t.t === "ref") {
      const a = parseRef(t.v)!;
      if (isOp(":")) {
        p++;
        const t2 = toks[p++];
        const b = t2?.t === "ref" ? parseRef(String(t2.v)) : null;
        if (!b) throw new FErr("#REF!");
        return { k: "range", s: t.sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      }
      if (isOp("#")) {
        p++;
        return { k: "spill", s: t.sheet, ...a };
      }
      return { k: "ref", s: t.sheet, ...a };
    }
    if (t.t === "id") {
      const bare = t.v.replace(/\$/g, "");
      // Column range: A:C.
      if (/^[A-Z]{1,3}$/.test(bare) && isOp(":") && toks[p + 1]?.t === "id" && /^\$?[A-Z]{1,3}$/.test(String(toks[p + 1].v))) {
        p++;
        const b = colIndex(String(toks[p++].v).replace(/\$/g, ""));
        const a = colIndex(bare);
        return { k: "range", s: t.sheet, r1: 0, c1: Math.min(a, b), r2: 1048575, c2: Math.max(a, b), wholeCol: true };
      }
      if (t.v === "TRUE" || t.v === "FALSE") {
        if (isOp("(")) {
          p += 1;
          expect(")");
        }
        return { k: "lit", v: t.v === "TRUE" };
      }
      if (isOp("(")) {
        p++;
        const a = args();
        expect(")");
        let node: Node = { k: "call", name: t.v.replace(/^_XLFN\.|^_XLWS\./, ""), args: a };
        while (isOp("(")) {
          p++;
          const b = args();
          expect(")");
          node = { k: "invoke", fn: node, args: b };
        }
        return node;
      }
      return { k: "name", name: t.v, s: t.sheet };
    }
    if (t.v === "(") {
      const e = expr();
      expect(")");
      let node = e;
      while (isOp("(")) {
        p++;
        const b = args();
        expect(")");
        node = { k: "invoke", fn: node, args: b };
      }
      return node;
    }
    if (t.v === "{") {
      const rows: Node[][] = [[]];
      for (;;) {
        rows[rows.length - 1].push(unary());
        if (isOp(",")) p++;
        else if (isOp(";")) {
          p++;
          rows.push([]);
        } else break;
      }
      expect("}");
      return { k: "arr", rows };
    }
    if (t.v === "@") return primary();
    throw new FErr("#ERROR!");
  };
  const postfix = (): Node => {
    let a = primary();
    while (isOp("%")) {
      p++;
      a = { k: "pct", a };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return postfix();
  };
  const power = binary(unary, ["^"]);
  const term = binary(power, ["*", "/"]);
  const add = binary(term, ["+", "-"]);
  const concat = binary(add, ["&"]);
  const expr: () => Node = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
  const root = expr();
  if (p < toks.length) throw new FErr("#ERROR!");
  return root;
}

// ---- Coercion ------------------------------------------------------------------------------------------

export const num = (v: Val | FErr): number => {
  if (v instanceof FErr) throw v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v.trim() === "") return 0;
  const typed = parseInput(v);
  if (typeof typed.value === "number") return typed.value;
  throw new FErr("#VALUE!");
};
export const str = (v: Val | FErr): string => {
  if (v instanceof FErr) throw v;
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? displayNumber(v) : v;
};
export const bool = (v: Val | FErr): boolean => {
  if (v instanceof FErr) throw v;
  if (typeof v === "string") {
    const u = v.toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE" || u === "") return false;
    throw new FErr("#VALUE!");
  }
  return !!num(v);
};
const displayNumber = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15))));

// ---- The workbook evaluator ---------------------------------------------------------------------------------

export interface BookSource {
  sheets: { name: string; cells: string[][] }[];
  names?: Record<string, string>;
}

export interface Ctx {
  book: Book;
  sheet: number;
  /** The cell being calculated. */
  r: number;
  c: number;
  env: Env;
  evaluate: (n: Node, env?: Env) => V;
  callLambda: (f: Lambda, args: V[]) => V;
}

const ARRAY_HINT = /[A-Z$]+\d*:[$A-Z]+\d*|\{|#\s*$|FILTER|SORT|UNIQUE|SEQUENCE|RANDARRAY|TRANSPOSE|STACK|TAKE|DROP|CHOOSE(ROWS|COLS)|TO(ROW|COL)|WRAP(ROWS|COLS)|EXPAND|TEXTSPLIT|MMULT|MINVERSE|MAKEARRAY|BYROW|BYCOL|MAP|SCAN|FREQUENCY|MODE\.MULT|LINEST|TREND|GROWTH/i;

export class Book {
  private cache: Map<string, Val | FErr>[] = [];
  private arrays: Map<string, Arr>[] = [];
  /** Cells filled by a neighbouring formula's spilled array: key → [source row, source col, value]. */
  private spills: Map<string, [number, number, Val | FErr]>[] = [];
  private spillReady: boolean[] = [];
  private visiting = new Set<string>();
  private parsed = new Map<string, Node | FErr>();
  constructor(public src: BookSource) {}

  sheetIndex(name?: string, from = 0) {
    if (!name) return from;
    return this.src.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
  }
  raw(s: number, r: number, c: number) {
    return this.src.sheets[s]?.cells[r]?.[c] ?? "";
  }
  used(s: number) {
    const cells = this.src.sheets[s]?.cells ?? [];
    return { rows: cells.length, cols: Math.max(0, ...cells.map((r) => r?.length ?? 0)) };
  }
  ast(raw: string): Node | FErr {
    let a = this.parsed.get(raw);
    if (!a) {
      try {
        a = parse(raw.slice(1));
      } catch (e) {
        a = e instanceof FErr ? e : new FErr("#ERROR!");
      }
      this.parsed.set(raw, a);
    }
    return a;
  }

  /** The value shown in a cell. */
  value(s: number, r: number, c: number): Val | FErr {
    const key = `${r},${c}`;
    const cache = (this.cache[s] ??= new Map());
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const raw = this.raw(s, r, c);
    let v: Val | FErr;
    if (raw.startsWith("=") && raw.length > 1) {
      const vk = `${s}:${key}`;
      if (this.visiting.has(vk)) return new FErr("#CYCLE!");
      this.visiting.add(vk);
      try {
        const ast = this.ast(raw);
        if (ast instanceof FErr) throw ast;
        let out = this.run(ast, s, r, c);
        if (out instanceof Lambda) out = new FErr("#CALC!");
        if (out instanceof Arr) {
          if (out.rows * out.cols === 1) v = out.v[0];
          else v = this.spill(s, r, c, out);
        } else v = out;
        if (v === "" && ast.k === "ref") v = 0;
        if (typeof v === "number" && !isFinite(v)) v = new FErr("#NUM!");
      } catch (e) {
        v = e instanceof FErr ? e : new FErr("#ERROR!");
      }
      this.visiting.delete(vk);
    } else if (raw === "") {
      this.ensureSpills(s);
      const sp = this.spills[s]?.get(key);
      v = sp ? sp[2] : "";
    } else v = parseInput(raw).value;
    cache.set(key, v);
    return v;
  }

  /** Where a spilled value came from, for drawing the spill border. */
  spillSource(s: number, r: number, c: number) {
    this.ensureSpills(s);
    const sp = this.spills[s]?.get(`${r},${c}`);
    return sp ? { r: sp[0], c: sp[1] } : null;
  }
  spillArray(s: number, r: number, c: number) {
    this.value(s, r, c);
    return this.arrays[s]?.get(`${r},${c}`) ?? null;
  }

  private spill(s: number, r: number, c: number, a: Arr): Val | FErr {
    const map = (this.spills[s] ??= new Map());
    for (let i = 0; i < a.rows; i++)
      for (let j = 0; j < a.cols; j++) {
        if (!i && !j) continue;
        const k = `${r + i},${c + j}`;
        const other = map.get(k);
        if (this.raw(s, r + i, c + j) !== "" || (other && (other[0] !== r || other[1] !== c))) return new FErr("#SPILL!");
      }
    for (let i = 0; i < a.rows; i++)
      for (let j = 0; j < a.cols; j++) {
        if (!i && !j) continue;
        const k = `${r + i},${c + j}`;
        map.set(k, [r, c, a.v[i * a.cols + j]]);
        this.cache[s]?.delete(k);
      }
    (this.arrays[s] ??= new Map()).set(`${r},${c}`, a);
    return a.v[0];
  }

  /** Calculate the formulas that may spill, so empty cells know whether they're covered. */
  private ensureSpills(s: number) {
    if (this.spillReady[s]) return;
    this.spillReady[s] = true;
    const cells = this.src.sheets[s]?.cells ?? [];
    cells.forEach((row, r) =>
      row?.forEach((raw, c) => {
        if (raw?.startsWith("=") && ARRAY_HINT.test(raw)) this.value(s, r, c);
      }),
    );
  }

  /** Calculate a formula as if it were in cell (r, c) of sheet s, without storing it. */
  formula(s: number, text: string, r: number, c: number): Val | FErr {
    const ast = this.ast(text.startsWith("=") ? text : "=" + text);
    if (ast instanceof FErr) return ast;
    try {
      return scalarOf(this.run(ast, s, r, c));
    } catch (e) {
      return e instanceof FErr ? e : new FErr("#ERROR!");
    }
  }

  private run(ast: Node, s: number, r: number, c: number): V {
    const ctx: Ctx = {
      book: this,
      sheet: s,
      r,
      c,
      env: new Map(),
      evaluate: (n, env) => this.evaluate(n, { ...ctx, env: env ?? ctx.env }),
      callLambda: (f, args) => {
        const env: Env = new Map(f.env);
        f.params.forEach((p, i) => env.set(p, args[i] ?? new FErr("#VALUE!")));
        return this.evaluate(f.body, { ...ctx, env });
      },
    };
    return this.evaluate(ast, ctx);
  }

  private cellOrErr(s: number, r: number, c: number): Val | FErr {
    if (s < 0) return new FErr("#REF!");
    return this.value(s, r, c);
  }

  rangeArr(s: number, r1: number, c1: number, r2: number, c2: number): Arr {
    if (s < 0) throw new FErr("#REF!");
    const u = this.used(s);
    // Whole columns and rows stop at the used area.
    r2 = Math.min(r2, Math.max(r1, u.rows - 1));
    c2 = Math.min(c2, Math.max(c1, u.cols - 1));
    const rows = r2 - r1 + 1, cols = c2 - c1 + 1;
    const v: (Val | FErr)[] = new Array(rows * cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) v[i * cols + j] = this.value(s, r1 + i, c1 + j);
    return new Arr(rows, cols, v);
  }

  /** Resolve a named range or LET/LAMBDA name. */
  private resolveName(name: string, ctx: Ctx): V {
    if (ctx.env.has(name)) return ctx.env.get(name)!;
    const def = this.src.names?.[name] ?? Object.entries(this.src.names ?? {}).find(([k]) => k.toUpperCase() === name)?.[1];
    if (def === undefined) throw new FErr("#NAME?");
    const ast = this.ast(def.startsWith("=") ? def : "=" + def);
    if (ast instanceof FErr) throw ast;
    return this.evaluate(ast, ctx);
  }

  evaluate(n: Node, ctx: Ctx): V {
    switch (n.k) {
      case "lit":
        return n.v;
      case "omit":
        return "";
      case "ref":
        return this.cellOrErr(this.sheetIndex(n.s, ctx.sheet), n.r, n.c);
      case "range":
        return this.rangeArr(this.sheetIndex(n.s, ctx.sheet), n.r1, n.c1, n.r2, n.c2);
      case "spill": {
        const s = this.sheetIndex(n.s, ctx.sheet);
        const a = this.spillArray(s, n.r, n.c);
        return a ?? this.cellOrErr(s, n.r, n.c);
      }
      case "name":
        return this.resolveName(n.name, ctx);
      case "arr":
        return Arr.of(n.rows.map((row) => row.map((x) => scalarOf(this.evaluate(x, ctx)))));
      case "neg":
        return lift1(this.evaluate(n.a, ctx), (x) => -num(x));
      case "pct":
        return lift1(this.evaluate(n.a, ctx), (x) => num(x) / 100);
      case "bin":
        return lift2(this.evaluate(n.a, ctx), this.evaluate(n.b, ctx), (a, b) => binop(n.op, a, b));
      case "call": {
        const lam = ctx.env.get(n.name);
        if (lam instanceof Lambda) return ctx.callLambda(lam, n.args.map((a) => this.evaluate(a, ctx)));
        const fn = FUNCTIONS[n.name];
        if (!fn) {
          // A named LAMBDA defined in the Name Manager.
          const named = this.src.names && Object.keys(this.src.names).find((k) => k.toUpperCase() === n.name);
          if (named) {
            const f = this.resolveName(n.name, ctx);
            if (f instanceof Lambda) return ctx.callLambda(f, n.args.map((a) => this.evaluate(a, ctx)));
          }
          throw new FErr("#NAME?");
        }
        return fn(n.args, ctx);
      }
      case "invoke": {
        const f = this.evaluate(n.fn, ctx);
        if (!(f instanceof Lambda)) throw new FErr("#VALUE!");
        return ctx.callLambda(f, n.args.map((a) => this.evaluate(a, ctx)));
      }
    }
  }
}

export const scalarOf = (v: V): Val | FErr => (v instanceof Arr ? v.v[0] ?? "" : v instanceof Lambda ? new FErr("#CALC!") : v);

function lift1(a: V, fn: (x: Val | FErr) => Val | FErr): V {
  if (a instanceof Arr) return a.map((x) => safe(() => fn(x)));
  return fn(scalarOf(a));
}
function lift2(a: V, b: V, fn: (x: Val | FErr, y: Val | FErr) => Val | FErr): V {
  if (a instanceof Arr || b instanceof Arr) {
    const A = a instanceof Arr ? a : new Arr(1, 1, [scalarOf(a)]);
    const B = b instanceof Arr ? b : new Arr(1, 1, [scalarOf(b)]);
    const rows = Math.max(A.rows, B.rows), cols = Math.max(A.cols, B.cols);
    const v: (Val | FErr)[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) v.push(safe(() => fn(A.at(r, c), B.at(r, c))));
    return new Arr(rows, cols, v);
  }
  return fn(scalarOf(a), scalarOf(b));
}
export function safe(fn: () => Val | FErr): Val | FErr {
  try {
    return fn();
  } catch (e) {
    return e instanceof FErr ? e : new FErr("#VALUE!");
  }
}

function binop(op: string, a: Val | FErr, b: Val | FErr): Val | FErr {
  if (a instanceof FErr) return a;
  if (b instanceof FErr) return b;
  switch (op) {
    case "+":
      return num(a) + num(b);
    case "-":
      return num(a) - num(b);
    case "*":
      return num(a) * num(b);
    case "/":
      if (num(b) === 0) return new FErr("#DIV/0!");
      return num(a) / num(b);
    case "^":
      return Math.pow(num(a), num(b));
    case "&":
      return str(a) + str(b);
  }
  return compare(op, a, b);
}

/** Excel comparison: numbers < text < booleans, text case-insensitive. */
export function compareVals(a: Val, b: Val): number {
  const rank = (v: Val) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  if (a === "" && typeof b === "number") a = 0;
  if (b === "" && typeof a === "number") b = 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string") return a.toLowerCase().localeCompare((b as string).toLowerCase());
  return Number(a) - Number(b);
}
function compare(op: string, a: Val, b: Val): boolean {
  const d = compareVals(a, b);
  switch (op) {
    case "=":
      return d === 0;
    case "<>":
      return d !== 0;
    case "<":
      return d < 0;
    case ">":
      return d > 0;
    case "<=":
      return d <= 0;
    default:
      return d >= 0;
  }
}

/** A single-sheet evaluator, for callers that only need one sheet. */
export function makeEvaluator(cells: string[][], book?: BookSource, sheet = 0) {
  const b = new Book(book ?? { sheets: [{ name: "Sheet1", cells }] });
  return (r: number, c: number) => b.value(sheet, r, c);
}

export function display(v: Val | FErr): string {
  if (v instanceof FErr) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  return v;
}
