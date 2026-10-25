import { askConfirm, askText, errorText, toast } from "../../lib/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowDownZA, ExternalLink, Mail, Redo2, Undo2 } from "lucide-react";
import { findLinks, openLink } from "../../lib/links";
import Papa from "papaparse";
import { useFile } from "../../lib/useFile";
import { safeName, saveAs } from "../../lib/platform";
import { csvToCells } from "../../lib/importers";
import { TitleBar, Missing, Menu } from "../../ui";
import { colName, display, makeEvaluator } from "./formula";
import type { Sheet, SheetsData } from "./types";

const ROW_H = 26;
const COL_W = 110;
const HEAD_W = 52;

type Pos = { r: number; c: number };

export default function Sheets({ id }: { id: string }) {
  const f = useFile<SheetsData>(id);
  const [active, setActive] = useState(0);
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [edit, setEdit] = useState<{ value: string; fromBar: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [headerRow, setHeaderRow] = useState(true);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const history = useRef<{ undo: SheetsData[]; redo: SheetsData[] }>({ undo: [], redo: [] });
  const grid = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const sheet: Sheet | undefined = f.data?.sheets[Math.min(active, (f.data?.sheets.length ?? 1) - 1)];
  const cells = sheet?.cells ?? [];
  const evaluator = useMemo(() => makeEvaluator(cells), [cells]);

  const nCols = Math.max(26, ...cells.map((r) => (r?.length ?? 0) + 3));
  const nRowsTotal = Math.max(100, cells.length + 30);

  // Row indices to show (filter keeps the header row visible).
  const rows = useMemo(() => {
    const all = Array.from({ length: nRowsTotal }, (_, i) => i);
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => (headerRow && r === 0) || (cells[r] ?? []).some((v, c) => display(evaluator(r, c)).toLowerCase().includes(q) || v?.toLowerCase().includes(q)));
  }, [nRowsTotal, filter, cells, evaluator, headerRow]);

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, [f.data !== null]);

  if (f.missing) return <Missing app="sheets" />;
  if (!f.data || !f.meta || !sheet) return <div className="loading">Loading…</div>;
  const data = f.data;

  const range = { r1: Math.min(sel.r, anchor.r), r2: Math.max(sel.r, anchor.r), c1: Math.min(sel.c, anchor.c), c2: Math.max(sel.c, anchor.c) };
  const inRange = (r: number, c: number) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
  const raw = (r: number, c: number) => cells[r]?.[c] ?? "";

  function commit(next: SheetsData) {
    history.current.undo.push(data);
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = [];
    f.setData(next);
  }
  function updateCells(fn: (cells: string[][]) => string[][]) {
    const sheets = data.sheets.slice();
    sheets[active] = { ...sheet!, cells: fn(cells.map((r) => (r ? r.slice() : []))) };
    commit({ sheets });
  }
  function setCells(entries: [number, number, string][]) {
    updateCells((cs) => {
      for (const [r, c, v] of entries) {
        while (cs.length <= r) cs.push([]);
        cs[r][c] = v;
      }
      return trim(cs);
    });
  }
  function undo() {
    const prev = history.current.undo.pop();
    if (!prev) return;
    history.current.redo.push(data);
    f.setData(prev);
  }
  function redo() {
    const next = history.current.redo.pop();
    if (!next) return;
    history.current.undo.push(data);
    f.setData(next);
  }

  function move(dr: number, dc: number, extend = false) {
    const idx = rows.indexOf(sel.r);
    const r = rows[Math.max(0, Math.min(rows.length - 1, idx + dr))] ?? 0;
    const c = Math.max(0, Math.min(nCols - 1, sel.c + dc));
    setSel({ r, c });
    if (!extend) setAnchor({ r, c });
    ensureVisible(r);
  }
  function ensureVisible(r: number) {
    const el = grid.current;
    if (!el) return;
    const y = rows.indexOf(r) * ROW_H;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H * 2 > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H * 2 - el.clientHeight;
  }
  function finishEdit(dr = 0, dc = 0) {
    if (edit) setCells([[sel.r, sel.c, edit.value]]);
    setEdit(null);
    if (dr || dc) move(dr, dc);
    grid.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: nRowsTotal - 1, c: nCols - 1 }); return; }
    if (mod) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); return move(-1, 0, e.shiftKey);
      case "ArrowDown": e.preventDefault(); return move(1, 0, e.shiftKey);
      case "ArrowLeft": e.preventDefault(); return move(0, -1, e.shiftKey);
      case "ArrowRight": e.preventDefault(); return move(0, 1, e.shiftKey);
      case "Tab": e.preventDefault(); return move(0, e.shiftKey ? -1 : 1);
      case "Enter": case "F2": e.preventDefault(); return setEdit({ value: raw(sel.r, sel.c), fromBar: false });
      case "Delete": case "Backspace": {
        e.preventDefault();
        const entries: [number, number, string][] = [];
        for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) if (raw(r, c)) entries.push([r, c, ""]);
        if (entries.length) setCells(entries);
        return;
      }
    }
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault();
      setEdit({ value: e.key, fromBar: false });
    }
  }

  function selectedTSV() {
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const line: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) line.push(display(evaluator(r, c)));
      lines.push(line.join("\t"));
    }
    return lines.join("\n");
  }
  function onCopy(e: React.ClipboardEvent, cut = false) {
    if (edit) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", selectedTSV());
    if (cut) {
      const entries: [number, number, string][] = [];
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) entries.push([r, c, ""]);
      setCells(entries);
    }
  }
  function onPaste(e: React.ClipboardEvent) {
    if (edit) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const parsed = text.includes("\t") || !text.includes(",") ? text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => l.split("\t")) : csvToCells(text);
    const entries: [number, number, string][] = [];
    parsed.forEach((row, i) => row.forEach((v, j) => entries.push([sel.r + i, sel.c + j, v])));
    setCells(entries);
    setAnchor({ r: sel.r + parsed.length - 1, c: sel.c + Math.max(...parsed.map((r) => r.length)) - 1 });
  }

  function sortBy(dir: 1 | -1) {
    const c = sel.c;
    updateCells((cs) => {
      const head = headerRow ? cs.slice(0, 1) : [];
      const body = cs.slice(head.length).filter((r) => r && r.some((v) => v));
      const key = (r: string[]) => r[c] ?? "";
      body.sort((a, b) => {
        const x = key(a), y = key(b);
        if (x === "" || y === "") return x === "" ? 1 : -1;
        const nx = Number(x), ny = Number(y);
        return (!isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true })) * dir;
      });
      return [...head, ...body];
    });
  }
  const insertRow = (offset: 0 | 1) => updateCells((cs) => { cs.splice(range.r1 + offset * (range.r2 - range.r1 + 1), 0, []); return cs; });
  const deleteRows = () => updateCells((cs) => { cs.splice(range.r1, range.r2 - range.r1 + 1); return trim(cs); });
  const insertCol = (offset: 0 | 1) => updateCells((cs) => cs.map((r) => { const x = r.slice(); while (x.length < range.c1) x.push(""); x.splice(range.c1 + offset * (range.c2 - range.c1 + 1), 0, ""); return x; }));
  const deleteCols = () => updateCells((cs) => cs.map((r) => { const x = r.slice(); x.splice(range.c1, range.c2 - range.c1 + 1); return x; }));

  function addSheet(name?: string, cells: string[][] = []) {
    const n = name ?? `Sheet${data.sheets.length + 1}`;
    commit({ sheets: [...data.sheets, { name: n, cells }] });
    setActive(data.sheets.length);
  }
  async function renameSheet(i: number) {
    const n = await askText("Rename sheet", { value: data.sheets[i].name, confirmLabel: "Rename" });
    if (!n) return;
    const sheets = data.sheets.slice();
    sheets[i] = { ...sheets[i], name: n };
    commit({ sheets });
  }
  async function removeSheet(i: number) {
    if (data.sheets.length === 1) return toast("A spreadsheet needs at least one sheet");
    if (!(await askConfirm(`Delete the sheet “${data.sheets[i].name}”?`, { body: "You can undo this with Ctrl+Z.", danger: true, confirmLabel: "Delete sheet" }))) return;
    commit({ sheets: data.sheets.filter((_, j) => j !== i) });
    setActive(Math.max(0, i - 1));
  }

  async function exportCSV() {
    const values = trim(cells.map((r, i) => Array.from(r ?? [], (_, c) => display(evaluator(i, c)))));
    await saveAs(`${safeName(f.meta!.name)}${data.sheets.length > 1 ? " - " + sheet!.name : ""}.csv`, Papa.unparse(values));
  }
  async function exportXLSX() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    for (const s of data.sheets) {
      const ev = makeEvaluator(s.cells);
      const aoa = s.cells.map((r, i) => Array.from(r ?? [], (v, c) => {
        const val = ev(i, c);
        const out = typeof val === "object" ? display(val) : val;
        return v?.startsWith("=") ? { t: typeof out === "number" ? "n" : typeof out === "boolean" ? "b" : "s", v: out, f: v.slice(1) } : out;
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.name.slice(0, 31));
    }
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await saveAs(`${safeName(f.meta!.name)}.xlsx`, new Uint8Array(out));
  }
  async function importInto(file: File) {
    if (/\.(csv|tsv)$/i.test(file.name)) return addSheet(file.name.replace(/\.[^.]+$/, ""), csvToCells(await file.text()));
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const added = wb.SheetNames.map((n) => ({ name: n, cells: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) => r.map((v) => String(v ?? ""))) }));
    commit({ sheets: [...data.sheets, ...added] });
    setActive(data.sheets.length);
  }

  // Selection statistics, like the status bar in spreadsheet apps.
  const stats = (() => {
    if (range.r1 === range.r2 && range.c1 === range.c2) return null;
    let sum = 0, count = 0, filled = 0;
    for (let r = range.r1; r <= Math.min(range.r2, cells.length); r++)
      for (let c = range.c1; c <= range.c2; c++) {
        const v = evaluator(r, c);
        if (v !== "") filled++;
        if (typeof v === "number") { sum += v; count++; }
      }
    return { sum, count, filled, avg: count ? sum / count : 0 };
  })();

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 5);
  const last = Math.min(rows.length, first + Math.ceil(scroll.height / ROW_H) + 12);
  const visible = rows.slice(first, last);
  const barValue = edit ? edit.value : raw(sel.r, sel.c);

  return (
    <div className="app-page sheets">
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="sheets">
        <Menu label="Export">
          <button onClick={exportCSV}>Download sheet as .csv</button>
          <button onClick={exportXLSX}>Download workbook as .xlsx</button>
        </Menu>
      </TitleBar>
      <div className="toolbar">
        <button title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.undo.length}><Undo2 /></button>
        <button title="Redo (Ctrl+Y)" onClick={redo} disabled={!history.current.redo.length}><Redo2 /></button>
        <span className="sep" />
        <Menu label="Rows">
          <button onClick={() => insertRow(0)}>Insert row above</button>
          <button onClick={() => insertRow(1)}>Insert row below</button>
          <button onClick={deleteRows}>Delete selected rows</button>
        </Menu>
        <Menu label="Columns">
          <button onClick={() => insertCol(0)}>Insert column left</button>
          <button onClick={() => insertCol(1)}>Insert column right</button>
          <button onClick={deleteCols}>Delete selected columns</button>
        </Menu>
        <span className="sep" />
        <button onClick={() => sortBy(1)} title={`Sort by column ${colName(sel.c)}`}><ArrowDownAZ /> Sort A–Z</button>
        <button onClick={() => sortBy(-1)} title={`Sort by column ${colName(sel.c)}`}><ArrowDownZA /> Sort Z–A</button>
        <label className="check"><input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} /> Header row</label>
        <span className="sep" />
        <input className="filter" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="sep" />
        <button onClick={() => importRef.current?.click()}>Import CSV/XLSX as tab</button>
        <input ref={importRef} type="file" hidden accept=".csv,.tsv,.xlsx,.xls,.ods" onChange={(e) => { const file = e.target.files?.[0]; if (file) importInto(file).catch((err) => toast(`Couldn’t import ${file.name}: ${errorText(err)}`, "error")); e.target.value = ""; }} />
      </div>
      <div className="formula-bar">
        <span className="addr">{colName(range.c1)}{range.r1 + 1}{(range.r1 !== range.r2 || range.c1 !== range.c2) && `:${colName(range.c2)}${range.r2 + 1}`}</span>
        <span className="fx">fx</span>
        <input
          value={barValue}
          onFocus={() => !edit && setEdit({ value: raw(sel.r, sel.c), fromBar: true })}
          onChange={(e) => setEdit({ value: e.target.value, fromBar: true })}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); finishEdit(1, 0); }
            if (e.key === "Escape") { setEdit(null); grid.current?.focus(); }
          }}
          onBlur={() => edit?.fromBar && finishEdit()}
        />
      </div>
      <div
        className="grid"
        ref={grid}
        tabIndex={0}
        onKeyDown={onKey}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      >
        <div style={{ width: HEAD_W + nCols * COL_W, height: (rows.length + 1) * ROW_H, position: "relative" }}>
          <div className="grid-head" style={{ width: HEAD_W + nCols * COL_W }}>
            <div className="corner" style={{ width: HEAD_W }} onClick={() => { setAnchor({ r: 0, c: 0 }); setSel({ r: nRowsTotal - 1, c: nCols - 1 }); }} />
            {Array.from({ length: nCols }, (_, c) => (
              <div
                key={c}
                className={"col-head" + (c >= range.c1 && c <= range.c2 ? " on" : "")}
                style={{ width: COL_W }}
                onClick={(e) => { if (e.shiftKey) setSel({ r: nRowsTotal - 1, c }); else { setAnchor({ r: 0, c }); setSel({ r: nRowsTotal - 1, c }); } }}
              >
                {colName(c)}
              </div>
            ))}
          </div>
          {visible.map((r, i) => (
            <div key={r} className="grid-row" style={{ top: (first + i + 1) * ROW_H, height: ROW_H }}>
              <div
                className={"row-head" + (r >= range.r1 && r <= range.r2 ? " on" : "")}
                style={{ width: HEAD_W }}
                onClick={(e) => { if (!e.shiftKey) setAnchor({ r, c: 0 }); setSel({ r, c: nCols - 1 }); }}
              >
                {r + 1}
              </div>
              {Array.from({ length: nCols }, (_, c) => {
                const isSel = sel.r === r && sel.c === c;
                const v = raw(r, c) ? evaluator(r, c) : "";
                const shown = display(v);
                const links = typeof v === "string" ? findLinks(shown) : [];
                const cls = ["cell", inRange(r, c) && "in", isSel && "sel", typeof v === "number" && "num", typeof v === "object" && "err", headerRow && r === 0 && "hdr"].filter(Boolean).join(" ");
                return (
                  <div
                    key={c}
                    className={cls}
                    style={{ width: COL_W }}
                    title={shown.length > 14 ? shown : undefined}
                    onMouseDown={(e) => {
                      if (links.length && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        return openLink(links[0].href);
                      }
                      if (edit) finishEdit();
                      if (e.shiftKey) setSel({ r, c });
                      else { setSel({ r, c }); setAnchor({ r, c }); }
                    }}
                    onMouseEnter={(e) => e.buttons === 1 && setSel({ r, c })}
                    onDoubleClick={() => setEdit({ value: raw(r, c), fromBar: false })}
                  >
                    {isSel && edit && !edit.fromBar ? (
                      <input
                        autoFocus
                        className="cell-input"
                        value={edit.value}
                        onChange={(e) => setEdit({ value: e.target.value, fromBar: false })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); finishEdit(e.shiftKey ? -1 : 1, 0); }
                          else if (e.key === "Tab") { e.preventDefault(); finishEdit(0, e.shiftKey ? -1 : 1); }
                          else if (e.key === "Escape") { setEdit(null); grid.current?.focus(); }
                        }}
                        onBlur={() => finishEdit()}
                      />
                    ) : links.length ? (
                      <>
                        <span className="cell-link">{shown}</span>
                        {isSel && !edit && range.r1 === range.r2 && range.c1 === range.c2 && (
                          <span className="link-card" onMouseDown={(e) => e.stopPropagation()}>
                            {links.slice(0, 3).map((l) => (
                              <button key={l.index} title={`Open ${l.href.replace(/^mailto:/, "")}`} onClick={() => openLink(l.href)}>
                                {l.href.startsWith("mailto:") ? <Mail /> : <ExternalLink />}
                                <span>{l.text.replace(/^https?:\/\//, "")}</span>
                              </button>
                            ))}
                            <span className="link-hint">Ctrl+click opens</span>
                          </span>
                        )}
                      </>
                    ) : (
                      shown
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="sheet-tabs">
        <button className="add" title="Add sheet" onClick={() => addSheet()}>+</button>
        {data.sheets.map((s, i) => (
          <button
            key={i}
            className={"tab" + (i === active ? " on" : "")}
            onClick={() => setActive(i)}
            onDoubleClick={() => renameSheet(i)}
            onContextMenu={(e) => { e.preventDefault(); removeSheet(i); }}
            title="Double-click to rename, right-click to delete"
          >
            {s.name}
          </button>
        ))}
        <span className="grow" />
        {stats && (
          <span className="stats">
            Sum <b>{display(stats.sum)}</b>&emsp;Average <b>{display(stats.avg)}</b>&emsp;Count <b>{stats.count}</b>&emsp;Filled <b>{stats.filled}</b>
          </span>
        )}
        {filter && <span className="stats">{rows.length - (headerRow ? 1 : 0)} matching rows</span>}
      </div>
    </div>
  );
}

function trim(cs: string[][]) {
  const out = cs.map((r) => {
    const x = Array.from(r ?? [], (v) => v ?? "");
    while (x.length && x[x.length - 1] === "") x.pop();
    return x;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

