// Charts on sheets: turn a range into series (with the same header and label rules as Excel),
// plus the statistics some chart types need: histogram bins, quartiles for box plots,
// trendline fits with their equation and R², and tidy axis ticks.
import { parseRange, FErr, type Val } from "./formula";
import type { ChartKind, SheetChart, Trendline } from "./types";

export const PALETTES: Record<string, string[]> = {
  Office: ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"],
  Colorful: ["#5b9bd5", "#ed7d31", "#70ad47", "#ffc000", "#7030a0", "#e84c3d", "#2ab0a3", "#c55a11", "#8064a2", "#4bacc6"],
  Blue: ["#1f4e79", "#2e75b6", "#5b9bd5", "#9dc3e6", "#bdd7ee", "#203864", "#4472c4", "#8faadc", "#b4c7e7", "#dae3f3"],
  Green: ["#375623", "#548235", "#70ad47", "#a9d18e", "#c5e0b4", "#385723", "#6a8e3a", "#94c47d", "#b6d7a8", "#e2efda"],
  Orange: ["#843c0c", "#c55a11", "#ed7d31", "#f4b183", "#f8cbad", "#9e480e", "#d26b2a", "#f19c5c", "#f7c6a3", "#fbe5d6"],
  Gray: ["#262626", "#595959", "#7f7f7f", "#a6a6a6", "#bfbfbf", "#404040", "#737373", "#8c8c8c", "#b3b3b3", "#d9d9d9"],
  Vivid: ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#f0e442", "#000000", "#999999", "#7f3c8d"],
};

export const CHART_KINDS: { kind: ChartKind; label: string; group: string }[] = [
  { kind: "column", label: "Column", group: "Common" },
  { kind: "bar", label: "Bar", group: "Common" },
  { kind: "line", label: "Line", group: "Common" },
  { kind: "area", label: "Area", group: "Common" },
  { kind: "pie", label: "Pie", group: "Common" },
  { kind: "doughnut", label: "Doughnut", group: "Common" },
  { kind: "combo", label: "Combo (column and line)", group: "Common" },
  { kind: "scatter", label: "Scatter (XY)", group: "XY" },
  { kind: "bubble", label: "Bubble", group: "XY" },
  { kind: "radar", label: "Radar", group: "Other" },
  { kind: "histogram", label: "Histogram", group: "Statistical" },
  { kind: "pareto", label: "Pareto", group: "Statistical" },
  { kind: "box", label: "Box and whisker", group: "Statistical" },
  { kind: "waterfall", label: "Waterfall", group: "Other" },
  { kind: "funnel", label: "Funnel", group: "Other" },
  { kind: "treemap", label: "Treemap", group: "Other" },
];

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  /** Scatter and bubble: x values; bubble: sizes. */
  xs?: number[];
  sizes?: number[];
  kind?: "column" | "line" | "area";
  secondary?: boolean;
}
export interface BoxStats {
  name: string;
  color: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  outliers: number[];
}
export interface ChartModel {
  spec: SheetChart;
  categories: string[];
  series: Series[];
  box?: BoxStats[];
  /** Pareto: cumulative share of each sorted category. */
  cumulative?: number[];
  /** Waterfall: which categories are totals (drawn from zero). */
  totals?: boolean[];
}

const num = (v: Val | FErr | undefined): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "boolean" ? (v ? 1 : 0) : null);

