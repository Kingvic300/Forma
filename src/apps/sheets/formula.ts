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

export function makeEvaluator(cells: string[][]) {
  const cache = new Map<string, Val | FErr>();
  const visiting = new Set<string>();
  const parsed = new Map<string, Node | FErr>();

  function value(r: number, c: number): Val | FErr {
    const key = r + "," + c;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const raw = cells[r]?.[c] ?? "";
    let v: Val | FErr;
    if (raw.startsWith("=") && raw.length > 1) {
      if (visiting.has(key)) return new FErr("#CYCLE!");
      visiting.add(key);
      try {
        let ast = parsed.get(raw);
        if (!ast) {
          try { ast = parse(raw.slice(1)); } catch (e) { ast = e instanceof FErr ? e : new FErr("#ERROR!"); }
          parsed.set(raw, ast);
        }
        if (ast instanceof FErr) throw ast;
        v = scalar(evaluate(ast));
        if (typeof v === "number" && !isFinite(v)) v = new FErr("#NUM!");
      } catch (e) {
        v = e instanceof FErr ? e : new FErr("#ERROR!");
      }
      visiting.delete(key);
    } else if (raw.trim() !== "" && !isNaN(Number(raw))) v = Number(raw);
    else v = raw;
    cache.set(key, v);
    return v;
  }

  const get = (r: number, c: number): Val => {
    const v = value(r, c);
    if (v instanceof FErr) throw v;
    return v;
  };

  const scalar = (v: Val | Val[]): Val => (Array.isArray(v) ? v[0] ?? "" : v);

  function evaluate(n: Node): Val | Val[] {
    switch (n.k) {
      case "lit": return n.v;
      case "ref": return get(n.r, n.c);
      case "range": {
        const out: Val[] = [];
        for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) out.push(get(r, c));
        return out;
      }
      case "neg": return -num(scalar(evaluate(n.a)));
      case "pct": return num(scalar(evaluate(n.a))) / 100;
      case "bin": {
        const a = scalar(evaluate(n.a));
        const b = scalar(evaluate(n.b));
        switch (n.op) {
          case "+": return num(a) + num(b);
          case "-": return num(a) - num(b);
          case "*": return num(a) * num(b);
          case "/": if (num(b) === 0) throw new FErr("#DIV/0!"); return num(a) / num(b);
          case "^": return Math.pow(num(a), num(b));
          case "&": return str(a) + str(b);
        }
        const bothNum = typeof a !== "string" && typeof b !== "string";
        const x = bothNum ? num(a) : str(a).toLowerCase();
        const y = bothNum ? num(b) : str(b).toLowerCase();
        switch (n.op) {
          case "=": return x === y;
          case "<>": return x !== y;
          case "<": return x < y;
          case ">": return x > y;
          case "<=": return x <= y;
          default: return x >= y;
        }
      }
      case "call": return call(n.name, n.args);
    }
  }

  function call(name: string, args: Node[]): Val | Val[] {
    const flat = () => args.flatMap((a) => { const v = evaluate(a); return Array.isArray(v) ? v : [v]; });
    const arg = (i: number) => scalar(evaluate(args[i] ?? { k: "lit", v: "" }));
    const numArgs = () => args.flatMap((a) => {
      const v = evaluate(a);
      return Array.isArray(v) ? nums(v) : [num(v)];
    });
    switch (name) {
      case "SUM": return numArgs().reduce((s, x) => s + x, 0);
      case "AVERAGE": case "AVG": {
        const xs = numArgs();
        if (!xs.length) throw new FErr("#DIV/0!");
        return xs.reduce((s, x) => s + x, 0) / xs.length;
      }
      case "MIN": { const xs = numArgs(); return xs.length ? Math.min(...xs) : 0; }
      case "MAX": { const xs = numArgs(); return xs.length ? Math.max(...xs) : 0; }
      case "COUNT": return nums(flat()).length;
      case "COUNTA": return flat().filter((v) => v !== "").length;
      case "PRODUCT": return numArgs().reduce((s, x) => s * x, 1);
      case "IF": return truthy(arg(0)) ? arg(1) : args.length > 2 ? arg(2) : false;
      case "IFERROR":
        try { return arg(0); } catch (e) { if (e instanceof FErr) return arg(1); throw e; }
      case "AND": return flat().every(truthy);
      case "OR": return flat().some(truthy);
      case "NOT": return !truthy(arg(0));
      case "ROUND": { const f = Math.pow(10, num(arg(1))); return Math.round(num(arg(0)) * f) / f; }
      case "FLOOR": return Math.floor(num(arg(0)));
      case "CEILING": return Math.ceil(num(arg(0)));
      case "ABS": return Math.abs(num(arg(0)));
      case "SQRT": { const x = num(arg(0)); if (x < 0) throw new FErr("#NUM!"); return Math.sqrt(x); }
      case "POWER": return Math.pow(num(arg(0)), num(arg(1)));
      case "MOD": { const d = num(arg(1)); if (d === 0) throw new FErr("#DIV/0!"); return num(arg(0)) % d; }
      case "CONCAT": case "CONCATENATE": return flat().map(str).join("");
      case "LEN": return str(arg(0)).length;
      case "UPPER": return str(arg(0)).toUpperCase();
      case "LOWER": return str(arg(0)).toLowerCase();
      case "TRIM": return str(arg(0)).trim().replace(/\s+/g, " ");
      case "LEFT": return str(arg(0)).slice(0, args.length > 1 ? num(arg(1)) : 1);
      case "RIGHT": { const s = str(arg(0)); const n = args.length > 1 ? num(arg(1)) : 1; return n ? s.slice(-n) : ""; }
      case "MID": return str(arg(0)).substr(num(arg(1)) - 1, num(arg(2)));
      case "TODAY": return new Date().toISOString().slice(0, 10);
      case "NOW": return new Date().toLocaleString();
      case "COUNTIF": {
        const test = criteria(arg(1));
        const v = evaluate(args[0]);
        return (Array.isArray(v) ? v : [v]).filter(test).length;
      }
      case "SUMIF": {
        const test = criteria(arg(1));
        const range = evaluate(args[0]);
        const r = Array.isArray(range) ? range : [range];
        const sumV = args[2] ? evaluate(args[2]) : r;
        const s = Array.isArray(sumV) ? sumV : [sumV];
        return r.reduce<number>((acc, v, i) => (test(v) && typeof s[i] === "number" ? acc + (s[i] as number) : acc), 0);
      }
      default: throw new FErr("#NAME?");
    }
  }

  return value;
}
