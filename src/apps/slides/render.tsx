// Draws slides. One renderer serves the editor canvas, the thumbnails and the slide show, so
// what you edit is exactly what you present.
import { createContext, memo, useContext, useId, type CSSProperties, type ReactNode } from "react";
import { Film, Music } from "lucide-react";
import { customPathD, FILL_RULE, OPEN_GEOMS, presetPath } from "./geometry";
import type { Asset, Chart, El, Fill, Line, Para, Run, Slide, SlidesData, TextBody } from "./types";

// ---- Assets -----------------------------------------------------------------------------------

const urls = new WeakMap<Asset, string>();
export const AssetContext = createContext<Record<string, Asset>>({});
export function assetUrl(assets: Record<string, Asset>, key: string | undefined) {
  const a = key ? assets[key] : undefined;
  if (!a) return undefined;
  let u = urls.get(a);
  if (!u) {
    u = URL.createObjectURL(new Blob([a.bytes], { type: a.type }));
    urls.set(a, u);
  }
  return u;
}
const useAsset = (key?: string) => assetUrl(useContext(AssetContext), key);

// ---- Fonts and colors --------------------------------------------------------------------------

const FALLBACKS: [RegExp, string, string][] = [
  [/calibri|aptos|candara|corbel/i, "Forma Carlito", "sans-serif"],
  [/times|georgia|cambria|garamond|book antiqua|palatino|constantia|baskerville|bodoni|didot|serif/i, "Forma Serif", "serif"],
  [/courier|consolas|mono|lucida console/i, "Forma Mono", "monospace"],
  [/./, "Forma Sans", "sans-serif"],
];
export function fontStack(name: string) {
  const [, fb, generic] = FALLBACKS.find(([re]) => re.test(name))!;
  return `"${name}", "${fb}", ${generic}`;
}