/** Read a chart's range. `read` gives a cell's value, `text` its displayed text. */
export function buildChart(spec: SheetChart, read: (r: number, c: number) => Val | FErr, text: (r: number, c: number) => string): ChartModel | null {
  const b = parseRange(spec.range);
  if (!b) return null;
  // Series down columns, or along rows: swap the accessor rather than the data.
  const rows = spec.byRow ? b.c2 - b.c1 + 1 : b.r2 - b.r1 + 1;
  const cols = spec.byRow ? b.r2 - b.r1 + 1 : b.c2 - b.c1 + 1;
  const at = (i: number, j: number) => (spec.byRow ? read(b.r1 + j, b.c1 + i) : read(b.r1 + i, b.c1 + j));
  const label = (i: number, j: number) => (spec.byRow ? text(b.r1 + j, b.c1 + i) : text(b.r1 + i, b.c1 + j));
  const pal = PALETTES[spec.palette ?? "Office"] ?? PALETTES.Office;
  const xy = spec.kind === "scatter" || spec.kind === "bubble";
  // A header row: text above numbers. A label column: text beside numbers (scatter's first column is X).
  const headerRow = rows > 1 && Array.from({ length: cols }, (_, j) => at(0, j)).some((v) => typeof v === "string" && v !== "") && Array.from({ length: cols }, (_, j) => at(1, j)).some((v) => typeof v === "number");
  const r0 = headerRow ? 1 : 0;
  const labelCol = cols > 1 && (xy || Array.from({ length: rows - r0 }, (_, i) => at(r0 + i, 0)).some((v) => typeof v === "string" && v !== "") || (headerRow && (at(0, 0) === "" || at(0, 0) === undefined)));
  const c0 = labelCol ? 1 : 0;
  const n = rows - r0;
  const categories = Array.from({ length: n }, (_, i) => (labelCol ? label(r0 + i, 0) : String(i + 1)));
  const name = (j: number) => (headerRow ? label(0, j) || `Series ${j - c0 + 1}` : `Series ${j - c0 + 1}`);
  let series: Series[] = [];
  if (xy) {
    const xs = Array.from({ length: n }, (_, i) => num(at(r0 + i, 0)) ?? i + 1);
    const step = spec.kind === "bubble" ? 2 : 1;
    for (let j = c0, k = 0; j < cols; j += step, k++) {
      series.push({ name: name(j), color: pal[k % pal.length], xs, values: Array.from({ length: n }, (_, i) => num(at(r0 + i, j))), sizes: spec.kind === "bubble" ? Array.from({ length: n }, (_, i) => Math.abs(num(at(r0 + i, j + 1)) ?? 1)) : undefined });
    }
  } else {
    for (let j = c0; j < cols; j++) {
      const k = j - c0;
      series.push({
        name: name(j),
        color: pal[k % pal.length],
        values: Array.from({ length: n }, (_, i) => num(at(r0 + i, j))),
        kind: spec.kind === "combo" ? spec.seriesKinds?.[k] ?? (k === 0 ? "column" : "line") : undefined,
        secondary: spec.secondary?.includes(k),
      });
    }
  }
  if (!series.length) return null;
  const model: ChartModel = { spec, categories, series };
  switch (spec.kind) {
    case "histogram": {
      const vals = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
      const h = histogram(vals, spec.bins);
      model.categories = h.labels;
      model.series = [{ name: series[0].name, color: pal[0], values: h.counts }];
      break;
    }
    case "pareto": {
      const s = series[0];
      const pairs = categories.map((c, i) => [c, s.values[i] ?? 0] as const).sort((a, b) => b[1] - a[1]);
      const total = pairs.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;
      let run = 0;
      model.categories = pairs.map((p) => p[0]);
      model.series = [{ ...s, values: pairs.map((p) => p[1]) }];
      model.cumulative = pairs.map((p) => (run += Math.max(0, p[1])) / total);
      break;
    }
    case "box":
      model.box = series.map((s) => ({ ...quartiles(s.values.filter((v): v is number => v !== null)), name: s.name, color: s.color }));
      model.categories = series.map((s) => s.name);
      break;
    case "waterfall":
      model.series = [series[0]];
      model.totals = categories.map((c) => /\b(total|subtotal|net|balance)\b/i.test(c));
      break;
    case "pie":
    case "doughnut":
    case "funnel":
    case "treemap":
      model.series = [series[0]];
      break;
  }
  series = model.series;
  return model;
}

// ---- Statistics ----------------------------------------------------------------------------------

export function histogram(vals: number[], bins?: number) {
  if (!vals.length) return { labels: [], counts: [] as number[] };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // Scott's rule, as Excel's automatic bins.
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const width0 = sd ? (3.49 * sd) / Math.cbrt(n) : 1;
  const k = Math.max(1, Math.min(50, bins ?? (Math.ceil((hi - lo) / width0) || 1)));
  const width = (hi - lo) / k || 1;
  const counts = new Array(k).fill(0);
  for (const v of vals) counts[Math.min(k - 1, Math.floor((v - lo) / width))]++;
  const f = (x: number) => String(Number(x.toPrecision(4)));
  const labels = counts.map((_, i) => `${i ? "(" : "["}${f(lo + i * width)}, ${f(lo + (i + 1) * width)}]`);
  return { labels, counts };
}

/** Quartiles by Excel's exclusive-median method, with whiskers at 1.5 × IQR. */
export function quartiles(vals: number[]) {
  const s = [...vals].sort((a, b) => a - b);
  if (!s.length) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, outliers: [] };
  const q = (p: number) => {
    const pos = (s.length + 1) * p - 1;
    const i = Math.max(0, Math.min(s.length - 1, Math.floor(pos)));
    const frac = Math.max(0, Math.min(1, pos - i));
    return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * frac;
  };
  const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
  const inside = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return {
    min: inside[0] ?? s[0],
    max: inside[inside.length - 1] ?? s[s.length - 1],
    q1,
    q3,
    median: q(0.5),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    outliers: s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr),
  };
}

