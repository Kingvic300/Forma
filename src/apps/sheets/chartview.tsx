// Drawing sheet charts as SVG: column, bar, line, area and combo charts with an optional
// secondary axis, scatter and bubble, histogram, Pareto, box and whisker, waterfall, pie,
// doughnut, radar, funnel and treemap, with trendlines, error bars, data labels and axis titles.
import type { ReactNode } from "react";
import { fitTrend, movingAverage, niceScale, PALETTES, stdev, tickLabel, type ChartModel } from "./chart";

const INK = "#404040";
const GRID = "#e3e3e3";
const AXIS = "#bfbfbf";
const UP = "#4472c4", DOWN = "#ed7d31", TOTAL = "#a5a5a5";

const valueText = (v: number, pct = false) => (pct ? `${Number((v * 100).toPrecision(3))}%` : Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(Number(v.toPrecision(4))));

/** Smooth path through points (Catmull-Rom as cubic Béziers). */
function path(pts: [number, number][], smooth?: boolean) {
  if (!pts.length) return "";
  if (!smooth || pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Split runs of points at gaps (null values). */
const runs = (pts: ([number, number] | null)[]) => {
  const out: [number, number][][] = [[]];
  for (const p of pts) {
    if (p) out[out.length - 1].push(p);
    else if (out[out.length - 1].length) out.push([]);
  }
  return out.filter((r) => r.length);
};

export function SheetChartView({ model, w, h }: { model: ChartModel; w: number; h: number }) {
  const { spec } = model;
  const kind = spec.kind;
  const fs = Math.max(9, Math.min(14, h / 26));
  const pal = PALETTES[spec.palette ?? "Office"] ?? PALETTES.Office;
  const radialLegend = kind === "pie" || kind === "doughnut" || kind === "funnel" || kind === "treemap";
  const legendItems: { name: string; color: string; line?: boolean }[] =
    kind === "pie" || kind === "doughnut" ? model.categories.map((c, i) => ({ name: c, color: pal[i % pal.length] }))
    : kind === "histogram" || kind === "funnel" || kind === "treemap" ? []
    : kind === "pareto" ? [{ name: model.series[0]?.name ?? "", color: model.series[0]?.color ?? UP }, { name: "Cumulative %", color: DOWN, line: true }]
    : kind === "waterfall" ? [{ name: "Increase", color: UP }, { name: "Decrease", color: DOWN }, { name: "Total", color: TOTAL }]
    : model.series.map((s) => ({ name: s.name, color: s.color, line: kind === "line" || kind === "scatter" || s.kind === "line" }));
  const legendPos = spec.legend === false ? null : spec.legendPos ?? (radialLegend ? "r" : "b");
  const showLegend = legendPos && legendItems.length > 0 && !(legendItems.length === 1 && kind !== "pie" && kind !== "doughnut" && kind !== "pareto" && kind !== "waterfall");
  const titleH = spec.title ? fs * 2.1 : fs * 0.8;
  const side = legendPos === "r" || legendPos === "l";
  const legendW = showLegend && side ? Math.min(w * 0.35, Math.max(...legendItems.map((l) => l.name.length)) * fs * 0.58 + fs * 2.4) : 0;
  const legendH = showLegend && !side ? fs * 2 : 0;
  const box = {
    x: legendPos === "l" ? legendW : 0,
    y: titleH + (legendPos === "t" ? legendH : 0),
    w: w - legendW,
    h: h - titleH - legendH,
  };
  let body: ReactNode;
  if (kind === "pie" || kind === "doughnut") body = <Pie model={model} box={box} fs={fs} pal={pal} />;
  else if (kind === "radar") body = <Radar model={model} box={box} fs={fs} />;
  else if (kind === "funnel") body = <Funnel model={model} box={box} fs={fs} pal={pal} />;
  else if (kind === "treemap") body = <Treemap model={model} box={box} fs={fs} pal={pal} />;
  else body = <Cartesian model={model} box={box} fs={fs} />;

  let legend: ReactNode = null;
  if (showLegend) {
    if (side) {
      const x0 = legendPos === "r" ? w - legendW + fs * 0.6 : fs * 0.4;
      const y0 = box.y + box.h / 2 - (legendItems.length * fs * 1.5) / 2;
      legend = legendItems.map((l, i) => (
        <g key={i} transform={`translate(${x0},${y0 + i * fs * 1.5})`}>
          {l.line ? <line x1={0} x2={fs} y1={fs * 0.5} y2={fs * 0.5} stroke={l.color} strokeWidth={2} /> : <rect width={fs * 0.75} height={fs * 0.75} y={fs * 0.12} fill={l.color} />}
          <text x={fs * 1.25} y={fs * 0.82} fontSize={fs * 0.92} fill={INK}>{l.name.length > 22 ? l.name.slice(0, 21) + "…" : l.name}</text>
        </g>
      ));
    } else {
      const widths = legendItems.map((l) => Math.min(l.name.length, 20) * fs * 0.56 + fs * 2.2);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = Math.max(4, (w - total) / 2);
      const y = legendPos === "t" ? titleH : h - legendH + fs * 0.3;
      legend = legendItems.map((l, i) => {
        const g = (
          <g key={i} transform={`translate(${x},${y})`}>
            {l.line ? <line x1={0} x2={fs} y1={fs * 0.55} y2={fs * 0.55} stroke={l.color} strokeWidth={2} /> : <rect width={fs * 0.75} height={fs * 0.75} y={fs * 0.15} fill={l.color} />}
            <text x={fs * 1.2} y={fs * 0.85} fontSize={fs * 0.92} fill={INK}>{l.name.length > 20 ? l.name.slice(0, 19) + "…" : l.name}</text>
          </g>
        );
        x += widths[i];
        return g;
      });
    }
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", fontFamily: "Calibri, Carlito, 'Mona Sans', sans-serif" }}>
      {spec.title && <text x={w / 2} y={fs * 1.45} textAnchor="middle" fontSize={fs * 1.3} fill={INK}>{spec.title}</text>}
      {body}
      {legend}
    </svg>
  );
}

type Box = { x: number; y: number; w: number; h: number };

// ---- Axes charts ----------------------------------------------------------------------------------

function Cartesian({ model, box, fs }: { model: ChartModel; box: Box; fs: number }) {
  const { spec, series, categories } = model;
  const kind = spec.kind;
  const horizontal = kind === "bar";
  const xy = kind === "scatter" || kind === "bubble";
  const stackable = (kind === "column" || kind === "bar" || kind === "line" || kind === "area") && (spec.stacked || spec.percent);
  const pct = !!spec.percent && stackable;
  const n = categories.length;
  const out: ReactNode[] = [];

  // Value ranges.
  const primary = series.filter((s) => !s.secondary);
  const secondarySeries = series.filter((s) => s.secondary);
  const vals: number[] = [];
  const stackTotals = (list: typeof series) => {
    const pos = new Array(n).fill(0), neg = new Array(n).fill(0);
    list.forEach((s) => s.values.forEach((v, i) => (v ?? 0) >= 0 ? (pos[i] += v ?? 0) : (neg[i] += v ?? 0)));
    return { pos, neg };
  };
  let waterfall: { lo: number; hi: number; v: number; total: boolean }[] = [];
  if (kind === "waterfall") {
    let run = 0;
    waterfall = (series[0]?.values ?? []).map((v, i) => {
      const total = !!model.totals?.[i];
      const val = v ?? 0;
      if (total) {
        run = val;
        return { lo: 0, hi: val, v: val, total };
      }
      const start = run;
      run += val;
      return { lo: Math.min(start, run), hi: Math.max(start, run), v: val, total };
    });
    waterfall.forEach((b) => vals.push(b.lo, b.hi));
  } else if (kind === "box") {
    (model.box ?? []).forEach((b) => vals.push(b.min, b.max, ...b.outliers));
  } else if (pct) vals.push(0, 1);
  else if (stackable) {
    const t = stackTotals(primary);
    vals.push(...t.pos, ...t.neg);
  } else primary.forEach((s) => s.values.forEach((v) => v !== null && vals.push(v)));
  // Error bars widen the range.
  const errOf = (s: (typeof series)[number], v: number) => {
    const e = spec.errorBars;
    if (!e) return 0;
    const nums = s.values.filter((x): x is number => x !== null);
    return e.type === "fixed" ? e.value : e.type === "percent" ? Math.abs(v) * e.value / 100 : e.type === "stdev" ? stdev(nums) * (e.value || 1) : (stdev(nums) / Math.sqrt(Math.max(1, nums.length))) * (e.value || 1);
  };
  if (spec.errorBars && !stackable) primary.forEach((s) => s.values.forEach((v) => v !== null && vals.push(v + errOf(s, v), v - errOf(s, v))));
  const zeroBased = kind === "column" || kind === "bar" || kind === "area" || kind === "histogram" || kind === "pareto" || kind === "waterfall" || kind === "combo";
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (kind === "bubble") {
    const pad = (hi - lo || 1) * 0.12;
    lo -= pad;
    hi += pad;
  }
  if (zeroBased) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const useLog = !!spec.log && lo > 0;
  const scale = useLog ? (() => {
    const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
    return { min: 10 ** a, max: 10 ** Math.max(b, a + 1), ticks: Array.from({ length: Math.max(b, a + 1) - a + 1 }, (_, i) => 10 ** (a + i)) };
  })() : niceScale(spec.min ?? lo, spec.max ?? hi);
  if (!useLog) {
    if (spec.min !== undefined) scale.min = spec.min;
    if (spec.max !== undefined) scale.max = spec.max;
    if (pct) Object.assign(scale, { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
  }
  const ticks = scale.ticks.filter((t) => t >= scale.min - 1e-9 && t <= scale.max + 1e-9);
  // Secondary axis (combo series, Pareto's cumulative line).
  const hasSecondary = secondarySeries.length > 0 || kind === "pareto";
  const s2 = kind === "pareto" ? { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] } : hasSecondary ? niceScale(Math.min(0, ...secondarySeries.flatMap((s) => s.values.filter((v): v is number => v !== null))), Math.max(...secondarySeries.flatMap((s) => s.values.filter((v): v is number => v !== null)), 1)) : null;

  // X range for scatter.
  const allX = xy ? series.flatMap((s) => s.xs ?? []) : [];
  // Bubbles need room at the edges.
  const xPad = kind === "bubble" ? (Math.max(...allX) - Math.min(...allX) || 1) * 0.1 : 0;
  const xs = xy ? niceScale(Math.min(...allX) - xPad, Math.max(...allX) + xPad) : null;

  // Plot area: leave room for tick labels and axis titles.
  const tickW = Math.max(...ticks.map((t) => tickLabel(t, pct).length)) * fs * 0.55 + fs * 0.8;
  const tick2W = s2 ? Math.max(...s2.ticks.map((t) => tickLabel(t, kind === "pareto").length)) * fs * 0.55 + fs * 0.8 : 0;
  const catLabelH = fs * 1.6;
  const left = box.x + (spec.yTitle ? fs * 1.6 : 0) + (horizontal ? Math.min(box.w * 0.3, Math.max(...categories.map((c) => c.length)) * fs * 0.52 + fs) : tickW);
  const right = box.x + box.w - fs * 0.8 - (s2 ? tick2W + (spec.y2Title ? fs * 1.6 : 0) : 0);
  const top = box.y + fs * 0.6;
  const bottom = box.y + box.h - (horizontal ? catLabelH : catLabelH) - (spec.xTitle ? fs * 1.6 : 0);
  const pw = Math.max(10, right - left), ph = Math.max(10, bottom - top);

  // Value → pixel along the value axis; category → band centre.
  const vpos = (v: number, sc = scale) => {
    const t = useLog && sc === scale ? (Math.log10(Math.max(v, scale.min)) - Math.log10(scale.min)) / (Math.log10(scale.max) - Math.log10(scale.min)) : (v - sc.min) / (sc.max - sc.min || 1);
    return horizontal ? left + t * pw : bottom - t * ph;
  };
  const band = (horizontal ? ph : pw) / Math.max(1, n);
  const cpos = (i: number) => (horizontal ? top + band * (i + 0.5) : left + band * (i + 0.5));
  const xpos = (x: number) => left + ((x - xs!.min) / (xs!.max - xs!.min || 1)) * pw;

  // Gridlines and value axis labels.
  ticks.forEach((t, i) => {
    const p = vpos(t);
    if (spec.gridlines !== false) out.push(horizontal ? <line key={`g${i}`} x1={p} x2={p} y1={top} y2={bottom} stroke={GRID} /> : <line key={`g${i}`} x1={left} x2={right} y1={p} y2={p} stroke={GRID} />);
    out.push(horizontal
      ? <text key={`t${i}`} x={p} y={bottom + fs * 1.2} textAnchor="middle" fontSize={fs * 0.85} fill={INK}>{tickLabel(t, pct)}</text>
      : <text key={`t${i}`} x={left - fs * 0.4} y={p + fs * 0.32} textAnchor="end" fontSize={fs * 0.85} fill={INK}>{tickLabel(t, pct)}</text>);
  });
  if (s2) s2.ticks.forEach((t, i) => {
    const p = vpos(t, s2);
    out.push(<text key={`t2${i}`} x={right + fs * 0.4} y={p + fs * 0.32} fontSize={fs * 0.85} fill={INK}>{tickLabel(t, kind === "pareto")}</text>);
  });
  // Category axis.
  if (xy) {
    xs!.ticks.forEach((t, i) => {
      const p = xpos(t);
      if (p < left - 1 || p > right + 1) return;
      if (spec.gridlines !== false) out.push(<line key={`xg${i}`} x1={p} x2={p} y1={top} y2={bottom} stroke={GRID} />);
      out.push(<text key={`xt${i}`} x={p} y={bottom + fs * 1.2} textAnchor="middle" fontSize={fs * 0.85} fill={INK}>{tickLabel(t)}</text>);
    });
  } else {
    const maxChars = Math.max(3, Math.floor(band / (fs * 0.55)));
    const every = horizontal ? Math.max(1, Math.ceil((fs * 1.2) / band)) : Math.max(1, Math.ceil(Math.min(...categories.map((c) => c.length), 12) * fs * 0.55 / band));
    categories.forEach((c, i) => {
      if (i % every) return;
      const label = !horizontal && c.length > maxChars * every ? c.slice(0, Math.max(2, maxChars * every - 1)) + "…" : c;
      out.push(horizontal
        ? <text key={`c${i}`} x={left - fs * 0.4} y={cpos(i) + fs * 0.32} textAnchor="end" fontSize={fs * 0.85} fill={INK}>{c.length > 24 ? c.slice(0, 23) + "…" : c}</text>
        : <text key={`c${i}`} x={cpos(i)} y={bottom + fs * 1.2} textAnchor="middle" fontSize={fs * 0.85} fill={INK}>{label}</text>);
    });
  }
  // Axis lines.
  const zero = !useLog && scale.min < 0 && scale.max > 0 ? vpos(0) : horizontal ? left : bottom;
  out.push(horizontal ? <line key="ax" x1={zero} x2={zero} y1={top} y2={bottom} stroke={AXIS} /> : <line key="ax" x1={left} x2={right} y1={zero} y2={zero} stroke={AXIS} />);
  // Axis titles.
  if (spec.xTitle) out.push(<text key="xt" x={left + pw / 2} y={box.y + box.h - fs * 0.35} textAnchor="middle" fontSize={fs * 0.95} fill={INK}>{spec.xTitle}</text>);
  if (spec.yTitle) out.push(<text key="yt" transform={`translate(${box.x + fs * 1.05},${top + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize={fs * 0.95} fill={INK}>{spec.yTitle}</text>);
  if (spec.y2Title && s2) out.push(<text key="y2t" transform={`translate(${box.x + box.w - fs * 0.6},${top + ph / 2}) rotate(90)`} textAnchor="middle" fontSize={fs * 0.95} fill={INK}>{spec.y2Title}</text>);

  const label = (key: string, x: number, y: number, v: number, anchor: "middle" | "start" = "middle") =>
    spec.labels ? <text key={key} x={x} y={y} textAnchor={anchor} fontSize={fs * 0.8} fill={INK}>{valueText(v, pct)}</text> : null;
  const errBar = (key: string, x: number, y: number, v: number, s: (typeof series)[number], color: string) => {
    if (!spec.errorBars || stackable) return null;
    const e = errOf(s, v);
    if (!e) return null;
    const a = vpos(v - e), b = vpos(v + e), cap = fs * 0.35;
    return horizontal ? (
      <g key={key} stroke={color === "#a5a5a5" ? "#555" : "#333"} strokeWidth={1}><line x1={a} x2={b} y1={y} y2={y} /><line x1={a} x2={a} y1={y - cap} y2={y + cap} /><line x1={b} x2={b} y1={y - cap} y2={y + cap} /></g>
    ) : (
      <g key={key} stroke="#333" strokeWidth={1}><line x1={x} x2={x} y1={a} y2={b} /><line x1={x - cap} x2={x + cap} y1={a} y2={a} /><line x1={x - cap} x2={x + cap} y1={b} y2={b} /></g>
    );
  };

  // ---- Series ----
  if (kind === "box") {
    (model.box ?? []).forEach((b, i) => {
      const cx = cpos(i), bw = band * 0.45;
      out.push(
        <g key={`box${i}`}>
          <line x1={cx} x2={cx} y1={vpos(b.max)} y2={vpos(b.q3)} stroke="#555" />
          <line x1={cx} x2={cx} y1={vpos(b.q1)} y2={vpos(b.min)} stroke="#555" />
          <line x1={cx - bw / 4} x2={cx + bw / 4} y1={vpos(b.max)} y2={vpos(b.max)} stroke="#555" />
          <line x1={cx - bw / 4} x2={cx + bw / 4} y1={vpos(b.min)} y2={vpos(b.min)} stroke="#555" />
          <rect x={cx - bw / 2} y={vpos(b.q3)} width={bw} height={Math.max(1, vpos(b.q1) - vpos(b.q3))} fill={b.color} fillOpacity={0.85} stroke="#fff" />
          <line x1={cx - bw / 2} x2={cx + bw / 2} y1={vpos(b.median)} y2={vpos(b.median)} stroke="#fff" strokeWidth={2} />
          <path d={`M${cx - 3},${vpos(b.mean) - 3}l6,6M${cx + 3},${vpos(b.mean) - 3}l-6,6`} stroke="#fff" strokeWidth={1.5} />
          {b.outliers.map((o, k) => <circle key={k} cx={cx} cy={vpos(o)} r={2.5} fill="none" stroke={b.color} />)}
          {spec.labels && <text x={cx + bw / 2 + 3} y={vpos(b.median) + fs * 0.3} fontSize={fs * 0.75} fill={INK}>{valueText(b.median)}</text>}
        </g>,
      );
    });
    return <g>{out}</g>;
  }
  if (kind === "waterfall") {
    waterfall.forEach((b, i) => {
      const cx = cpos(i), bw = band * 0.6;
      const y1 = vpos(b.hi), y2 = vpos(b.lo);
      out.push(<rect key={`w${i}`} x={cx - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} fill={b.total ? TOTAL : b.v >= 0 ? UP : DOWN} />);
      if (i < waterfall.length - 1) {
        const end = b.total ? b.hi : b.v >= 0 ? b.hi : b.lo;
        out.push(<line key={`wc${i}`} x1={cx + bw / 2} x2={cpos(i + 1) - bw / 2} y1={vpos(end)} y2={vpos(end)} stroke="#999" strokeDasharray="2 2" />);
      }
      out.push(label(`wl${i}`, cx, y1 - fs * 0.3, b.v));
    });
    return <g>{out}</g>;
  }
  if (xy) {
    const maxSize = Math.max(1, ...series.flatMap((s) => s.sizes ?? [1]));
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v === null ? null : ([xpos(s.xs![i]), vpos(v)] as [number, number])));
      if (spec.smooth || spec.markers === false) runs(pts).forEach((r, k) => out.push(<path key={`sl${si}-${k}`} d={path(r, spec.smooth)} fill="none" stroke={s.color} strokeWidth={2} />));
      pts.forEach((p, i) => {
        if (!p) return;
        const r = kind === "bubble" ? Math.max(3, Math.sqrt((s.sizes?.[i] ?? 1) / maxSize) * Math.min(pw, ph) * 0.09) : 3.5;
        out.push(errBar(`se${si}-${i}`, p[0], p[1], s.values[i]!, s, s.color));
        if (spec.markers !== false || kind === "bubble") out.push(<circle key={`sp${si}-${i}`} cx={p[0]} cy={p[1]} r={r} fill={s.color} fillOpacity={kind === "bubble" ? 0.7 : 1} stroke={kind === "bubble" ? "#fff" : "none"} />);
        out.push(label(`sv${si}-${i}`, p[0], p[1] - r - 3, s.values[i]!));
      });
      out.push(...trend(si, s.xs ?? [], s.values, s.color));
    });
    return <g>{out}</g>;
  }

  // Category charts: column/bar/histogram/pareto, line, area, combo.
  const barSeries = series.filter((s) => (kind === "combo" ? (s.kind ?? "column") === "column" : kind === "column" || kind === "bar" || kind === "histogram" || kind === "pareto"));
  const lineSeries = series.filter((s) => (kind === "combo" ? s.kind === "line" : kind === "line"));
  const areaSeries = series.filter((s) => (kind === "combo" ? s.kind === "area" : kind === "area"));
  const totals = pct ? stackTotals(series) : null;
  const norm = (v: number, i: number) => (pct && totals ? v / ((totals.pos[i] - totals.neg[i]) || 1) : v);
  const stacked = !!stackable;

  // Areas first (they sit behind).
  if (areaSeries.length) {
    const base = new Array(n).fill(0);
    areaSeries.forEach((s, si) => {
      const sc = s.secondary && s2 ? s2 : scale;
      const lowerVals = stacked ? base.slice() : new Array(n).fill(Math.max(sc.min, Math.min(0, sc.max)));
      const upperVals = s.values.map((v, i) => (stacked ? lowerVals[i] + norm(v ?? 0, i) : v ?? 0));
      if (stacked) upperVals.forEach((v, i) => (base[i] = v));
      const upper = upperVals.map((v, i) => [cpos(i), vpos(v, sc)] as [number, number]);
      const lower = lowerVals.map((v, i) => [cpos(i), vpos(v, sc)] as [number, number]).reverse();
      out.push(<path key={`a${si}`} d={path(upper, spec.smooth) + "L" + lower.map((p) => p.join(",")).join("L") + "Z"} fill={s.color} fillOpacity={stacked ? 0.9 : 0.55} stroke={s.color} strokeWidth={1} />);
      s.values.forEach((v, i) => v !== null && out.push(label(`al${si}-${i}`, cpos(i), vpos(upperVals[i], sc) - fs * 0.4, v)));
    });
  }
  // Bars.
  if (barSeries.length) {
    const gap = kind === "histogram" ? 0.02 : kind === "pareto" ? 0.1 : 0.35;
    const groupW = band * (1 - gap);
    const each = stacked ? groupW : groupW / barSeries.length;
    const pos = new Array(n).fill(0), neg = new Array(n).fill(0);
    barSeries.forEach((s, si) => {
      const sc = s.secondary && s2 ? s2 : scale;
      s.values.forEach((v0, i) => {
        if (v0 === null) return;
        const v = norm(v0, i);
        let a: number, b: number;
        if (stacked) {
          if (v >= 0) { a = pos[i]; b = pos[i] += v; }
          else { a = neg[i]; b = neg[i] += v; }
        } else {
          a = useLog ? scale.min : Math.max(sc.min, Math.min(0, sc.max));
          b = v;
        }
        const off = stacked ? -groupW / 2 : -groupW / 2 + each * si;
        const p1 = vpos(a, sc), p2 = vpos(b, sc);
        const fill = kind === "histogram" ? s.color : s.color;
        if (horizontal) {
          const y = cpos(i) + off;
          out.push(<rect key={`b${si}-${i}`} x={Math.min(p1, p2)} y={y} width={Math.max(0.5, Math.abs(p2 - p1))} height={each * 0.98} fill={fill} />);
          out.push(errBar(`be${si}-${i}`, 0, y + each / 2, v0, s, s.color));
          if (spec.labels) out.push(<text key={`bl${si}-${i}`} x={Math.max(p1, p2) + 3} y={y + each / 2 + fs * 0.3} fontSize={fs * 0.8} fill={INK}>{valueText(stacked && pct ? v : v0, pct)}</text>);
        } else {
          const x = cpos(i) + off;
          out.push(<rect key={`b${si}-${i}`} x={x} y={Math.min(p1, p2)} width={Math.max(0.5, each * (kind === "histogram" ? 1 : 0.98))} height={Math.max(0.5, Math.abs(p2 - p1))} fill={fill} stroke={kind === "histogram" ? "#fff" : "none"} strokeWidth={kind === "histogram" ? 0.5 : 0} />);
          out.push(errBar(`be${si}-${i}`, x + each / 2, 0, v0, s, s.color));
          out.push(label(`bl${si}-${i}`, x + each / 2, (stacked ? (p1 + p2) / 2 + fs * 0.3 : Math.min(p1, p2) - fs * 0.3), stacked && pct ? v : v0));
        }
      });
      if (!stacked && kind !== "histogram") out.push(...trend(si, categories.map((_, i) => i + 1), s.values, s.color, s.secondary && s2 ? s2 : scale));
    });
  }
  // Pareto's cumulative line on the secondary axis.
  if (kind === "pareto" && model.cumulative && s2) {
    const pts = model.cumulative.map((v, i) => [cpos(i), vpos(v, s2)] as [number, number]);
    out.push(<path key="pc" d={path(pts)} fill="none" stroke={DOWN} strokeWidth={2} />);
    pts.forEach((p, i) => out.push(<circle key={`pcp${i}`} cx={p[0]} cy={p[1]} r={2.5} fill={DOWN} />));
  }
  // Lines on top.
  if (lineSeries.length) {
    const base = new Array(n).fill(0);
    lineSeries.forEach((s, si) => {
      const sc = s.secondary && s2 ? s2 : scale;
      const ys = s.values.map((v, i) => {
        if (v === null) return null;
        const y = stacked ? (base[i] += norm(v, i)) : v;
        return y;
      });
      const pts = ys.map((y, i) => (y === null ? null : ([cpos(i), vpos(y, sc)] as [number, number])));
      runs(pts).forEach((r, k) => out.push(<path key={`l${si}-${k}`} d={path(r, spec.smooth)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" />));
      const marks = spec.markers ?? n <= 24;
      pts.forEach((p, i) => {
        if (!p) return;
        out.push(errBar(`le${si}-${i}`, p[0], p[1], s.values[i]!, s, s.color));
        if (marks) out.push(<circle key={`lm${si}-${i}`} cx={p[0]} cy={p[1]} r={3} fill={s.color} stroke="#fff" strokeWidth={1} />);
        out.push(label(`ll${si}-${i}`, p[0], p[1] - fs * 0.6, stacked && pct ? ys[i]! : s.values[i]!));
      });
      if (!stacked) out.push(...trend(100 + si, categories.map((_, i) => i + 1), s.values, s.color, sc));
    });
  }
  return <g>{out}</g>;

  // Trendline through one series, drawn dashed in its colour with the equation and R² if asked.
  function trend(key: number, X: number[], Y: (number | null)[], color: string, sc = scale): ReactNode[] {
    const t = spec.trendline;
    if (!t) return [];
    const toX = (x: number) => (xy ? xpos(x) : cpos(x - 1));
    const toY = (v: number) => vpos(v, sc);
    if (horizontal) return [];
    if (t === "movingAvg") {
      const ma = movingAverage(Y, Math.max(2, spec.trendOrder ?? 2));
      return runs(ma.map((v, i) => (v === null ? null : ([toX(X[i]), toY(v)] as [number, number])))).map((r, k) => <path key={`tr${key}-${k}`} d={path(r)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 3" />);
    }
    const ok = X.map((x, i) => [x, Y[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null);
    const fit = fitTrend(t, ok.map((p) => p[0]), ok.map((p) => p[1]), spec.trendOrder ?? 2);
    if (!fit) return [];
    const x0 = Math.min(...X), x1 = Math.max(...X);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 60; k++) {
      const x = x0 + ((x1 - x0) * k) / 60;
      const y = fit.f(x);
      if (isFinite(y)) pts.push([toX(x), Math.max(top - 20, Math.min(bottom + 20, toY(y)))]);
    }
    const nodes: ReactNode[] = [<path key={`tr${key}`} d={path(pts)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 3" />];
    const txt = [spec.trendEquation && fit.equation, spec.trendR2 && `R² = ${fit.r2.toFixed(4)}`].filter(Boolean).join("   ");
    if (txt) {
      const last = pts[pts.length - 1];
      nodes.push(<text key={`te${key}`} x={Math.min(last[0], right - 4)} y={Math.max(top + fs, last[1] - fs * 0.6) + (key % 100) * fs * 1.1} textAnchor="end" fontSize={fs * 0.8} fill={color}>{txt}</text>);
    }
    return nodes;
  }
}

// ---- Round and other charts -----------------------------------------------------------------------------

function Pie({ model, box, fs, pal }: { model: ChartModel; box: Box; fs: number; pal: string[] }) {
  const vals = (model.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const R = Math.max(8, Math.min(box.w, box.h) / 2 - fs * 0.8);
  const inner = model.spec.kind === "doughnut" ? R * 0.55 : 0;
  let a = -Math.PI / 2;
  return (
    <g>
      {vals.map((v, i) => {
        const a0 = a, a1 = (a += (v / total) * Math.PI * 2);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (r: number, t: number) => `${cx + r * Math.cos(t)},${cy + r * Math.sin(t)}`;
        const d = v >= total ? (inner ? `M${p(R, 0)}A${R},${R} 0 1 1 ${p(R, Math.PI)}A${R},${R} 0 1 1 ${p(R, 0)}M${p(inner, 0)}A${inner},${inner} 0 1 0 ${p(inner, Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, 0)}` : `M${p(R, 0)}A${R},${R} 0 1 1 ${p(R, Math.PI)}A${R},${R} 0 1 1 ${p(R, 0)}Z`)
          : inner ? `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z` : `M${cx},${cy}L${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}Z`;
        const mid = (a0 + a1) / 2, lr = inner ? (R + inner) / 2 : R * 0.65;
        return (
          <g key={i}>
            <path d={d} fill={pal[i % pal.length]} stroke="#fff" strokeWidth={1.5} fillRule="evenodd" />
            {model.spec.labels && v / total > 0.03 && <text x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + fs * 0.3} textAnchor="middle" fontSize={fs * 0.85} fill="#fff">{Math.round((v / total) * 100)}%</text>}
          </g>
        );
      })}
    </g>
  );
}

function Radar({ model, box, fs }: { model: ChartModel; box: Box; fs: number }) {
  const n = model.categories.length;
  if (n < 3) return <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" fontSize={fs} fill={INK}>A radar chart needs at least three categories.</text>;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2 + fs * 0.3;
  const R = Math.max(10, Math.min(box.w, box.h) / 2 - fs * 2.2);
  const all = model.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const sc = niceScale(Math.min(0, ...all), Math.max(...all, 1), 5);
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i: number, v: number) => {
    const r = ((v - sc.min) / (sc.max - sc.min || 1)) * R;
    return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))] as [number, number];
  };
  return (
    <g>
      {sc.ticks.map((t, k) => <polygon key={`r${k}`} points={Array.from({ length: n }, (_, i) => pt(i, t).join(",")).join(" ")} fill="none" stroke={GRID} />)}
      {sc.ticks.map((t, k) => <text key={`rt${k}`} x={cx + 3} y={pt(0, t)[1] - 2} fontSize={fs * 0.75} fill="#888">{tickLabel(t)}</text>)}
      {model.categories.map((c, i) => {
        const [x, y] = [cx + (R + fs * 0.9) * Math.cos(ang(i)), cy + (R + fs * 0.9) * Math.sin(ang(i))];
        return (
          <g key={`ax${i}`}>
            <line x1={cx} y1={cy} x2={cx + R * Math.cos(ang(i))} y2={cy + R * Math.sin(ang(i))} stroke={GRID} />
            <text x={x} y={y + fs * 0.3} textAnchor={Math.abs(Math.cos(ang(i))) < 0.2 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end"} fontSize={fs * 0.85} fill={INK}>{c.length > 16 ? c.slice(0, 15) + "…" : c}</text>
          </g>
        );
      })}
      {model.series.map((s, si) => (
        <g key={`s${si}`}>
          <polygon points={s.values.map((v, i) => pt(i, v ?? sc.min).join(",")).join(" ")} fill={s.color} fillOpacity={0.15} stroke={s.color} strokeWidth={2} />
          {s.values.map((v, i) => { const [x, y] = pt(i, v ?? sc.min); return <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />; })}
        </g>
      ))}
    </g>
  );
}

function Funnel({ model, box, fs, pal }: { model: ChartModel; box: Box; fs: number; pal: string[] }) {
  const vals = (model.series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const max = Math.max(...vals, 1);
  const labelW = Math.min(box.w * 0.3, Math.max(...model.categories.map((c) => c.length)) * fs * 0.55 + fs);
  const left = box.x + labelW, w = box.w - labelW - fs, rowH = (box.h - fs) / Math.max(1, vals.length);
  return (
    <g>
      {vals.map((v, i) => {
        const bw = (v / max) * w, y = box.y + fs * 0.4 + i * rowH;
        return (
          <g key={i}>
            <text x={left - fs * 0.5} y={y + rowH / 2 + fs * 0.3} textAnchor="end" fontSize={fs * 0.85} fill={INK}>{model.categories[i]}</text>
            <rect x={left + (w - bw) / 2} y={y + rowH * 0.08} width={Math.max(1, bw)} height={rowH * 0.84} fill={pal[0]} fillOpacity={1 - (i / Math.max(1, vals.length)) * 0.35} />
            <text x={left + w / 2} y={y + rowH / 2 + fs * 0.3} textAnchor="middle" fontSize={fs * 0.85} fill="#fff">{valueText(v)}</text>
          </g>
        );
      })}
    </g>
  );
}

/** Squarified treemap layout. */
function squarify(items: { v: number; i: number }[], x: number, y: number, w: number, h: number): { i: number; x: number; y: number; w: number; h: number }[] {
  const out: { i: number; x: number; y: number; w: number; h: number }[] = [];
  let rest = items.filter((it) => it.v > 0).sort((a, b) => b.v - a.v);
  const total = rest.reduce((a, b) => a + b.v, 0);
  if (!total) return out;
  const scale = (w * h) / total;
  let bx = x, by = y, bw = w, bh = h;
  while (rest.length) {
    const short = Math.min(bw, bh);
    let row: typeof rest = [];
    let worst = Infinity;
    for (const it of rest) {
      const next = [...row, it];
      const s = next.reduce((a, b) => a + b.v * scale, 0);
      const mx = Math.max(...next.map((r) => r.v * scale)), mn = Math.min(...next.map((r) => r.v * scale));
      const wst = Math.max((short * short * mx) / (s * s), (s * s) / (short * short * mn));
      if (wst > worst) break;
      worst = wst;
      row = next;
    }
    const s = row.reduce((a, b) => a + b.v * scale, 0);
    const thick = s / short;
    let off = 0;
    for (const it of row) {
      const len = (it.v * scale) / thick;
      if (bw >= bh) out.push({ i: it.i, x: bx, y: by + off, w: thick, h: len });
      else out.push({ i: it.i, x: bx + off, y: by, w: len, h: thick });
      off += len;
    }
    if (bw >= bh) { bx += thick; bw -= thick; } else { by += thick; bh -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

function Treemap({ model, box, fs, pal }: { model: ChartModel; box: Box; fs: number; pal: string[] }) {
  const vals = (model.series[0]?.values ?? []).map((v, i) => ({ v: Math.max(0, v ?? 0), i }));
  const rects = squarify(vals, box.x + 2, box.y + 2, box.w - 4, box.h - 4);
  return (
    <g>
      {rects.map((r) => (
        <g key={r.i}>
          <rect x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)} fill={pal[r.i % pal.length]} stroke="#fff" strokeWidth={2} />
          {r.w > fs * 3 && r.h > fs * 1.6 && (
            <text x={r.x + 5} y={r.y + fs * 1.15} fontSize={fs * 0.85} fill="#fff">
              {model.categories[r.i].slice(0, Math.max(2, Math.floor(r.w / (fs * 0.55))))}
              {r.h > fs * 2.8 && <tspan x={r.x + 5} dy={fs * 1.1}>{valueText(vals[r.i].v)}</tspan>}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/** A sparkline: a tiny line, column or win/loss chart filling a cell. */
export function SparklineSvg({ values, kind, color = "#2e75b6", highLow, w, h }: { values: number[]; kind: "line" | "column" | "winloss"; color?: string; highLow?: boolean; w: number; h: number }) {
  if (!values.length) return null;
  const pad = 3;
  const lo = Math.min(...values, kind === "column" ? 0 : Infinity), hi = Math.max(...values, kind === "column" ? 0 : -Infinity);
  const y = (v: number) => (kind === "winloss" ? 0 : h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2));
  const step = (w - pad * 2) / Math.max(1, kind === "line" ? values.length - 1 : values.length);
  const imax = values.indexOf(Math.max(...values)), imin = values.indexOf(Math.min(...values));
  return (
    <svg className="cell-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {kind === "line" && (
        <>
          <path d={values.map((v, i) => `${i ? "L" : "M"}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          {highLow && <circle cx={pad + imax * step} cy={y(values[imax])} r={2} fill="#2e9e4f" />}
          {highLow && <circle cx={pad + imin * step} cy={y(values[imin])} r={2} fill="#d9434d" />}
        </>
      )}
      {kind === "column" && values.map((v, i) => {
        const y0 = y(Math.max(0, Math.min(lo, hi) > 0 ? lo : 0)), y1 = y(v);
        return <rect key={i} x={pad + i * step + step * 0.12} y={Math.min(y0, y1)} width={step * 0.76} height={Math.max(1, Math.abs(y1 - y0))} fill={highLow && i === imax ? "#2e9e4f" : highLow && i === imin ? "#d9434d" : v < 0 ? "#d9434d" : color} />;
      })}
      {kind === "winloss" && values.map((v, i) => (
        <rect key={i} x={pad + i * step + step * 0.12} y={v >= 0 ? pad : h / 2 + 1} width={step * 0.76} height={h / 2 - pad - 1} fill={v >= 0 ? color : "#d9434d"} opacity={v === 0 ? 0.25 : 1} />
      ))}
    </svg>
  );
}
