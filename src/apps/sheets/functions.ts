// The spreadsheet function library, following Excel's behaviour: math and trig, statistics,
// logic, text, dates, lookup, financial, information, engineering, database and dynamic arrays.
import { Arr, bool, compareVals, FErr, Lambda, num, safe, scalarOf, str, type Ctx, type Node, type V, type Val } from "./formula";
import { formatValue, fromSerial, nowSerial, parseDate, parseInput, todaySerial, toSerial } from "./format";

type Fn = (args: Node[], ctx: Ctx) => V;
export const FUNCTIONS: Record<string, Fn> = {};
const def = (names: string, fn: Fn) => names.split(" ").forEach((n) => (FUNCTIONS[n] = fn));

const NA = () => new FErr("#N/A");
const VALUE = () => new FErr("#VALUE!");
const NUM = () => new FErr("#NUM!");
const DIV0 = () => new FErr("#DIV/0!");

const ev = (ctx: Ctx, n?: Node): V => (n && n.k !== "omit" ? ctx.evaluate(n) : "");
const sc = (ctx: Ctx, n?: Node): Val | FErr => scalarOf(ev(ctx, n));
const toArr = (v: V): Arr => (v instanceof Arr ? v : new Arr(1, 1, [scalarOf(v)]));
const omitted = (n?: Node) => !n || n.k === "omit";
const rethrow = (v: Val | FErr) => {
  if (v instanceof FErr) throw v;
  return v;
};

/** Scalar function that spills over arrays: =LEN(A1:A5) gives five lengths. */
function lift(min: number, max: number, fn: (...xs: (Val | FErr)[]) => Val | FErr): Fn {
  return (args, ctx) => {
    if (args.length < min || args.length > max) throw VALUE();
    const vals = args.map((a) => ev(ctx, a));
    const arrs = vals.filter((v): v is Arr => v instanceof Arr);
    if (!arrs.length) return fn(...vals.map(scalarOf));
    const rows = Math.max(...arrs.map((a) => a.rows)), cols = Math.max(...arrs.map((a) => a.cols));
    const out: (Val | FErr)[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) out.push(safe(() => fn(...vals.map((v) => (v instanceof Arr ? v.at(r, c) : scalarOf(v))))));
    return new Arr(rows, cols, out);
  };
}
const n1 = (fn: (x: number) => number) => lift(1, 1, (x) => fn(num(x)));
const n2 = (fn: (x: number, y: number) => number, min = 2) => lift(min, 2, (x, y) => fn(num(x), y === undefined ? NaN : num(y)));

/** All values from the arguments; `fromRange` marks values that came from a range or array. */
function collect(ctx: Ctx, args: Node[]): { v: Val | FErr; fromRange: boolean }[] {
  const out: { v: Val | FErr; fromRange: boolean }[] = [];
  for (const a of args) {
    if (omitted(a)) continue;
    const v = ctx.evaluate(a);
    if (v instanceof Arr) v.v.forEach((x) => out.push({ v: x, fromRange: true }));
    else out.push({ v: scalarOf(v), fromRange: a.k === "ref" || a.k === "name" });
  }
  return out;
}
/** Numbers as SUM sees them: from ranges only numbers count; typed arguments are converted. */
function numbers(ctx: Ctx, args: Node[], countText = false): number[] {
  const out: number[] = [];
  for (const { v, fromRange } of collect(ctx, args)) {
    if (v instanceof FErr) throw v;
    if (typeof v === "number") out.push(v);
    else if (fromRange) {
      if (countText) out.push(typeof v === "boolean" ? (v ? 1 : 0) : v === "" ? NaN : 0);
    } else out.push(num(v));
  }
  return out.filter((x) => !isNaN(x));
}
const flat = (ctx: Ctx, args: Node[]) => collect(ctx, args).map((x) => x.v);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => {
  if (!xs.length) throw DIV0();
  return sum(xs) / xs.length;
};
const sortNum = (xs: number[]) => xs.slice().sort((a, b) => a - b);

/** COUNTIF-style criteria: ">5", "<>x", "a*", "=", numbers. */
export function criteria(c: Val | FErr): (v: Val | FErr) => boolean {
  if (c instanceof FErr) return (v) => v instanceof FErr && v.code === c.code;
  if (typeof c !== "string") return (v) => !(v instanceof FErr) && (typeof v === typeof c || typeof v === "string") && compareVals(v, c) === 0 && (typeof v !== "string" || typeof c === "string" || v !== "");
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? "=";
  const target = m[2];
  const tn = target.trim() !== "" && !isNaN(Number(target)) ? Number(target) : null;
  const wild = /[*?]/.test(target) && (op === "=" || op === "<>");
  const re = wild ? new RegExp("^" + target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$", "i") : null;
  return (v) => {
    if (v instanceof FErr) return false;
    if (re) return op === "=" ? re.test(str(v)) : !re.test(str(v));
    if (target === "" ) return op === "<>" ? v !== "" : v === "";
    let d: number;
    if (tn !== null && typeof v === "number") d = v - tn;
    else if (tn !== null) return op === "<>";
    else if (typeof v === "number") return op === "<>";
    else d = str(v).toLowerCase().localeCompare(target.toLowerCase());
    switch (op) {
      case "<": return d < 0;
      case ">": return d > 0;
      case "<=": return d <= 0;
      case ">=": return d >= 0;
      case "<>": return d !== 0;
      default: return d === 0;
    }
  };
}

/** Pairs of (range, criteria) for the *IFS functions. */
function ifsMask(ctx: Ctx, args: Node[], start: number, size: number): boolean[] {
  const mask = new Array(size).fill(true);
  for (let i = start; i + 1 < args.length; i += 2) {
    const range = toArr(ev(ctx, args[i]));
    const test = criteria(sc(ctx, args[i + 1]));
    if (range.v.length !== size) throw VALUE();
    range.v.forEach((v, j) => (mask[j] = mask[j] && test(v)));
  }
  return mask;
}

// ---- Math and trig ------------------------------------------------------------------------------

def("SUM", (a, ctx) => sum(numbers(ctx, a)));
def("PRODUCT", (a, ctx) => numbers(ctx, a).reduce((x, y) => x * y, 1));
def("SUMSQ", (a, ctx) => sum(numbers(ctx, a).map((x) => x * x)));
def("SUMIF", (a, ctx) => {
  const range = toArr(ev(ctx, a[0]));
  const test = criteria(sc(ctx, a[1]));
  const sumR = omitted(a[2]) ? range : toArr(ev(ctx, a[2]));
  let s = 0;
  range.v.forEach((v, i) => {
    const x = sumR.v[i];
    if (test(v) && typeof x === "number") s += x;
  });
  return s;
});
def("SUMIFS", (a, ctx) => {
  const sumR = toArr(ev(ctx, a[0]));
  const mask = ifsMask(ctx, a, 1, sumR.v.length);
  return sumR.v.reduce<number>((s, x, i) => (mask[i] && typeof x === "number" ? s + x : s), 0);
});
def("SUMPRODUCT", (a, ctx) => {
  const arrs = a.map((n) => toArr(ev(ctx, n)));
  const len = arrs[0]?.v.length ?? 0;
  if (arrs.some((x) => x.v.length !== len)) throw VALUE();
  let s = 0;
  for (let i = 0; i < len; i++) s += arrs.reduce((p, x) => p * (typeof x.v[i] === "number" ? (x.v[i] as number) : typeof x.v[i] === "boolean" ? 0 : x.v[i] instanceof FErr ? rethrow(x.v[i]) as number : 0), 1);
  return s;
});
def("SUMX2MY2", (a, ctx) => {
  const x = toArr(ev(ctx, a[0])).v.map(num), y = toArr(ev(ctx, a[1])).v.map(num);
  return sum(x.map((v, i) => v * v - y[i] * y[i]));
});
FUNCTIONS.SUMX2PY2 = (a, ctx) => {
  const x = toArr(ev(ctx, a[0])).v.map(num), y = toArr(ev(ctx, a[1])).v.map(num);
  return sum(x.map((v, i) => v * v + y[i] * y[i]));
};
FUNCTIONS.SUMXMY2 = (a, ctx) => {
  const x = toArr(ev(ctx, a[0])).v.map(num), y = toArr(ev(ctx, a[1])).v.map(num);
  return sum(x.map((v, i) => (v - y[i]) ** 2));
};

const AGG: Record<number, (xs: number[]) => number> = {
  1: mean, 2: (xs) => xs.length, 3: (xs) => xs.length, 4: (xs) => Math.max(...xs), 5: (xs) => Math.min(...xs), 6: (xs) => xs.reduce((p, x) => p * x, 1),
  7: (xs) => stdev(xs, true), 8: (xs) => stdev(xs, false), 9: sum, 10: (xs) => variance(xs, true), 11: (xs) => variance(xs, false),
  12: (xs) => median(xs), 13: (xs) => mode(xs), 14: (xs) => sortNum(xs).reverse()[0], 15: (xs) => sortNum(xs)[0],
};
def("SUBTOTAL", (a, ctx) => {
  const f = num(sc(ctx, a[0])) % 100;
  if (f === 3) return flat(ctx, a.slice(1)).filter((v) => v !== "").length;
  const fn = AGG[f];
  if (!fn) throw VALUE();
  return fn(numbers(ctx, a.slice(1)));
});
def("AGGREGATE", (a, ctx) => {
  const f = num(sc(ctx, a[0]));
  const opts = num(sc(ctx, a[1]));
  const vals = flat(ctx, a.slice(2, f >= 14 ? 3 : undefined)).filter((v) => !(v instanceof FErr && [2, 3, 6, 7].includes(opts)));
  const xs = vals.map((v) => rethrow(v)).filter((v): v is number => typeof v === "number");
  if (f === 14 || f === 15) {
    const k = num(sc(ctx, a[3]));
    const s = sortNum(xs);
    return f === 14 ? s[s.length - k] : s[k - 1];
  }
  if (f === 16 || f === 18) return percentile(xs, num(sc(ctx, a[3])), f === 16);
  if (f === 17 || f === 19) return percentile(xs, num(sc(ctx, a[3])) / 4, f === 17);
  const fn = AGG[f];
  if (!fn) throw VALUE();
  return fn(xs);
});

def("ABS", n1(Math.abs));
def("SIGN", n1(Math.sign));
def("INT", n1(Math.floor));
def("TRUNC", n2((x, d) => {
  const f = 10 ** (isNaN(d) ? 0 : d);
  return Math.trunc(x * f) / f;
}, 1));
const roundTo = (x: number, d: number, mode: "half" | "up" | "down") => {
  const f = 10 ** d;
  const y = Math.abs(x) * f;
  const r = mode === "half" ? Math.round(Number(y.toPrecision(15))) : mode === "up" ? Math.ceil(Number(y.toPrecision(15))) : Math.floor(Number(y.toPrecision(15)));
  return (Math.sign(x) * r) / f;
};
def("ROUND", n2((x, d) => roundTo(x, isNaN(d) ? 0 : d, "half"), 1));
def("ROUNDUP", n2((x, d) => roundTo(x, isNaN(d) ? 0 : d, "up"), 1));
def("ROUNDDOWN", n2((x, d) => roundTo(x, isNaN(d) ? 0 : d, "down"), 1));
def("MROUND", n2((x, m) => {
  if (m === 0) return 0;
  if (Math.sign(x) * Math.sign(m) < 0) throw NUM();
  return Math.round(x / m) * m;
}));
def("CEILING CEILING.PRECISE ISO.CEILING", n2((x, s) => {
  const sig = isNaN(s) ? 1 : s;
  return sig === 0 ? 0 : Math.ceil(x / Math.abs(sig)) * Math.abs(sig);
}, 1));
def("CEILING.MATH", lift(1, 3, (x, s, mode) => {
  const v = num(x), sig = s === undefined || s === "" ? 1 : Math.abs(num(s));
  if (sig === 0) return 0;
  return v < 0 && mode !== undefined && num(mode) ? Math.floor(v / sig) * sig : Math.ceil(v / sig) * sig;
}));
def("FLOOR FLOOR.PRECISE", n2((x, s) => {
  const sig = isNaN(s) ? 1 : s;
  if (sig === 0) throw DIV0();
  return Math.floor(x / Math.abs(sig)) * Math.abs(sig);
}, 1));
def("FLOOR.MATH", lift(1, 3, (x, s, mode) => {
  const v = num(x), sig = s === undefined || s === "" ? 1 : Math.abs(num(s));
  if (sig === 0) return 0;
  return v < 0 && mode !== undefined && num(mode) ? Math.ceil(v / sig) * sig : Math.floor(v / sig) * sig;
}));
def("EVEN", n1((x) => {
  const c = Math.ceil(Math.abs(x));
  return Math.sign(x || 1) * (c % 2 ? c + 1 : c);
}));
def("ODD", n1((x) => {
  const c = Math.ceil(Math.abs(x));
  return Math.sign(x || 1) * (c % 2 ? c : c + 1);
}));
def("MOD", lift(2, 2, (x, y) => {
  const d = num(y);
  if (d === 0) return DIV0();
  const v = num(x);
  return v - d * Math.floor(v / d);
}));
def("QUOTIENT", n2((x, y) => {
  if (y === 0) throw DIV0();
  return Math.trunc(x / y);
}));
def("POWER", n2((x, y) => Math.pow(x, y)));
def("SQRT", n1((x) => {
  if (x < 0) throw NUM();
  return Math.sqrt(x);
}));
def("SQRTPI", n1((x) => {
  if (x < 0) throw NUM();
  return Math.sqrt(x * Math.PI);
}));
def("EXP", n1(Math.exp));
def("LN", n1((x) => {
  if (x <= 0) throw NUM();
  return Math.log(x);
}));
def("LOG10", n1((x) => {
  if (x <= 0) throw NUM();
  return Math.log10(x);
}));
def("LOG", n2((x, b) => {
  if (x <= 0) throw NUM();
  return Math.log(x) / Math.log(isNaN(b) ? 10 : b);
}, 1));
def("PI", () => Math.PI);
def("RAND", () => Math.random());
def("RANDBETWEEN", n2((lo, hi) => Math.floor(lo + Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1))));
const fact = (n: number): number => {
  if (n < 0) throw NUM();
  let f = 1;
  for (let i = 2; i <= Math.floor(n); i++) f *= i;
  return f;
};
def("FACT", n1(fact));
def("FACTDOUBLE", n1((n) => {
  let f = 1;
  for (let i = Math.floor(n); i > 1; i -= 2) f *= i;
  return f;
}));
const combin = (n: number, k: number) => {
  n = Math.floor(n);
  k = Math.floor(k);
  if (k < 0 || n < k) throw NUM();
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
def("COMBIN", n2(combin));
def("COMBINA", n2((n, k) => combin(n + k - 1, k)));
def("PERMUT", n2((n, k) => fact(n) / fact(n - k)));
def("PERMUTATIONA", n2((n, k) => Math.pow(Math.floor(n), Math.floor(k))));
const gcd2 = (a: number, b: number): number => (b ? gcd2(b, a % b) : a);
def("GCD", (a, ctx) => numbers(ctx, a).map(Math.floor).reduce(gcd2));
def("LCM", (a, ctx) => numbers(ctx, a).map(Math.floor).reduce((x, y) => (x && y ? (x * y) / gcd2(x, y) : 0)));
def("DEGREES", n1((x) => (x * 180) / Math.PI));
def("RADIANS", n1((x) => (x * Math.PI) / 180));
for (const f of ["SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "SINH", "COSH", "TANH", "ASINH", "ACOSH", "ATANH"] as const) {
  const m = f.toLowerCase() as keyof Math;
  def(f, n1((x) => {
    const y = (Math[m] as (x: number) => number)(x);
    if (isNaN(y)) throw NUM();
    return y;
  }));
}
def("ATAN2", n2((x, y) => {
  if (x === 0 && y === 0) throw DIV0();
  return Math.atan2(y, x);
}));
def("SEC", n1((x) => 1 / Math.cos(x)));
def("CSC", n1((x) => 1 / Math.sin(x)));
def("COT", n1((x) => 1 / Math.tan(x)));
def("ROMAN", lift(1, 2, (x) => {
  let n = Math.floor(num(x));
  if (n < 0 || n > 3999) throw VALUE();
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) {
    s += r;
    n -= v;
  }
  return s;
}));
def("ARABIC", lift(1, 1, (x) => {
  const m: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const s = str(x).toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = m[s[i]], w = m[s[i + 1]] ?? 0;
    if (!v) throw VALUE();
    n += v < w ? -v : v;
  }
  return n;
}));
def("BASE", lift(2, 3, (x, b, len) => Math.floor(num(x)).toString(num(b)).toUpperCase().padStart(len === undefined ? 0 : num(len), "0")));
def("DECIMAL", lift(2, 2, (x, b) => {
  const n = parseInt(str(x), num(b));
  if (isNaN(n)) throw NUM();
  return n;
}));