export const stdev = (v: number[]) => {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

/** Least-squares polynomial of the given order. Returns coefficients, constant first. */
function polyfit(xs: number[], ys: number[], order: number): number[] | null {
  const m = order + 1;
  const A = Array.from({ length: m }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (j < m ? xs.reduce((a, x) => a + x ** (i + j), 0) : xs.reduce((a, x, k) => a + ys[k] * x ** i, 0))));
  for (let i = 0; i < m; i++) {
    let p = i;
    for (let k = i + 1; k < m; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let k = 0; k < m; k++) {
      if (k === i) continue;
      const f = A[k][i] / A[i][i];
      for (let j = i; j <= m; j++) A[k][j] -= f * A[i][j];
    }
  }
  return A.map((row, i) => row[m] / A[i][i]);
}

export interface Fit {
  f: (x: number) => number;
  equation: string;
  r2: number;
}
const fmt = (v: number) => {
  const s = Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(Number(v.toPrecision(4)));
  return s;
};
const signed = (v: number) => (v < 0 ? ` − ${fmt(-v)}` : ` + ${fmt(v)}`);

/** Fit a trendline through the points (x, y). */
export function fitTrend(kind: Trendline, xs: number[], ys: number[], order = 2): Fit | null {
  const pts = xs.map((x, i) => [x, ys[i]] as const).filter(([x, y]) => isFinite(x) && isFinite(y));
  if (pts.length < 2) return null;
  const X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
  const r2Of = (f: (x: number) => number) => {
    const m = Y.reduce((a, b) => a + b, 0) / Y.length;
    const ssTot = Y.reduce((a, y) => a + (y - m) ** 2, 0);
    const ssRes = Y.reduce((a, y, i) => a + (y - f(X[i])) ** 2, 0);
    return ssTot ? 1 - ssRes / ssTot : 1;
  };
  switch (kind) {
    case "linear": {
      const c = polyfit(X, Y, 1);
      if (!c) return null;
      const f = (x: number) => c[0] + c[1] * x;
      return { f, equation: `y = ${fmt(c[1])}x${signed(c[0])}`, r2: r2Of(f) };
    }
    case "poly2":
    case "poly3": {
      const o = kind === "poly3" ? 3 : Math.max(2, Math.min(6, order));
      const c = polyfit(X, Y, o);
      if (!c) return null;
      const f = (x: number) => c.reduce((a, k, i) => a + k * x ** i, 0);
      const terms = c.map((k, i) => (i === 0 ? fmt(k) : `${fmt(k)}x${i > 1 ? (i === 2 ? "²" : i === 3 ? "³" : `^${i}`) : ""}`)).reverse();
      return { f, equation: "y = " + terms.join(" + ").replace(/\+ -/g, "− "), r2: r2Of(f) };
    }
    case "exp": {
      if (Y.some((y) => y <= 0)) return null;
      const c = polyfit(X, Y.map(Math.log), 1);
      if (!c) return null;
      const a = Math.exp(c[0]);
      const f = (x: number) => a * Math.exp(c[1] * x);
      return { f, equation: `y = ${fmt(a)}e^${fmt(c[1])}x`, r2: r2Of(f) };
    }
    case "log": {
      if (X.some((x) => x <= 0)) return null;
      const c = polyfit(X.map(Math.log), Y, 1);
      if (!c) return null;
      const f = (x: number) => c[0] + c[1] * Math.log(x);
      return { f, equation: `y = ${fmt(c[1])}ln(x)${signed(c[0])}`, r2: r2Of(f) };
    }
    case "power": {
      if (X.some((x) => x <= 0) || Y.some((y) => y <= 0)) return null;
      const c = polyfit(X.map(Math.log), Y.map(Math.log), 1);
      if (!c) return null;
      const a = Math.exp(c[0]);
      const f = (x: number) => a * x ** c[1];
      return { f, equation: `y = ${fmt(a)}x^${fmt(c[1])}`, r2: r2Of(f) };
    }
    case "movingAvg":
      return null;
  }
}

export function movingAverage(ys: (number | null)[], period: number): (number | null)[] {
  return ys.map((_, i) => {
    if (i < period - 1) return null;
    const win = ys.slice(i - period + 1, i + 1).filter((v): v is number => v !== null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

/** Round axis bounds and a tick step, Excel-style. */
export function niceScale(lo: number, hi: number, maxTicks = 6) {
  if (lo === hi) {
    hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.5;
    lo = lo === 0 ? 0 : lo - Math.abs(lo) * 0.5;
  }
  const raw = (hi - lo) / Math.max(1, maxTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { min, max, step, ticks };
}

/** Short tick labels: 12K, 3.4M. */
export function tickLabel(v: number, percent = false) {
  if (percent) return `${Math.round(v * 100)}%`;
  const a = Math.abs(v);
  if (a >= 1e9) return `${Number((v / 1e9).toPrecision(3))}B`;
  if (a >= 1e6) return `${Number((v / 1e6).toPrecision(3))}M`;
  if (a >= 1e4) return `${Number((v / 1e3).toPrecision(3))}K`;
  return String(Number(v.toPrecision(6)));
}
