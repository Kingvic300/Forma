// Pieces of the spreadsheet editor: colour and border pickers, the dialogs for conditional
// formatting, data validation, sorting, charts and named ranges, the find bar and the function list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Search, Trash2, X } from "lucide-react";
import { Modal, useDismiss } from "../../ui";
import { colName, parseRange } from "./formula";
import { FUNCTIONS, SIGNATURES } from "./functions";
import type { Border, CondRule, SheetChart, Validation } from "./types";

const uid = () => Math.random().toString(36).slice(2, 10);

// ---- Colours --------------------------------------------------------------------------------------

const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79",
  "#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300",
];

export function ColorMenu({ icon, title, value, onPick, noneLabel }: { icon: ReactNode; title: string; value?: string; onPick: (c: string | undefined) => void; noneLabel?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  return (
    <div className="menu" ref={ref}>
      <button className="sh-color" title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {icon}
        <span className="sh-swatch" style={{ background: value ?? "transparent" }} />
      </button>
      {open && (
        <div className="menu-pop pop left sh-palette" onMouseDown={(e) => e.preventDefault()}>
          {noneLabel && <button className="sh-none" onClick={() => { onPick(undefined); setOpen(false); }}>{noneLabel}</button>}
          <div className="sh-swatches">
            {PALETTE.map((c) => (
              <button key={c} title={c} aria-label={c} style={{ background: c }} className={value === c ? "on" : ""} onClick={() => { onPick(c); setOpen(false); }} />
            ))}
          </div>
          <label className="sh-custom">
            Custom <input type="color" value={value ?? "#000000"} onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

export type BorderKind = "all" | "outer" | "inner" | "top" | "bottom" | "left" | "right" | "none" | "thickOuter" | "bottomDouble";

export function BorderMenu({ onPick }: { onPick: (kind: BorderKind, b: Border) => void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState("#000000");
  const [style, setStyle] = useState("thin");
  const ref = useDismiss(open, setOpen);
  const item = (k: BorderKind, label: string, d: string) => (
    <button key={k} title={label} aria-label={label} onClick={() => { onPick(k, { color, style }); setOpen(false); }}>
      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden>
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeDasharray="1 1.5" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth={k === "thickOuter" ? 2.2 : 1.4} />
      </svg>
    </button>
  );
  return (
    <div className="menu" ref={ref}>
      <button title="Borders" aria-label="Borders" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden><path d="M2 2h12v12H2zM8 2v12M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
        <ChevronDown className="chev" />
      </button>
      {open && (
        <div className="menu-pop pop left sh-borders" onMouseDown={(e) => e.preventDefault()}>
          <div className="sh-border-grid">
            {item("all", "All borders", "M2 2h12v12H2zM8 2v12M2 8h12")}
            {item("outer", "Outside borders", "M2 2h12v12H2z")}
            {item("inner", "Inside borders", "M8 2v12M2 8h12")}
            {item("thickOuter", "Thick outside border", "M2 2h12v12H2z")}
            {item("top", "Top border", "M2 2h12")}
            {item("bottom", "Bottom border", "M2 14h12")}
            {item("left", "Left border", "M2 2v12")}
            {item("right", "Right border", "M14 2v12")}
            {item("bottomDouble", "Double bottom border", "M2 13h12M2 15h12")}
            {item("none", "No borders", "")}
          </div>
          <div className="sh-border-opts">
            <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Line style">
              <option value="thin">Thin</option>
              <option value="medium">Medium</option>
              <option value="thick">Thick</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
            </select>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Line color" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Conditional formatting --------------------------------------------------------------------------

const COND_TYPES: { type: CondRule["type"]; label: string; args: 0 | 1 | 2; text?: boolean }[] = [
  { type: "gt", label: "Greater than", args: 1 },
  { type: "lt", label: "Less than", args: 1 },
  { type: "between", label: "Between", args: 2 },
  { type: "eq", label: "Equal to", args: 1 },
  { type: "ne", label: "Not equal to", args: 1 },
  { type: "contains", label: "Text contains", args: 1, text: true },
  { type: "notContains", label: "Text does not contain", args: 1, text: true },
  { type: "begins", label: "Text begins with", args: 1, text: true },
  { type: "ends", label: "Text ends with", args: 1, text: true },
  { type: "blank", label: "Is empty", args: 0 },
  { type: "notBlank", label: "Is not empty", args: 0 },
  { type: "duplicate", label: "Duplicate values", args: 0 },
  { type: "unique", label: "Unique values", args: 0 },
  { type: "top", label: "Top N items", args: 1 },
  { type: "bottom", label: "Bottom N items", args: 1 },
  { type: "aboveAvg", label: "Above average", args: 0 },
  { type: "belowAvg", label: "Below average", args: 0 },
  { type: "formula", label: "Custom formula is", args: 1, text: true },
  { type: "scale2", label: "Color scale (2 colors)", args: 0 },
  { type: "scale3", label: "Color scale (3 colors)", args: 0 },
  { type: "bar", label: "Data bars", args: 0 },
];
const STYLES = [
  { label: "Light red fill, dark red text", style: { bg: "#ffc7ce", color: "#9c0006" } },
  { label: "Yellow fill, dark yellow text", style: { bg: "#ffeb9c", color: "#9c5700" } },
  { label: "Green fill, dark green text", style: { bg: "#c6efce", color: "#006100" } },
  { label: "Light red fill", style: { bg: "#ffc7ce" } },
  { label: "Red text", style: { color: "#c00000" } },
  { label: "Bold", style: { bold: true } },
];
export const condLabel = (r: CondRule) => {
  const t = COND_TYPES.find((x) => x.type === r.type)?.label ?? r.type;
  return t + (r.a ? ` ${r.a}${r.percent ? "%" : ""}` : "") + (r.b ? ` and ${r.b}` : "");
};

export function CondDialog({ rules, selection, onSave, onClose }: { rules: CondRule[]; selection: string; onSave: (rules: CondRule[]) => void; onClose: () => void }) {
  const [list, setList] = useState(rules);
  const [draft, setDraft] = useState<CondRule | null>(rules.length ? null : { id: uid(), range: selection, type: "gt", a: "", style: STYLES[0].style });
  const info = COND_TYPES.find((x) => x.type === draft?.type);
  const save = (next: CondRule[]) => {
    setList(next);
    onSave(next);
  };
  return (
    <Modal title="Conditional formatting" onClose={onClose} wide>
      {!draft ? (
        <>
          <div className="sh-rules">
            {list.map((r, i) => (
              <div key={r.id} className="sh-rule">
                <span className="sh-rule-swatch" style={{ background: r.type === "bar" ? r.colors?.[0] : r.type.startsWith("scale") ? `linear-gradient(90deg, ${(r.colors ?? []).join(",")})` : r.style?.bg, color: r.style?.color, fontWeight: r.style?.bold ? 700 : 400 }}>Aa</span>
                <span className="grow"><b>{condLabel(r)}</b><span className="muted small"> · {r.range}</span></span>
                <button className="icon" title="Higher priority" disabled={!i} onClick={() => { const n = list.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; save(n); }}><ArrowUp /></button>
                <button className="icon" title="Lower priority" disabled={i === list.length - 1} onClick={() => { const n = list.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; save(n); }}><ArrowDown /></button>
                <button onClick={() => setDraft(r)}>Edit</button>
                <button className="icon" title="Delete rule" onClick={() => save(list.filter((x) => x.id !== r.id))}><Trash2 /></button>
              </div>
            ))}
            {!list.length && <p className="muted">No rules on this sheet yet.</p>}
          </div>
          <div className="modal-foot">
            <button onClick={() => setDraft({ id: uid(), range: selection, type: "gt", a: "", style: STYLES[0].style })}><Plus /> New rule</button>
            <span className="grow" />
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <div className="sh-form">
            <label><span>Apply to range</span><input value={draft.range} onChange={(e) => setDraft({ ...draft, range: e.target.value.toUpperCase() })} placeholder="A1:B10" /></label>
            <label>
              <span>Format cells if</span>
              <select value={draft.type} onChange={(e) => {
                const type = e.target.value as CondRule["type"];
                setDraft({ ...draft, type, colors: type === "scale2" ? ["#f8696b", "#63be7b"] : type === "scale3" ? ["#f8696b", "#ffeb84", "#63be7b"] : type === "bar" ? ["#638ec6"] : undefined, a: type === "top" || type === "bottom" ? "10" : draft.a });
              }}>
                {COND_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </label>
            {info && info.args >= 1 && (
              <label><span>{draft.type === "formula" ? "Formula" : draft.type === "top" || draft.type === "bottom" ? "How many" : "Value"}</span>
                <input value={draft.a ?? ""} onChange={(e) => setDraft({ ...draft, a: e.target.value })} placeholder={draft.type === "formula" ? "=$B2>100" : ""} />
              </label>
            )}
            {(draft.type === "top" || draft.type === "bottom") && (
              <label className="check"><input type="checkbox" checked={!!draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.checked })} /> <span>Percent of cells</span></label>
            )}
            {info?.args === 2 && <label><span>And</span><input value={draft.b ?? ""} onChange={(e) => setDraft({ ...draft, b: e.target.value })} /></label>}
            {draft.colors ? (
              <label>
                <span>Colors</span>
                <span className="sh-colors">
                  {draft.colors.map((c, i) => (
                    <input key={i} type="color" value={c} onChange={(e) => setDraft({ ...draft, colors: draft.colors!.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Color ${i + 1}`} />
                  ))}
                </span>
              </label>
            ) : (
              <>
                <label>
                  <span>Style</span>
                  <select value={STYLES.findIndex((s) => JSON.stringify(s.style) === JSON.stringify(draft.style))} onChange={(e) => setDraft({ ...draft, style: e.target.value === "-1" ? draft.style : STYLES[Number(e.target.value)].style })}>
                    {STYLES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                    <option value={-1}>Custom</option>
                  </select>
                </label>
                <label>
                  <span>Custom</span>
                  <span className="sh-colors">
                    Fill <input type="color" value={draft.style?.bg ?? "#ffffff"} onChange={(e) => setDraft({ ...draft, style: { ...draft.style, bg: e.target.value } })} />
                    Text <input type="color" value={draft.style?.color ?? "#000000"} onChange={(e) => setDraft({ ...draft, style: { ...draft.style, color: e.target.value } })} />
                    <label className="check"><input type="checkbox" checked={!!draft.style?.bold} onChange={(e) => setDraft({ ...draft, style: { ...draft.style, bold: e.target.checked || undefined } })} /> Bold</label>
                  </span>
                </label>
              </>
            )}
            <label className="check"><input type="checkbox" checked={!!draft.stop} onChange={(e) => setDraft({ ...draft, stop: e.target.checked || undefined })} /> <span>Stop if true (later rules don't apply)</span></label>
          </div>
          <div className="modal-foot">
            <button onClick={() => setDraft(null)}>Back</button>
            <span className="grow" />
            <button
              className="primary"
              disabled={!parseRange(draft.range)}
              onClick={() => {
                const exists = list.some((x) => x.id === draft.id);
                save(exists ? list.map((x) => (x.id === draft.id ? draft : x)) : [...list, draft]);
                setDraft(null);
              }}
            >
              Save rule
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---- Data validation ------------------------------------------------------------------------------

export function ValidDialog({ rule, selection, onSave, onRemove, onClose }: { rule?: Validation; selection: string; onSave: (v: Validation) => void; onRemove: () => void; onClose: () => void }) {
  const [v, setV] = useState<Validation>(rule ?? { id: uid(), range: selection, type: "list", list: "", strict: true });
  const numeric = v.type === "whole" || v.type === "decimal" || v.type === "date" || v.type === "length";
  const two = v.op === "between" || v.op === "notBetween" || !v.op;
  return (
    <Modal title="Data validation" onClose={onClose}>
      <div className="sh-form">
        <label><span>Cells</span><input value={v.range} onChange={(e) => setV({ ...v, range: e.target.value.toUpperCase() })} /></label>
        <label>
          <span>Allow</span>
          <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as Validation["type"], op: e.target.value === "list" || e.target.value === "formula" ? undefined : v.op ?? "between" })}>
            <option value="list">List of items (dropdown)</option>
            <option value="whole">Whole number</option>
            <option value="decimal">Decimal</option>
            <option value="date">Date</option>
            <option value="length">Text length</option>
            <option value="formula">Custom formula</option>
          </select>
        </label>
        {v.type === "list" && <label><span>Items</span><input value={v.list ?? ""} onChange={(e) => setV({ ...v, list: e.target.value })} placeholder="Yes, No, Maybe — or a range like $D$1:$D$9" /></label>}
        {numeric && (
          <label>
            <span>Data</span>
            <select value={v.op ?? "between"} onChange={(e) => setV({ ...v, op: e.target.value as Validation["op"] })}>
              <option value="between">between</option>
              <option value="notBetween">not between</option>
              <option value="eq">equal to</option>
              <option value="ne">not equal to</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
              <option value="ge">greater than or equal to</option>
              <option value="le">less than or equal to</option>
            </select>
          </label>
        )}
        {(numeric || v.type === "formula") && (
          <label><span>{v.type === "formula" ? "Formula" : two ? "Minimum" : "Value"}</span><input value={v.min ?? ""} onChange={(e) => setV({ ...v, min: e.target.value })} placeholder={v.type === "formula" ? "=A1>0" : v.type === "date" ? "2024-01-01" : ""} /></label>
        )}
        {numeric && two && <label><span>Maximum</span><input value={v.max ?? ""} onChange={(e) => setV({ ...v, max: e.target.value })} /></label>}
        <label className="check"><input type="checkbox" checked={v.strict !== false} onChange={(e) => setV({ ...v, strict: e.target.checked })} /> <span>Reject invalid entries (otherwise just warn)</span></label>
        <label><span>Message</span><input value={v.message ?? ""} onChange={(e) => setV({ ...v, message: e.target.value })} placeholder="Shown when an entry isn't allowed" /></label>
      </div>
      <div className="modal-foot">
        {rule && <button onClick={() => { onRemove(); onClose(); }}><Trash2 /> Remove rule</button>}
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!parseRange(v.range)} onClick={() => { onSave(v); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

// ---- Custom sort -----------------------------------------------------------------------------------------

export function SortDialog({ range, headers, onSort, onClose }: { range: { c1: number; c2: number }; headers: string[]; onSort: (keys: { col: number; desc: boolean }[], hasHeader: boolean) => void; onClose: () => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const [levels, setLevels] = useState([{ col: range.c1, desc: false }]);
  const cols = Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i);
  const name = (c: number) => (hasHeader && headers[c - range.c1] ? headers[c - range.c1] : `Column ${colName(c)}`);
  return (
    <Modal title="Sort range" onClose={onClose}>
      <label className="check"><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> My data has a header row</label>
      <div className="sh-levels">
        {levels.map((l, i) => (
          <div key={i} className="sh-level">
            <span className="muted small">{i ? "Then by" : "Sort by"}</span>
            <select value={l.col} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))}>
              {cols.map((c) => <option key={c} value={c}>{name(c)}</option>)}
            </select>
            <select value={l.desc ? "1" : "0"} onChange={(e) => setLevels(levels.map((x, j) => (j === i ? { ...x, desc: e.target.value === "1" } : x)))}>
              <option value="0">A → Z, smallest first</option>
              <option value="1">Z → A, largest first</option>
            </select>
            {levels.length > 1 && <button className="icon" title="Remove level" onClick={() => setLevels(levels.filter((_, j) => j !== i))}><X /></button>}
          </div>
        ))}
      </div>
      <div className="modal-foot">
        <button onClick={() => setLevels([...levels, { col: cols[Math.min(levels.length, cols.length - 1)], desc: false }])}><Plus /> Add level</button>
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { onSort(levels, hasHeader); onClose(); }}>Sort</button>
      </div>
    </Modal>
  );
}

// ---- Charts -------------------------------------------------------------------------------------------------

export const CHART_KINDS: { kind: SheetChart["kind"]; label: string }[] = [
  { kind: "column", label: "Column" },
  { kind: "bar", label: "Bar" },
  { kind: "line", label: "Line" },
  { kind: "area", label: "Area" },
  { kind: "pie", label: "Pie" },
  { kind: "doughnut", label: "Doughnut" },
  { kind: "scatter", label: "Scatter" },
];

export function ChartDialog({ chart, onSave, onDelete, onClose }: { chart: SheetChart; onSave: (c: SheetChart) => void; onDelete: () => void; onClose: () => void }) {
  const [c, setC] = useState(chart);
  const stackable = c.kind === "column" || c.kind === "bar" || c.kind === "area" || c.kind === "line";
  return (
    <Modal title="Chart" onClose={onClose}>
      <div className="sh-form">
        <label><span>Type</span>
          <select value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value as SheetChart["kind"] })}>
            {CHART_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        {stackable && (
          <label><span>Grouping</span>
            <select value={c.percent ? "percent" : c.stacked ? "stacked" : "clustered"} onChange={(e) => setC({ ...c, stacked: e.target.value !== "clustered", percent: e.target.value === "percent" })}>
              <option value="clustered">Side by side</option>
              <option value="stacked">Stacked</option>
              <option value="percent">100% stacked</option>
            </select>
          </label>
        )}
        <label><span>Data range</span><input value={c.range} onChange={(e) => setC({ ...c, range: e.target.value.toUpperCase() })} /></label>
        <label><span>Title</span><input value={c.title ?? ""} onChange={(e) => setC({ ...c, title: e.target.value || undefined })} /></label>
        <label className="check"><input type="checkbox" checked={c.legend !== false} onChange={(e) => setC({ ...c, legend: e.target.checked })} /> <span>Show legend</span></label>
        <label className="check"><input type="checkbox" checked={!!c.labels} onChange={(e) => setC({ ...c, labels: e.target.checked })} /> <span>Show values on the chart</span></label>
        <p className="muted small">The first row of the range names the series and the first column labels the categories.</p>
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

// ---- Named ranges ---------------------------------------------------------------------------------------------

export function NamesDialog({ names, selection, onSave, onClose }: { names: Record<string, string>; selection: string; onSave: (n: Record<string, string>) => void; onClose: () => void }) {
  const [list, setList] = useState(Object.entries(names));
  const [name, setName] = useState("");
  const [ref, setRef] = useState(selection);
  const valid = /^[A-Za-z_\\][\w.]*$/.test(name) && !/^[A-Z]{1,3}\d+$/i.test(name);
  return (
    <Modal title="Named ranges" onClose={onClose}>
      <div className="sh-rules">
        {list.map(([n, r]) => (
          <div key={n} className="sh-rule">
            <span className="grow"><b>{n}</b> <span className="muted small">{r}</span></span>
            <button className="icon" title="Delete name" onClick={() => setList(list.filter(([x]) => x !== n))}><Trash2 /></button>
          </div>
        ))}
        {!list.length && <p className="muted">Give a range a name, then use it in formulas: =SUM(Sales).</p>}
      </div>
      <div className="sh-add-name">
        <input placeholder="Name, e.g. Sales" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Sheet1!$A$1:$A$9" value={ref} onChange={(e) => setRef(e.target.value)} />
        <button disabled={!valid || !ref} onClick={() => { setList([...list.filter(([x]) => x.toUpperCase() !== name.toUpperCase()), [name, ref]]); setName(""); }}><Plus /> Add</button>
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { onSave(Object.fromEntries(list)); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

// ---- Find and replace ------------------------------------------------------------------------------------------

export interface FindOpts {
  text: string;
  replace: string;
  matchCase: boolean;
  whole: boolean;
  formulas: boolean;
  all: boolean;
}

export function FindBar({ replaceMode, count, onFind, onReplace, onReplaceAll, onClose }: {
  replaceMode: boolean;
  count: string;
  onFind: (o: FindOpts, back: boolean) => void;
  onReplace: (o: FindOpts) => void;
  onReplaceAll: (o: FindOpts) => void;
  onClose: () => void;
}) {
  const [o, setO] = useState<FindOpts>({ text: "", replace: "", matchCase: false, whole: false, formulas: false, all: false });
  const [showReplace, setShowReplace] = useState(replaceMode);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setShowReplace(replaceMode || showReplace), [replaceMode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sh-find" role="search">
      <Search />
      <input ref={input} placeholder="Find" value={o.text} onChange={(e) => setO({ ...o, text: e.target.value })} onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onFind(o, e.shiftKey); }
        if (e.key === "Escape") onClose();
      }} />
      {showReplace && (
        <input placeholder="Replace with" value={o.replace} onChange={(e) => setO({ ...o, replace: e.target.value })} onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onReplace(o); }
          if (e.key === "Escape") onClose();
        }} />
      )}
      <span className="muted small">{count}</span>
      <button onClick={() => onFind(o, true)} title="Previous (Shift+Enter)" aria-label="Previous match"><ArrowUp /></button>
      <button onClick={() => onFind(o, false)} title="Next (Enter)" aria-label="Next match"><ArrowDown /></button>
      {showReplace ? (
        <>
          <button onClick={() => onReplace(o)}>Replace</button>
          <button onClick={() => onReplaceAll(o)}>Replace all</button>
        </>
      ) : (
        <button onClick={() => setShowReplace(true)}>Replace…</button>
      )}
      <label className="check"><input type="checkbox" checked={o.matchCase} onChange={(e) => setO({ ...o, matchCase: e.target.checked })} /> Match case</label>
      <label className="check"><input type="checkbox" checked={o.whole} onChange={(e) => setO({ ...o, whole: e.target.checked })} /> Whole cell</label>
      <label className="check"><input type="checkbox" checked={o.formulas} onChange={(e) => setO({ ...o, formulas: e.target.checked })} /> In formulas</label>
      <label className="check"><input type="checkbox" checked={o.all} onChange={(e) => setO({ ...o, all: e.target.checked })} /> All sheets</label>
      <span className="grow" />
      <button className="icon" title="Close (Esc)" aria-label="Close find" onClick={onClose}><X /></button>
    </div>
  );
}

// ---- Function list -----------------------------------------------------------------------------------------------

const CATEGORY: [string, RegExp][] = [
  ["Most used", /^(SUM|AVERAGE|COUNT|COUNTA|MIN|MAX|IF|IFERROR|VLOOKUP|XLOOKUP|INDEX|MATCH|SUMIF|SUMIFS|COUNTIF|COUNTIFS|ROUND|TODAY|CONCAT|TEXT|LEFT|RIGHT|LEN|TRIM|UNIQUE|FILTER|SORT)$/],
  ["Logical", /^(IF|IFS|IFERROR|IFNA|AND|OR|NOT|XOR|SWITCH|CHOOSE|TRUE|FALSE|LET|LAMBDA)$/],
  ["Lookup", /LOOKUP|INDEX|MATCH|OFFSET|INDIRECT|ADDRESS|ROW|COLUMN|TRANSPOSE|FILTER|SORT|UNIQUE|SEQUENCE|TAKE|DROP|STACK|CHOOSE(ROWS|COLS)|TO(ROW|COL)|WRAP|EXPAND|HYPERLINK|FORMULATEXT/],
  ["Text", /^(LEN|LOWER|UPPER|PROPER|TRIM|CLEAN|LEFT|RIGHT|MID|CONCAT|CONCATENATE|TEXTJOIN|TEXT|VALUE|NUMBERVALUE|EXACT|FIND|SEARCH|REPLACE|SUBSTITUTE|REPT|CHAR|CODE|UNICHAR|UNICODE|T|FIXED|DOLLAR|TEXTBEFORE|TEXTAFTER|TEXTSPLIT|REGEX\w+)$/],
  ["Date and time", /^(TODAY|NOW|DATE|TIME|DATEVALUE|TIMEVALUE|YEAR|MONTH|DAY|HOUR|MINUTE|SECOND|WEEKDAY|WEEKNUM|ISOWEEKNUM|DAYS|DAYS360|DATEDIF|EDATE|EOMONTH|WORKDAY|WORKDAY\.INTL|NETWORKDAYS|NETWORKDAYS\.INTL|YEARFRAC)$/],
  ["Financial", /^(PMT|IPMT|PPMT|FV|PV|NPV|XNPV|IRR|XIRR|MIRR|RATE|NPER|EFFECT|NOMINAL|CUMIPMT|CUMPRINC|DB|DDB|SLN|SYD|VDB|RRI|PDURATION|DISC|INTRATE|RECEIVED|FVSCHEDULE|ISPMT)$/],
  ["Statistical", /AVERAGE|MEDIAN|MODE|STDEV|VAR|COUNT|LARGE|SMALL|RANK|PERCENT|QUARTILE|CORREL|PEARSON|COVAR|FORECAST|TREND|GROWTH|FREQUENCY|SLOPE|INTERCEPT|RSQ|STEYX|GEOMEAN|HARMEAN|TRIMMEAN|SKEW|KURT|DEVSQ|AVEDEV|NORM|STANDARDIZE|CONFIDENCE|MINIFS|MAXIFS|MINA|MAXA/],
  ["Math", /^(SUM\w*|PRODUCT|ABS|SIGN|INT|TRUNC|ROUND\w*|MROUND|CEILING\S*|FLOOR\S*|EVEN|ODD|MOD|QUOTIENT|POWER|SQRT|SQRTPI|EXP|LN|LOG|LOG10|PI|RAND\w*|FACT\w*|COMBIN\w*|PERMUT\w*|GCD|LCM|DEGREES|RADIANS|A?(SIN|COS|TAN)H?|ATAN2|SEC|CSC|COT|ROMAN|ARABIC|BASE|DECIMAL|MMULT|MDETERM|MINVERSE|MUNIT|SUBTOTAL|AGGREGATE)$/],
  ["Information", /^(IS\w+|TYPE|N|NA|ERROR\.TYPE|SHEETS?|CELL|INFO)$/],
  ["Engineering", /^(BIT\w+|\w+2(DEC|BIN|HEX|OCT)|DEC2\w+|IM\w+|COMPLEX|CONVERT|DELTA|GESTEP|ERF)$/],
  ["Database", /^D(SUM|AVERAGE|COUNTA?|MAX|MIN|PRODUCT|STDEVP?|VARP?|GET)$/],
  ["Arrays and LAMBDA", /^(MAP|REDUCE|SCAN|MAKEARRAY|BYROW|BYCOL|LAMBDA|LET|ISOMITTED)$/],
];

export function FunctionPicker({ onPick, onClose }: { onPick: (name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Most used");
  const all = useMemo(() => Object.keys(FUNCTIONS).sort(), []);
  const re = CATEGORY.find(([c]) => c === cat)?.[1];
  const shown = q ? all.filter((n) => n.includes(q.trim().toUpperCase())) : all.filter((n) => re?.test(n));
  return (
    <Modal title="Insert function" onClose={onClose} wide>
      <div className="sh-fx">
        <input type="search" autoFocus placeholder={`Search ${all.length} functions`} value={q} onChange={(e) => setQ(e.target.value)} />
        {!q && (
          <div className="sh-fx-cats">
            {CATEGORY.map(([c]) => <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        )}
        <div className="sh-fx-list">
          {shown.map((n) => (
            <button key={n} onClick={() => { onPick(n); onClose(); }}>
              <b>{n}</b>
              <span className="muted small">({SIGNATURES[n] ?? "…"})</span>
            </button>
          ))}
          {!shown.length && <p className="muted">No function matches “{q}”.</p>}
        </div>
      </div>
    </Modal>
  );
}

/** Function names for autocomplete while typing a formula. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
export { SIGNATURES };