// Matrices.
const matrix = (v: V) => {
  const a = toArr(v);
  return Array.from({ length: a.rows }, (_, r) => a.row(r).map((x) => num(x)));
};
def("MMULT", (a, ctx) => {
  const A = matrix(ev(ctx, a[0])), B = matrix(ev(ctx, a[1]));
  if (A[0].length !== B.length) throw VALUE();
  return Arr.of(A.map((row) => B[0].map((_, j) => row.reduce((s, x, k) => s + x * B[k][j], 0))));
});
const det = (m: number[][]): number => {
  const n = m.length;
  if (n === 1) return m[0][0];
  const a = m.map((r) => r.slice());
  let d = 1;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (a[p][i] === 0) return 0;
    if (p !== i) {
      [a[p], a[i]] = [a[i], a[p]];
      d = -d;
    }
    d *= a[i][i];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < n; c++) a[r][c] -= f * a[i][c];
    }
  }
  return d;
};
def("MDETERM", (a, ctx) => {
  const m = matrix(ev(ctx, a[0]));
  if (m.length !== m[0].length) throw VALUE();
  return det(m);
});
def("MINVERSE", (a, ctx) => {
  const m = matrix(ev(ctx, a[0]));
  const n = m.length;
  if (n !== m[0].length) throw VALUE();
  const aug = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(aug[r][i]) > Math.abs(aug[p][i])) p = r;
    if (Math.abs(aug[p][i]) < 1e-12) throw NUM();
    [aug[p], aug[i]] = [aug[i], aug[p]];
    const d = aug[i][i];
    for (let c = 0; c < 2 * n; c++) aug[i][c] /= d;
    for (let r = 0; r < n; r++)
      if (r !== i) {
        const f = aug[r][i];
        for (let c = 0; c < 2 * n; c++) aug[r][c] -= f * aug[i][c];
      }
  }
  return Arr.of(aug.map((r) => r.slice(n)));
});
def("MUNIT", (a, ctx) => {
  const n = num(sc(ctx, a[0]));
  return Arr.of(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
});

// ---- Statistics -------------------------------------------------------------------------------------

const variance = (xs: number[], sample: boolean) => {
  if (xs.length < (sample ? 2 : 1)) throw DIV0();
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0));
};
const stdev = (xs: number[], sample: boolean) => Math.sqrt(variance(xs, sample));
const median = (xs: number[]) => {
  if (!xs.length) throw NUM();
  const s = sortNum(xs);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const modes = (xs: number[]) => {
  const counts = new Map<number, number>();
  xs.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  const best = Math.max(...counts.values());
  if (best < 2) throw NA();
  return [...counts.entries()].filter(([, c]) => c === best).map(([x]) => x);
};
const mode = (xs: number[]) => modes(xs)[0];
function percentile(xs: number[], p: number, inclusive: boolean) {
  const s = sortNum(xs);
  const n = s.length;
  if (!n) throw NUM();
  let rank: number;
  if (inclusive) {
    if (p < 0 || p > 1) throw NUM();
    rank = p * (n - 1);
  } else {
    rank = p * (n + 1) - 1;
    if (rank < 0 || rank > n - 1) throw NUM();
  }
  const lo = Math.floor(rank);
  return s[lo] + (s[Math.min(lo + 1, n - 1)] - s[lo]) * (rank - lo);
}

def("AVERAGE AVG", (a, ctx) => mean(numbers(ctx, a)));
def("AVERAGEA", (a, ctx) => mean(numbers(ctx, a, true)));
def("AVERAGEIF", (a, ctx) => {
  const range = toArr(ev(ctx, a[0]));
  const test = criteria(sc(ctx, a[1]));
  const avgR = omitted(a[2]) ? range : toArr(ev(ctx, a[2]));
  return mean(range.v.flatMap((v, i) => (test(v) && typeof avgR.v[i] === "number" ? [avgR.v[i] as number] : [])));
});
def("AVERAGEIFS", (a, ctx) => {
  const r = toArr(ev(ctx, a[0]));
  const mask = ifsMask(ctx, a, 1, r.v.length);
  return mean(r.v.flatMap((x, i) => (mask[i] && typeof x === "number" ? [x] : [])));
});
def("MEDIAN", (a, ctx) => median(numbers(ctx, a)));
def("MODE MODE.SNGL", (a, ctx) => mode(numbers(ctx, a)));
def("MODE.MULT", (a, ctx) => Arr.of(modes(numbers(ctx, a)).map((x) => [x])));
def("MIN", (a, ctx) => {
  const xs = numbers(ctx, a);
  return xs.length ? Math.min(...xs) : 0;
});
def("MAX", (a, ctx) => {
  const xs = numbers(ctx, a);
  return xs.length ? Math.max(...xs) : 0;
});
def("MINA", (a, ctx) => {
  const xs = numbers(ctx, a, true);
  return xs.length ? Math.min(...xs) : 0;
});
def("MAXA", (a, ctx) => {
  const xs = numbers(ctx, a, true);
  return xs.length ? Math.max(...xs) : 0;
});
def("MINIFS", (a, ctx) => {
  const r = toArr(ev(ctx, a[0]));
  const mask = ifsMask(ctx, a, 1, r.v.length);
  const xs = r.v.flatMap((x, i) => (mask[i] && typeof x === "number" ? [x] : []));
  return xs.length ? Math.min(...xs) : 0;
});
def("MAXIFS", (a, ctx) => {
  const r = toArr(ev(ctx, a[0]));
  const mask = ifsMask(ctx, a, 1, r.v.length);
  const xs = r.v.flatMap((x, i) => (mask[i] && typeof x === "number" ? [x] : []));
  return xs.length ? Math.max(...xs) : 0;
});
def("COUNT", (a, ctx) => collect(ctx, a).filter(({ v, fromRange }) => typeof v === "number" || (!fromRange && (typeof v === "boolean" || (typeof v === "string" && typeof parseInput(v).value === "number")))).length);
def("COUNTA", (a, ctx) => flat(ctx, a).filter((v) => v !== "").length);
def("COUNTBLANK", (a, ctx) => flat(ctx, a).filter((v) => v === "").length);
def("COUNTIF", (a, ctx) => {
  const test = criteria(sc(ctx, a[1]));
  return toArr(ev(ctx, a[0])).v.filter(test).length;
});
def("COUNTIFS", (a, ctx) => {
  const first = toArr(ev(ctx, a[0]));
  return ifsMask(ctx, a, 0, first.v.length).filter(Boolean).length;
});
def("LARGE", (a, ctx) => {
  const xs = sortNum(numbers(ctx, [a[0]])).reverse();
  const k = toArr(ev(ctx, a[1]));
  const out = k.map((x) => {
    const i = Math.ceil(num(x));
    if (i < 1 || i > xs.length) return NUM();
    return xs[i - 1];
  });
  return out.v.length === 1 ? out.v[0] : out;
});
def("SMALL", (a, ctx) => {
  const xs = sortNum(numbers(ctx, [a[0]]));
  const k = toArr(ev(ctx, a[1]));
  const out = k.map((x) => {
    const i = Math.ceil(num(x));
    if (i < 1 || i > xs.length) return NUM();
    return xs[i - 1];
  });
  return out.v.length === 1 ? out.v[0] : out;
});
const rank = (x: number, xs: number[], asc: boolean, avg: boolean) => {
  const s = asc ? sortNum(xs) : sortNum(xs).reverse();
  const first = s.indexOf(x);
  if (first < 0) throw NA();
  if (!avg) return first + 1;
  const last = s.lastIndexOf(x);
  return (first + last) / 2 + 1;
};
def("RANK RANK.EQ", (a, ctx) => rank(num(sc(ctx, a[0])), numbers(ctx, [a[1]]), !omitted(a[2]) && !!num(sc(ctx, a[2])), false));
def("RANK.AVG", (a, ctx) => rank(num(sc(ctx, a[0])), numbers(ctx, [a[1]]), !omitted(a[2]) && !!num(sc(ctx, a[2])), true));
def("PERCENTILE PERCENTILE.INC", (a, ctx) => percentile(numbers(ctx, [a[0]]), num(sc(ctx, a[1])), true));
def("PERCENTILE.EXC", (a, ctx) => percentile(numbers(ctx, [a[0]]), num(sc(ctx, a[1])), false));
def("QUARTILE QUARTILE.INC", (a, ctx) => percentile(numbers(ctx, [a[0]]), num(sc(ctx, a[1])) / 4, true));
def("QUARTILE.EXC", (a, ctx) => percentile(numbers(ctx, [a[0]]), num(sc(ctx, a[1])) / 4, false));
const pctRank = (xs: number[], x: number, inc: boolean, sig: number) => {
  const s = sortNum(xs);
  const n = s.length;
  if (!n || x < s[0] || x > s[n - 1]) throw NA();
  let below = s.filter((v) => v < x).length;
  if (!s.includes(x)) {
    const i = below - 1;
    below = i + (x - s[i]) / (s[i + 1] - s[i]);
  }
  const r = inc ? below / (n - 1) : (below + 1) / (n + 1);
  const f = 10 ** sig;
  return Math.floor(r * f) / f;
};
def("PERCENTRANK PERCENTRANK.INC", (a, ctx) => pctRank(numbers(ctx, [a[0]]), num(sc(ctx, a[1])), true, omitted(a[2]) ? 3 : num(sc(ctx, a[2]))));
def("PERCENTRANK.EXC", (a, ctx) => pctRank(numbers(ctx, [a[0]]), num(sc(ctx, a[1])), false, omitted(a[2]) ? 3 : num(sc(ctx, a[2]))));
def("STDEV STDEV.S", (a, ctx) => stdev(numbers(ctx, a), true));
def("STDEVP STDEV.P", (a, ctx) => stdev(numbers(ctx, a), false));
def("STDEVA", (a, ctx) => stdev(numbers(ctx, a, true), true));
def("STDEVPA", (a, ctx) => stdev(numbers(ctx, a, true), false));
def("VAR VAR.S", (a, ctx) => variance(numbers(ctx, a), true));
def("VARP VAR.P", (a, ctx) => variance(numbers(ctx, a), false));
def("VARA", (a, ctx) => variance(numbers(ctx, a, true), true));
def("VARPA", (a, ctx) => variance(numbers(ctx, a, true), false));
def("DEVSQ", (a, ctx) => {
  const xs = numbers(ctx, a);
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2));
});
def("AVEDEV", (a, ctx) => {
  const xs = numbers(ctx, a);
  const m = mean(xs);
  return sum(xs.map((x) => Math.abs(x - m))) / xs.length;
});
def("GEOMEAN", (a, ctx) => {
  const xs = numbers(ctx, a);
  if (xs.some((x) => x <= 0)) throw NUM();
  return Math.exp(sum(xs.map(Math.log)) / xs.length);
});
def("HARMEAN", (a, ctx) => {
  const xs = numbers(ctx, a);
  if (xs.some((x) => x <= 0)) throw NUM();
  return xs.length / sum(xs.map((x) => 1 / x));
});
def("TRIMMEAN", (a, ctx) => {
  const xs = sortNum(numbers(ctx, [a[0]]));
  const p = num(sc(ctx, a[1]));
  const k = Math.floor((xs.length * p) / 2);
  return mean(xs.slice(k, xs.length - k));
});
def("SKEW", (a, ctx) => {
  const xs = numbers(ctx, a);
  const n = xs.length, m = mean(xs), s = stdev(xs, true);
  return (n / ((n - 1) * (n - 2))) * sum(xs.map((x) => ((x - m) / s) ** 3));
});
def("SKEW.P", (a, ctx) => {
  const xs = numbers(ctx, a);
  const m = mean(xs), s = stdev(xs, false);
  return sum(xs.map((x) => ((x - m) / s) ** 3)) / xs.length;
});
def("KURT", (a, ctx) => {
  const xs = numbers(ctx, a);
  const n = xs.length, m = mean(xs), s = stdev(xs, true);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum(xs.map((x) => ((x - m) / s) ** 4)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
});
const pairs = (ctx: Ctx, a: Node[]) => {
  const x = toArr(ev(ctx, a[0])).v, y = toArr(ev(ctx, a[1])).v;
  if (x.length !== y.length) throw NA();
  const xs: number[] = [], ys: number[] = [];
  x.forEach((v, i) => {
    if (typeof v === "number" && typeof y[i] === "number") {
      xs.push(v);
      ys.push(y[i] as number);
    }
  });
  return [xs, ys];
};
const covar = (xs: number[], ys: number[], sample: boolean) => {
  const mx = mean(xs), my = mean(ys);
  return sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / (xs.length - (sample ? 1 : 0));
};
const correl = (xs: number[], ys: number[]) => covar(xs, ys, true) / (stdev(xs, true) * stdev(ys, true));
def("CORREL PEARSON", (a, ctx) => {
  const [x, y] = pairs(ctx, a);
  return correl(x, y);
});
def("RSQ", (a, ctx) => {
  const [x, y] = pairs(ctx, a);
  return correl(x, y) ** 2;
});
def("COVAR COVARIANCE.P", (a, ctx) => {
  const [x, y] = pairs(ctx, a);
  return covar(x, y, false);
});
def("COVARIANCE.S", (a, ctx) => {
  const [x, y] = pairs(ctx, a);
  return covar(x, y, true);
});
const linear = (ys: number[], xs: number[]) => {
  const mx = mean(xs), my = mean(ys);
  const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map((x) => (x - mx) ** 2));
  return { slope, intercept: my - slope * mx };
};
def("SLOPE", (a, ctx) => {
  const [y, x] = pairs(ctx, a);
  return linear(y, x).slope;
});
def("INTERCEPT", (a, ctx) => {
  const [y, x] = pairs(ctx, a);
  return linear(y, x).intercept;
});
def("STEYX", (a, ctx) => {
  const [y, x] = pairs(ctx, a);
  const { slope, intercept } = linear(y, x);
  return Math.sqrt(sum(y.map((v, i) => (v - (intercept + slope * x[i])) ** 2)) / (y.length - 2));
});
def("FORECAST FORECAST.LINEAR", (a, ctx) => {
  const x0 = toArr(ev(ctx, a[0]));
  const [y, x] = pairs(ctx, [a[1], a[2]]);
  const { slope, intercept } = linear(y, x);
  const out = x0.map((v) => intercept + slope * num(v));
  return out.v.length === 1 ? out.v[0] : out;
});
def("TREND GROWTH", (a, ctx) => {
  const ys = numbers(ctx, [a[0]]);
  const xs = omitted(a[1]) ? ys.map((_, i) => i + 1) : numbers(ctx, [a[1]]);
  const nx = omitted(a[2]) ? toArr(Arr.of(xs.map((x) => [x]))) : toArr(ev(ctx, a[2]));
  const { slope, intercept } = linear(ys, xs);
  return nx.map((v) => intercept + slope * num(v));
});
FUNCTIONS.GROWTH = (a, ctx) => {
  const ys = numbers(ctx, [a[0]]);
  const xs = omitted(a[1]) ? ys.map((_, i) => i + 1) : numbers(ctx, [a[1]]);
  const nx = omitted(a[2]) ? Arr.of(xs.map((x) => [x])) : toArr(ev(ctx, a[2]));
  const { slope, intercept } = linear(ys.map(Math.log), xs);
  return nx.map((v) => Math.exp(intercept + slope * num(v)));
};
def("FREQUENCY", (a, ctx) => {
  const data = numbers(ctx, [a[0]]);
  const bins = sortNum(numbers(ctx, [a[1]]));
  const counts = new Array(bins.length + 1).fill(0);
  data.forEach((x) => {
    const i = bins.findIndex((b) => x <= b);
    counts[i < 0 ? bins.length : i]++;
  });
  return Arr.of(counts.map((c) => [c]));
});
def("STANDARDIZE", lift(3, 3, (x, m, s) => (num(x) - num(m)) / num(s)));
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const normInv = (p: number) => {
  if (p <= 0 || p >= 1) throw NUM();
  // Acklam's approximation.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : 0;
  if (p < 0.02425) return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p > 1 - 0.02425) return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  const r = p - 0.5, s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
};
def("NORM.DIST NORMDIST", lift(4, 4, (x, m, s, cum) => {
  const z = (num(x) - num(m)) / num(s);
  return bool(cum) ? normCdf(z) : Math.exp(-0.5 * z * z) / (num(s) * Math.sqrt(2 * Math.PI));
}));
def("NORM.S.DIST", lift(1, 2, (z, cum) => (cum === undefined || bool(cum) ? normCdf(num(z)) : Math.exp(-0.5 * num(z) ** 2) / Math.sqrt(2 * Math.PI))));
def("NORMSDIST", n1(normCdf));
def("NORM.INV NORMINV", lift(3, 3, (p, m, s) => num(m) + num(s) * normInv(num(p))));
def("NORM.S.INV NORMSINV", n1(normInv));
def("ERF", n1(erf));
def("CONFIDENCE CONFIDENCE.NORM", lift(3, 3, (al, s, n) => (normInv(1 - num(al) / 2) * num(s)) / Math.sqrt(num(n))));

