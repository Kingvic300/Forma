// Chart editor and sparkline dialog.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../../ui";
import { parseRange } from "./formula";
import { CHART_KINDS, PALETTES, type ChartModel } from "./chart";
import { SheetChartView } from "./chartview";
import type { ChartKind, SheetChart, Sparkline, Trendline } from "./types";

const TRENDS: { v: Trendline | ""; label: string }[] = [
  { v: "", label: "None" },
  { v: "linear", label: "Linear" },
  { v: "exp", label: "Exponential" },
  { v: "log", label: "Logarithmic" },
  { v: "power", label: "Power" },
  { v: "poly2", label: "Polynomial" },
  { v: "movingAvg", label: "Moving average" },
];

const cartesian = (k: ChartKind) => !["pie", "doughnut", "funnel", "treemap", "radar"].includes(k);

export function ChartDialog({ chart, preview, onSave, onDelete, onClose }: {
  chart: SheetChart;
  preview: (c: SheetChart) => ChartModel | null;
  onSave: (c: SheetChart) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [c, setC] = useState(chart);
  const [tab, setTab] = useState<"type" | "labels" | "axes" | "series">("type");
  const set = (p: Partial<SheetChart>) => setC({ ...c, ...p });
  const stackable = c.kind === "column" || c.kind === "bar" || c.kind === "area" || c.kind === "line";
  const model = parseRange(c.range) ? preview(c) : null;
  const num = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? undefined : Number(v));
  return (
    <Modal title="Chart" onClose={onClose} wide>
      <div className="sh-chartdlg">
        <div className="sh-chartdlg-preview">{model ? <SheetChartView model={model} w={300} h={210} /> : <p className="muted small">Choose a data range to see the chart.</p>}</div>
        <div className="sh-chartdlg-side">
          <div className="seg sh-seg">
            {(["type", "labels", "axes", "series"] as const).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "type" ? "Type and data" : t === "labels" ? "Titles and legend" : t === "axes" ? "Axes and lines" : "Series"}</button>
            ))}
          </div>
          {tab === "type" && (
            <div className="sh-form">
              <label><span>Type</span>
                <select value={c.kind} onChange={(e) => set({ kind: e.target.value as ChartKind })}>
                  {["Common", "XY", "Statistical", "Other"].map((g) => (
                    <optgroup key={g} label={g}>
                      {CHART_KINDS.filter((k) => k.group === g).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              {stackable && (
                <label><span>Grouping</span>
                  <select value={c.percent ? "percent" : c.stacked ? "stacked" : "clustered"} onChange={(e) => set({ stacked: e.target.value !== "clustered", percent: e.target.value === "percent" })}>
                    <option value="clustered">Side by side</option>
                    <option value="stacked">Stacked</option>
                    <option value="percent">100% stacked</option>
                  </select>
                </label>
              )}
              <label><span>Data range</span><input value={c.range} onChange={(e) => set({ range: e.target.value.toUpperCase() })} /></label>
              <label><span>Series in</span>
                <select value={c.byRow ? "rows" : "cols"} onChange={(e) => set({ byRow: e.target.value === "rows" })}>
                  <option value="cols">Columns</option>
                  <option value="rows">Rows</option>
                </select>
              </label>
              {c.kind === "histogram" && <label><span>Bins</span><input type="number" min={1} max={50} value={c.bins ?? ""} placeholder="Automatic" onChange={(e) => set({ bins: num(e.target.value) })} /></label>}
              <label><span>Colors</span>
                <select value={c.palette ?? "Office"} onChange={(e) => set({ palette: e.target.value })}>
                  {Object.keys(PALETTES).map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <p className="muted small">{c.kind === "scatter" || c.kind === "bubble" ? "The first column holds the X values; each other column is a series" + (c.kind === "bubble" ? " followed by its bubble sizes." : ".") : c.kind === "waterfall" ? "Categories named Total, Subtotal or Net are drawn as totals." : "The first row names the series and the first column labels the categories."}</p>
            </div>
          )}
          {tab === "labels" && (
            <div className="sh-form">
              <label><span>Chart title</span><input value={c.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} /></label>
              {cartesian(c.kind) && (
                <>
                  <label><span>{c.kind === "bar" ? "Vertical axis" : "Horizontal axis"}</span><input value={c.xTitle ?? ""} onChange={(e) => set({ xTitle: e.target.value || undefined })} /></label>
                  <label><span>{c.kind === "bar" ? "Horizontal axis" : "Vertical axis"}</span><input value={c.yTitle ?? ""} onChange={(e) => set({ yTitle: e.target.value || undefined })} /></label>
                  {(c.kind === "combo" || c.kind === "pareto") && <label><span>Secondary axis</span><input value={c.y2Title ?? ""} onChange={(e) => set({ y2Title: e.target.value || undefined })} /></label>}
                </>
              )}
              <label><span>Legend</span>
                <select value={c.legend === false ? "none" : c.legendPos ?? "auto"} onChange={(e) => set(e.target.value === "none" ? { legend: false } : { legend: true, legendPos: e.target.value === "auto" ? undefined : (e.target.value as SheetChart["legendPos"]) })}>
                  <option value="auto">Automatic</option>
                  <option value="b">Bottom</option>
                  <option value="t">Top</option>
                  <option value="r">Right</option>
                  <option value="l">Left</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={!!c.labels} onChange={(e) => set({ labels: e.target.checked })} /> <span>Data labels</span></label>
            </div>
          )}
          {tab === "axes" && (
            <div className="sh-form">
              {cartesian(c.kind) ? (
                <>
                  <label className="check"><input type="checkbox" checked={c.gridlines !== false} onChange={(e) => set({ gridlines: e.target.checked })} /> <span>Gridlines</span></label>
                  <label><span>Minimum</span><input value={c.min ?? ""} placeholder="Automatic" onChange={(e) => set({ min: num(e.target.value) })} /></label>
                  <label><span>Maximum</span><input value={c.max ?? ""} placeholder="Automatic" onChange={(e) => set({ max: num(e.target.value) })} /></label>
                  <label className="check"><input type="checkbox" checked={!!c.log} onChange={(e) => set({ log: e.target.checked })} /> <span>Logarithmic scale</span></label>
                  {(c.kind === "line" || c.kind === "area" || c.kind === "scatter" || c.kind === "combo") && <label className="check"><input type="checkbox" checked={!!c.smooth} onChange={(e) => set({ smooth: e.target.checked })} /> <span>Smooth lines</span></label>}
                  {(c.kind === "line" || c.kind === "scatter" || c.kind === "combo") && <label className="check"><input type="checkbox" checked={c.markers !== false} onChange={(e) => set({ markers: e.target.checked })} /> <span>Markers</span></label>}
                  <label><span>Trendline</span>
                    <select value={c.trendline ?? ""} onChange={(e) => set({ trendline: (e.target.value || undefined) as Trendline | undefined })}>
                      {TRENDS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                  </label>
                  {(c.trendline === "poly2" || c.trendline === "movingAvg") && <label><span>{c.trendline === "poly2" ? "Order" : "Period"}</span><input type="number" min={2} max={c.trendline === "poly2" ? 6 : 50} value={c.trendOrder ?? 2} onChange={(e) => set({ trendOrder: num(e.target.value) })} /></label>}
                  {c.trendline && c.trendline !== "movingAvg" && (
                    <div className="sh-checks">
                      <label className="check"><input type="checkbox" checked={!!c.trendEquation} onChange={(e) => set({ trendEquation: e.target.checked })} /> <span>Show equation</span></label>
                      <label className="check"><input type="checkbox" checked={!!c.trendR2} onChange={(e) => set({ trendR2: e.target.checked })} /> <span>Show R²</span></label>
                    </div>
                  )}
                  <label><span>Error bars</span>
                    <select value={c.errorBars?.type ?? ""} onChange={(e) => set({ errorBars: e.target.value ? { type: e.target.value as NonNullable<SheetChart["errorBars"]>["type"], value: c.errorBars?.value ?? (e.target.value === "percent" ? 5 : 1) } : undefined })}>
                      <option value="">None</option>
                      <option value="fixed">Fixed value</option>
                      <option value="percent">Percentage</option>
                      <option value="stdev">Standard deviation</option>
                      <option value="stderr">Standard error</option>
                    </select>
                  </label>
                  {c.errorBars && <label><span>{c.errorBars.type === "percent" ? "Percent" : c.errorBars.type === "fixed" ? "Amount" : "Multiple"}</span><input value={c.errorBars.value} onChange={(e) => set({ errorBars: { ...c.errorBars!, value: num(e.target.value) ?? 0 } })} /></label>}
                </>
              ) : (
                <p className="muted small">This chart type has no axes.</p>
              )}
            </div>
          )}
          {tab === "series" && (
            <div className="sh-form">
              {c.kind === "combo" && model ? (
                model.series.map((s, i) => (
                  <div key={i} className="sh-series-row">
                    <span className="sh-series-dot" style={{ background: s.color }} />
                    <span className="grow">{s.name}</span>
                    <select value={c.seriesKinds?.[i] ?? (i === 0 ? "column" : "line")} onChange={(e) => set({ seriesKinds: { ...(c.seriesKinds ?? {}), [i]: e.target.value as "column" | "line" | "area" } })}>
                      <option value="column">Column</option>
                      <option value="line">Line</option>
                      <option value="area">Area</option>
                    </select>
                    <label className="check"><input type="checkbox" checked={!!c.secondary?.includes(i)} onChange={(e) => set({ secondary: e.target.checked ? [...(c.secondary ?? []), i] : (c.secondary ?? []).filter((x) => x !== i) })} /> Secondary</label>
                  </div>
                ))
              ) : (
                <p className="muted small">Choose Combo on the first tab to mix columns, lines and areas, and to put series on a secondary axis.</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <button onClick={() => { onDelete(); onClose(); }}><Trash2 /> Delete chart</button>
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!parseRange(c.range)} onClick={() => { onSave(c); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

export function SparklineDialog({ data, location, onSave, onRemove, onClose }: { data: string; location: string; onSave: (loc: string, s: Sparkline) => string | null; onRemove: (loc: string) => void; onClose: () => void }) {
  const [s, setS] = useState<Sparkline>({ range: data, kind: "line", color: "#2e75b6" });
  const [loc, setLoc] = useState(location);
  const [err, setErr] = useState("");
  return (
    <Modal title="Sparklines" onClose={onClose}>
      <div className="sh-form">
        <label><span>Type</span>
          <select value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as Sparkline["kind"] })}>
            <option value="line">Line</option>
            <option value="column">Column</option>
            <option value="winloss">Win/Loss</option>
          </select>
        </label>
        <label><span>Data range</span><input value={s.range} onChange={(e) => setS({ ...s, range: e.target.value.toUpperCase() })} placeholder="B2:M2" /></label>
        <label><span>Location</span><input value={loc} onChange={(e) => setLoc(e.target.value.toUpperCase())} placeholder="N2, or N2:N9 for one per row" /></label>
        <label><span>Color</span><input type="color" value={s.color ?? "#2e75b6"} onChange={(e) => setS({ ...s, color: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={!!s.highLow} onChange={(e) => setS({ ...s, highLow: e.target.checked })} /> <span>Mark high and low points</span></label>
        <p className="muted small">With several location cells, each gets the matching row (or column) of the data range.</p>
        {err && <p className="sh-err">{err}</p>}
      </div>
      <div className="modal-foot">
        <button onClick={() => { onRemove(loc); onClose(); }}><Trash2 /> Clear sparklines</button>
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { const e = onSave(loc, s); if (e) setErr(e); else onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}
