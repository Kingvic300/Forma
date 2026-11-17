// Table and pivot table UI: the create dialogs, the table design popover (name, options, style
// gallery) and the pivot table field list.
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, RefreshCw, Table2, X } from "lucide-react";
import { Modal, useDismiss } from "../../ui";
import { parseRange } from "./formula";
import { TABLE_STYLES, tableLook } from "./tables";
import { FN_LABEL, SHOW_LABEL } from "./pivot";
import type { Pivot, PivotFn, PivotGroup, PivotShow, SheetTable } from "./types";

// ---- Create a table ---------------------------------------------------------------------------------------

export function CreateTableDialog({ range, onCreate, onClose }: { range: string; onCreate: (range: string, header: boolean) => string | null; onClose: () => void }) {
  const [r, setR] = useState(range);
  const [header, setHeader] = useState(true);
  const [err, setErr] = useState("");
  const submit = () => {
    const e = onCreate(r, header);
    if (e) setErr(e);
    else onClose();
  };
  return (
    <Modal title="Create table" onClose={onClose}>
      <div className="sh-form">
        <label><span>Where is the data?</span><input value={r} autoFocus onChange={(e) => setR(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
        <label className="check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> <span>My table has headers</span></label>
        {err && <p className="sh-err">{err}</p>}
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!parseRange(r)} onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

// ---- Table design -----------------------------------------------------------------------------------------------

function StylePreview({ style, on, onPick }: { style: string; on: boolean; onPick: () => void }) {
  const t: SheetTable = { name: "", r1: 0, c1: 0, r2: 4, c2: 3, style };
  return (
    <button className={"sh-tstyle" + (on ? " on" : "")} title={style.replace("TableStyle", "").replace(/(\D)(\d)/, "$1 $2")} aria-label={style} onClick={onPick}>
      {Array.from({ length: 5 }, (_, r) => (
        <span key={r} className="sh-tstyle-row">
          {Array.from({ length: 4 }, (_, c) => {
            const l = tableLook(t, r, c);
            return <span key={c} style={{ background: l?.bg ?? "#fff", borderTop: l?.border?.t ? `1px solid ${l.border.t.color}` : undefined, borderBottom: l?.border?.b ? `1px solid ${l.border.b.color}` : undefined }}><i style={{ background: l?.color ?? (l?.bg && l.bg !== "#fff" ? "#fff" : "#9a9a9a"), opacity: l?.bold ? 1 : 0.55 }} /></span>;
          })}
        </span>
      ))}
    </button>
  );
}

export function TableDesign({ table, onPatch, onRename, onTotals, onResize, onConvert, onSelect, onPivot }: {
  table: SheetTable;
  onPatch: (p: Partial<SheetTable>) => void;
  onRename: (name: string) => string | null;
  onTotals: (on: boolean) => void;
  onResize: () => void;
  onConvert: () => void;
  onSelect: () => void;
  onPivot: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const [name, setName] = useState(table.name);
  const [err, setErr] = useState("");
  const opt = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="check"><input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}</label>
  );
  return (
    <div className="menu" ref={ref}>
      <button className="on sh-tbl-btn" title="Table design" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => { setName(table.name); setErr(""); setOpen(!open); }}>
        <Table2 /> {table.name} <ChevronDown className="chev" />
      </button>
      {open && (
        <div className="menu-pop pop left sh-tdesign">
          <div className="sh-tdesign-name">
            <span className="muted small">Table name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const e2 = name === table.name ? null : onRename(name);
              setErr(e2 ?? "");
            }} onBlur={() => { if (name !== table.name) setErr(onRename(name) ?? ""); }} />
            {err && <p className="sh-err">{err}</p>}
          </div>
          <div className="sh-tdesign-opts">
            {opt("Total row", !!table.totals, onTotals)}
            {opt("Banded rows", table.bandRows !== false, (v) => onPatch({ bandRows: v }))}
            {opt("Banded columns", !!table.bandCols, (v) => onPatch({ bandCols: v }))}
            {opt("First column", !!table.firstCol, (v) => onPatch({ firstCol: v }))}
            {opt("Last column", !!table.lastCol, (v) => onPatch({ lastCol: v }))}
            {opt("Filter buttons", table.filter !== false, (v) => onPatch({ filter: v }))}
          </div>
          <span className="muted small">Style</span>
          <div className="sh-tstyles">
            <button className={"sh-tstyle sh-tstyle-none" + (table.style === "" ? " on" : "")} title="None" aria-label="No style" onClick={() => onPatch({ style: "" })}>None</button>
            {TABLE_STYLES.map((s) => <StylePreview key={s} style={s} on={(table.style ?? "TableStyleMedium2") === s} onPick={() => onPatch({ style: s })} />)}
          </div>
          <div className="sh-tdesign-actions">
            <button onClick={() => { setOpen(false); onSelect(); }}>Select table</button>
            <button onClick={() => { setOpen(false); onResize(); }}>Resize…</button>
            <button onClick={() => { setOpen(false); onPivot(); }}>Summarize with PivotTable</button>
            <button onClick={() => { setOpen(false); onConvert(); }}>Convert to range</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Create a pivot table ------------------------------------------------------------------------------------------------

export function CreatePivotDialog({ source, onCreate, onClose }: { source: string; onCreate: (source: string) => string | null; onClose: () => void }) {
  const [s, setS] = useState(source);
  const [err, setErr] = useState("");
  const submit = () => {
    const e = onCreate(s.trim());
    if (e) setErr(e);
    else onClose();
  };
  return (
    <Modal title="Create PivotTable" onClose={onClose}>
      <div className="sh-form">
        <label><span>Table or range</span><input value={s} autoFocus onChange={(e) => setS(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Table1 or Sheet1!A1:D40" /></label>
        <p className="muted small">The PivotTable goes on a new sheet. The first row of the range names the fields.</p>
        {err && <p className="sh-err">{err}</p>}
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!s.trim()} onClick={submit}>Create</button>
      </div>
    </Modal>
  );
}

// ---- Pivot table fields --------------------------------------------------------------------------------------------------

type Area = "rows" | "cols" | "values" | "filters";
const AREA_LABEL: Record<Area, string> = { filters: "Filters", cols: "Columns", rows: "Rows", values: "Values" };

function FilterItems({ items, hidden, onApply }: { items: string[]; hidden: string[]; onApply: (h: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const [off, setOff] = useState(new Set(hidden));
  return (
    <div className="menu" ref={ref}>
      <button className="sh-pv-filter" onClick={() => { setOff(new Set(hidden)); setOpen(!open); }}>
        {hidden.length ? `${items.length - hidden.filter((h) => items.includes(h)).length} of ${items.length}` : "All"} <ChevronDown className="chev" />
      </button>
      {open && (
        <div className="menu-pop pop right sh-pv-items">
          <div className="sh-af-row">
            <button className="link" onClick={() => setOff(new Set())}>Select all</button>
            <button className="link" onClick={() => setOff(new Set(items))}>Clear</button>
          </div>
          <div className="sh-af-list">
            {items.map((v) => (
              <label key={v} className="check">
                <input type="checkbox" checked={!off.has(v)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(v); else n.add(v); setOff(n); }} />
                <span>{v}</span>
              </label>
            ))}
          </div>
          <div className="sh-af-row">
            <span className="grow" />
            <button className="primary" onClick={() => { onApply([...off]); setOpen(false); }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PivotPanel({ pivot, fields, dates, numeric, items, error, onChange, onRefresh, onClose }: {
  pivot: Pivot;
  fields: string[];
  dates: Set<string>;
  numeric: Set<string>;
  items: (field: string) => string[];
  error?: string;
  onChange: (p: Pivot) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState(pivot.source);
  const used = useMemo(() => new Set([...pivot.rows, ...pivot.cols, ...pivot.values.map((v) => v.field), ...pivot.filters.map((f) => f.field)]), [pivot]);
  const list = (a: Area): string[] => (a === "values" ? pivot.values.map((v) => v.field) : a === "filters" ? pivot.filters.map((f) => f.field) : pivot[a]);
  const remove = (p: Pivot, a: Area, i: number): Pivot =>
    a === "values" ? { ...p, values: p.values.filter((_, j) => j !== i) } : a === "filters" ? { ...p, filters: p.filters.filter((_, j) => j !== i) } : { ...p, [a]: p[a].filter((_, j) => j !== i) };
  const addTo = (p: Pivot, a: Area, field: string): Pivot => {
    // A field sits in one of rows, columns or filters at a time (values may repeat).
    let n = p;
    if (a !== "values") {
      n = { ...n, rows: n.rows.filter((f) => f !== field), cols: n.cols.filter((f) => f !== field), filters: n.filters.filter((f) => f.field !== field) };
    }
    if (a === "values") return { ...n, values: [...n.values, { field, fn: numeric.has(field) ? "sum" : "count" }] };
    if (a === "filters") return { ...n, filters: [...n.filters, { field, hidden: [] }] };
    // Dates are grouped by month by default, as in Excel.
    const group = dates.has(field) && n.group?.[field] === undefined ? { ...(n.group ?? {}), [field]: "month" as PivotGroup } : n.group;
    return { ...n, [a]: [...n[a], field], group };
  };
  const toggle = (field: string, on: boolean) => {
    if (!on) {
      onChange({ ...pivot, rows: pivot.rows.filter((f) => f !== field), cols: pivot.cols.filter((f) => f !== field), values: pivot.values.filter((v) => v.field !== field), filters: pivot.filters.filter((f) => f.field !== field) });
      return;
    }
    onChange(addTo(pivot, numeric.has(field) && !dates.has(field) ? "values" : "rows", field));
  };
  const move = (a: Area, i: number, d: -1 | 1) => {
    const arr = a === "values" ? pivot.values.slice() : a === "filters" ? pivot.filters.slice() : pivot[a].slice();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ ...pivot, [a]: arr });
  };
  const moveTo = (from: Area, i: number, to: Area) => {
    const field = list(from)[i];
    onChange(addTo(remove(pivot, from, i), to, field));
  };
  const shown = fields.filter((f) => f.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="sh-pivot" aria-label="PivotTable fields">
      <div className="sh-pivot-head">
        <b>PivotTable fields</b>
        <span className="grow" />
        <button className="icon" title="Refresh from the source data" aria-label="Refresh" onClick={onRefresh}><RefreshCw /></button>
        <button className="icon" title="Close" aria-label="Close field list" onClick={onClose}><X /></button>
      </div>
      <label className="sh-pivot-src">
        <span className="muted small">Source</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} onBlur={() => source.trim() && source !== pivot.source && onChange({ ...pivot, source: source.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      </label>
      {error && <p className="sh-err">{error}</p>}
      <input type="search" placeholder="Search fields" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="sh-pivot-fields">
        {shown.map((f) => (
          <div key={f} className="sh-pivot-field">
            <label className="check"><input type="checkbox" checked={used.has(f)} onChange={(e) => toggle(f, e.target.checked)} /> <span>{f}</span></label>
            <span className="grow" />
            <span className="sh-pv-add">
              {(["rows", "cols", "values", "filters"] as Area[]).map((a) => (
                <button key={a} title={`Add to ${AREA_LABEL[a]}`} onClick={() => onChange(addTo(pivot, a, f))}>{AREA_LABEL[a][0]}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
      {(["filters", "cols", "rows", "values"] as Area[]).map((a) => (
        <section key={a} className="sh-pivot-area">
          <h4>{AREA_LABEL[a]}</h4>
          {!list(a).length && <p className="muted small">{a === "values" ? "Add a field to sum or count" : "Drop a field here with the buttons above"}</p>}
          {list(a).map((field, i) => (
            <div key={`${field}-${i}`} className="sh-pivot-item">
              <div className="sh-pivot-item-top">
                <b>{a === "values" ? `${FN_LABEL[pivot.values[i].fn]} of ${field}` : field}</b>
                <span className="grow" />
                <button className="icon" title="Move up" aria-label="Move up" disabled={!i} onClick={() => move(a, i, -1)}><ArrowUp /></button>
                <button className="icon" title="Move down" aria-label="Move down" disabled={i === list(a).length - 1} onClick={() => move(a, i, 1)}><ArrowDown /></button>
                <button className="icon" title="Remove" aria-label="Remove field" onClick={() => onChange(remove(pivot, a, i))}><X /></button>
              </div>
              <div className="sh-pivot-item-opts">
                {a === "values" ? (
                  <>
                    <select aria-label="Summarize by" value={pivot.values[i].fn} onChange={(e) => onChange({ ...pivot, values: pivot.values.map((v, j) => (j === i ? { ...v, fn: e.target.value as PivotFn } : v)) })}>
                      {(Object.keys(FN_LABEL) as PivotFn[]).map((fn) => <option key={fn} value={fn}>{FN_LABEL[fn]}</option>)}
                    </select>
                    <select aria-label="Show values as" value={pivot.values[i].show ?? "none"} onChange={(e) => onChange({ ...pivot, values: pivot.values.map((v, j) => (j === i ? { ...v, show: e.target.value as PivotShow } : v)) })}>
                      {(Object.keys(SHOW_LABEL) as PivotShow[]).map((s) => <option key={s} value={s}>{SHOW_LABEL[s]}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    {(dates.has(field) || numeric.has(field)) && (
                      <select aria-label="Group" value={String(pivot.group?.[field] ?? "")} onChange={(e) => {
                        const v = e.target.value;
                        const group = { ...(pivot.group ?? {}) };
                        if (!v) delete group[field];
                        else group[field] = /^\d/.test(v) ? Number(v) : (v as PivotGroup);
                        onChange({ ...pivot, group });
                      }}>
                        <option value="">{dates.has(field) ? "Each date" : "Each value"}</option>
                        {dates.has(field) ? (
                          <>
                            <option value="year">By year</option>
                            <option value="quarter">By quarter</option>
                            <option value="month">By month</option>
                            <option value="day">By day</option>
                          </>
                        ) : (
                          [1, 5, 10, 50, 100, 500, 1000].map((n) => <option key={n} value={n}>In groups of {n}</option>)
                        )}
                      </select>
                    )}
                    {a === "filters" && (
                      <FilterItems items={items(field)} hidden={pivot.filters[i].hidden} onApply={(h) => onChange({ ...pivot, filters: pivot.filters.map((x, j) => (j === i ? { ...x, hidden: h } : x)) })} />
                    )}
                    {a !== "filters" && (
                      <FilterItems items={items(field)} hidden={pivot.filters.find((x) => x.field === field)?.hidden ?? []} onApply={(h) => {
                        const rest = pivot.filters.filter((x) => x.field !== field);
                        onChange({ ...pivot, filters: h.length ? [...rest, { field, hidden: h }] : rest });
                      }} />
                    )}
                  </>
                )}
                <select aria-label="Move to" value="" onChange={(e) => e.target.value && moveTo(a, i, e.target.value as Area)}>
                  <option value="">Move to…</option>
                  {(["rows", "cols", "values", "filters"] as Area[]).filter((x) => x !== a).map((x) => <option key={x} value={x}>{AREA_LABEL[x]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </section>
      ))}
      <section className="sh-pivot-area">
        <h4>Layout</h4>
        <label className="check"><input type="checkbox" checked={pivot.subtotals !== false} onChange={(e) => onChange({ ...pivot, subtotals: e.target.checked })} /> Subtotals</label>
        <label className="check"><input type="checkbox" checked={pivot.grandRows !== false} onChange={(e) => onChange({ ...pivot, grandRows: e.target.checked })} /> Grand total row</label>
        <label className="check"><input type="checkbox" checked={pivot.grandCols !== false} onChange={(e) => onChange({ ...pivot, grandCols: e.target.checked })} /> Grand total column</label>
        <select aria-label="Sort" value={pivot.sort ?? "asc"} onChange={(e) => onChange({ ...pivot, sort: e.target.value as Pivot["sort"] })}>
          <option value="asc">Sort labels A → Z</option>
          <option value="desc">Sort labels Z → A</option>
          <option value="valueDesc">Sort by value, largest first</option>
          <option value="valueAsc">Sort by value, smallest first</option>
        </select>
      </section>
    </aside>
  );
}