// ---- Logic -----------------------------------------------------------------------------------------

def("IF", (a, ctx) => {
  const test = ev(ctx, a[0]);
  if (test instanceof Arr) {
    const t = ev(ctx, a[1]), f = a.length > 2 ? ev(ctx, a[2]) : false;
    return test.map((x, r, c) => {
      const yes = bool(rethrow(x));
      const pick = yes ? t : f;
      return pick instanceof Arr ? pick.at(r, c) : scalarOf(pick);
    });
  }
  const yes = bool(scalarOf(test));
  return yes ? ev(ctx, a[1]) : a.length > 2 ? ev(ctx, a[2]) : false;
});
def("IFS", (a, ctx) => {
  for (let i = 0; i + 1 < a.length; i += 2) if (bool(sc(ctx, a[i]))) return ev(ctx, a[i + 1]);
  return NA();
});
def("IFERROR", (a, ctx) => {
  try {
    const v = ev(ctx, a[0]);
    if (v instanceof Arr) {
      const alt = scalarOf(ev(ctx, a[1]));
      return v.map((x) => (x instanceof FErr ? alt : x));
    }
    return v instanceof FErr ? ev(ctx, a[1]) : v;
  } catch (e) {
    if (e instanceof FErr) return ev(ctx, a[1]);
    throw e;
  }
});
def("IFNA", (a, ctx) => {
  try {
    const v = ev(ctx, a[0]);
    return v instanceof FErr && v.code === "#N/A" ? ev(ctx, a[1]) : v;
  } catch (e) {
    if (e instanceof FErr && e.code === "#N/A") return ev(ctx, a[1]);
    throw e;
  }
});
const truthies = (ctx: Ctx, a: Node[]) =>
  collect(ctx, a)
    .filter(({ v, fromRange }) => !(fromRange && (typeof v === "string")))
    .map(({ v }) => bool(v));
def("AND", (a, ctx) => {
  const xs = truthies(ctx, a);
  if (!xs.length) return VALUE();
  return xs.every(Boolean);
});
def("OR", (a, ctx) => {
  const xs = truthies(ctx, a);
  if (!xs.length) return VALUE();
  return xs.some(Boolean);
});
def("XOR", (a, ctx) => truthies(ctx, a).filter(Boolean).length % 2 === 1);
def("NOT", lift(1, 1, (x) => !bool(x)));
def("TRUE", () => true);
def("FALSE", () => false);
def("SWITCH", (a, ctx) => {
  const v = sc(ctx, a[0]);
  let i = 1;
  for (; i + 1 < a.length; i += 2) {
    const m = sc(ctx, a[i]);
    if (!(v instanceof FErr) && !(m instanceof FErr) && compareVals(v, m) === 0) return ev(ctx, a[i + 1]);
  }
  return i < a.length ? ev(ctx, a[i]) : NA();
});
def("CHOOSE", (a, ctx) => {
  const i = Math.floor(num(sc(ctx, a[0])));
  if (i < 1 || i >= a.length) return VALUE();
  return ev(ctx, a[i]);
});
def("LET", (a, ctx) => {
  const env = new Map(ctx.env);
  for (let i = 0; i + 1 < a.length; i += 2) {
    const n = a[i];
    if (n.k !== "name") throw VALUE();
    env.set(n.name, ctx.evaluate(a[i + 1], env));
  }
  return ctx.evaluate(a[a.length - 1], env);
});
def("LAMBDA", (a, ctx) => {
  const params = a.slice(0, -1).map((n) => {
    if (n.k !== "name") throw VALUE();
    return n.name;
  });
  return new Lambda(params, a[a.length - 1], new Map(ctx.env));
});
def("ISOMITTED", (a, ctx) => {
  const n = a[0];
  return n?.k === "name" && ctx.env.get(n.name) === undefined;
});

// ---- Information -------------------------------------------------------------------------------------