export function fillCss(fill: Fill | undefined, assets: Record<string, Asset>): CSSProperties {
  if (!fill || fill.type === "none") return {};
  if (fill.type === "solid") return { background: fill.color };
  if (fill.type === "grad") {
    const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(", ");
    return { background: fill.radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(${fill.angle + 90}deg, ${stops})` };
  }
  const u = assetUrl(assets, fill.asset);
  return u ? { background: `url("${u}") ${fill.tile ? "repeat" : "center / 100% 100% no-repeat"}` } : {};
}

// ---- Text --------------------------------------------------------------------------------------

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
const roman = (n: number) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, "");
const alpha = (n: number) => { let s = ""; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
export function autoNumber(type: string, n: number) {
  const base = type.startsWith("roman") ? roman(n) : type.startsWith("alpha") ? alpha(n) : String(n);
  const v = /Lc/.test(type) ? base.toLowerCase() : base;
  if (type.endsWith("ParenBoth")) return `(${v})`;
  if (type.endsWith("ParenR")) return `${v})`;
  if (type.endsWith("Plain")) return v;
  return `${v}.`;
}
function numbering(paras: Para[]) {
  const counters: number[] = [];
  return paras.map((p) => {
    const lvl = p.level ?? 0;
    counters.length = Math.min(counters.length, lvl + 1);
    if (!p.bullet?.auto) {
      counters[lvl] = 0;
      return 0;
    }
    counters[lvl] = (counters[lvl] || (p.bullet.startAt ?? 1) - 1) + 1;
    return counters[lvl];
  });
}

export const runStyle = (r: Omit<Run, "text">, scale = 1): CSSProperties => ({
  fontFamily: fontStack(r.font),
  fontSize: `${r.size * scale * (r.baseline ? 0.66 : 1)}pt`,
  color: r.color,
  fontWeight: r.bold ? 700 : 400,
  fontStyle: r.italic ? "italic" : undefined,
  textDecoration: [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ") || undefined,
  verticalAlign: r.baseline ? (r.baseline > 0 ? "super" : "sub") : undefined,
  textTransform: r.caps ? "uppercase" : undefined,
  background: r.highlight,
});

/** Run formatting stored on its span, read back when an edit finishes. */
export const runData = (r: Run) => {
  const { text: _t, ...rest } = r;
  return JSON.stringify(rest);
};

export function Paragraphs({ body, editing }: { body: TextBody; editing?: boolean }) {
  const scale = body.fontScale ?? 1;
  const numbers = numbering(body.paras);
  return (
    <>
      {body.paras.map((p, i) => {
        const first = p.runs[0];
        const size = (p.runs.some((r) => r.text) ? Math.max(...p.runs.filter((r) => r.text).map((r) => r.size)) : p.endSize ?? first?.size ?? 18) * scale;
        const lh = p.line ? ("pt" in p.line ? `${p.line.pt}pt` : String(Math.max(0.5, p.line.pct * 1.2 * (1 - (body.lineReduce ?? 0))))) : String(1.2 * (1 - (body.lineReduce ?? 0)));
        const indent = p.indent ?? 0;
        const empty = !p.runs.some((r) => r.text);
        const style: CSSProperties = {
          paddingLeft: p.marL ?? 0,
          textIndent: indent,
          textAlign: p.align === "ctr" ? "center" : p.align === "r" ? "right" : p.align === "just" ? "justify" : "left",
          lineHeight: lh,
          fontSize: `${size}pt`,
          marginTop: i && p.spaceBefore ? `${p.spaceBefore}pt` : undefined,
          marginBottom: p.spaceAfter ? `${p.spaceAfter}pt` : undefined,
          fontFamily: first ? fontStack(first.font) : undefined,
          color: first?.color,
        };
        const bullet = p.bullet && !empty ? (p.bullet.auto ? autoNumber(p.bullet.auto, numbers[i]) : p.bullet.char) : null;
        return (
          <div key={i} data-para={i} data-pp={JSON.stringify({ ...p, runs: undefined })} style={style}>
            {bullet && (
              <span
                data-bullet
                contentEditable={false}
                style={{
                  display: "inline-block",
                  minWidth: indent < 0 ? -indent : undefined,
                  textIndent: 0,
                  paddingRight: indent < 0 ? 0 : "0.4em",
                  color: p.bullet!.color ?? first?.color,
                  fontFamily: fontStack(p.bullet!.font ?? first?.font ?? "Calibri"),
                  fontSize: `${(first?.size ?? 18) * scale * (p.bullet!.scale ?? 1)}pt`,
                  fontWeight: first?.bold ? 700 : 400,
                }}
              >
                {bullet}
              </span>
            )}
            {p.runs.map((r, j) =>
              r.text ? (
                <span key={j} data-run={runData(r)} data-link={r.link} style={runStyle(r, scale)}>
                  {r.text}
                </span>
              ) : null,
            )}
            {empty && (editing ? <br /> : "​")}
          </div>
        );
      })}
    </>
  );
}

export function textBoxStyle(body: TextBody): CSSProperties {
  const [l, t, r, b] = body.inset ?? [9.6, 4.8, 9.6, 4.8];
  return {
    position: "absolute",
    inset: 0,
    padding: `${t}px ${r}px ${b}px ${l}px`,
    display: "flex",
    flexDirection: "column",
    justifyContent: body.anchor === "ctr" ? "center" : body.anchor === "b" ? "flex-end" : "flex-start",
    whiteSpace: body.wrap === false ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
    writingMode: body.vert ? "vertical-rl" : undefined,
    transform: body.vert === "vert270" ? "rotate(180deg)" : undefined,
    columnCount: body.cols,
  };
}

// ---- Shapes ---------------------------------------------------------------------------------------

const DASH: Record<string, number[]> = { dash: [4, 3], sysDash: [3, 1], sysDot: [1, 1], dot: [1, 2], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };

function SvgFill({ fill, id }: { fill: Fill | undefined; id: string }) {
  const assets = useContext(AssetContext);
  if (!fill || fill.type === "grad") {
    if (!fill) return null;
    const t = ((fill.angle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(t) / 2, dy = Math.sin(t) / 2;
    const stops = fill.stops.map((s, i) => <stop key={i} offset={s.pos} stopColor={s.color} />);
    return fill.radial ? <radialGradient id={id}>{stops}</radialGradient> : <linearGradient id={id} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>{stops}</linearGradient>;
  }
  if (fill.type === "image") {
    const u = assetUrl(assets, fill.asset);
    return u ? (
      <pattern id={id} patternContentUnits="objectBoundingBox" width="1" height="1">
        <image href={u} width="1" height="1" preserveAspectRatio="none" />
      </pattern>
    ) : null;
  }
  return null;
}
const paint = (fill: Fill | undefined, id: string) => (!fill || fill.type === "none" ? "none" : fill.type === "solid" ? fill.color : `url(#${id})`);

function strokeProps(line: Line | undefined, mid: string) {
  if (!line) return { stroke: "none" };
  return {
    stroke: line.color,
    strokeWidth: line.width,
    strokeDasharray: line.dash && DASH[line.dash] ? DASH[line.dash].map((d) => d * line.width).join(" ") : undefined,
    markerStart: line.head ? `url(#${mid}h)` : undefined,
    markerEnd: line.tail ? `url(#${mid}t)` : undefined,
    strokeLinejoin: "round" as const,
  };
}
function Markers({ line, id }: { line?: Line; id: string }) {
  if (!line || (!line.head && !line.tail)) return null;
  const m = (suffix: string, kind: string, start: boolean) => (
    <marker id={id + suffix} viewBox="0 0 10 10" refX={kind === "arrow" ? 8 : 5} refY="5" markerWidth="4" markerHeight="4" orient={start ? "auto-start-reverse" : "auto"} markerUnits="strokeWidth">
      {kind === "oval" ? <circle cx="5" cy="5" r="4" fill={line.color} /> : kind === "diamond" ? <path d="M5,0 L10,5 L5,10 L0,5 Z" fill={line.color} /> : kind === "arrow" ? <path d="M0,0 L10,5 L0,10" fill="none" stroke={line.color} strokeWidth="2" /> : <path d="M0,0 L10,5 L0,10 Z" fill={line.color} />}
    </marker>
  );
  return (
    <>
      {line.head && m("h", line.head, true)}
      {line.tail && m("t", line.tail, false)}
    </>
  );
}

export function geomD(el: Pick<El, "geom" | "adj" | "paths" | "w" | "h">) {
  if (el.paths?.length) return el.paths.map((p) => customPathD(p, el.w, el.h)).join(" ");
  return presetPath(el.geom ?? "rect", el.w, el.h, el.adj);
}

function ShapeSvg({ el }: { el: El }) {
  const id = useId().replace(/:/g, "");
  const open = OPEN_GEOMS.has(el.geom ?? "");
  const flip = el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;
  const shadow = el.shadow ? `drop-shadow(${el.shadow.dx}px ${el.shadow.dy}px ${el.shadow.blur / 2}px ${el.shadow.color})` : undefined;
  const fill = open ? "none" : paint(el.fill, id + "f");
  const stroke = strokeProps(el.line, id + "m");
  if (fill === "none" && stroke.stroke === "none") return null;
  return (
    <svg className="sl-svg" width={Math.max(el.w, 1)} height={Math.max(el.h, 1)} style={{ transform: flip, filter: shadow }} aria-hidden>
      <defs>
        <SvgFill fill={el.fill} id={id + "f"} />
        <Markers line={el.line} id={id + "m"} />
      </defs>
      {el.paths?.length ? (
        el.paths.map((p, i) => <path key={i} d={customPathD(p, el.w, el.h)} fill={p.fill === false ? "none" : fill} {...(p.stroke === false ? { stroke: "none" } : stroke)} />)
      ) : (
        <path d={geomD(el)} fill={fill} fillRule={FILL_RULE[el.geom ?? ""] ?? "nonzero"} {...stroke} />
      )}
    </svg>
  );
}

function ImageView({ el }: { el: El }) {
  const src = useAsset(el.image?.asset);
  const [l, t, r, b] = el.image?.crop ?? [0, 0, 0, 0];
  const W = el.w / Math.max(0.01, 1 - l - r), H = el.h / Math.max(0.01, 1 - t - b);
  const clip = el.geom && el.geom !== "rect" ? `path("${geomD(el)}")` : undefined;
  return (
    <>
      <div className="sl-img" style={{ clipPath: clip, filter: el.shadow ? `drop-shadow(${el.shadow.dx}px ${el.shadow.dy}px ${el.shadow.blur / 2}px ${el.shadow.color})` : undefined }}>
        {src && <img src={src} alt="" draggable={false} style={{ position: "absolute", left: -l * W, top: -t * H, width: W, height: H, transform: el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined }} />}
      </div>
      {el.line && <ShapeSvg el={{ ...el, fill: { type: "none" }, shadow: undefined, geom: el.geom ?? "rect" }} />}
    </>
  );
}

function MediaView({ el, live }: { el: El; live?: boolean }) {
  const src = useAsset(el.media?.asset);
  const poster = useAsset(el.image?.asset);
  if (live && src) {
    return el.media!.kind === "audio" ? (
      <div className="sl-media audio">
        <audio src={src} controls style={{ width: "100%" }} />
      </div>
    ) : (
      <video className="sl-media" src={src} poster={poster} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
    );
  }
  return (
    <div className="sl-media" style={{ background: poster ? `url("${poster}") center / 100% 100%` : "#111" }}>
      <span className="sl-media-badge">{el.media?.kind === "audio" ? <Music /> : <Film />}</span>
    </div>
  );
}

function TableView({ el }: { el: El }) {
  const t = el.table!;
  const assets = useContext(AssetContext);
  const border = (l?: Line) => (l ? `${Math.max(l.width, 0.75)}px ${l.dash ? "dashed" : "solid"} ${l.color}` : undefined);
  return (
    <table className="sl-table" style={{ width: t.cols.reduce((a, b) => a + b, 0) }}>
      <colgroup>
        {t.cols.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <tbody>
        {t.rows.map((row, r) => (
          <tr key={r} style={{ height: row.h }}>
            {row.cells.map((c, i) =>
              c.merged ? null : (
                <td
                  key={i}
                  colSpan={c.span}
                  rowSpan={c.rowSpan}
                  style={{
                    ...fillCss(c.fill, assets),
                    borderLeft: border(c.borders?.l),
                    borderRight: border(c.borders?.r),
                    borderTop: border(c.borders?.t),
                    borderBottom: border(c.borders?.b),
                    padding: c.text.inset ? `${c.text.inset[1]}px ${c.text.inset[2]}px ${c.text.inset[3]}px ${c.text.inset[0]}px` : undefined,
                    verticalAlign: c.text.anchor === "ctr" ? "middle" : c.text.anchor === "b" ? "bottom" : "top",
                  }}
                >
                  <Paragraphs body={c.text} />
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Charts -----------------------------------------------------------------------------------------

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString() : String(Math.round(v * 100) / 100));

export function ChartView({ chart, w, h }: { chart: Chart; w: number; h: number }) {
  const fs = Math.max(9, Math.min(16, h / 28));
  const color = chart.textColor ?? "#404040";
  const titleH = chart.title ? fs * 2.2 : fs * 0.6;
  const legendItems = chart.kind === "pie" || chart.kind === "doughnut" ? chart.categories.map((c, i) => ({ name: c, color: chart.series[0]?.colors?.[i] ?? "#888" })) : chart.series.map((s) => ({ name: s.name, color: s.color }));
  const legendRight = chart.legend === "r" || chart.legend === "l";
  const legendW = chart.legend && legendRight ? Math.min(w * 0.3, Math.max(...legendItems.map((l) => l.name.length)) * fs * 0.6 + fs * 2) : 0;
  const legendH = chart.legend && !legendRight ? fs * 2 : 0;
  const plot = { x: chart.legend === "l" ? legendW : 0, y: titleH + (chart.legend === "t" ? legendH : 0), w: w - legendW, h: h - titleH - legendH };

  let body: ReactNode = null;
  if (chart.kind === "pie" || chart.kind === "doughnut") {
    const vals = chart.series[0]?.values.map((v) => Math.max(0, v || 0)) ?? [];
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const R = Math.min(plot.w, plot.h) / 2 - fs;
    const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
    let ang = -Math.PI / 2;
    body = vals.map((v, i) => {
      const a0 = ang, a1 = (ang += (v / total) * Math.PI * 2);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, r: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      const inner = chart.kind === "doughnut" ? R * 0.5 : 0;
      const d = v / total >= 0.9999 ? `M${cx - R},${cy} a${R},${R} 0 1 0 ${2 * R},0 a${R},${R} 0 1 0 ${-2 * R},0` : inner ? `M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)} Z` : `M${cx},${cy} L${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} Z`;
      const mid = (a0 + a1) / 2;
      return (
        <g key={i}>
          <path d={d} fill={chart.series[0]?.colors?.[i] ?? "#888"} stroke="#fff" strokeWidth={1} />
          {chart.labels && v > 0 && (
            <text x={cx + R * 0.7 * Math.cos(mid)} y={cy + R * 0.7 * Math.sin(mid)} fontSize={fs} fill="#fff" textAnchor="middle" dominantBaseline="middle">
              {fmt(v)}
            </text>
          )}
        </g>
      );
    });
  } else {
    const n = chart.categories.length || 1;
    const stackedTotals = chart.categories.map((_, i) => chart.series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0));
    const rawMax = chart.percent ? 1 : chart.stacked ? Math.max(...stackedTotals, 0) : Math.max(...chart.series.flatMap((s) => s.values.map((v) => v || 0)), 0);
    const rawMin = Math.min(0, ...chart.series.flatMap((s) => s.values.map((v) => v || 0)));
    const max = niceMax(rawMax), min = rawMin < 0 ? -niceMax(-rawMin) : 0;
    const axisW = chart.horizontal ? Math.min(plot.w * 0.3, Math.max(...chart.categories.map((c) => c.length)) * fs * 0.55 + fs) : fs * 3.2;
    const axisH = fs * 1.8;
    const area = { x: plot.x + axisW, y: plot.y + fs * 0.5, w: plot.w - axisW - fs, h: plot.h - axisH - fs * 0.5 };
    const ticks = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
    const val = (v: number) => ((v - min) / (max - min || 1)) * (chart.horizontal ? area.w : area.h);
    const grid = ticks.map((t, i) =>
      chart.horizontal ? (
        <g key={i}>
          <line x1={area.x + val(t)} x2={area.x + val(t)} y1={area.y} y2={area.y + area.h} stroke="#d9d9d9" />
          <text x={area.x + val(t)} y={area.y + area.h + fs * 1.2} fontSize={fs} fill={color} textAnchor="middle">{chart.percent ? `${Math.round(t * 100)}%` : fmt(t)}</text>
        </g>
      ) : (
        <g key={i}>
          <line x1={area.x} x2={area.x + area.w} y1={area.y + area.h - val(t)} y2={area.y + area.h - val(t)} stroke="#d9d9d9" />
          <text x={area.x - fs * 0.4} y={area.y + area.h - val(t)} fontSize={fs} fill={color} textAnchor="end" dominantBaseline="middle">{chart.percent ? `${Math.round(t * 100)}%` : fmt(t)}</text>
        </g>
      ),
    );
    const band = (chart.horizontal ? area.h : area.w) / n;
    const cats = chart.categories.map((c, i) =>
      chart.horizontal ? (
        <text key={i} x={area.x - fs * 0.4} y={area.y + band * (n - i - 0.5)} fontSize={fs} fill={color} textAnchor="end" dominantBaseline="middle">{c}</text>
      ) : (
        <text key={i} x={area.x + band * (i + 0.5)} y={area.y + area.h + fs * 1.2} fontSize={fs} fill={color} textAnchor="middle">{c}</text>
      ),
    );
    let marks: ReactNode[] = [];
    if (chart.kind === "bar") {
      const k = chart.stacked ? 1 : chart.series.length;
      const bw = (band * 0.7) / k;
      const acc = chart.categories.map(() => 0);
      marks = chart.series.flatMap((s, si) =>
        s.values.map((raw, i) => {
          let v = raw || 0;
          if (chart.percent) v = stackedTotals[i] ? v / stackedTotals[i] : 0;
          const start = chart.stacked ? acc[i] : 0;
          if (chart.stacked) acc[i] += v;
          const a = val(Math.min(start, start + v)), b = val(Math.max(start, start + v));
          const zero = val(0);
          const off = band * 0.15 + (chart.stacked ? 0 : si * bw);
          const lo = chart.stacked ? a : Math.min(zero, b), len = chart.stacked ? b - a : Math.abs(b - zero);
          return chart.horizontal ? (
            <rect key={`${si}-${i}`} x={area.x + lo} y={area.y + band * (n - i - 1) + off} width={Math.max(0, len)} height={bw} fill={s.color} />
          ) : (
            <rect key={`${si}-${i}`} x={area.x + band * i + off} y={area.y + area.h - lo - len} width={bw} height={Math.max(0, len)} fill={s.color} />
          );
        }),
      );
    } else {
      const acc = chart.categories.map(() => 0);
      marks = chart.series.map((s, si) => {
        const pts = s.values.map((raw, i) => {
          let v = raw || 0;
          if (chart.stacked) v = acc[i] += v;
          return [area.x + band * (i + 0.5), area.y + area.h - val(v)] as const;
        });
        const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
        return chart.kind === "area" ? (
          <path key={si} d={`${d} L${pts[pts.length - 1]?.[0]},${area.y + area.h - val(0)} L${pts[0]?.[0]},${area.y + area.h - val(0)} Z`} fill={s.color} fillOpacity={0.85} />
        ) : (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={Math.max(2, fs / 5)} strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={fs / 4} fill={s.color} />)}
          </g>
        );
      });
    }
    body = (
      <>
        {grid}
        {marks}
        {cats}
      </>
    );
  }

  const legend = chart.legend
    ? legendItems.map((it, i) => {
        const x = legendRight ? (chart.legend === "l" ? fs * 0.5 : w - legendW + fs * 0.5) : (w / (legendItems.length + 1)) * (i + 1) - it.name.length * fs * 0.25;
        const y = legendRight ? h / 2 - (legendItems.length * fs * 1.5) / 2 + i * fs * 1.5 : chart.legend === "t" ? titleH + fs * 0.5 : h - fs * 1.5;
        return (
          <g key={i}>
            <rect x={x} y={y} width={fs * 0.8} height={fs * 0.8} fill={it.color} />
            <text x={x + fs * 1.1} y={y + fs * 0.7} fontSize={fs} fill={color}>{it.name}</text>
          </g>
        );
      })
    : null;

  return (
    <svg width={w} height={h} className="sl-chart" style={{ fontFamily: fontStack("Calibri") }}>
      {chart.title && <text x={w / 2} y={fs * 1.5} fontSize={fs * 1.3} fill={color} textAnchor="middle">{chart.title}</text>}
      {body}
      {legend}
    </svg>
  );
}

// ---- Elements and slides ---------------------------------------------------------------------------

export interface ElOptions {
  /** Show placeholder prompts ("Click to add title"), as the editor does. */
  prompts?: boolean;
  /** Play video and audio, as the slide show does. */
  live?: boolean;
  /** This element's text is being edited elsewhere; draw only its shape. */
  hideText?: string;
}

export const ElView = memo(function ElView({ el, opts }: { el: El; opts: ElOptions }) {
  const hasText = !!el.text?.paras.some((p) => p.runs.some((r) => r.text));
  let content: ReactNode = null;
  if (el.type === "image") content = <ImageView el={el} />;
  else if (el.type === "media") content = <MediaView el={el} live={opts.live} />;
  else if (el.type === "table" && el.table) content = <TableView el={el} />;
  else if (el.type === "chart" && el.chart) content = <ChartView chart={el.chart} w={el.w} h={el.h} />;
  else
    content = (
      <>
        <ShapeSvg el={el} />
        {el.text && opts.hideText !== el.id && (hasText || !(opts.prompts && el.prompt)) && (
          <div className="sl-text" style={textBoxStyle(el.text)}>
            <Paragraphs body={el.text} />
          </div>
        )}
        {el.text && opts.hideText !== el.id && !hasText && opts.prompts && el.prompt && (
          <div className="sl-text sl-prompt" style={textBoxStyle(el.text)}>
            <div style={{ ...runStyle(el.text.paras[0]?.runs[0] ?? { size: 18, font: "Calibri", color: "#888" }, el.text.fontScale), color: undefined, textAlign: el.text.paras[0]?.align === "ctr" ? "center" : el.text.paras[0]?.align === "r" ? "right" : "left" }}>{el.prompt}</div>
          </div>
        )}
      </>
    );
  return (
    <div
      className="sl-el"
      data-el={el.id}
      data-groups={el.groups?.join(" ")}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: el.rot ? `rotate(${el.rot}deg)` : undefined, opacity: el.opacity }}
    >
      <div className="sl-anim" data-anim>
        {content}
      </div>
    </div>
  );
});

export function slideBg(deck: Pick<SlidesData, "bases">, slide: Slide): Fill {
  return slide.bg ?? (slide.base ? deck.bases[slide.base]?.bg : undefined) ?? { type: "solid", color: "#ffffff" };
}

/** A slide at its real size (deck.w × deck.h px); scale it with CSS around it. */
export function SlideView({ deck, slide, opts = {}, children }: { deck: SlidesData; slide: Slide; opts?: ElOptions; children?: ReactNode }) {
  const base = slide.base && !slide.noBase ? deck.bases[slide.base] : undefined;
  return (
    <AssetContext.Provider value={deck.assets}>
      <div className="sl-slide" style={{ width: deck.w, height: deck.h, ...fillCss(slideBg(deck, slide), deck.assets) }}>
        {base?.els.map((el) => <ElView key={el.id} el={el} opts={{}} />)}
        {slide.els.map((el) => (
          <ElView key={el.id} el={el} opts={opts} />
        ))}
        {children}
      </div>
    </AssetContext.Provider>
  );
}

/** A slide drawn to fit a width, for thumbnails and pickers. */
export const Thumb = memo(
  function Thumb({ deck, slide, width }: { deck: SlidesData; slide: Slide; width: number }) {
  const s = width / deck.w;
  return (
    <div className="sl-thumb" style={{ width, height: deck.h * s }}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <SlideView deck={deck} slide={slide} />
      </div>
    </div>
  );
  },
  // Re-draw only when this slide, its layout or the slide size changed.
  (a, b) => a.slide === b.slide && a.width === b.width && a.deck.bases === b.deck.bases && a.deck.assets === b.deck.assets && a.deck.w === b.deck.w && a.deck.h === b.deck.h,
);
