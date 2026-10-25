// Small spreadsheet formula engine: arithmetic, comparisons, & concatenation,
// cell refs (A1, $A$1), ranges (A1:B9) and common functions.

export type Val = number | string | boolean;
export class FErr {
  constructor(public code: string) {}
}

export function colName(i: number) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export function parseRef(ref: string) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i))!;
      if (!m) throw new FErr("#ERROR!");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') { s += '"'; i += 2; }
        else if (src[i] === '"') break;
        else s += src[i++];
      }
      if (src[i] !== '"') throw new FErr("#ERROR!");
      i++;
      out.push({ t: "str", v: s });
      continue;
    }
    const word = /^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      out.push(parseRef(w) ? { t: "ref", v: w.toUpperCase() } : { t: "id", v: w.toUpperCase() });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>(),:%".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new FErr("#ERROR!");
  }
  return out;
}

type Node =
  | { k: "lit"; v: Val }
  | { k: "ref"; r: number; c: number }
  | { k: "range"; r1: number; c1: number; r2: number; c2: number }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node }
  | { k: "pct"; a: Node }
  | { k: "call"; name: string; args: Node[] };

function parse(src: string): Node {
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
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FErr("#ERROR!");
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "ref") {
      const a = parseRef(t.v)!;
      if (isOp(":")) {
        p++;
        const t2 = toks[p++];
        const b = t2?.t === "ref" ? parseRef(String(t2.v)) : null;
        if (!b) throw new FErr("#REF!");
        return { k: "range", r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
      }
      return { k: "ref", ...a };
    }
    if (t.t === "id") {
      if (t.v === "TRUE" || t.v === "FALSE") return { k: "lit", v: t.v === "TRUE" };
      expect("(");
      const args: Node[] = [];
      if (!isOp(")")) {
        do args.push(expr());
        while (isOp(",") && ++p);
      }
      expect(")");
      return { k: "call", name: t.v, args };
    }
    if (t.v === "(") {
      const e = expr();
      expect(")");
      return e;
    }
    throw new FErr("#ERROR!");
  };
  const postfix = (): Node => {
    let a = primary();
    while (isOp("%")) { p++; a = { k: "pct", a }; }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) { p++; return { k: "neg", a: unary() }; }
    if (isOp("+")) { p++; return unary(); }
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

const num = (v: Val): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v.trim() === "") return 0;
  const n = Number(v);
  if (isNaN(n)) throw new FErr("#VALUE!");
  return n;
};
const str = (v: Val) => (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
const truthy = (v: Val) => (typeof v === "string" ? v !== "" && v.toUpperCase() !== "FALSE" : !!num(v));
const nums = (vs: Val[]) => vs.filter((v): v is number => typeof v === "number");

function criteria(c: Val): (v: Val) => boolean {
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(str(c))!;
  const op = m[1] ?? "=";
  const target = m[2];
  const tn = Number(target);
  return (v) => {
    const isNum = target !== "" && !isNaN(tn) && typeof v !== "string";
    const a = isNum ? num(v) : str(v).toLowerCase();
    const b = isNum ? tn : target.toLowerCase();
    switch (op) {
      case "<": return a < b;
      case ">": return a > b;
      case "<=": return a <= b;
      case ">=": return a >= b;
      case "<>": return a !== b;
      default: return a === b;
    }
  };
}