const isErr = (fn: (e: FErr | null, v: Val) => boolean): Fn => (a, ctx) => {
  let v: V;
  try {
    v = ev(ctx, a[0]);
  } catch (e) {
    if (e instanceof FErr) return fn(e, "");
    throw e;
  }
  if (v instanceof Arr) return v.map((x) => fn(x instanceof FErr ? x : null, x instanceof FErr ? "" : x));
  const s = scalarOf(v);
  return fn(s instanceof FErr ? s : null, s instanceof FErr ? "" : s);
};
def("ISERROR", isErr((e) => !!e));
def("ISERR", isErr((e) => !!e && e.code !== "#N/A"));
def("ISNA", isErr((e) => e?.code === "#N/A"));
def("ISBLANK", isErr((e, v) => !e && v === ""));
def("ISNUMBER", isErr((e, v) => !e && typeof v === "number"));
def("ISTEXT", isErr((e, v) => !e && typeof v === "string" && v !== ""));
def("ISNONTEXT", isErr((e, v) => !!e || typeof v !== "string" || v === ""));
def("ISLOGICAL", isErr((e, v) => !e && typeof v === "boolean"));
def("ISEVEN", lift(1, 1, (x) => Math.floor(Math.abs(num(x))) % 2 === 0));
def("ISODD", lift(1, 1, (x) => Math.floor(Math.abs(num(x))) % 2 === 1));
def("ISREF", (a) => ["ref", "range", "spill"].includes(a[0]?.k ?? ""));
def("ISFORMULA", (a, ctx) => {
  const n = a[0];
  if (n?.k !== "ref") return false;
  return ctx.book.raw(ctx.book.sheetIndex(n.s, ctx.sheet), n.r, n.c).startsWith("=");
});
def("FORMULATEXT", (a, ctx) => {
  const n = a[0];
  if (n?.k !== "ref") return NA();
  const raw = ctx.book.raw(ctx.book.sheetIndex(n.s, ctx.sheet), n.r, n.c);
  return raw.startsWith("=") ? raw : NA();
});
def("TYPE", (a, ctx) => {
  const v = ev(ctx, a[0]);
  if (v instanceof Arr) return 64;
  if (v instanceof FErr) return 16;
  return typeof v === "number" ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 4 : 16;
});
def("N", lift(1, 1, (x) => (typeof x === "number" ? x : typeof x === "boolean" ? (x ? 1 : 0) : x instanceof FErr ? x : 0)));
def("NA", () => NA());
def("ERROR.TYPE", (a, ctx) => {
  const v = sc(ctx, a[0]);
  const codes = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA"];
  return v instanceof FErr && codes.includes(v.code) ? codes.indexOf(v.code) + 1 : NA();
});
def("SHEET", (a, ctx) => {
  const n = a[0];
  if (!n) return ctx.sheet + 1;
  if (n.k === "ref" || n.k === "range") return ctx.book.sheetIndex(n.s, ctx.sheet) + 1;
  const i = ctx.book.sheetIndex(str(sc(ctx, n)));
  return i < 0 ? NA() : i + 1;
});
def("SHEETS", (_a, ctx) => ctx.book.src.sheets.length);
def("CELL", (a, ctx) => {
  const what = str(sc(ctx, a[0])).toLowerCase();
  const n = a[1] && (a[1].k === "ref" ? a[1] : a[1].k === "range" ? { ...a[1], r: a[1].r1, c: a[1].c1 } : null);
  const r = n ? (n as { r: number }).r : ctx.r, c = n ? (n as { c: number }).c : ctx.c;
  switch (what) {
    case "row": return r + 1;
    case "col": return c + 1;
    case "address": return `$${colLetters(c)}$${r + 1}`;
    case "contents": return ctx.book.value(ctx.sheet, r, c);
    case "type": {
      const v = ctx.book.raw(ctx.sheet, r, c);
      return v === "" ? "b" : typeof ctx.book.value(ctx.sheet, r, c) === "string" ? "l" : "v";
    }
    case "filename": return "";
    default: return VALUE();
  }
});
def("INFO", (a, ctx) => {
  const t = str(sc(ctx, a[0])).toLowerCase();
  return t === "numfile" ? ctx.book.src.sheets.length : t === "osversion" ? "Forma" : t === "system" ? "pcdos" : t === "release" ? "16.0" : NA();
});
const colLetters = (i: number) => {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

// ---- Text ---------------------------------------------------------------------------------------------

const s1 = (fn: (s: string) => Val) => lift(1, 1, (x) => fn(str(x)));
def("LEN", s1((s) => s.length));
def("LOWER", s1((s) => s.toLowerCase()));
def("UPPER", s1((s) => s.toUpperCase()));
def("PROPER", s1((s) => s.toLowerCase().replace(/(^|[^a-zA-Z\u00C0-\uFFFF'])([a-z\u00E0-\uFFFF])/g, (_, p, c) => p + c.toUpperCase())));
def("TRIM", s1((s) => s.trim().replace(/ +/g, " ")));
def("CLEAN", s1((s) => s.replace(/[\x00-\x1f]/g, "")));
def("LEFT", lift(1, 2, (s, n) => str(s).slice(0, n === undefined ? 1 : Math.max(0, num(n)))));
def("RIGHT", lift(1, 2, (s, n) => {
  const k = n === undefined ? 1 : num(n);
  return k <= 0 ? "" : str(s).slice(-k);
}));
def("MID", lift(3, 3, (s, a, n) => {
  if (num(a) < 1 || num(n) < 0) throw VALUE();
  return str(s).substr(num(a) - 1, num(n));
}));
def("CONCAT", (a, ctx) => flat(ctx, a).map((v) => str(rethrow(v))).join(""));
def("CONCATENATE", lift(1, 255, (...xs) => xs.map(str).join("")));
def("TEXTJOIN", (a, ctx) => {
  const delims = toArr(ev(ctx, a[0])).v.map((d) => str(rethrow(d)));
  const skip = bool(sc(ctx, a[1]));
  const parts = flat(ctx, a.slice(2)).map((v) => str(rethrow(v))).filter((s) => !(skip && s === ""));
  return parts.map((p, i) => (i ? delims[(i - 1) % delims.length] : "") + p).join("");
});
def("TEXT", lift(2, 2, (v, f) => formatValue(v instanceof FErr ? rethrow(v) : typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : v, str(f)).text));
def("VALUE", lift(1, 1, (x) => (typeof x === "number" ? x : num(x))));
def("NUMBERVALUE", lift(1, 3, (x, dec, grp) => {
  let s = str(x).trim();
  const d = dec === undefined ? "." : str(dec), g = grp === undefined ? "," : str(grp);
  s = s.split(g).join("").replace(d, ".");
  const pct = (s.match(/%/g) ?? []).length;
  const n = Number(s.replace(/%/g, ""));
  if (isNaN(n)) throw VALUE();
  return n / 100 ** pct;
}));
def("EXACT", lift(2, 2, (a, b) => str(a) === str(b)));
def("FIND FINDB", lift(2, 3, (f, s, st) => {
  const i = str(s).indexOf(str(f), st === undefined ? 0 : num(st) - 1);
  return i < 0 ? VALUE() : i + 1;
}));
def("SEARCH SEARCHB", lift(2, 3, (f, s, st) => {
  const pat = str(f).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?");
  const start = st === undefined ? 0 : num(st) - 1;
  const m = new RegExp(pat, "i").exec(str(s).slice(start));
  return m ? m.index + start + 1 : VALUE();
}));
def("REPLACE REPLACEB", lift(4, 4, (s, a, n, t) => {
  const x = str(s);
  return x.slice(0, num(a) - 1) + str(t) + x.slice(num(a) - 1 + num(n));
}));
def("SUBSTITUTE", lift(3, 4, (s, o, n, k) => {
  const x = str(s), old = str(o), rep = str(n);
  if (!old) return x;
  if (k === undefined) return x.split(old).join(rep);
  let count = 0;
  return x.replace(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (m) => (++count === num(k) ? rep : m));
}));
def("REPT", lift(2, 2, (s, n) => str(s).repeat(Math.max(0, Math.floor(num(n))))));
def("CHAR", lift(1, 1, (x) => String.fromCharCode(num(x))));
def("UNICHAR", lift(1, 1, (x) => String.fromCodePoint(num(x))));
def("CODE", lift(1, 1, (x) => {
  const s = str(x);
  if (!s) throw VALUE();
  return s.charCodeAt(0);
}));
def("UNICODE", lift(1, 1, (x) => {
  const s = str(x);
  if (!s) throw VALUE();
  return s.codePointAt(0)!;
}));
def("T", lift(1, 1, (x) => (typeof x === "string" ? x : "")));
def("FIXED", lift(1, 3, (x, d, noCommas) => {
  const dec = d === undefined ? 2 : num(d);
  const v = roundTo(num(x), dec, "half");
  const s = Math.abs(v).toFixed(Math.max(0, dec));
  const [i, f] = s.split(".");
  return (v < 0 ? "-" : "") + (noCommas !== undefined && bool(noCommas) ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + (f ? "." + f : "");
}));
def("DOLLAR", lift(1, 2, (x, d) => formatValue(num(x), `$#,##0${(d === undefined ? 2 : num(d)) > 0 ? "." + "0".repeat(num(d ?? 2)) : ""};($#,##0${(d === undefined ? 2 : num(d)) > 0 ? "." + "0".repeat(num(d ?? 2)) : ""})`).text));
def("ASC JIS PHONETIC DBCS", s1((s) => s));
def("TEXTBEFORE", lift(2, 6, (s, d, n, mode, _end, nf) => {
  const text = str(s), delim = str(d), k = n === undefined ? 1 : num(n);
  const hay = mode !== undefined && num(mode) ? text.toLowerCase() : text, needle = mode !== undefined && num(mode) ? delim.toLowerCase() : delim;
  let idx = -1;
  if (k > 0) {
    let from = 0;
    for (let i = 0; i < k; i++) {
      idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      from = idx + needle.length;
    }
  } else {
    let from = hay.length;
    for (let i = 0; i < -k; i++) {
      idx = hay.lastIndexOf(needle, from);
      if (idx < 0) break;
      from = idx - 1;
    }
  }
  if (idx < 0) return nf === undefined ? NA() : nf;
  return text.slice(0, idx);
}));
def("TEXTAFTER", lift(2, 6, (s, d, n, mode, _end, nf) => {
  const text = str(s), delim = str(d), k = n === undefined ? 1 : num(n);
  const hay = mode !== undefined && num(mode) ? text.toLowerCase() : text, needle = mode !== undefined && num(mode) ? delim.toLowerCase() : delim;
  let idx = -1;
  if (k > 0) {
    let from = 0;
    for (let i = 0; i < k; i++) {
      idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      from = idx + needle.length;
    }
  } else {
    let from = hay.length;
    for (let i = 0; i < -k; i++) {
      idx = hay.lastIndexOf(needle, from);
      if (idx < 0) break;
      from = idx - 1;
    }
  }
  if (idx < 0) return nf === undefined ? NA() : nf;
  return text.slice(idx + needle.length);
}));
def("TEXTSPLIT", (a, ctx) => {
  const text = str(sc(ctx, a[0]));
  const colD = omitted(a[1]) ? [] : toArr(ev(ctx, a[1])).v.map((x) => str(rethrow(x)));
  const rowD = omitted(a[2]) ? [] : toArr(ev(ctx, a[2])).v.map((x) => str(rethrow(x)));
  const ignore = !omitted(a[3]) && bool(sc(ctx, a[3]));
  const pad = omitted(a[5]) ? NA() : sc(ctx, a[5]);
  const split = (s: string, ds: string[]) => {
    if (!ds.length) return [s];
    const re = new RegExp(ds.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
    return s.split(re).filter((x) => !(ignore && x === ""));
  };
  const rows = split(text, rowD).map((r) => split(r, colD));
  const cols = Math.max(...rows.map((r) => r.length));
  return Arr.of(rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? pad)));
});
const regex = (p: Val | FErr, cs?: Val | FErr) => {
  try {
    return new RegExp(str(p), cs !== undefined && num(cs) === 1 ? "g" : "gi");
  } catch {
    throw VALUE();
  }
};
def("REGEXTEST", lift(2, 3, (s, p, cs) => regex(p, cs).test(str(s))));
def("REGEXEXTRACT", lift(2, 4, (s, p, mode, cs) => {
  const re = regex(p, cs);
  const m = mode === undefined || num(mode) === 0 ? str(s).match(new RegExp(re.source, re.flags.replace("g", ""))) : str(s).match(re);
  if (!m) return NA();
  return m[0];
}));
def("REGEXREPLACE", lift(3, 5, (s, p, r, occ, cs) => {
  const re = regex(p, cs);
  if (occ === undefined || num(occ) === 0) return str(s).replace(re, str(r));
  let i = 0;
  return str(s).replace(re, (m) => (++i === num(occ) ? str(r) : m));
}));

// ---- Dates and times ----------------------------------------------------------------------------------

const D = (x: Val | FErr) => {
  if (typeof x === "string") {
    const p = parseDate(x);
    if (p) return p.serial;
  }
  return num(x);
};
const ymd = (x: Val | FErr) => {
  const d = fromSerial(Math.floor(D(x)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
};
def("TODAY", () => todaySerial());
def("NOW", () => nowSerial());
def("DATE", lift(3, 3, (y, m, d) => {
  let yr = Math.floor(num(y));
  if (yr < 1900) yr += 1900;
  return toSerial(yr, Math.floor(num(m)), Math.floor(num(d)));
}));
def("TIME", lift(3, 3, (h, m, s) => (((num(h) * 3600 + num(m) * 60 + num(s)) / 86400) % 1 + 1) % 1));
def("DATEVALUE", lift(1, 1, (s) => {
  const p = parseDate(str(s));
  if (!p) throw VALUE();
  return Math.floor(p.serial);
}));
def("TIMEVALUE", lift(1, 1, (s) => {
  const p = parseDate(str(s));
  if (!p) throw VALUE();
  return p.serial % 1;
}));
def("YEAR", lift(1, 1, (x) => ymd(x).y));
def("MONTH", lift(1, 1, (x) => ymd(x).m));
def("DAY", lift(1, 1, (x) => ymd(x).d));
const tod = (x: Val | FErr) => Math.round((D(x) % 1) * 86400);
def("HOUR", lift(1, 1, (x) => Math.floor(tod(x) / 3600) % 24));
def("MINUTE", lift(1, 1, (x) => Math.floor(tod(x) / 60) % 60));
def("SECOND", lift(1, 1, (x) => tod(x) % 60));
def("WEEKDAY", lift(1, 2, (x, t) => {
  const w = ymd(x).w;
  const type = t === undefined ? 1 : num(t);
  if (type === 1 || type === 17) return w + 1;
  if (type === 2 || type === 11) return ((w + 6) % 7) + 1;
  if (type === 3) return (w + 6) % 7;
  if (type >= 12 && type <= 16) return ((w - (type - 10) + 7) % 7) + 1;
  throw NUM();
}));
const isoWeek = (serial: number) => {
  const d = fromSerial(Math.floor(serial));
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
};
def("ISOWEEKNUM", lift(1, 1, (x) => isoWeek(D(x))));
def("WEEKNUM", lift(1, 2, (x, t) => {
  const type = t === undefined ? 1 : num(t);
  if (type === 21) return isoWeek(D(x));
  const { y } = ymd(x);
  const jan1 = toSerial(y, 1, 1);
  const start = type === 2 || type === 11 ? 1 : type >= 12 && type <= 17 ? type - 10 : 0;
  const w1 = fromSerial(jan1).getUTCDay();
  const offset = (w1 - start + 7) % 7;
  return Math.floor((Math.floor(D(x)) - jan1 + offset) / 7) + 1;
}));
def("DAYS", lift(2, 2, (e, s) => Math.floor(D(e)) - Math.floor(D(s))));
def("DAYS360", lift(2, 3, (s, e, m) => {
  const a = ymd(s), b = ymd(e);
  const eu = m !== undefined && bool(m);
  let d1 = a.d, d2 = b.d;
  if (eu) {
    d1 = Math.min(d1, 30);
    d2 = Math.min(d2, 30);
  } else {
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}));
def("DATEDIF", lift(3, 3, (s, e, u) => {
  const a = ymd(s), b = ymd(e);
  const start = Math.floor(D(s)), end = Math.floor(D(e));
  if (start > end) throw NUM();
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months--;
  switch (str(u).toUpperCase()) {
    case "Y": return Math.floor(months / 12);
    case "M": return months;
    case "D": return end - start;
    case "YM": return months % 12;
    case "MD": return b.d >= a.d ? b.d - a.d : end - toSerial(b.y, b.m - 1, a.d);
    case "YD": {
      let s2 = toSerial(b.y, a.m, a.d);
      if (s2 > end) s2 = toSerial(b.y - 1, a.m, a.d);
      return end - s2;
    }
    default: throw NUM();
  }
}));
def("EDATE", lift(2, 2, (s, m) => {
  const a = ymd(s);
  const target = new Date(Date.UTC(a.y, a.m - 1 + Math.trunc(num(m)), 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return toSerial(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(a.d, last));
}));
def("EOMONTH", lift(2, 2, (s, m) => {
  const a = ymd(s);
  const d = new Date(Date.UTC(a.y, a.m + Math.trunc(num(m)), 0));
  return toSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}));
const weekendMask = (w: Val | FErr | undefined): boolean[] => {
  // Index 0 = Monday … 6 = Sunday.
  if (w === undefined || w === "") return [false, false, false, false, false, true, true];
  if (typeof w === "string" && /^[01]{7}$/.test(w)) return w.split("").map((x) => x === "1");
  const n = num(w);
  const pairs: Record<number, number[]> = { 1: [5, 6], 2: [6, 0], 3: [0, 1], 4: [1, 2], 5: [2, 3], 6: [3, 4], 7: [4, 5], 11: [6], 12: [0], 13: [1], 14: [2], 15: [3], 16: [4], 17: [5] };
  const days = pairs[n];
  if (!days) throw NUM();
  return Array.from({ length: 7 }, (_, i) => days.includes(i));
};
const holidaysOf = (ctx: Ctx, n?: Node) => new Set(omitted(n) ? [] : toArr(ev(ctx, n)).v.filter((v) => v !== "").map((v) => Math.floor(D(v))));
const isWork = (s: number, wk: boolean[], hol: Set<number>) => !wk[(fromSerial(s).getUTCDay() + 6) % 7] && !hol.has(s);
const workday = (start: number, days: number, wk: boolean[], hol: Set<number>) => {
  let s = Math.floor(start);
  const step = days < 0 ? -1 : 1;
  let left = Math.abs(Math.trunc(days));
  while (left > 0) {
    s += step;
    if (isWork(s, wk, hol)) left--;
  }
  return s;
};
def("WORKDAY", (a, ctx) => workday(D(sc(ctx, a[0])), num(sc(ctx, a[1])), weekendMask(undefined), holidaysOf(ctx, a[2])));
def("WORKDAY.INTL", (a, ctx) => workday(D(sc(ctx, a[0])), num(sc(ctx, a[1])), weekendMask(omitted(a[2]) ? undefined : sc(ctx, a[2])), holidaysOf(ctx, a[3])));
const networkdays = (s: number, e: number, wk: boolean[], hol: Set<number>) => {
  let a = Math.floor(s), b = Math.floor(e), sign = 1;
  if (a > b) {
    [a, b] = [b, a];
    sign = -1;
  }
  let n = 0;
  for (let d = a; d <= b; d++) if (isWork(d, wk, hol)) n++;
  return n * sign;
};
def("NETWORKDAYS", (a, ctx) => networkdays(D(sc(ctx, a[0])), D(sc(ctx, a[1])), weekendMask(undefined), holidaysOf(ctx, a[2])));
def("NETWORKDAYS.INTL", (a, ctx) => networkdays(D(sc(ctx, a[0])), D(sc(ctx, a[1])), weekendMask(omitted(a[2]) ? undefined : sc(ctx, a[2])), holidaysOf(ctx, a[3])));
def("YEARFRAC", lift(2, 3, (s, e, b) => {
  let x = Math.floor(D(s)), y = Math.floor(D(e));
  if (x > y) [x, y] = [y, x];
  const basis = b === undefined ? 0 : num(b);
  const A = ymd(x), B = ymd(y);
  switch (basis) {
    case 0: {
      let d1 = A.d, d2 = B.d;
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 === 30) d2 = 30;
      return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + (d2 - d1)) / 360;
    }
    case 1: {
      const years = B.y - A.y + 1;
      const days = toSerial(B.y + 1, 1, 1) - toSerial(A.y, 1, 1);
      return (y - x) / (days / years);
    }
    case 2: return (y - x) / 360;
    case 3: return (y - x) / 365;
    case 4: return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + (Math.min(B.d, 30) - Math.min(A.d, 30))) / 360;
    default: throw NUM();
  }
}));

// ---- Lookup and reference -------------------------------------------------------------------------------

const match = (needle: Val | FErr, list: (Val | FErr)[], mode: number): number => {
  if (needle instanceof FErr) throw needle;
  if (mode === 0) {
    const test = typeof needle === "string" && /[*?]/.test(needle) ? criteria(needle) : null;
    return list.findIndex((v) => !(v instanceof FErr) && (test ? test(v) : v !== "" && compareVals(v, needle) === 0 && (typeof v === "string") === (typeof needle === "string")));
  }
  // Approximate: largest ≤ needle (mode 1) or smallest ≥ needle (mode -1), list sorted.
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v instanceof FErr || v === "" || (typeof v === "string") !== (typeof needle === "string")) continue;
    const d = compareVals(v, needle);
    if (mode > 0 ? d <= 0 : d >= 0) best = i;
    else if (mode > 0) break;
  }
  return best;
};
def("VLOOKUP", (a, ctx) => {
  const needle = ev(ctx, a[0]);
  const table = toArr(ev(ctx, a[1]));
  const col = Math.floor(num(sc(ctx, a[2])));
  const approx = omitted(a[3]) ? true : bool(sc(ctx, a[3]));
  if (col < 1 || col > table.cols) return new FErr("#REF!");
  const look = (n: Val | FErr) => {
    const i = match(n, table.col(0), approx ? 1 : 0);
    return i < 0 ? NA() : table.v[i * table.cols + col - 1];
  };
  return needle instanceof Arr ? needle.map(look) : look(scalarOf(needle));
});
def("HLOOKUP", (a, ctx) => {
  const needle = ev(ctx, a[0]);
  const table = toArr(ev(ctx, a[1]));
  const row = Math.floor(num(sc(ctx, a[2])));
  const approx = omitted(a[3]) ? true : bool(sc(ctx, a[3]));
  if (row < 1 || row > table.rows) return new FErr("#REF!");
  const look = (n: Val | FErr) => {
    const i = match(n, table.row(0), approx ? 1 : 0);
    return i < 0 ? NA() : table.v[(row - 1) * table.cols + i];
  };
  return needle instanceof Arr ? needle.map(look) : look(scalarOf(needle));
});
def("LOOKUP", (a, ctx) => {
  const needle = sc(ctx, a[0]);
  const vec = toArr(ev(ctx, a[1]));
  const lookIn = vec.rows >= vec.cols ? vec.col(0) : vec.row(0);
  const result = omitted(a[2]) ? (vec.rows >= vec.cols ? vec.col(vec.cols - 1) : vec.row(vec.rows - 1)) : toArr(ev(ctx, a[2])).v;
  const i = match(needle, lookIn, 1);
  return i < 0 ? NA() : result[i] ?? NA();
});
def("MATCH", (a, ctx) => {
  const needle = ev(ctx, a[0]);
  const list = toArr(ev(ctx, a[1])).v;
  const mode = omitted(a[2]) ? 1 : num(sc(ctx, a[2]));
  const one = (n: Val | FErr) => {
    const i = match(n, list, mode > 0 ? 1 : mode < 0 ? -1 : 0);
    return i < 0 ? NA() : i + 1;
  };
  return needle instanceof Arr ? needle.map(one) : one(scalarOf(needle));
});
const xmatch = (needle: Val | FErr, list: (Val | FErr)[], mode: number, search: number): number => {
  if (needle instanceof FErr) throw needle;
  const order = search < 0 ? [...list.keys()].reverse() : [...list.keys()];
  if (mode === 2) {
    const test = criteria(needle);
    return order.find((i) => test(list[i])) ?? -1;
  }
  let exact = order.find((i) => {
    const v = list[i];
    return !(v instanceof FErr) && v !== "" && compareVals(v, needle) === 0;
  });
  if (exact !== undefined || mode === 0) return exact ?? -1;
  let best = -1;
  for (const i of order) {
    const v = list[i];
    if (v instanceof FErr || v === "" || (typeof v === "string") !== (typeof needle === "string")) continue;
    const d = compareVals(v, needle);
    if (mode === -1 && d < 0 && (best < 0 || compareVals(v, list[best] as Val) > 0)) best = i;
    if (mode === 1 && d > 0 && (best < 0 || compareVals(v, list[best] as Val) < 0)) best = i;
  }
  exact = best;
  return exact;
};
def("XMATCH", (a, ctx) => {
  const needle = ev(ctx, a[0]);
  const list = toArr(ev(ctx, a[1])).v;
  const mode = omitted(a[2]) ? 0 : num(sc(ctx, a[2]));
  const search = omitted(a[3]) ? 1 : num(sc(ctx, a[3]));
  const one = (n: Val | FErr) => {
    const i = xmatch(n, list, mode, search);
    return i < 0 ? NA() : i + 1;
  };
  return needle instanceof Arr ? needle.map(one) : one(scalarOf(needle));
});
def("XLOOKUP", (a, ctx) => {
  const needle = ev(ctx, a[0]);
  const lookIn = toArr(ev(ctx, a[1]));
  const ret = toArr(ev(ctx, a[2]));
  const ifNot = omitted(a[3]) ? null : ev(ctx, a[3]);
  const mode = omitted(a[4]) ? 0 : num(sc(ctx, a[4]));
  const search = omitted(a[5]) ? 1 : num(sc(ctx, a[5]));
  const vertical = lookIn.cols === 1;
  const one = (n: Val | FErr): V => {
    const i = xmatch(n, lookIn.v, mode, search);
    if (i < 0) return ifNot ?? NA();
    if (vertical) return ret.cols === 1 ? ret.v[i] : Arr.of([ret.row(i)]);
    return ret.rows === 1 ? ret.v[i] : Arr.of(ret.col(i).map((x) => [x]));
  };
  if (needle instanceof Arr) return needle.map((n) => scalarOf(one(n)));
  return one(scalarOf(needle));
});
def("INDEX", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  let r = omitted(a[1]) ? 0 : Math.floor(num(sc(ctx, a[1])));
  let c = omitted(a[2]) ? 0 : Math.floor(num(sc(ctx, a[2])));
  if (t.rows === 1 && omitted(a[2])) {
    c = r;
    r = 1;
  }
  if (r < 0 || c < 0 || r > t.rows || c > t.cols) return new FErr("#REF!");
  if (r === 0 && c === 0) return t;
  if (r === 0) return Arr.of(t.col(c - 1).map((x) => [x]));
  if (c === 0) return t.cols === 1 ? t.v[r - 1] : Arr.of([t.row(r - 1)]);
  return t.v[(r - 1) * t.cols + c - 1];
});
const refOf = (n: Node | undefined, ctx: Ctx) => {
  if (n?.k === "ref") return { s: ctx.book.sheetIndex(n.s, ctx.sheet), r1: n.r, c1: n.c, r2: n.r, c2: n.c };
  if (n?.k === "range") return { s: ctx.book.sheetIndex(n.s, ctx.sheet), r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
  return null;
};
def("OFFSET", (a, ctx) => {
  const base = refOf(a[0], ctx);
  if (!base) return VALUE();
  const r = base.r1 + num(sc(ctx, a[1])), c = base.c1 + num(sc(ctx, a[2]));
  const h = omitted(a[3]) ? base.r2 - base.r1 + 1 : num(sc(ctx, a[3]));
  const w = omitted(a[4]) ? base.c2 - base.c1 + 1 : num(sc(ctx, a[4]));
  if (r < 0 || c < 0 || h < 1 || w < 1) return new FErr("#REF!");
  if (h === 1 && w === 1) return ctx.book.value(base.s, r, c);
  return ctx.book.rangeArr(base.s, r, c, r + h - 1, c + w - 1);
});
def("INDIRECT", (a, ctx) => {
  const text = str(sc(ctx, a[0])).trim();
  const r1c1 = !omitted(a[1]) && !bool(sc(ctx, a[1]));
  let t = text;
  if (r1c1) {
    const m = /^R(\d+)C(\d+)$/i.exec(text);
    if (!m) return new FErr("#REF!");
    t = colLetters(Number(m[2]) - 1) + m[1];
  }
  const m = /^(?:'?([^'!]+)'?!)?(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/i.exec(t);
  if (!m) {
    const named = ctx.book.src.names?.[text] ?? ctx.book.src.names?.[text.toUpperCase()];
    if (named) return FUNCTIONS.INDIRECT([{ k: "lit", v: named.replace(/^=/, "") }], ctx);
    return new FErr("#REF!");
  }
  const s = ctx.book.sheetIndex(m[1], ctx.sheet);
  const p = parseRefSafe(m[2]);
  if (!p || s < 0) return new FErr("#REF!");
  if (!m[3]) return ctx.book.value(s, p.r, p.c);
  const q = parseRefSafe(m[3]);
  if (!q) return new FErr("#REF!");
  return ctx.book.rangeArr(s, Math.min(p.r, q.r), Math.min(p.c, q.c), Math.max(p.r, q.r), Math.max(p.c, q.c));
});
const parseRefSafe = (s: string) => {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(s);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
};
def("ADDRESS", lift(2, 5, (r, c, abs, a1, sheet) => {
  const t = abs === undefined ? 1 : num(abs);
  const row = num(r), col = num(c);
  const useA1 = a1 === undefined || bool(a1);
  const ref = useA1
    ? `${t === 1 || t === 3 ? "$" : ""}${colLetters(col - 1)}${t === 1 || t === 2 ? "$" : ""}${row}`
    : `R${t === 1 || t === 2 ? row : `[${row}]`}C${t === 1 || t === 3 ? col : `[${col}]`}`;
  return sheet === undefined ? ref : `${/[^A-Za-z0-9_]/.test(str(sheet)) ? `'${str(sheet)}'` : str(sheet)}!${ref}`;
}));
def("ROW", (a, ctx) => {
  const ref = refOf(a[0], ctx);
  if (!ref) return ctx.r + 1;
  if (ref.r1 === ref.r2) return ref.r1 + 1;
  return Arr.of(Array.from({ length: ref.r2 - ref.r1 + 1 }, (_, i) => [ref.r1 + i + 1]));
});
def("COLUMN", (a, ctx) => {
  const ref = refOf(a[0], ctx);
  if (!ref) return ctx.c + 1;
  if (ref.c1 === ref.c2) return ref.c1 + 1;
  return Arr.of([Array.from({ length: ref.c2 - ref.c1 + 1 }, (_, i) => ref.c1 + i + 1)]);
});
def("ROWS", (a, ctx) => {
  const ref = refOf(a[0], ctx);
  return ref ? ref.r2 - ref.r1 + 1 : toArr(ev(ctx, a[0])).rows;
});
def("COLUMNS", (a, ctx) => {
  const ref = refOf(a[0], ctx);
  return ref ? ref.c2 - ref.c1 + 1 : toArr(ev(ctx, a[0])).cols;
});
def("AREAS", () => 1);
def("HYPERLINK", lift(1, 2, (url, name) => (name === undefined ? str(url) : name)));
def("TRANSPOSE", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  return Arr.of(Array.from({ length: t.cols }, (_, c) => t.col(c)));
});

// ---- Dynamic arrays ------------------------------------------------------------------------------------

def("FILTER", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const inc = toArr(ev(ctx, a[1]));
  const byRow = inc.rows === t.rows && (inc.cols === 1 || t.rows > 1);
  const keep = (i: number) => {
    const v = inc.v[i];
    return bool(rethrow(v));
  };
  let out: (Val | FErr)[][];
  if (byRow) out = Array.from({ length: t.rows }, (_, r) => r).filter(keep).map((r) => t.row(r));
  else {
    const cols = Array.from({ length: t.cols }, (_, c) => c).filter(keep);
    out = Array.from({ length: t.rows }, (_, r) => cols.map((c) => t.v[r * t.cols + c]));
  }
  if (!out.length || !out[0].length) return omitted(a[2]) ? new FErr("#CALC!") : ev(ctx, a[2]);
  return Arr.of(out);
});
const sortRows = (rows: (Val | FErr)[][], keys: { col: number; asc: boolean }[]) =>
  rows.slice().sort((x, y) => {
    for (const k of keys) {
      const a = x[k.col], b = y[k.col];
      if (a instanceof FErr || b instanceof FErr) continue;
      const d = compareVals(a, b);
      if (d) return k.asc ? d : -d;
    }
    return 0;
  });
def("SORT", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const idx = omitted(a[1]) ? toArr(1) : toArr(ev(ctx, a[1]));
  const ord = omitted(a[2]) ? toArr(1) : toArr(ev(ctx, a[2]));
  const byCol = !omitted(a[3]) && bool(sc(ctx, a[3]));
  const keys = idx.v.map((x, i) => ({ col: num(x) - 1, asc: num(ord.v[i] ?? ord.v[0]) >= 0 }));
  if (byCol) {
    const rows = Array.from({ length: t.cols }, (_, c) => t.col(c));
    const sorted = sortRows(rows, keys);
    return Arr.of(Array.from({ length: t.rows }, (_, r) => sorted.map((col) => col[r])));
  }
  return Arr.of(sortRows(Array.from({ length: t.rows }, (_, r) => t.row(r)), keys));
});
def("SORTBY", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const rows = Array.from({ length: t.rows }, (_, r) => ({ row: t.row(r), keys: [] as (Val | FErr)[] }));
  const dirs: boolean[] = [];
  for (let i = 1; i < a.length; i += 2) {
    const by = toArr(ev(ctx, a[i]));
    dirs.push(omitted(a[i + 1]) ? true : num(sc(ctx, a[i + 1])) >= 0);
    rows.forEach((r, j) => r.keys.push(by.v[j]));
  }
  rows.sort((x, y) => {
    for (let k = 0; k < dirs.length; k++) {
      const p = x.keys[k], q = y.keys[k];
      if (p instanceof FErr || q instanceof FErr) continue;
      const d = compareVals(p, q);
      if (d) return dirs[k] ? d : -d;
    }
    return 0;
  });
  return Arr.of(rows.map((r) => r.row));
});
def("UNIQUE", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const byCol = !omitted(a[1]) && bool(sc(ctx, a[1]));
  const once = !omitted(a[2]) && bool(sc(ctx, a[2]));
  const items = byCol ? Array.from({ length: t.cols }, (_, c) => t.col(c)) : Array.from({ length: t.rows }, (_, r) => t.row(r));
  const keyOf = (x: (Val | FErr)[]) => JSON.stringify(x.map((v) => (v instanceof FErr ? v.code : typeof v === "string" ? v.toLowerCase() : v)));
  const counts = new Map<string, number>();
  items.forEach((x) => counts.set(keyOf(x), (counts.get(keyOf(x)) ?? 0) + 1));
  const seen = new Set<string>();
  const out = items.filter((x) => {
    const k = keyOf(x);
    if (once) return counts.get(k) === 1;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!out.length) return new FErr("#CALC!");
  return byCol ? Arr.of(Array.from({ length: t.rows }, (_, r) => out.map((col) => col[r]))) : Arr.of(out);
});
def("SEQUENCE", (a, ctx) => {
  const rows = Math.floor(num(sc(ctx, a[0])));
  const cols = omitted(a[1]) ? 1 : Math.floor(num(sc(ctx, a[1])));
  const start = omitted(a[2]) ? 1 : num(sc(ctx, a[2]));
  const step = omitted(a[3]) ? 1 : num(sc(ctx, a[3]));
  if (rows < 1 || cols < 1) return new FErr("#CALC!");
  return Arr.of(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => start + (r * cols + c) * step)));
});
def("RANDARRAY", (a, ctx) => {
  const rows = omitted(a[0]) ? 1 : num(sc(ctx, a[0]));
  const cols = omitted(a[1]) ? 1 : num(sc(ctx, a[1]));
  const lo = omitted(a[2]) ? 0 : num(sc(ctx, a[2]));
  const hi = omitted(a[3]) ? 1 : num(sc(ctx, a[3]));
  const whole = !omitted(a[4]) && bool(sc(ctx, a[4]));
  return Arr.of(Array.from({ length: rows }, () => Array.from({ length: cols }, () => (whole ? Math.floor(lo + Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo)))));
});
const rowsOf = (t: Arr) => Array.from({ length: t.rows }, (_, r) => t.row(r));
def("TAKE", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const r = omitted(a[1]) ? t.rows : num(sc(ctx, a[1]));
  const c = omitted(a[2]) ? t.cols : num(sc(ctx, a[2]));
  const rs = rowsOf(t);
  const pickR = r >= 0 ? rs.slice(0, r) : rs.slice(r);
  return Arr.of(pickR.map((row) => (c >= 0 ? row.slice(0, c) : row.slice(c))));
});
def("DROP", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const r = omitted(a[1]) ? 0 : num(sc(ctx, a[1]));
  const c = omitted(a[2]) ? 0 : num(sc(ctx, a[2]));
  const rs = rowsOf(t);
  const pickR = r >= 0 ? rs.slice(r) : rs.slice(0, r);
  const out = pickR.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c)));
  if (!out.length || !out[0].length) return new FErr("#CALC!");
  return Arr.of(out);
});
def("CHOOSECOLS", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const idx = a.slice(1).flatMap((n) => toArr(ev(ctx, n)).v.map((x) => num(x)));
  return Arr.of(rowsOf(t).map((row) => idx.map((i) => row[i > 0 ? i - 1 : t.cols + i] ?? new FErr("#VALUE!"))));
});
def("CHOOSEROWS", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const idx = a.slice(1).flatMap((n) => toArr(ev(ctx, n)).v.map((x) => num(x)));
  const rs = rowsOf(t);
  return Arr.of(idx.map((i) => rs[i > 0 ? i - 1 : t.rows + i] ?? [new FErr("#VALUE!")]));
});
def("EXPAND", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const r = omitted(a[1]) ? t.rows : num(sc(ctx, a[1]));
  const c = omitted(a[2]) ? t.cols : num(sc(ctx, a[2]));
  const pad = omitted(a[3]) ? NA() : sc(ctx, a[3]);
  return Arr.of(Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => (i < t.rows && j < t.cols ? t.v[i * t.cols + j] : pad))));
});
def("VSTACK", (a, ctx) => {
  const ts = a.map((n) => toArr(ev(ctx, n)));
  const cols = Math.max(...ts.map((t) => t.cols));
  return Arr.of(ts.flatMap((t) => rowsOf(t).map((row) => Array.from({ length: cols }, (_, j) => row[j] ?? NA()))));
});
def("HSTACK", (a, ctx) => {
  const ts = a.map((n) => toArr(ev(ctx, n)));
  const rows = Math.max(...ts.map((t) => t.rows));
  return Arr.of(Array.from({ length: rows }, (_, i) => ts.flatMap((t) => (i < t.rows ? t.row(i) : Array(t.cols).fill(NA())))));
});
def("TOROW", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const ignore = omitted(a[1]) ? 0 : num(sc(ctx, a[1]));
  const byCol = !omitted(a[2]) && bool(sc(ctx, a[2]));
  const vals = byCol ? Array.from({ length: t.cols }, (_, c) => t.col(c)).flat() : t.v;
  return Arr.of([vals.filter((v) => !((ignore & 1 && v === "") || (ignore & 2 && v instanceof FErr)))]);
});
def("TOCOL", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const ignore = omitted(a[1]) ? 0 : num(sc(ctx, a[1]));
  const byCol = !omitted(a[2]) && bool(sc(ctx, a[2]));
  const vals = byCol ? Array.from({ length: t.cols }, (_, c) => t.col(c)).flat() : t.v;
  return Arr.of(vals.filter((v) => !((ignore & 1 && v === "") || (ignore & 2 && v instanceof FErr))).map((v) => [v]));
});
def("WRAPROWS", (a, ctx) => {
  const v = toArr(ev(ctx, a[0])).v;
  const n = num(sc(ctx, a[1]));
  const pad = omitted(a[2]) ? NA() : sc(ctx, a[2]);
  const out: (Val | FErr)[][] = [];
  for (let i = 0; i < v.length; i += n) out.push(Array.from({ length: n }, (_, j) => v[i + j] ?? pad));
  return Arr.of(out);
});
def("WRAPCOLS", (a, ctx) => {
  const v = toArr(ev(ctx, a[0])).v;
  const n = num(sc(ctx, a[1]));
  const pad = omitted(a[2]) ? NA() : sc(ctx, a[2]);
  const cols = Math.ceil(v.length / n);
  return Arr.of(Array.from({ length: n }, (_, r) => Array.from({ length: cols }, (_, c) => v[c * n + r] ?? pad)));
});
const lam = (ctx: Ctx, n: Node) => {
  const f = ev(ctx, n);
  if (!(f instanceof Lambda)) throw VALUE();
  return f;
};
def("MAP", (a, ctx) => {
  const arrs = a.slice(0, -1).map((n) => toArr(ev(ctx, n)));
  const f = lam(ctx, a[a.length - 1]);
  return arrs[0].map((_, r, c) => scalarOf(ctx.callLambda(f, arrs.map((x) => x.at(r, c)))));
});
def("REDUCE", (a, ctx) => {
  let acc: V = ev(ctx, a[0]);
  const t = toArr(ev(ctx, a[1]));
  const f = lam(ctx, a[2]);
  for (const x of t.v) acc = ctx.callLambda(f, [acc, x]);
  return acc;
});
def("SCAN", (a, ctx) => {
  let acc: V = ev(ctx, a[0]);
  const t = toArr(ev(ctx, a[1]));
  const f = lam(ctx, a[2]);
  return t.map((x) => {
    acc = ctx.callLambda(f, [acc, x]);
    return scalarOf(acc);
  });
});
def("MAKEARRAY", (a, ctx) => {
  const rows = num(sc(ctx, a[0])), cols = num(sc(ctx, a[1]));
  const f = lam(ctx, a[2]);
  return Arr.of(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => scalarOf(ctx.callLambda(f, [r + 1, c + 1])))));
});
def("BYROW", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const f = lam(ctx, a[1]);
  return Arr.of(rowsOf(t).map((row) => [scalarOf(ctx.callLambda(f, [Arr.of([row])]))]));
});
def("BYCOL", (a, ctx) => {
  const t = toArr(ev(ctx, a[0]));
  const f = lam(ctx, a[1]);
  return Arr.of([Array.from({ length: t.cols }, (_, c) => scalarOf(ctx.callLambda(f, [Arr.of(t.col(c).map((x) => [x]))])))]);
});

// ---- Financial --------------------------------------------------------------------------------------------

const fv = (rate: number, n: number, pmt: number, pv: number, type: number) =>
  rate === 0 ? -(pv + pmt * n) : -(pv * (1 + rate) ** n + (pmt * (1 + rate * type) * ((1 + rate) ** n - 1)) / rate);
const pmtOf = (rate: number, n: number, pv: number, f: number, type: number) =>
  rate === 0 ? -(pv + f) / n : (-(pv * (1 + rate) ** n + f) * rate) / ((1 + rate * type) * ((1 + rate) ** n - 1));
const pvOf = (rate: number, n: number, pmt: number, f: number, type: number) =>
  rate === 0 ? -(f + pmt * n) : -(f + (pmt * (1 + rate * type) * ((1 + rate) ** n - 1)) / rate) / (1 + rate) ** n;
const opt = (x: Val | FErr | undefined, d = 0) => (x === undefined || x === "" ? d : num(x));
def("PMT", lift(3, 5, (r, n, pv, f, t) => pmtOf(num(r), num(n), num(pv), opt(f), opt(t))));
def("FV", lift(3, 5, (r, n, p, pv, t) => fv(num(r), num(n), num(p), opt(pv), opt(t))));
def("PV", lift(3, 5, (r, n, p, f, t) => pvOf(num(r), num(n), num(p), opt(f), opt(t))));
const ipmt = (rate: number, per: number, n: number, pv: number, f: number, type: number) => {
  const pmt = pmtOf(rate, n, pv, f, type);
  if (per === 1 && type === 1) return 0;
  const balance = -fv(rate, per - 1, pmt, pv, type);
  return (type === 1 ? (balance - pmt) * rate : balance * rate) * -1;
};
def("IPMT", lift(4, 6, (r, p, n, pv, f, t) => ipmt(num(r), num(p), num(n), num(pv), opt(f), opt(t))));
def("PPMT", lift(4, 6, (r, p, n, pv, f, t) => pmtOf(num(r), num(n), num(pv), opt(f), opt(t)) - ipmt(num(r), num(p), num(n), num(pv), opt(f), opt(t))));
def("CUMIPMT", lift(6, 6, (r, n, pv, s, e, t) => {
  let total = 0;
  for (let p = num(s); p <= num(e); p++) total += ipmt(num(r), p, num(n), num(pv), 0, num(t));
  return total;
}));
def("CUMPRINC", lift(6, 6, (r, n, pv, s, e, t) => {
  let total = 0;
  const pmt = pmtOf(num(r), num(n), num(pv), 0, num(t));
  for (let p = num(s); p <= num(e); p++) total += pmt - ipmt(num(r), p, num(n), num(pv), 0, num(t));
  return total;
}));
def("NPER", lift(3, 5, (r, p, pv, f, t) => {
  const rate = num(r), pmt = num(p), PV = num(pv), F = opt(f), type = opt(t);
  if (rate === 0) return -(PV + F) / pmt;
  const z = pmt * (1 + rate * type) / rate;
  return Math.log((-F + z) / (PV + z)) / Math.log(1 + rate);
}));
def("RATE", lift(3, 6, (n, p, pv, f, t, g) => {
  let rate = g === undefined || g === "" ? 0.1 : num(g);
  const N = num(n), P = num(p), PV = num(pv), F = opt(f), T = opt(t);
  for (let i = 0; i < 100; i++) {
    const y = PV * (1 + rate) ** N + P * (1 + rate * T) * (((1 + rate) ** N - 1) / rate) + F;
    const h = 1e-6;
    const r2 = rate + h;
    const y2 = PV * (1 + r2) ** N + P * (1 + r2 * T) * (((1 + r2) ** N - 1) / r2) + F;
    const next = rate - y / ((y2 - y) / h);
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }
  throw NUM();
}));
def("NPV", (a, ctx) => {
  const rate = num(sc(ctx, a[0]));
  return numbers(ctx, a.slice(1)).reduce((s, x, i) => s + x / (1 + rate) ** (i + 1), 0);
});
const irr = (flows: number[], guess: number) => {
  let r = guess;
  for (let i = 0; i < 200; i++) {
    let f = 0, d = 0;
    flows.forEach((c, k) => {
      f += c / (1 + r) ** k;
      d -= (k * c) / (1 + r) ** (k + 1);
    });
    const next = r - f / d;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  throw NUM();
};
def("IRR", (a, ctx) => irr(numbers(ctx, [a[0]]), omitted(a[1]) ? 0.1 : num(sc(ctx, a[1]))));
def("XNPV", (a, ctx) => {
  const rate = num(sc(ctx, a[0]));
  const v = numbers(ctx, [a[1]]), d = numbers(ctx, [a[2]]);
  return v.reduce((s, x, i) => s + x / (1 + rate) ** ((d[i] - d[0]) / 365), 0);
});
def("XIRR", (a, ctx) => {
  const v = numbers(ctx, [a[0]]), d = numbers(ctx, [a[1]]);
  let r = omitted(a[2]) ? 0.1 : num(sc(ctx, a[2]));
  for (let i = 0; i < 200; i++) {
    let f = 0, df = 0;
    v.forEach((x, k) => {
      const t = (d[k] - d[0]) / 365;
      f += x / (1 + r) ** t;
      df -= (t * x) / (1 + r) ** (t + 1);
    });
    const next = r - f / df;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  throw NUM();
});
def("MIRR", (a, ctx) => {
  const v = numbers(ctx, [a[0]]);
  const fr = num(sc(ctx, a[1])), rr = num(sc(ctx, a[2]));
  const n = v.length;
  const pos = v.reduce((s, x, i) => (x > 0 ? s + x * (1 + rr) ** (n - 1 - i) : s), 0);
  const neg = v.reduce((s, x, i) => (x < 0 ? s + x / (1 + fr) ** i : s), 0);
  if (!neg || !pos) throw DIV0();
  return (-pos / neg) ** (1 / (n - 1)) - 1;
});
def("EFFECT", lift(2, 2, (r, n) => (1 + num(r) / Math.floor(num(n))) ** Math.floor(num(n)) - 1));
def("NOMINAL", lift(2, 2, (r, n) => Math.floor(num(n)) * ((1 + num(r)) ** (1 / Math.floor(num(n))) - 1)));
def("SLN", lift(3, 3, (c, s, l) => (num(c) - num(s)) / num(l)));
def("SYD", lift(4, 4, (c, s, l, p) => ((num(c) - num(s)) * (num(l) - num(p) + 1) * 2) / (num(l) * (num(l) + 1))));
def("DDB", lift(4, 5, (c, s, l, p, f) => {
  const cost = num(c), salvage = num(s), life = num(l), per = num(p), factor = opt(f, 2);
  let book = cost, dep = 0;
  for (let i = 1; i <= per; i++) {
    dep = Math.min(book * (factor / life), Math.max(0, book - salvage));
    book -= dep;
  }
  return dep;
}));
def("DB", lift(4, 5, (c, s, l, p, m) => {
  const cost = num(c), salvage = num(s), life = num(l), per = num(p), months = opt(m, 12);
  const rate = Math.round((1 - (salvage / cost) ** (1 / life)) * 1000) / 1000;
  let total = 0, dep = 0;
  for (let i = 1; i <= per; i++) {
    dep = i === 1 ? (cost * rate * months) / 12 : i === Math.floor(life) + 1 ? ((cost - total) * rate * (12 - months)) / 12 : (cost - total) * rate;
    total += dep;
  }
  return dep;
}));
def("VDB", lift(5, 7, (c, s, l, st, en, f) => {
  const cost = num(c), salvage = num(s), life = num(l), factor = opt(f, 2);
  let book = cost, total = 0;
  for (let i = 0; i < num(en); i++) {
    const ddb = book * (factor / life);
    const sl = (book - salvage) / (life - i);
    const dep = Math.max(0, Math.min(Math.max(ddb, sl), book - salvage));
    if (i >= num(st)) total += dep;
    book -= dep;
  }
  return total;
}));
def("RRI", lift(3, 3, (n, pv, f) => (num(f) / num(pv)) ** (1 / num(n)) - 1));
def("PDURATION", lift(3, 3, (r, pv, f) => (Math.log(num(f)) - Math.log(num(pv))) / Math.log(1 + num(r))));
def("DISC", lift(4, 5, (s, m, pr, red) => ((num(red) - num(pr)) / num(red)) * (360 / (D(m) - D(s)))));
def("INTRATE", lift(4, 5, (s, m, inv, red) => ((num(red) - num(inv)) / num(inv)) * (360 / (D(m) - D(s)))));
def("RECEIVED", lift(4, 5, (s, m, inv, disc) => num(inv) / (1 - num(disc) * ((D(m) - D(s)) / 360))));
def("FVSCHEDULE", (a, ctx) => numbers(ctx, [a[1]]).reduce((p, r) => p * (1 + r), num(sc(ctx, a[0]))));
def("ISPMT", lift(4, 4, (r, p, n, pv) => num(pv) * num(r) * (num(p) / num(n) - 1)));

// ---- Engineering ---------------------------------------------------------------------------------------------

const bits = (fn: (a: number, b: number) => number) => lift(2, 2, (x, y) => {
  const a = num(x), b = num(y);
  if (a < 0 || b < 0 || !Number.isInteger(a) || !Number.isInteger(b)) throw NUM();
  return Number(BigInt(fn(a, b)));
});
def("BITAND", bits((a, b) => Number(BigInt(a) & BigInt(b))));
def("BITOR", bits((a, b) => Number(BigInt(a) | BigInt(b))));
def("BITXOR", bits((a, b) => Number(BigInt(a) ^ BigInt(b))));
def("BITLSHIFT", lift(2, 2, (x, s) => Number(BigInt(num(x)) << BigInt(num(s)))));
def("BITRSHIFT", lift(2, 2, (x, s) => Number(BigInt(num(x)) >> BigInt(num(s)))));
const fromBase = (s: string, base: number, bitsN: number) => {
  const v = parseInt(s || "0", base);
  if (isNaN(v)) throw NUM();
  const max = base ** (bitsN / Math.log2(base)) ;
  return s.length === bitsN / Math.log2(base) && v >= max / 2 ? v - max : v;
};
const toBase = (n: number, base: number, places: Val | FErr | undefined, digits: number) => {
  const v = Math.trunc(n);
  const s = v < 0 ? (base ** digits + v).toString(base) : v.toString(base);
  return s.toUpperCase().padStart(places === undefined ? 0 : num(places), "0");
};
def("BIN2DEC", lift(1, 1, (x) => fromBase(str(x), 2, 10)));
def("OCT2DEC", lift(1, 1, (x) => fromBase(str(x), 8, 30)));
def("HEX2DEC", lift(1, 1, (x) => fromBase(str(x), 16, 40)));
def("DEC2BIN", lift(1, 2, (x, p) => toBase(num(x), 2, p, 10)));
def("DEC2OCT", lift(1, 2, (x, p) => toBase(num(x), 8, p, 10)));
def("DEC2HEX", lift(1, 2, (x, p) => toBase(num(x), 16, p, 10)));
def("BIN2HEX", lift(1, 2, (x, p) => toBase(fromBase(str(x), 2, 10), 16, p, 10)));
def("BIN2OCT", lift(1, 2, (x, p) => toBase(fromBase(str(x), 2, 10), 8, p, 10)));
def("HEX2BIN", lift(1, 2, (x, p) => toBase(fromBase(str(x), 16, 40), 2, p, 10)));
def("HEX2OCT", lift(1, 2, (x, p) => toBase(fromBase(str(x), 16, 40), 8, p, 10)));
def("OCT2BIN", lift(1, 2, (x, p) => toBase(fromBase(str(x), 8, 30), 2, p, 10)));
def("OCT2HEX", lift(1, 2, (x, p) => toBase(fromBase(str(x), 8, 30), 16, p, 10)));
def("DELTA", lift(1, 2, (a, b) => (num(a) === opt(b) ? 1 : 0)));
def("GESTEP", lift(1, 2, (a, b) => (num(a) >= opt(b) ? 1 : 0)));

type Cx = [number, number];
const parseCx = (v: Val | FErr): Cx => {
  if (typeof v === "number") return [v, 0];
  const s = str(v).replace(/\s/g, "");
  if (!s) return [0, 0];
  const m = /^([+-]?[\d.]+(?:e[+-]?\d+)?)?([+-]?[\d.]*(?:e[+-]?\d+)?)?([ij])?$/i.exec(s);
  if (!m) throw NUM();
  if (m[3]) {
    if (m[2] !== undefined && m[2] !== "") return [Number(m[1] ?? 0), m[2] === "+" ? 1 : m[2] === "-" ? -1 : Number(m[2])];
    if (m[1] !== undefined) return [0, m[1] === "+" || m[1] === "" ? 1 : m[1] === "-" ? -1 : Number(m[1])];
    return [0, 1];
  }
  return [Number(m[1]), 0];
};
const fmtCx = ([re, im]: Cx, sfx = "i") => {
  const r = Number(re.toPrecision(15)), i = Number(im.toPrecision(15));
  if (!i) return String(r);
  const ip = i === 1 ? "" : i === -1 ? "-" : String(i);
  return (r ? String(r) + (i > 0 ? "+" : "") : "") + ip + sfx;
};
def("COMPLEX", lift(2, 3, (r, i, s) => fmtCx([num(r), num(i)], s === undefined ? "i" : str(s))));
def("IMREAL", lift(1, 1, (x) => parseCx(x)[0]));
def("IMAGINARY", lift(1, 1, (x) => parseCx(x)[1]));
def("IMABS", lift(1, 1, (x) => Math.hypot(...parseCx(x))));
def("IMARGUMENT", lift(1, 1, (x) => Math.atan2(parseCx(x)[1], parseCx(x)[0])));
def("IMCONJUGATE", lift(1, 1, (x) => fmtCx([parseCx(x)[0], -parseCx(x)[1]])));
def("IMSUM", (a, ctx) => fmtCx(flat(ctx, a).map(parseCx).reduce<Cx>((s, x) => [s[0] + x[0], s[1] + x[1]], [0, 0])));
def("IMSUB", lift(2, 2, (x, y) => {
  const a = parseCx(x), b = parseCx(y);
  return fmtCx([a[0] - b[0], a[1] - b[1]]);
}));
const cmul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
def("IMPRODUCT", (a, ctx) => fmtCx(flat(ctx, a).map(parseCx).reduce<Cx>(cmul, [1, 0])));
def("IMDIV", lift(2, 2, (x, y) => {
  const a = parseCx(x), b = parseCx(y);
  const d = b[0] ** 2 + b[1] ** 2;
  if (!d) throw NUM();
  return fmtCx([(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]);
}));
def("IMPOWER", lift(2, 2, (x, n) => {
  const [re, im] = parseCx(x);
  const r = Math.hypot(re, im) ** num(n), t = Math.atan2(im, re) * num(n);
  return fmtCx([r * Math.cos(t), r * Math.sin(t)]);
}));
def("IMSQRT", lift(1, 1, (x) => {
  const [re, im] = parseCx(x);
  const r = Math.sqrt(Math.hypot(re, im)), t = Math.atan2(im, re) / 2;
  return fmtCx([r * Math.cos(t), r * Math.sin(t)]);
}));
def("IMEXP", lift(1, 1, (x) => {
  const [re, im] = parseCx(x);
  return fmtCx([Math.exp(re) * Math.cos(im), Math.exp(re) * Math.sin(im)]);
}));
def("IMLN", lift(1, 1, (x) => {
  const [re, im] = parseCx(x);
  return fmtCx([Math.log(Math.hypot(re, im)), Math.atan2(im, re)]);
}));

const UNITS: Record<string, [string, number]> = {
  m: ["len", 1], km: ["len", 1000], cm: ["len", 0.01], mm: ["len", 0.001], mi: ["len", 1609.344], yd: ["len", 0.9144], ft: ["len", 0.3048], in: ["len", 0.0254], Nmi: ["len", 1852],
  g: ["mass", 1], kg: ["mass", 1000], mg: ["mass", 0.001], lbm: ["mass", 453.59237], ozm: ["mass", 28.349523125], ton: ["mass", 907184.74], t: ["mass", 1e6], stone: ["mass", 6350.29318],
  sec: ["time", 1], s: ["time", 1], mn: ["time", 60], min: ["time", 60], hr: ["time", 3600], day: ["time", 86400], d: ["time", 86400], yr: ["time", 31557600],
  l: ["vol", 1], L: ["vol", 1], lt: ["vol", 1], ml: ["vol", 0.001], gal: ["vol", 3.785411784], qt: ["vol", 0.946352946], pt: ["vol", 0.473176473], cup: ["vol", 0.2365882365], oz: ["vol", 0.0295735295625], tbs: ["vol", 0.01478676478125], tsp: ["vol", 0.00492892159375], m3: ["vol", 1000],
  m2: ["area", 1], km2: ["area", 1e6], ha: ["area", 1e4], ft2: ["area", 0.09290304], in2: ["area", 0.00064516], mi2: ["area", 2589988.110336], acre: ["area", 4046.8564224],
  J: ["energy", 1], kJ: ["energy", 1000], cal: ["energy", 4.1868], kcal: ["energy", 4186.8], Wh: ["energy", 3600], kWh: ["energy", 3.6e6], BTU: ["energy", 1055.05585262],
  W: ["power", 1], kW: ["power", 1000], HP: ["power", 745.69987158227],
  Pa: ["pressure", 1], kPa: ["pressure", 1000], atm: ["pressure", 101325], bar: ["pressure", 1e5], psi: ["pressure", 6894.757293168], mmHg: ["pressure", 133.322387415],
  "m/s": ["speed", 1], "km/h": ["speed", 1 / 3.6], mph: ["speed", 0.44704], kn: ["speed", 0.514444],
  bit: ["info", 1], byte: ["info", 8], kB: ["info", 8000], MB: ["info", 8e6], GB: ["info", 8e9],
};
def("CONVERT", lift(3, 3, (x, f, t) => {
  const v = num(x), from = str(f), to = str(t);
  const temp = (s: string) => ["C", "cel", "F", "fah", "K", "kel"].includes(s);
  if (temp(from) && temp(to)) {
    const k = from[0] === "C" || from === "cel" ? v + 273.15 : from[0] === "F" || from === "fah" ? (v - 32) * (5 / 9) + 273.15 : v;
    return to[0] === "C" || to === "cel" ? k - 273.15 : to[0] === "F" || to === "fah" ? (k - 273.15) * 1.8 + 32 : k;
  }
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b || a[0] !== b[0]) return NA();
  return (v * a[1]) / b[1];
}));

// ---- Database -----------------------------------------------------------------------------------------------

function dbRows(ctx: Ctx, a: Node[]) {
  const db = toArr(ev(ctx, a[0]));
  const header = db.row(0).map((h) => str(rethrow(h)).toLowerCase());
  const fieldV = sc(ctx, a[1]);
  const field = typeof fieldV === "number" ? fieldV - 1 : header.indexOf(str(fieldV).toLowerCase());
  const crit = toArr(ev(ctx, a[2]));
  const ch = crit.row(0).map((h) => str(rethrow(h)).toLowerCase());
  const rules = Array.from({ length: crit.rows - 1 }, (_, r) =>
    ch.map((h, c) => ({ col: header.indexOf(h), test: crit.v[(r + 1) * crit.cols + c] === "" ? null : criteria(crit.v[(r + 1) * crit.cols + c]) })).filter((x) => x.test),
  );
  const out: (Val | FErr)[] = [];
  for (let r = 1; r < db.rows; r++) {
    const row = db.row(r);
    const ok = !rules.length || rules.some((rule) => rule.every((x) => x.col >= 0 && x.test!(row[x.col])));
    if (ok) out.push(field >= 0 ? row[field] : new FErr("#VALUE!"));
  }
  return out;
}
const dnums = (xs: (Val | FErr)[]) => xs.filter((x): x is number => typeof x === "number");
def("DSUM", (a, ctx) => sum(dnums(dbRows(ctx, a))));
def("DAVERAGE", (a, ctx) => mean(dnums(dbRows(ctx, a))));
def("DCOUNT", (a, ctx) => dnums(dbRows(ctx, a)).length);
def("DCOUNTA", (a, ctx) => dbRows(ctx, a).filter((x) => x !== "").length);
def("DMAX", (a, ctx) => Math.max(...dnums(dbRows(ctx, a))));
def("DMIN", (a, ctx) => Math.min(...dnums(dbRows(ctx, a))));
def("DPRODUCT", (a, ctx) => dnums(dbRows(ctx, a)).reduce((p, x) => p * x, 1));
def("DSTDEV", (a, ctx) => stdev(dnums(dbRows(ctx, a)), true));
def("DSTDEVP", (a, ctx) => stdev(dnums(dbRows(ctx, a)), false));
def("DVAR", (a, ctx) => variance(dnums(dbRows(ctx, a)), true));
def("DVARP", (a, ctx) => variance(dnums(dbRows(ctx, a)), false));
def("DGET", (a, ctx) => {
  const xs = dbRows(ctx, a);
  return xs.length === 1 ? xs[0] : xs.length ? NUM() : VALUE();
});

/** Function names for autocomplete, with a short signature. */
export const SIGNATURES: Record<string, string> = {
  SUM: "number1, [number2], …", AVERAGE: "number1, [number2], …", COUNT: "value1, …", COUNTA: "value1, …", MIN: "number1, …", MAX: "number1, …",
  IF: "test, value_if_true, [value_if_false]", IFS: "test1, value1, …", IFERROR: "value, value_if_error", AND: "logical1, …", OR: "logical1, …",
  SUMIF: "range, criteria, [sum_range]", SUMIFS: "sum_range, criteria_range1, criteria1, …", COUNTIF: "range, criteria", COUNTIFS: "criteria_range1, criteria1, …",
  AVERAGEIF: "range, criteria, [average_range]", AVERAGEIFS: "average_range, criteria_range1, criteria1, …",
  VLOOKUP: "lookup_value, table, col_index, [approximate]", HLOOKUP: "lookup_value, table, row_index, [approximate]",
  XLOOKUP: "lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]", INDEX: "array, row, [column]", MATCH: "lookup_value, lookup_array, [match_type]",
  XMATCH: "lookup_value, lookup_array, [match_mode], [search_mode]", ROUND: "number, digits", ROUNDUP: "number, digits", ROUNDDOWN: "number, digits",
  CONCAT: "text1, …", TEXTJOIN: "delimiter, ignore_empty, text1, …", TEXT: "value, format", LEFT: "text, [count]", RIGHT: "text, [count]", MID: "text, start, count",
  FIND: "find, within, [start]", SEARCH: "find, within, [start]", SUBSTITUTE: "text, old, new, [instance]", REPLACE: "text, start, count, new",
  DATE: "year, month, day", TODAY: "", NOW: "", EDATE: "start, months", EOMONTH: "start, months", DATEDIF: "start, end, unit",
  NETWORKDAYS: "start, end, [holidays]", WORKDAY: "start, days, [holidays]", WEEKDAY: "date, [type]", YEARFRAC: "start, end, [basis]",
  PMT: "rate, nper, pv, [fv], [type]", FV: "rate, nper, pmt, [pv], [type]", PV: "rate, nper, pmt, [fv], [type]", NPV: "rate, value1, …", IRR: "values, [guess]",
  FILTER: "array, include, [if_empty]", SORT: "array, [sort_index], [order], [by_col]", SORTBY: "array, by_array1, [order1], …", UNIQUE: "array, [by_col], [exactly_once]",
  SEQUENCE: "rows, [columns], [start], [step]", LET: "name1, value1, …, calculation", LAMBDA: "param1, …, calculation", TEXTSPLIT: "text, col_delimiter, [row_delimiter]",
  SUMPRODUCT: "array1, [array2], …", RANK: "number, ref, [order]", LARGE: "array, k", SMALL: "array, k", MEDIAN: "number1, …", STDEV: "number1, …",
  OFFSET: "reference, rows, cols, [height], [width]", INDIRECT: "ref_text, [a1]", CHOOSE: "index, value1, …", SWITCH: "expression, value1, result1, …, [default]",
};
