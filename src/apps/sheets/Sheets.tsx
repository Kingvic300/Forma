// Sheets: an Excel-style spreadsheet. Formatting, number formats, merges, freeze panes, fill
// handle, formulas with autocomplete, AutoFilter, sorting, conditional formatting, validation,
// notes, charts, find and replace, printing, and .xlsx files that keep their formatting.
import { askConfirm, askText, errorText, toast } from "../../lib/dialog";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowDownZA, ArrowDownToLine, ArrowUpToLine, BarChart3, Baseline, Bold, Brush, ChevronDown, ExternalLink,
  Filter, FoldVertical, Italic, Mail, Merge, PaintBucket, Plus, Redo2, Search, Sigma, Sparkles, Strikethrough, Underline, Undo2, WrapText, X,
} from "lucide-react";
import Papa from "papaparse";
import { findLinks, openLink } from "../../lib/links";
import { AiPanel, type AiHistory } from "../../lib/AiPanel";
import { useFile } from "../../lib/useFile";
import { safeName, saveAs } from "../../lib/platform";
import { csvToCells, workbookToSheets } from "../../lib/importers";
import { TitleBar, Missing, Menu } from "../../ui";
import { buildChart, type ChartModel } from "./chart";
import { SheetChartView, SparklineSvg } from "./chartview";
import { ChartDialog, SparklineDialog } from "./chartui";
import { Book, colName, display, FErr, parseRange, rangeText } from "./formula";
import { adjustDecimals, CURRENCIES, NUMBER_FORMATS, nowSerial, todaySerial, formatValue } from "./format";
import { cycleAbsolute, moveFormula } from "./refs";
import { extendSeries, renameSheet, shiftAxis, sortRange } from "./ops";
import { checkValid, listItems, makeCondEval, validationAt } from "./rules";
import { cellText, formatOf } from "./view";
import { sheetHtml, printHtml } from "./print";
import { BorderMenu, ColorMenu, CondDialog, FindBar, FunctionPicker, FUNCTION_NAMES, NamesDialog, SIGNATURES, SortDialog, ValidDialog, type BorderKind, type FindOpts } from "./parts";
import { afterEdit, badTableName, convertToRange, createTable, dataRows, renameTable, resizeTable, setTotals, tableAt, tableLook, totalFormula, headerTexts, TOTAL_FNS } from "./tables";
import { pivotAt, pivotItems, readSource, refreshPivot } from "./pivot";
import { CreatePivotDialog, CreateTableDialog, PivotPanel, TableDesign } from "./tableui";
import type { Border, CellFmt, Pivot, Sheet, SheetChart, SheetsData, Sparkline } from "./types";
import { key } from "./types";

const ROW_H = 24;
const COL_W = 100;
const HEAD_W = 52;
const HEAD_H = 26;
const FONTS = ["Calibri", "Arial", "Helvetica", "Verdana", "Tahoma", "Georgia", "Times New Roman", "Courier New", "Mona Sans"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

type Pos = { r: number; c: number };
type Box = { r1: number; c1: number; r2: number; c2: number };
type Edit = { value: string; fromBar: boolean; caret?: number };

/** Cells copied with Ctrl+C, so pasting inside Forma keeps formulas and formats. */
let clip: { text: string; box: Box; cells: string[][]; fmt: (CellFmt | undefined)[][]; cut: boolean; sheet: number; file: string } | null = null;

const clampBox = (a: Pos, b: Pos): Box => ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
const inBox = (b: Box, r: number, c: number) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
const fontPx = (pt?: number) => ((pt ?? 11) * 4) / 3;

function trim(cs: string[][]) {
  const out = cs.map((r) => {
    const x = Array.from(r ?? [], (v) => v ?? "");
    while (x.length && x[x.length - 1] === "") x.pop();
    return x;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

export default function Sheets({ id }: { id: string }) {
  const f = useFile<SheetsData>(id);
  const [active, setActive] = useState(0);
  const [sel, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [filter, setFilter] = useState("");
  const [scroll, setScroll] = useState({ top: 0, left: 0, height: 600, width: 1000 });
  const [zoom, setZoom] = useState(1);
  const [showFormulas, setShowFormulas] = useState(false);
  const [find, setFind] = useState<{ replace: boolean } | null>(null);
  const [findCount, setFindCount] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "cell" | "row" | "col" | "tab"; tab?: number } | null>(null);
  const [dialog, setDialog] = useState<null | "cond" | "valid" | "sort" | "names" | "fx" | "table" | "spark" | { pivot: string } | { chart: string }>(null);
  const [pivotClosed, setPivotClosed] = useState<string | null>(null);
  const [painter, setPainter] = useState<{ fmt: (CellFmt | undefined)[][]; keep: boolean } | null>(null);
  const [dropdown, setDropdown] = useState<{ r: number; c: number; items: string[]; pick?: (item: string) => void } | null>(null);
  // AutoFilter on a range or a table. `r2` bounds a table's data rows (otherwise the filter runs to the end of the data).
  const [af, setAf] = useState<{ header: number; c1: number; c2: number; r2?: number; hide: Record<number, string[]> } | null>(null);
  const [afMenu, setAfMenu] = useState<number | null>(null);
  const [chartSel, setChartSel] = useState<string | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [suggest, setSuggest] = useState(0);
  const [fillTarget, setFillTarget] = useState<Box | null>(null);
  const history = useRef<{ undo: SheetsData[]; redo: SheetsData[]; tag?: string; at: number }>({ undo: [], redo: [], at: 0 });
  const dataRef = useRef<SheetsData | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLTextAreaElement | null>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pointing = useRef<{ start: number; end: number } | null>(null);
  // Set by Escape so the blur that follows doesn't commit the abandoned edit.
  const cancelled = useRef(false);
  dataRef.current = f.data;

  const data = f.data;
  const si = data ? Math.min(active, data.sheets.length - 1) : 0;
  const sheet: Sheet | undefined = data?.sheets[si];
  const book = useMemo(() => (data ? new Book(data) : null), [data]);
  // A filter belongs to the sheet it was set on.
  useEffect(() => {
    setAf(null);
    setAfMenu(null);
  }, [si]);
  const cond = useMemo(() => (sheet && book ? makeCondEval(sheet, book, si) : () => null), [sheet, book, si]);
  const range = clampBox(sel, anchor);

  // ---- Geometry ----------------------------------------------------------------------------------
  const geo = useMemo(() => {
    if (!sheet || !book) return null;
    const cells = sheet.cells;
    const fmtCols = Object.keys(sheet.fmt ?? {}).map((k) => Number(k.split(",")[1]));
    const fmtRows = Object.keys(sheet.fmt ?? {}).map((k) => Number(k.split(",")[0]));
    const usedCols = Math.max(0, ...cells.map((r) => r?.length ?? 0), ...fmtCols.map((c) => c + 1));
    const nCols = Math.max(26, usedCols + 4, (sheet.freeze?.c ?? 0) + 2);
    const nRows = Math.max(100, cells.length + 50, ...fmtRows.map((r) => r + 20));
    const hc = new Set(sheet.hiddenCols ?? []), hr = new Set(sheet.hiddenRows ?? []);
    const cw = (c: number) => (hc.has(c) ? 0 : sheet.colW?.[c] ?? COL_W);
    const colX = [0];
    for (let c = 0; c < nCols; c++) colX.push(colX[c] + cw(c));
    const q = filter.trim().toLowerCase();
    const afHide = af ? Object.entries(af.hide).filter(([, v]) => v.length) : [];
    const rows: number[] = [];
    for (let r = 0; r < nRows; r++) {
      if (hr.has(r)) continue;
      if (q && r > 0 && !(cells[r] ?? []).some((v, c) => v?.toLowerCase().includes(q) || display(book.value(si, r, c)).toLowerCase().includes(q))) continue;
      if (afHide.length && r > af!.header && r < cells.length && (af!.r2 === undefined || r <= af!.r2)) {
        const hidden = afHide.some(([c, vals]) => vals.includes(cellText(book.value(si, r, Number(c)), cells[r]?.[Number(c)] ?? "", sheet.fmt?.[key(r, Number(c))]).text));
        if (hidden) continue;
      }
      rows.push(r);
    }
    // Rows without a set height grow to fit large text, as Excel's do.
    const autoH: Record<number, number> = {};
    for (const [k, fm] of Object.entries(sheet.fmt ?? {})) {
      if (!fm?.size || fm.size <= 13) continue;
      const r = Number(k.split(",")[0]);
      autoH[r] = Math.max(autoH[r] ?? ROW_H, Math.ceil(fontPx(fm.size) * 1.3) + 4);
    }
    const rh = (r: number) => sheet.rowH?.[r] ?? autoH[r] ?? ROW_H;
    const tops = [0];
    rows.forEach((r, i) => tops.push(tops[i] + rh(r)));
    const index = new Map(rows.map((r, i) => [r, i]));
    return { nCols, nRows, colX, cw, rows, tops, rh, index, hc };
  }, [sheet, book, filter, af, si]);

  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight, width: el.clientWidth })));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data !== null]);

  // ---- Changes and undo ------------------------------------------------------------------------------
  const commit = useCallback(
    (next: SheetsData, tag?: string) => {
      const h = history.current;
      const now = Date.now();
      if (!(tag && tag === h.tag && now - h.at < 1500)) {
        h.undo.push(dataRef.current!);
        if (h.undo.length > 100) h.undo.shift();
      }
      h.tag = tag;
      h.at = now;
      h.redo = [];
      f.setData(next);
    },
    [f.setData],
  );
  const undo = () => {
    const prev = history.current.undo.pop();
    if (!prev) return;
    history.current.redo.push(dataRef.current!);
    history.current.tag = undefined;
    f.setData(prev);
  };
  const redo = () => {
    const next = history.current.redo.pop();
    if (!next) return;
    history.current.undo.push(dataRef.current!);
    f.setData(next);
  };
  const updateSheet = (fn: (s: Sheet) => Sheet, tag?: string, at = si) => {
    const d = dataRef.current!;
    commit({ ...d, sheets: d.sheets.map((s, i) => (i === at ? fn(s) : s)) }, tag);
  };

  // ---- Early returns (after all hooks) ------------------------------------------------------------------------
  if (f.missing) return <Missing app="sheets" />;
  if (!data || !f.meta || !sheet || !book || !geo) return <div className="loading">Loading…</div>;

  const cells = sheet.cells;
  const raw = (r: number, c: number) => cells[r]?.[c] ?? "";
  const fmtAt = (r: number, c: number) => sheet.fmt?.[key(r, c)];
  const ev = (r: number, c: number) => book.value(si, r, c);
  const merges = sheet.merges ?? [];
  const mergeAt = (r: number, c: number) => merges.find((m) => inBox(m, r, c));
  const fr = sheet.freeze?.r ?? 0, fc = sheet.freeze?.c ?? 0;
  const selText = rangeText(range.r1, range.c1, range.r2, range.c2);

  // ---- Cell edits ---------------------------------------------------------------------------------------------
  function writeCells(s: Sheet, entries: [number, number, string][]): Sheet {
    const cs = s.cells.map((r) => (r ? r.slice() : []));
    for (const [r, c, v] of entries) {
      while (cs.length <= r) cs.push([]);
      cs[r][c] = v;
    }
    return { ...s, cells: trim(cs) };
  }
  function setCells(entries: [number, number, string][], tag?: string) {
    updateSheet((s) => writeCells(s, entries), tag);
  }
  function patchFmt(box: Box, patch: Partial<CellFmt> | ((f: CellFmt, r: number, c: number) => CellFmt | undefined), tag?: string) {
    updateSheet((s) => {
      const fmt = { ...(s.fmt ?? {}) };
      for (let r = box.r1; r <= Math.min(box.r2, box.r1 + 50000); r++)
        for (let c = box.c1; c <= box.c2; c++) {
          const k = key(r, c);
          const cur = fmt[k] ?? {};
          const next = typeof patch === "function" ? patch(cur, r, c) : { ...cur, ...patch };
          const clean = next && Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false && v !== ""));
          if (clean && Object.keys(clean).length) fmt[k] = clean as CellFmt;
          else delete fmt[k];
        }
      return { ...s, fmt };
    }, tag);
  }
  // Whole rows or columns selected: format only the used area plus a margin.
  const fmtBox = (): Box => ({ ...range, r2: Math.min(range.r2, Math.max(range.r1, cells.length + 200)), c2: Math.min(range.c2, Math.max(range.c1, geo.nCols)) });
  const toggleFmt = (k: "bold" | "italic" | "underline" | "strike") => {
    const on = !fmtAt(sel.r, sel.c)?.[k];
    patchFmt(fmtBox(), { [k]: on || undefined });
  };

  function commitValue(r: number, c: number, value: string, then?: () => void) {
    const rule = validationAt(sheet!, r, c);
    if (rule && !checkValid(rule, value, book!, si, r, c)) {
      const msg = rule.message || "That value isn't allowed in this cell.";
      if (rule.strict !== false) {
        toast(msg, "error");
        return false;
      }
      toast(msg);
    }
    // Tables grow, fill calculated columns and follow renamed headers.
    const d = dataRef.current!;
    const old = d.sheets[si].cells[r]?.[c] ?? "";
    const written = { ...d, sheets: d.sheets.map((x, i) => (i === si ? writeCells(x, [[r, c, value]]) : x)) };
    commit(afterEdit(written, si, r, c, value, old));
    then?.();
    return true;
  }

  function move(dr: number, dc: number, extend = false, jump = false) {
    let { r, c } = sel;
    if (jump) {
      // Ctrl+arrow: to the edge of the current block of data.
      const filled = (rr: number, cc: number) => raw(rr, cc) !== "";
      const step = (rr: number, cc: number): Pos => ({ r: rr + dr, c: cc + dc });
      let p = { r, c };
      const startFilled = filled(r, c) && filled(step(r, c).r, step(r, c).c);
      for (;;) {
        const n = step(p.r, p.c);
        if (n.r < 0 || n.c < 0 || n.r >= geo!.nRows || n.c >= geo!.nCols) break;
        if (startFilled ? !filled(n.r, n.c) : filled(n.r, n.c)) {
          if (!startFilled) p = n;
          break;
        }
        p = n;
      }
      r = p.r;
      c = p.c;
    } else {
      const i = geo!.index.get(r) ?? 0;
      r = geo!.rows[Math.max(0, Math.min(geo!.rows.length - 1, i + dr))] ?? 0;
      c = Math.max(0, Math.min(geo!.nCols - 1, c + dc));
      while (geo!.hc.has(c) && c > 0 && c < geo!.nCols - 1) c += dc || 1;
      const m = mergeAt(r, c);
      if (m && !extend && (dr > 0 || dc > 0) && (sel.r >= m.r1 && sel.r <= m.r2 && sel.c >= m.c1 && sel.c <= m.c2)) {
        r = dr > 0 ? Math.min(geo!.nRows - 1, m.r2 + 1) : r;
        c = dc > 0 ? Math.min(geo!.nCols - 1, m.c2 + 1) : c;
      }
    }
    setSel({ r, c });
    if (!extend) setAnchor({ r, c });
    ensureVisible(r, c);
  }
  function ensureVisible(r: number, c: number) {
    const el = grid.current;
    if (!el || !geo) return;
    const i = geo.index.get(r);
    const frozen = geo.rows.filter((x) => x < fr);
    const fH = frozen.reduce((s, x) => s + geo.rh(x), 0);
    const bStart = geo.rows.findIndex((x) => x >= fr);
    const b0 = bStart >= 0 ? geo.tops[bStart] : 0;
    const top = el.scrollTop / zoom, left = el.scrollLeft / zoom;
    const vh = el.clientHeight / zoom, vw = el.clientWidth / zoom;
    if (i !== undefined && r >= fr) {
      const y = HEAD_H + fH + geo.tops[i] - b0, h = geo.rh(r);
      if (y < top + HEAD_H + fH) el.scrollTop = Math.max(0, (y - HEAD_H - fH) * zoom);
      else if (y + h > top + vh - 16) el.scrollTop = (y + h - vh + 16) * zoom;
    }
    if (c >= fc) {
      const x = HEAD_W + geo.colX[c], w = geo.cw(c), fW = geo.colX[fc];
      if (x < left + HEAD_W + fW) el.scrollLeft = Math.max(0, (x - HEAD_W - fW) * zoom);
      else if (x + w > left + vw - 16) el.scrollLeft = (x + w - vw + 16) * zoom;
    }
  }

  function startEdit(value: string, fromBar = false) {
    setDropdown(null);
    setSuggest(0);
    cancelled.current = false;
    setEdit({ value, fromBar });
  }
  function editText() {
    const box = edit && (edit.fromBar ? barInput.current : cellInput.current);
    return box && box.isConnected ? box.value : edit?.value ?? "";
  }
  function finishEdit(dr = 0, dc = 0) {
    if (cancelled.current) return;
    if (edit) {
      const v = editText();
      // Ctrl+Enter style: a selected range takes the value in every cell.
      const ok = commitValue(sel.r, sel.c, v);
      if (!ok) return;
    }
    setEdit(null);
    pointing.current = null;
    if (dr || dc) move(dr, dc);
    grid.current?.focus();
  }
  function fillSelection(value: string) {
    const entries: [number, number, string][] = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) entries.push([r, c, value.startsWith("=") ? moveFormula(value, r - sel.r, c - sel.c) : value]);
    setCells(entries);
    setEdit(null);
    grid.current?.focus();
  }

  // Formula autocomplete: the function name being typed, and the function whose arguments the caret is in.
  const editValue = edit?.value ?? "";
  const typing = edit && editValue.startsWith("=") ? /([A-Z][A-Z0-9.]*)$/i.exec(editValue.slice(0, edit.caret ?? editValue.length))?.[1]?.toUpperCase() : undefined;
  const tableNames = data.sheets.flatMap((x) => (x.tables ?? []).map((t) => t.name));
  const suggestions = typing && typing.length >= 1 ? [...tableNames.filter((n) => n.toUpperCase().startsWith(typing)), ...FUNCTION_NAMES.filter((n) => n.startsWith(typing))].slice(0, 8) : [];
  const inside = (() => {
    if (!edit || !editValue.startsWith("=")) return undefined;
    let depth = 0;
    const s = editValue.slice(0, edit.caret ?? editValue.length);
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === ")") depth++;
      else if (s[i] === "(") {
        if (depth === 0) return /([A-Z][A-Z0-9.]*)$/i.exec(s.slice(0, i))?.[1]?.toUpperCase();
        depth--;
      }
    }
    return undefined;
  })();
  function acceptSuggestion(name: string) {
    const box = edit!.fromBar ? barInput.current : cellInput.current;
    const v = box?.value ?? editValue;
    const caret = box?.selectionStart ?? v.length;
    const before = v.slice(0, caret).replace(/[A-Z][A-Z0-9.]*$/i, name + (tableNames.includes(name) ? "[" : "("));
    const next = before + v.slice(caret);
    setEdit({ ...edit!, value: next, caret: before.length });
    if (box) {
      box.value = next;
      requestAnimationFrame(() => box.setSelectionRange(before.length, before.length));
    }
  }
  // Clicking a cell while typing a formula after an operator inserts its reference.
  const canPoint = () => {
    if (!edit) return false;
    const box = edit.fromBar ? barInput.current : cellInput.current;
    const v = box?.value ?? editValue;
    const caret = box?.selectionStart ?? v.length;
    if (pointing.current && pointing.current.end === caret) return true;
    return v.startsWith("=") && /[=(,+\-*/^&<>:;]\s*$/.test(v.slice(0, caret));
  };
  function pointAt(r1: number, c1: number, r2: number, c2: number, s?: string) {
    const box = edit!.fromBar ? barInput.current : cellInput.current;
    const v = box?.value ?? editValue;
    const caret = box?.selectionStart ?? v.length;
    const start = pointing.current && pointing.current.end === caret ? pointing.current.start : caret;
    const ref = (s ? `${/^[A-Za-z_]\w*$/.test(s) ? s : `'${s}'`}!` : "") + rangeText(r1, c1, r2, c2);
    const next = v.slice(0, start) + ref + v.slice(caret);
    pointing.current = { start, end: start + ref.length };
    setEdit({ ...edit!, value: next, caret: start + ref.length });
    if (box) {
      box.value = next;
      if (barInput.current && !edit!.fromBar) barInput.current.value = next;
      requestAnimationFrame(() => {
        box.focus();
        box.setSelectionRange(start + ref.length, start + ref.length);
      });
    }
  }

  // ---- Clipboard --------------------------------------------------------------------------------------------
  function selectedTSV(b: Box) {
    const lines: string[] = [];
    for (let r = b.r1; r <= b.r2; r++) {
      if (!geo!.index.has(r)) continue;
      const line: string[] = [];
      for (let c = b.c1; c <= b.c2; c++) line.push(cellText(ev(r, c), raw(r, c), fmtAt(r, c)).text);
      lines.push(line.join("\t"));
    }
    return lines.join("\n");
  }
  function copy(cut = false) {
    const b = { ...range, r2: Math.min(range.r2, cells.length - 1 < range.r1 ? range.r1 : Math.min(range.r2, cells.length + 50)) };
    const text = selectedTSV(b);
    clip = {
      text,
      box: b,
      cells: Array.from({ length: b.r2 - b.r1 + 1 }, (_, i) => Array.from({ length: b.c2 - b.c1 + 1 }, (_, j) => raw(b.r1 + i, b.c1 + j))),
      fmt: Array.from({ length: b.r2 - b.r1 + 1 }, (_, i) => Array.from({ length: b.c2 - b.c1 + 1 }, (_, j) => fmtAt(b.r1 + i, b.c1 + j))),
      cut,
      sheet: si,
      file: id,
    };
    return text;
  }
  function pasteClip(mode: "all" | "values" | "formats" | "transpose" | "formulas") {
    if (!clip) return;
    const c0 = clip;
    const rows = c0.cells.length, cols = c0.cells[0]?.length ?? 0;
    const at = { r: range.r1, c: range.c1 };
    const entries: [number, number, string][] = [];
    const fmts: [number, number, CellFmt | undefined][] = [];
    const srcBook = c0.file === id ? book! : null;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const [ti, tj] = mode === "transpose" ? [j, i] : [i, j];
        const r = at.r + ti, c = at.c + tj;
        const v = c0.cells[i][j];
        if (mode !== "formats") {
          let out = v;
          if (mode === "values") {
            const val = srcBook && v.startsWith("=") ? srcBook.value(c0.sheet, c0.box.r1 + i, c0.box.c1 + j) : v;
            out = val instanceof FErr ? val.code : String(val);
          } else if (v.startsWith("=") && !c0.cut) out = moveFormula(v, r - (c0.box.r1 + i), c - (c0.box.c1 + j));
          entries.push([r, c, out]);
        }
        if (mode === "all" || mode === "formats" || mode === "transpose") fmts.push([r, c, c0.fmt[i][j]]);
      }
    let next: SheetsData = dataRef.current!;
    // A cut moves the cells: clear the source first.
    if (c0.cut && c0.file === id && mode === "all") {
      next = { ...next, sheets: next.sheets.map((s, i) => {
        if (i !== c0.sheet) return s;
        const clearEntries: [number, number, string][] = [];
        const fmt = { ...(s.fmt ?? {}) };
        for (let r = c0.box.r1; r <= c0.box.r2; r++) for (let c = c0.box.c1; c <= c0.box.c2; c++) {
          clearEntries.push([r, c, ""]);
          delete fmt[key(r, c)];
        }
        return { ...writeCells(s, clearEntries), fmt };
      }) };
      clip = null;
    }
    next = { ...next, sheets: next.sheets.map((s, i) => {
      if (i !== si) return s;
      const w = writeCells(s, entries);
      if (!fmts.length) return w;
      const fmt = { ...(w.fmt ?? {}) };
      for (const [r, c, fm] of fmts) {
        if (fm) fmt[key(r, c)] = fm;
        else delete fmt[key(r, c)];
      }
      return { ...w, fmt };
    }) };
    commit(next);
    setAnchor({ r: at.r + (mode === "transpose" ? cols : rows) - 1, c: at.c + (mode === "transpose" ? rows : cols) - 1 });
    setSel(at);
  }
  function onCopy(e: React.ClipboardEvent, cut = false) {
    if (edit) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copy(cut));
  }
  function onPaste(e: React.ClipboardEvent) {
    if (edit) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (clip && text.replace(/\r/g, "") === clip.text) return pasteClip("all");
    if (!text) return;
    const parsed = text.includes("\t") || !text.includes(",") ? text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => l.split("\t")) : csvToCells(text);
    const entries: [number, number, string][] = [];
    parsed.forEach((row, i) => row.forEach((v, j) => entries.push([sel.r + i, sel.c + j, v])));
    setCells(entries);
    setAnchor({ r: sel.r + parsed.length - 1, c: sel.c + Math.max(...parsed.map((r) => r.length)) - 1 });
  }

  // ---- Structure -----------------------------------------------------------------------------------------------
  const insertRows = (before: boolean) => commit(shiftAxis(dataRef.current!, si, "row", before ? range.r1 : range.r2 + 1, range.r2 - range.r1 + 1));
  const deleteRows = () => commit(shiftAxis(dataRef.current!, si, "row", range.r1, -(range.r2 - range.r1 + 1)));
  const insertCols = (before: boolean) => commit(shiftAxis(dataRef.current!, si, "col", before ? range.c1 : range.c2 + 1, range.c2 - range.c1 + 1));
  const deleteCols = () => commit(shiftAxis(dataRef.current!, si, "col", range.c1, -(range.c2 - range.c1 + 1)));
  const hideRows = (hide: boolean) => updateSheet((s) => {
    const set = new Set(s.hiddenRows ?? []);
    for (let r = range.r1; r <= range.r2; r++) (hide ? set.add(r) : set.delete(r));
    return { ...s, hiddenRows: [...set] };
  });
  const hideCols = (hide: boolean) => updateSheet((s) => {
    const set = new Set(s.hiddenCols ?? []);
    for (let c = range.c1; c <= range.c2; c++) (hide ? set.add(c) : set.delete(c));
    return { ...s, hiddenCols: [...set] };
  });
  const clearBox = (what: "contents" | "formats" | "all") => updateSheet((s) => {
    let n = s;
    if (what !== "formats") {
      const entries: [number, number, string][] = [];
      for (let r = range.r1; r <= Math.min(range.r2, s.cells.length); r++) for (let c = range.c1; c <= range.c2; c++) if (s.cells[r]?.[c]) entries.push([r, c, ""]);
      n = writeCells(n, entries);
    }
    if (what !== "contents") {
      const fmt = { ...(n.fmt ?? {}) };
      for (const k of Object.keys(fmt)) {
        const [r, c] = k.split(",").map(Number);
        if (inBox(range, r, c)) delete fmt[k];
      }
      n = { ...n, fmt, merges: (n.merges ?? []).filter((m) => !(inBox(range, m.r1, m.c1) && inBox(range, m.r2, m.c2))) };
    }
    return n;
  });

  // The block of data around the selection, for sorting and filters.
  function dataRegion(): Box {
    if (range.r1 !== range.r2 || range.c1 !== range.c2) return { ...range, r2: Math.min(range.r2, cells.length - 1) };
    const filled = (r: number, c: number) => raw(r, c) !== "";
    let r1 = sel.r, r2 = sel.r, c1 = sel.c, c2 = sel.c;
    let grew = true;
    while (grew) {
      grew = false;
      if (r1 > 0 && Array.from({ length: c2 - c1 + 3 }, (_, i) => c1 - 1 + i).some((c) => c >= 0 && filled(r1 - 1, c))) { r1--; grew = true; }
      if (r2 < cells.length - 1 && Array.from({ length: c2 - c1 + 3 }, (_, i) => c1 - 1 + i).some((c) => c >= 0 && filled(r2 + 1, c))) { r2++; grew = true; }
      if (c1 > 0 && Array.from({ length: r2 - r1 + 3 }, (_, i) => r1 - 1 + i).some((r) => r >= 0 && filled(r, c1 - 1))) { c1--; grew = true; }
      if (Array.from({ length: r2 - r1 + 3 }, (_, i) => r1 - 1 + i).some((r) => r >= 0 && filled(r, c2 + 1))) { c2++; grew = true; }
    }
    return { r1, c1, r2, c2 };
  }
  function sortBy(keys: { col: number; desc: boolean }[], hasHeader: boolean, box = dataRegion()) {
    const r1 = box.r1 + (hasHeader ? 1 : 0);
    if (r1 > box.r2) return;
    updateSheet((s) => sortRange(s, r1, box.r2, box.c1, box.c2, keys, (r, c) => {
      const v = book!.value(si, r, c);
      return v instanceof FErr ? "" : v;
    }));
  }
  const quickSort = (desc: boolean) => {
    const box = dataRegion();
    const headerLike = box.r1 < box.r2 && typeof ev(box.r1, sel.c) === "string" && typeof ev(box.r1 + 1, sel.c) !== typeof ev(box.r1, sel.c);
    sortBy([{ col: sel.c, desc }], headerLike || (af?.header === box.r1), box);
  };

  function merge(kind: "all" | "across" | "none") {
    updateSheet((s) => {
      const rest = (s.merges ?? []).filter((m) => !(m.r1 <= range.r2 && m.r2 >= range.r1 && m.c1 <= range.c2 && m.c2 >= range.c1));
      if (kind === "none") return { ...s, merges: rest };
      const add = kind === "across" ? Array.from({ length: range.r2 - range.r1 + 1 }, (_, i) => ({ r1: range.r1 + i, c1: range.c1, r2: range.r1 + i, c2: range.c2 })) : [range];
      const keep = add.filter((m) => m.r1 !== m.r2 || m.c1 !== m.c2);
      // Merging keeps only the top-left value of each block, as Excel does.
      const entries: [number, number, string][] = [];
      for (const m of keep) for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if ((r !== m.r1 || c !== m.c1) && s.cells[r]?.[c]) entries.push([r, c, ""]);
      const w = writeCells(s, entries);
      const fmt = { ...(w.fmt ?? {}) };
      if (kind === "all") fmt[key(range.r1, range.c1)] = { ...(fmt[key(range.r1, range.c1)] ?? {}), align: "center" };
      return { ...w, fmt, merges: [...rest, ...keep] };
    });
  }

  function applyBorders(kind: BorderKind, b: Border) {
    const box = fmtBox();
    patchFmt(box, (cur, r, c) => {
      const border = { ...(cur.border ?? {}) };
      const top = r === box.r1, bottom = r === box.r2, left = c === box.c1, right = c === box.c2;
      const thick = { ...b, style: "thick" };
      switch (kind) {
        case "none": return { ...cur, border: undefined };
        case "all": Object.assign(border, { t: b, r: b, b: b, l: b }); break;
        case "outer": if (top) border.t = b; if (bottom) border.b = b; if (left) border.l = b; if (right) border.r = b; break;
        case "thickOuter": if (top) border.t = thick; if (bottom) border.b = thick; if (left) border.l = thick; if (right) border.r = thick; break;
        case "inner": if (!bottom) border.b = b; if (!right) border.r = b; if (!top) border.t = b; if (!left) border.l = b; break;
        case "top": if (top) border.t = b; break;
        case "bottom": if (bottom) border.b = b; break;
        case "bottomDouble": if (bottom) border.b = { ...b, style: "double" }; break;
        case "left": if (left) border.l = b; break;
        case "right": if (right) border.r = b; break;
      }
      return { ...cur, border };
    });
  }

  function autoSum() {
    // Sum the numbers above (or to the left of) the selected cell.
    let r = sel.r - 1;
    while (r >= 0 && typeof ev(r, sel.c) === "number") r--;
    if (r < sel.r - 1) return setCells([[sel.r, sel.c, `=SUM(${rangeText(r + 1, sel.c, sel.r - 1, sel.c)})`]]);
    let c = sel.c - 1;
    while (c >= 0 && typeof ev(sel.r, c) === "number") c--;
    if (c < sel.c - 1) return setCells([[sel.r, sel.c, `=SUM(${rangeText(sel.r, c + 1, sel.r, sel.c - 1)})`]]);
    startEdit("=SUM(");
  }

  function fillFrom(src: Box, dst: Box) {
    // dst extends src in one direction.
    const entries: [number, number, string][] = [];
    const fmts: [number, number, CellFmt | undefined][] = [];
    const down = dst.r2 > src.r2, up = dst.r1 < src.r1, right = dst.c2 > src.c2, left = dst.c1 < src.c1;
    if (down || up) {
      const n = down ? dst.r2 - src.r2 : src.r1 - dst.r1;
      for (let c = src.c1; c <= src.c2; c++) {
        const seed = Array.from({ length: src.r2 - src.r1 + 1 }, (_, i) => raw(src.r1 + i, c));
        const seq = up ? extendSeries(seed.slice().reverse(), n, { dr: -1, dc: 0 }) : extendSeries(seed, n, { dr: 1, dc: 0 });
        seq.forEach((v, i) => {
          const r = down ? src.r2 + 1 + i : src.r1 - 1 - i;
          entries.push([r, c, v]);
          const sr = down ? src.r1 + ((i % seed.length)) : src.r2 - (i % seed.length);
          fmts.push([r, c, fmtAt(sr, c)]);
        });
      }
    } else if (right || left) {
      const n = right ? dst.c2 - src.c2 : src.c1 - dst.c1;
      for (let r = src.r1; r <= src.r2; r++) {
        const seed = Array.from({ length: src.c2 - src.c1 + 1 }, (_, i) => raw(r, src.c1 + i));
        const seq = left ? extendSeries(seed.slice().reverse(), n, { dr: 0, dc: -1 }) : extendSeries(seed, n, { dr: 0, dc: 1 });
        seq.forEach((v, i) => {
          const c = right ? src.c2 + 1 + i : src.c1 - 1 - i;
          entries.push([r, c, v]);
          const sc = right ? src.c1 + (i % seed.length) : src.c2 - (i % seed.length);
          fmts.push([r, c, fmtAt(r, sc)]);
        });
      }
    } else return;
    updateSheet((s) => {
      const w = writeCells(s, entries);
      const fmt = { ...(w.fmt ?? {}) };
      for (const [r, c, fm] of fmts) {
        if (fm) fmt[key(r, c)] = fm;
        else delete fmt[key(r, c)];
      }
      return { ...w, fmt };
    });
    setAnchor({ r: dst.r1, c: dst.c1 });
    setSel({ r: dst.r2, c: dst.c2 });
  }
  const fillDown = () => {
    if (range.r1 === range.r2) {
      if (range.r1 === 0) return;
      return fillFrom({ ...range, r1: range.r1 - 1, r2: range.r1 - 1 }, { ...range, r1: range.r1 - 1 });
    }
    const entries: [number, number, string][] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const v = raw(range.r1, c);
      for (let r = range.r1 + 1; r <= range.r2; r++) entries.push([r, c, v.startsWith("=") ? moveFormula(v, r - range.r1, 0) : v]);
    }
    setCells(entries);
  };
  const fillRight = () => {
    if (range.c1 === range.c2) {
      if (range.c1 === 0) return;
      return fillFrom({ ...range, c1: range.c1 - 1, c2: range.c1 - 1 }, { ...range, c1: range.c1 - 1 });
    }
    const entries: [number, number, string][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const v = raw(r, range.c1);
      for (let c = range.c1 + 1; c <= range.c2; c++) entries.push([r, c, v.startsWith("=") ? moveFormula(v, 0, c - range.c1) : v]);
    }
    setCells(entries);
  };

  function removeDuplicates() {
    const box = dataRegion();
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let r = box.r1; r <= box.r2; r++) {
      const k = JSON.stringify(Array.from({ length: box.c2 - box.c1 + 1 }, (_, i) => display(ev(r, box.c1 + i)).toLowerCase()));
      if (r === box.r1 || !seen.has(k)) keep.push(r);
      seen.add(k);
    }
    const removed = box.r2 - box.r1 + 1 - keep.length;
    if (!removed) return toast("No duplicate rows found");
    const entries: [number, number, string][] = [];
    for (let i = 0; i <= box.r2 - box.r1; i++)
      for (let c = box.c1; c <= box.c2; c++) entries.push([box.r1 + i, c, i < keep.length ? raw(keep[i], c) : ""]);
    setCells(entries);
    toast(`Removed ${removed} duplicate row${removed === 1 ? "" : "s"}`, "success");
  }
  function trimSpaces() {
    const entries: [number, number, string][] = [];
    for (let r = range.r1; r <= Math.min(range.r2, cells.length - 1); r++)
      for (let c = range.c1; c <= range.c2; c++) {
        const v = raw(r, c);
        if (v && !v.startsWith("=") && v !== v.trim().replace(/ +/g, " ")) entries.push([r, c, v.trim().replace(/ +/g, " ")]);
      }
    setCells(entries);
    toast(`Cleaned ${entries.length} cell${entries.length === 1 ? "" : "s"}`);
  }
  async function splitColumn() {
    const d = await askText("Split text into columns", { label: "Separator (comma, space, tab or any text)", value: ",", confirmLabel: "Split" });
    if (d === null || d === undefined) return;
    const sep = d === "tab" || d === "\\t" ? "\t" : d === "space" ? " " : d;
    const entries: [number, number, string][] = [];
    for (let r = range.r1; r <= Math.min(range.r2, cells.length - 1); r++) {
      const v = raw(r, range.c1);
      if (!v || v.startsWith("=")) continue;
      v.split(sep).forEach((part, i) => entries.push([r, range.c1 + i, part.trim()]));
    }
    setCells(entries);
  }
  function changeCase(kind: "upper" | "lower" | "proper") {
    const entries: [number, number, string][] = [];
    for (let r = range.r1; r <= Math.min(range.r2, cells.length - 1); r++)
      for (let c = range.c1; c <= range.c2; c++) {
        const v = raw(r, c);
        if (!v || v.startsWith("=")) continue;
        entries.push([r, c, kind === "upper" ? v.toUpperCase() : kind === "lower" ? v.toLowerCase() : v.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase())]);
      }
    setCells(entries);
  }

  function autofitCol(c: number) {
    const ctx = document.createElement("canvas").getContext("2d")!;
    let w = 40;
    for (let r = 0; r < cells.length; r++) {
      const fm = fmtAt(r, c);
      ctx.font = `${fm?.bold ? 700 : 400} ${fontPx(fm?.size)}px ${fm?.font ?? "Calibri, Carlito, sans-serif"}`;
      w = Math.max(w, ctx.measureText(cellText(ev(r, c), raw(r, c), fm).text).width + 16);
    }
    return Math.min(600, Math.ceil(w));
  }
  const autofitCols = () => updateSheet((s) => {
    const colW = { ...(s.colW ?? {}) };
    for (let c = range.c1; c <= Math.min(range.c2, geo!.nCols - 1); c++) colW[c] = autofitCol(c);
    return { ...s, colW };
  });

  // ---- Find and replace ------------------------------------------------------------------------------------------
  function matches(o: FindOpts, s: Sheet, sIdx: number, r: number, c: number) {
    const rawV = s.cells[r]?.[c] ?? "";
    if (!rawV) return false;
    const text = o.formulas ? rawV : cellText(book!.value(sIdx, r, c), rawV, s.fmt?.[key(r, c)]).text;
    const a = o.matchCase ? text : text.toLowerCase(), b = o.matchCase ? o.text : o.text.toLowerCase();
    return o.whole ? a === b : a.includes(b);
  }
  function findNext(o: FindOpts, back: boolean) {
    if (!o.text) return;
    const order = o.all ? data!.sheets.map((_, i) => (si + i) % data!.sheets.length) : [si];
    const hits: { s: number; r: number; c: number }[] = [];
    for (const s of order) {
      const sh = data!.sheets[s];
      sh.cells.forEach((row, r) => row?.forEach((_, c) => matches(o, sh, s, r, c) && hits.push({ s, r, c })));
    }
    if (!hits.length) {
      setFindCount("No matches");
      return;
    }
    const cur = hits.findIndex((h) => h.s === si && (h.r > sel.r || (h.r === sel.r && h.c > sel.c)));
    let i = back ? (cur < 0 ? hits.length : cur) - 1 - (hits.some((h) => h.s === si && h.r === sel.r && h.c === sel.c) ? 1 : 0) : cur < 0 ? 0 : cur;
    i = ((i % hits.length) + hits.length) % hits.length;
    const h = hits[i];
    if (h.s !== si) setActive(h.s);
    setSel({ r: h.r, c: h.c });
    setAnchor({ r: h.r, c: h.c });
    setFindCount(`${i + 1} of ${hits.length}`);
    requestAnimationFrame(() => ensureVisible(h.r, h.c));
  }
  function replaceIn(text: string, o: FindOpts) {
    if (o.whole) return o.replace;
    return text.replace(new RegExp(o.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.matchCase ? "g" : "gi"), o.replace.replace(/\$/g, "$$$$"));
  }
  function replaceOne(o: FindOpts) {
    if (matches(o, sheet!, si, sel.r, sel.c)) setCells([[sel.r, sel.c, replaceIn(raw(sel.r, sel.c), { ...o, formulas: true })]]);
    findNext(o, false);
  }
  function replaceAll(o: FindOpts) {
    if (!o.text) return;
    let n = 0;
    const d = dataRef.current!;
    const sheets = d.sheets.map((s, i) => {
      if (!o.all && i !== si) return s;
      const cs = s.cells.map((row, r) => row?.map((v, c) => {
        if (!matches(o, s, i, r, c)) return v;
        n++;
        return replaceIn(v, { ...o, formulas: true });
      }) ?? []);
      return { ...s, cells: cs };
    });
    commit({ ...d, sheets });
    setFindCount(`Replaced ${n}`);
  }

  // ---- Keyboard ----------------------------------------------------------------------------------------------------
  function onKey(e: React.KeyboardEvent) {
    if (edit) {
      if (edit.fromBar || e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return finishEdit(e.key === "Tab" ? 0 : e.shiftKey ? -1 : 1, e.key === "Tab" ? (e.shiftKey ? -1 : 1) : 0);
      }
      if (e.key === "Escape") { cancelled.current = true; return setEdit(null); }
      const box = cellInput.current;
      if (e.key === "Backspace") {
        e.preventDefault();
        if (box) box.value = box.value.slice(0, -1);
        else setEdit((v) => v && { ...v, value: v.value.slice(0, -1) });
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (box) box.value += e.key;
        else setEdit((v) => v && { ...v, value: v.value + e.key });
      }
      return;
    }
    if (chartSel && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      updateSheet((s) => ({ ...s, charts: (s.charts ?? []).filter((c) => c.id !== chartSel) }));
      setChartSel(null);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && k === "y") { e.preventDefault(); return redo(); }
    if (mod && k === "a") { e.preventDefault(); setAnchor({ r: 0, c: 0 }); return setSel({ r: geo!.nRows - 1, c: geo!.nCols - 1 }); }
    if (mod && k === "b") { e.preventDefault(); return toggleFmt("bold"); }
    if (mod && k === "i") { e.preventDefault(); return toggleFmt("italic"); }
    if (mod && k === "u") { e.preventDefault(); return toggleFmt("underline"); }
    if (mod && k === "d") { e.preventDefault(); return fillDown(); }
    if (mod && k === "r") { e.preventDefault(); return fillRight(); }
    if (mod && k === "f") { e.preventDefault(); return setFind({ replace: false }); }
    if (mod && k === "h") { e.preventDefault(); return setFind({ replace: true }); }
    if (mod && k === "p") { e.preventDefault(); return printSheet(); }
    if (mod && (k === "t" || k === "l")) { e.preventDefault(); return setDialog("table"); }
    if (mod && e.key === "`") { e.preventDefault(); return setShowFormulas((v) => !v); }
    if (mod && (e.key === ";" || e.key === ":")) {
      e.preventDefault();
      const s = e.shiftKey ? nowSerial() % 1 : todaySerial();
      const txt = formatValue(s, e.shiftKey ? "h:mm" : "yyyy-mm-dd").text;
      return setCells([[sel.r, sel.c, txt]]);
    }
    if (mod && e.shiftKey && (e.key === "$" || e.key === "4")) { e.preventDefault(); return patchFmt(fmtBox(), { num: "$#,##0.00" }); }
    if (mod && e.shiftKey && (e.key === "%" || e.key === "5")) { e.preventDefault(); return patchFmt(fmtBox(), { num: "0%" }); }
    if (mod && e.shiftKey && (e.key === "!" || e.key === "1")) { e.preventDefault(); return patchFmt(fmtBox(), { num: "#,##0.00" }); }
    if (mod && e.shiftKey && (e.key === "+" || e.key === "=")) { e.preventDefault(); return range.c1 === 0 && range.c2 >= geo!.nCols - 1 ? insertRows(true) : range.r1 === 0 && range.r2 >= geo!.nRows - 1 ? insertCols(true) : insertRows(true); }
    if (mod && e.key === "-") { e.preventDefault(); return range.c1 === 0 && range.c2 >= geo!.nCols - 1 ? deleteRows() : range.r1 === 0 && range.r2 >= geo!.nRows - 1 ? deleteCols() : deleteRows(); }
    if (mod && e.key === "9") { e.preventDefault(); return hideRows(true); }
    if (mod && e.key === "0") { e.preventDefault(); return hideCols(true); }
    if (e.altKey && e.key === "=") { e.preventDefault(); return autoSum(); }
    if (e.shiftKey && e.key === " " && !mod) { e.preventDefault(); setAnchor({ r: sel.r, c: 0 }); return setSel({ r: sel.r, c: geo!.nCols - 1 }); }
    if (mod && e.key === " ") { e.preventDefault(); setAnchor({ r: 0, c: sel.c }); return setSel({ r: geo!.nRows - 1, c: sel.c }); }
    if (e.key === "Home") {
      e.preventDefault();
      const p = mod ? { r: 0, c: 0 } : { r: sel.r, c: 0 };
      setSel(p);
      if (!e.shiftKey) setAnchor(p);
      return ensureVisible(p.r, p.c);
    }
    if (mod && e.key === "End") {
      e.preventDefault();
      const p = { r: Math.max(0, cells.length - 1), c: Math.max(0, ...cells.map((r) => r.length)) - 1 };
      setSel(p);
      if (!e.shiftKey) setAnchor(p);
      return ensureVisible(p.r, Math.max(0, p.c));
    }
    if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      return move((e.key === "PageDown" ? 1 : -1) * Math.max(1, Math.floor(scroll.height / ROW_H) - 2), 0, e.shiftKey);
    }
    if (mod && !e.shiftKey && !e.key.startsWith("Arrow")) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); return move(-1, 0, e.shiftKey, mod);
      case "ArrowDown": e.preventDefault(); return move(1, 0, e.shiftKey, mod);
      case "ArrowLeft": e.preventDefault(); return move(0, -1, e.shiftKey, mod);
      case "ArrowRight": e.preventDefault(); return move(0, 1, e.shiftKey, mod);
      case "Tab": e.preventDefault(); return move(0, e.shiftKey ? -1 : 1);
      case "Enter": e.preventDefault(); return range.r1 !== range.r2 || range.c1 !== range.c2 ? move(e.shiftKey ? -1 : 1, 0, true) : move(e.shiftKey ? -1 : 1, 0);
      case "F2": e.preventDefault(); return startEdit(raw(sel.r, sel.c));
      case "Escape": setPainter(null); setChartSel(null); return;
      case "Delete": case "Backspace": {
        e.preventDefault();
        return clearBox("contents");
      }
    }
    if (e.key.length === 1 && !e.altKey && !mod) {
      e.preventDefault();
      startEdit(e.key);
    }
  }

  function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, fromBar: boolean) {
    const box = e.currentTarget;
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      return setSuggest((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    }
    if (suggestions.length && e.key === "Tab") {
      e.preventDefault();
      return acceptSuggestion(suggestions[suggest] ?? suggestions[0]);
    }
    if (e.key === "F4") {
      e.preventDefault();
      const r = cycleAbsolute(box.value, box.selectionStart ?? box.value.length);
      box.value = r.text;
      setEdit((v) => v && { ...v, value: r.text, caret: r.pos });
      requestAnimationFrame(() => box.setSelectionRange(r.pos, r.pos));
      return;
    }
    if (e.key === "Enter" && e.altKey && !fromBar) {
      e.preventDefault();
      const p = box.selectionStart ?? box.value.length;
      box.value = box.value.slice(0, p) + "\n" + box.value.slice(p);
      box.setSelectionRange(p + 1, p + 1);
      setEdit((v) => v && { ...v, value: box.value });
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (range.r1 !== range.r2 || range.c1 !== range.c2)) {
      e.preventDefault();
      return fillSelection(box.value);
    }
    if (e.key === "Enter") { e.preventDefault(); return finishEdit(fromBar ? 1 : e.shiftKey ? -1 : 1, 0); }
    if (e.key === "Tab") { e.preventDefault(); return finishEdit(0, e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { cancelled.current = true; setEdit(null); pointing.current = null; grid.current?.focus(); }
  }

  // ---- Pointer --------------------------------------------------------------------------------------------------------
  const cellFromPoint = (x: number, y: number): Pos | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-r]");
    return el ? { r: Number(el.dataset.r), c: Number(el.dataset.c) } : null;
  };
  function onCellDown(e: React.MouseEvent, r: number, c: number) {
    if (e.button !== 0) {
      if (e.button === 2 && !inBox(range, r, c)) {
        setSel({ r, c });
        setAnchor({ r, c });
      }
      return;
    }
    const links = typeof ev(r, c) === "string" ? findLinks(String(ev(r, c))) : [];
    if (links.length && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      return openLink(links[0].href);
    }
    if (edit && canPoint()) {
      e.preventDefault();
      pointAt(r, c, r, c);
      const start = { r, c };
      const moveFn = (ev2: MouseEvent) => {
        const p = cellFromPoint(ev2.clientX, ev2.clientY);
        if (p) pointAt(Math.min(start.r, p.r), Math.min(start.c, p.c), Math.max(start.r, p.r), Math.max(start.c, p.c));
      };
      const up = () => {
        removeEventListener("mousemove", moveFn);
        removeEventListener("mouseup", up);
      };
      addEventListener("mousemove", moveFn);
      addEventListener("mouseup", up);
      return;
    }
    if (edit) finishEdit();
    setChartSel(null);
    setDropdown(null);
    const m = mergeAt(r, c);
    if (e.shiftKey) setSel({ r, c });
    else {
      // A merged block is selected whole.
      setSel({ r: m?.r1 ?? r, c: m?.c1 ?? c });
      setAnchor({ r: m?.r2 ?? r, c: m?.c2 ?? c });
    }
    // Drag to select a range.
    const moveFn = (ev2: MouseEvent) => {
      const p = cellFromPoint(ev2.clientX, ev2.clientY);
      if (p) setSel(p);
    };
    const up = () => {
      removeEventListener("mousemove", moveFn);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", moveFn);
    addEventListener("mouseup", up);
  }
  // Format painter: apply on mouse-up over the target range.
  function onCellUp() {
    if (!painter) return;
    const src = painter.fmt;
    patchFmt(range, (_cur, r, c) => src[(r - range.r1) % src.length]?.[(c - range.c1) % src[0].length] ?? {});
    if (!painter.keep) setPainter(null);
  }
  function startFill(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const src = range;
    const moveFn = (ev2: MouseEvent) => {
      const p = cellFromPoint(ev2.clientX, ev2.clientY);
      if (!p) return;
      const dr = p.r > src.r2 ? p.r - src.r2 : p.r < src.r1 ? p.r - src.r1 : 0;
      const dc = p.c > src.c2 ? p.c - src.c2 : p.c < src.c1 ? p.c - src.c1 : 0;
      if (Math.abs(dr) >= Math.abs(dc) && dr) setFillTarget({ ...src, r1: Math.min(src.r1, p.r), r2: Math.max(src.r2, p.r) });
      else if (dc) setFillTarget({ ...src, c1: Math.min(src.c1, p.c), c2: Math.max(src.c2, p.c) });
      else setFillTarget(null);
    };
    const up = () => {
      removeEventListener("mousemove", moveFn);
      removeEventListener("mouseup", up);
      setFillTarget((t) => {
        if (t) fillFrom(src, t);
        return null;
      });
    };
    addEventListener("mousemove", moveFn);
    addEventListener("mouseup", up);
  }
  function fillDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Fill down as far as the column to the left (or right) has data.
    const nb = range.c1 > 0 ? range.c1 - 1 : range.c2 + 1;
    let r = range.r2;
    while (raw(r + 1, nb) !== "") r++;
    if (r > range.r2) fillFrom(range, { ...range, r2: r });
  }
  function startResize(e: React.MouseEvent, axis: "col" | "row", i: number) {
    e.preventDefault();
    e.stopPropagation();
    const start = axis === "col" ? e.clientX : e.clientY;
    const orig = axis === "col" ? geo!.cw(i) : geo!.rh(i);
    const targets = axis === "col" && range.r1 === 0 && range.r2 >= geo!.nRows - 1 && inBox(range, 0, i) ? Array.from({ length: range.c2 - range.c1 + 1 }, (_, k) => range.c1 + k) : axis === "row" && range.c1 === 0 && range.c2 >= geo!.nCols - 1 && inBox(range, i, 0) ? Array.from({ length: range.r2 - range.r1 + 1 }, (_, k) => range.r1 + k) : [i];
    let first = true;
    const moveFn = (ev2: MouseEvent) => {
      const size = Math.max(axis === "col" ? 16 : 12, Math.round(orig + ((axis === "col" ? ev2.clientX : ev2.clientY) - start) / zoom));
      updateSheet((s) => {
        const map = { ...((axis === "col" ? s.colW : s.rowH) ?? {}) };
        targets.forEach((t) => (map[t] = size));
        return axis === "col" ? { ...s, colW: map } : { ...s, rowH: map };
      }, first ? undefined : "resize");
      first = false;
    };
    const up = () => {
      removeEventListener("mousemove", moveFn);
      removeEventListener("mouseup", up);
      history.current.tag = undefined;
    };
    addEventListener("mousemove", moveFn);
    addEventListener("mouseup", up);
  }

  // ---- Sheets (tabs) -----------------------------------------------------------------------------------------------
  function addSheet(name?: string, newCells: string[][] = []) {
    const d = dataRef.current!;
    let n = name ?? `Sheet${d.sheets.length + 1}`;
    while (d.sheets.some((s) => s.name.toLowerCase() === n.toLowerCase())) n += " 2";
    commit({ ...d, sheets: [...d.sheets, { name: n, cells: newCells }] });
    setActive(d.sheets.length);
  }
  async function renameTab(i: number) {
    const n = await askText("Rename sheet", { value: data!.sheets[i].name, confirmLabel: "Rename" });
    if (!n?.trim()) return;
    if (data!.sheets.some((s, j) => j !== i && s.name.toLowerCase() === n.trim().toLowerCase())) return toast("Another sheet already has that name", "error");
    commit(renameSheet(dataRef.current!, i, n.trim()));
  }
  async function removeTab(i: number) {
    if (data!.sheets.filter((s) => !s.hidden).length === 1 && !data!.sheets[i].hidden) return toast("A spreadsheet needs at least one visible sheet");
    if (!(await askConfirm(`Delete the sheet “${data!.sheets[i].name}”?`, { body: "You can undo this with Ctrl+Z.", danger: true, confirmLabel: "Delete sheet" }))) return;
    const d = dataRef.current!;
    commit({ ...d, sheets: d.sheets.filter((_, j) => j !== i) });
    setActive(Math.max(0, i - 1));
  }
  function duplicateTab(i: number) {
    const d = dataRef.current!;
    const src = d.sheets[i];
    let n = `${src.name} (2)`;
    while (d.sheets.some((s) => s.name === n)) n += " 2";
    const sheets = d.sheets.slice();
    sheets.splice(i + 1, 0, { ...structuredClone(src), name: n, charts: src.charts?.map((c) => ({ ...c, id: Math.random().toString(36).slice(2) })) });
    commit({ ...d, sheets });
    setActive(i + 1);
  }
  function moveTab(i: number, to: number) {
    const d = dataRef.current!;
    if (to < 0 || to >= d.sheets.length) return;
    const sheets = d.sheets.slice();
    const [s] = sheets.splice(i, 1);
    sheets.splice(to, 0, s);
    commit({ ...d, sheets });
    setActive(to);
  }

  // ---- Charts ---------------------------------------------------------------------------------------------------------
  function addChart() {
    const box = range.r1 === range.r2 && range.c1 === range.c2 ? dataRegion() : range;
    const x = geo!.colX[Math.min(box.c2 + 1, geo!.nCols)] + 16;
    const i = geo!.index.get(box.r1) ?? 0;
    const c: SheetChart = { id: Math.random().toString(36).slice(2, 10), range: rangeText(box.r1, box.c1, Math.min(box.r2, cells.length - 1), box.c2), kind: "column", x, y: geo!.tops[i], w: 480, h: 300, legend: true };
    updateSheet((s) => ({ ...s, charts: [...(s.charts ?? []), c] }));
    setChartSel(c.id);
  }
  function chartData(c: SheetChart): ChartModel | null {
    return buildChart(c, (r, cc) => ev(r, cc), (r, cc) => cellText(ev(r, cc), raw(r, cc), fmtAt(r, cc)).text);
  }
  /** Numbers for a sparkline, in reading order. */
  function sparkValues(range: string): number[] {
    const b = parseRange(range);
    if (!b) return [];
    const out: number[] = [];
    for (let r = b.r1; r <= Math.min(b.r2, b.r1 + 500); r++)
      for (let cc = b.c1; cc <= Math.min(b.c2, b.c1 + 500); cc++) {
        const v = ev(r, cc);
        if (typeof v === "number") out.push(v);
      }
    return out;
  }
  /** Put sparklines in `loc`; several cells each get their own row (or column) of the data. */
  function saveSparklines(loc: string, sp: Sparkline): string | null {
    const L = parseRange(loc), D = parseRange(sp.range);
    if (!L || !D) return "Type ranges like B2:M2 and N2.";
    const cellsL: [number, number][] = [];
    for (let r = L.r1; r <= L.r2; r++) for (let cc = L.c1; cc <= L.c2; cc++) cellsL.push([r, cc]);
    const vertical = L.c1 === L.c2;
    const parts = cellsL.length === 1 ? [sp.range] : vertical
      ? Array.from({ length: D.r2 - D.r1 + 1 }, (_, i) => rangeText(D.r1 + i, D.c1, D.r1 + i, D.c2))
      : Array.from({ length: D.c2 - D.c1 + 1 }, (_, i) => rangeText(D.r1, D.c1 + i, D.r2, D.c1 + i));
    if (parts.length !== cellsL.length) return `The location has ${cellsL.length} cells but the data has ${parts.length} ${vertical ? "rows" : "columns"}.`;
    updateSheet((s) => {
      const sparklines = { ...(s.sparklines ?? {}) };
      cellsL.forEach(([r, cc], i) => (sparklines[key(r, cc)] = { ...sp, range: parts[i] }));
      return { ...s, sparklines };
    });
    return null;
  }
  function chartDrag(e: React.MouseEvent, c: SheetChart, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    setChartSel(c.id);
    const sx = e.clientX, sy = e.clientY;
    let first = true;
    const moveFn = (ev2: MouseEvent) => {
      const dx = (ev2.clientX - sx) / zoom, dy = (ev2.clientY - sy) / zoom;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      updateSheet((s) => ({
        ...s,
        charts: (s.charts ?? []).map((x) => (x.id !== c.id ? x : mode === "move" ? { ...x, x: Math.max(0, c.x + dx), y: Math.max(0, c.y + dy) } : { ...x, w: Math.max(160, c.w + dx), h: Math.max(120, c.h + dy) })),
      }), first ? undefined : "chart");
      first = false;
    };
    const up = () => {
      removeEventListener("mousemove", moveFn);
      removeEventListener("mouseup", up);
      history.current.tag = undefined;
    };
    addEventListener("mousemove", moveFn);
    addEventListener("mouseup", up);
  }

  // ---- Files ----------------------------------------------------------------------------------------------------------
  async function exportXLSX() {
    try {
      const { writeXlsx } = await import("./xlsx");
      await saveAs(`${safeName(f.meta!.name)}.xlsx`, await writeXlsx(data!));
    } catch (e) {
      toast(`Couldn’t save the Excel file: ${errorText(e)}`, "error");
    }
  }
  const usedValues = (s: Sheet, sIdx: number) => trim(s.cells.map((row, r) => Array.from(row ?? [], (v, c) => cellText(book!.value(sIdx, r, c), v ?? "", s.fmt?.[key(r, c)]).text)));
  async function exportDelimited(ext: "csv" | "tsv") {
    const values = usedValues(sheet!, si);
    await saveAs(`${safeName(f.meta!.name)}${data!.sheets.length > 1 ? " - " + sheet!.name : ""}.${ext}`, Papa.unparse(values, { delimiter: ext === "tsv" ? "\t" : "," }));
  }
  async function exportJSON() {
    const values = usedValues(sheet!, si);
    const [head = [], ...rows] = values;
    const out = rows.map((r) => Object.fromEntries(head.map((h, i) => [h || colName(i), r[i] ?? ""])));
    await saveAs(`${safeName(f.meta!.name)} - ${sheet!.name}.json`, JSON.stringify(out, null, 2));
  }
  async function exportHTML() {
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>${f.meta!.name}</title></head><body>${data!.sheets.filter((s) => !s.hidden).map((s) => `<h2>${s.name}</h2>${sheetHtml(s, book!, data!.sheets.indexOf(s))}`).join("")}</body></html>`;
    await saveAs(`${safeName(f.meta!.name)}.html`, body);
  }
  function printSheet(selectionOnly = false) {
    const body = sheetHtml(sheet!, book!, si, { gridlines: sheet!.showGrid !== false, range: selectionOnly ? range : undefined });
    const wide = Object.values(sheet!.colW ?? {}).reduce((a, b) => a + b, 0) + (Math.max(0, ...cells.map((r) => r.length)) - Object.keys(sheet!.colW ?? {}).length) * COL_W > 700;
    printHtml(`${f.meta!.name} - ${sheet!.name}`, body, wide);
  }
  async function importInto(file: File) {
    if (/\.(csv|tsv)$/i.test(file.name)) return addSheet(file.name.replace(/\.[^.]+$/, ""), csvToCells(await file.text()));
    let added: Sheet[];
    if (/\.xlsx$/i.test(file.name)) {
      const { readXlsx } = await import("./xlsx");
      added = (await readXlsx(await file.arrayBuffer())).sheets;
    } else added = await workbookToSheets(await file.arrayBuffer());
    const d = dataRef.current!;
    const taken = new Set(d.sheets.map((s) => s.name.toLowerCase()));
    added = added.map((s) => {
      let n = s.name;
      while (taken.has(n.toLowerCase())) n += " 2";
      taken.add(n.toLowerCase());
      return { ...s, name: n };
    });
    commit({ ...d, sheets: [...d.sheets, ...added] });
    setActive(d.sheets.length);
  }

  async function askAi(key: string, request: string, hist: AiHistory) {
    if (edit) finishEdit();
    const { askSheets, applySheetOps } = await import("./ai");
    const answer = await askSheets(key, data!, si, selText, hist, request);
    if (!answer.ops.length) return answer.reply;
    const { data: next, applied, focus } = applySheetOps(data!, si, answer.ops);
    if (applied) {
      commit(next);
      setActive(focus);
    }
    const skipped = answer.ops.length - applied;
    return answer.reply + (skipped ? `\n\n(${skipped} change${skipped === 1 ? "" : "s"} couldn’t be applied.)` : "");
  }

  // ---- Status -----------------------------------------------------------------------------------------------------------
  const stats = (() => {
    if (range.r1 === range.r2 && range.c1 === range.c2) return null;
    let sum = 0, count = 0, filled = 0, min = Infinity, max = -Infinity;
    for (let r = range.r1; r <= Math.min(range.r2, cells.length); r++)
      for (let c = range.c1; c <= Math.min(range.c2, geo.nCols); c++) {
        const v = ev(r, c);
        if (v !== "") filled++;
        if (typeof v === "number") {
          sum += v;
          count++;
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    return { sum, count, filled, avg: count ? sum / count : 0, min, max };
  })();

  // ---- Tables and pivot tables ---------------------------------------------------------------------------------------------
  const selTable = tableAt(sheet, sel.r, sel.c);
  const pivotHere = pivotAt(sheet, sel.r, sel.c);
  const pivotSrc = pivotHere ? readSource(data, book, pivotHere.source, si) : null;
  function defaultPivotSource() {
    if (selTable) return selTable.name;
    const b = dataRegion();
    const q = /^[A-Za-z_]\w*$/.test(sheet!.name) ? sheet!.name : `'${sheet!.name.replace(/'/g, "''")}'`;
    return `${q}!${rangeText(b.r1, b.c1, b.r2, b.c2).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`;
  }
  function createPivot(source: string): string | null {
    const d = dataRef.current!;
    const src = readSource(d, new Book(d), source, si);
    if (typeof src === "string") return src;
    const n = d.sheets.filter((x) => x.pivots?.length).length + 1;
    let name = `PivotTable${n}`;
    for (let i = n; d.sheets.some((x) => x.name.toLowerCase() === name.toLowerCase()); i++) name = `PivotTable${i + 1}`;
    const p: Pivot = { id: Math.random().toString(36).slice(2, 10), name, source, r: 2, c: 0, rows: [], cols: [], values: [], filters: [] };
    const withSheet: SheetsData = { ...d, sheets: [...d.sheets, { name, cells: [], pivots: [p] }] };
    const out = refreshPivot(withSheet, withSheet.sheets.length - 1, p.id);
    commit(out.data);
    setActive(withSheet.sheets.length - 1);
    setAnchor({ r: 2, c: 0 });
    setSel({ r: 2, c: 0 });
    setPivotClosed(null);
    return null;
  }
  function updatePivot(p: Pivot) {
    const d = dataRef.current!;
    const next = { ...d, sheets: d.sheets.map((x, i) => (i === si ? { ...x, pivots: (x.pivots ?? []).map((y) => (y.id === p.id ? p : y)) } : x)) };
    const out = refreshPivot(next, si, p.id);
    commit(out.data);
  }
  function refreshAllPivots() {
    let d = dataRef.current!;
    let n = 0;
    d.sheets.forEach((x, i) => (x.pivots ?? []).forEach((p) => {
      d = refreshPivot(d, i, p.id).data;
      n++;
    }));
    if (!n) return toast("There are no PivotTables in this workbook");
    commit(d);
    toast(`Refreshed ${n} PivotTable${n === 1 ? "" : "s"}`, "success");
  }

  // ---- Rendering ---------------------------------------------------------------------------------------------------------
  const curFmt = fmtAt(sel.r, sel.c) ?? {};
  const frozenRows = geo.rows.filter((r) => r < fr);
  const frozenH = frozenRows.reduce((s, r) => s + geo.rh(r), 0);
  const frozenW = geo.colX[fc];
  const bodyStart = geo.rows.findIndex((r) => r >= fr);
  const viewTop = scroll.top / zoom, viewH = scroll.height / zoom;
  let first = Math.max(bodyStart < 0 ? geo.rows.length : bodyStart, 0);
  {
    // Binary search for the first body row on screen.
    let lo = first, hi = geo.rows.length - 1;
    const target = viewTop + (bodyStart >= 0 ? geo.tops[bodyStart] : 0);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (geo.tops[mid + 1] <= target) lo = mid + 1;
      else hi = mid;
    }
    first = Math.max(first, lo - 2);
  }
  let last = first;
  const limit = viewTop + viewH + (bodyStart >= 0 ? geo.tops[bodyStart] : 0);
  while (last < geo.rows.length && geo.tops[last] < limit + 200) last++;
  const visibleRows = geo.rows.slice(first, last);
  const viewL = scroll.left / zoom + frozenW, viewW = scroll.width / zoom;
  let c0 = fc;
  while (c0 < geo.nCols - 1 && geo.colX[c0 + 1] <= viewL) c0++;
  c0 = Math.max(fc, c0 - 1);
  let c9 = c0;
  while (c9 < geo.nCols && geo.colX[c9] < viewL + viewW) c9++;
  // Merged blocks that start off-screen still need drawing.
  const visCols = Array.from({ length: Math.max(0, c9 - c0) }, (_, i) => c0 + i).filter((c) => !geo.hc.has(c));
  const frozenCols = Array.from({ length: fc }, (_, i) => i).filter((c) => !geo.hc.has(c));
  const lastFrozen = frozenCols[frozenCols.length - 1];
  const totalW = geo.colX[geo.nCols];
  const totalH = geo.tops[geo.tops.length - 1];
  const bodyTop0 = bodyStart >= 0 ? geo.tops[bodyStart] : totalH;
  const spillSrc = (r: number, c: number) => book.spillSource(si, r, c);
  const activeSpill = book.spillArray(si, sel.r, sel.c);
  const listRule = validationAt(sheet, sel.r, sel.c);

  function renderCell(r: number, c: number, sticky: boolean) {
    const m = mergeAt(r, c);
    const covered = m && (m.r1 !== r || m.c1 !== c);
    const width = m && !covered ? geo!.colX[m.c2 + 1] - geo!.colX[m.c1] : geo!.cw(c);
    const height = m && !covered ? Array.from({ length: m.r2 - m.r1 + 1 }, (_, i) => m.r1 + i).filter((x) => geo!.index.has(x)).reduce((s, x) => s + geo!.rh(x), 0) : geo!.rh(r);
    const isSel = sel.r === r && sel.c === c;
    const fm = fmtAt(r, c);
    const rawV = raw(r, c);
    const v = covered ? "" : ev(r, c);
    const look = covered ? null : cond(r, c);
    const tbl = tableAt(sheet!, r, c);
    const tl = tbl && !covered ? tableLook(tbl, r, c) : null;
    const shown = showFormulas && rawV.startsWith("=") ? { text: rawV, align: "left" as const, color: undefined, isNum: false } : covered ? { text: "", align: "left" as const, color: undefined, isNum: false } : cellText(v, rawV, fm);
    const links = typeof v === "string" && !covered ? findLinks(shown.text) : [];
    const align = fm?.align ?? shown.align;
    const spills = shown.text && !fm?.wrap && align === "left" && !raw(r, c + 1) && !mergeAt(r, c + 1) && !(spillSrc(r, c + 1));
    const style: React.CSSProperties = {
      width,
      height,
      ...(sticky ? { position: "sticky", left: HEAD_W + geo!.colX[c], zIndex: 2 } : {}),
      // Text running into empty cells to the right is drawn above them.
      ...(spills && !sticky ? { zIndex: 1 } : {}),
      // A merged block overlaps the covered cells after it instead of pushing them right.
      ...(m && !covered ? { zIndex: 1, marginRight: geo!.cw(c) - width } : {}),
      fontWeight: fm?.bold || look?.bold || (tl?.bold && fm?.bold !== false) ? 700 : undefined,
      fontStyle: fm?.italic ? "italic" : undefined,
      textDecoration: [fm?.underline && "underline", fm?.strike && "line-through"].filter(Boolean).join(" ") || undefined,
      fontFamily: fm?.font ? `"${fm.font}", Carlito, sans-serif` : undefined,
      fontSize: fm?.size ? fontPx(fm.size) : undefined,
      color: look?.color ?? shown.color ?? fm?.color ?? tl?.color,
      background: look?.bg ?? fm?.bg ?? tl?.bg ?? (sticky || (m && !covered) ? "#ffffff" : undefined),
      justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
      alignItems: fm?.valign === "top" ? "flex-start" : fm?.valign === "middle" ? "center" : "flex-end",
      whiteSpace: fm?.wrap ? "pre-wrap" : "pre",
      paddingLeft: fm?.indent ? 6 + fm.indent * 9 : undefined,
      overflow: spills && !isSel ? "visible" : undefined,
    };
    const cls = ["cell", inBox(range, r, c) && !isSel && "in", isSel && "sel", shown.isNum && "num", v instanceof FErr && "err", covered && "covered", fillTarget && inBox(fillTarget, r, c) && "filling", sheet!.showGrid === false && "nogrid", sticky && c === lastFrozen && "frz-edge"].filter(Boolean).join(" ");
    const border = fm?.border ?? (tl?.border ? { t: tl.border.t, b: tl.border.b } : undefined);
    const side = (b?: Border) => (b ? `${b.style === "thick" ? 3 : b.style === "medium" || b.style === "double" ? 2 : 1}px ${b.style === "dashed" ? "dashed" : b.style === "dotted" ? "dotted" : b.style === "double" ? "double" : "solid"} ${b.color}` : undefined);
    const editingHere = isSel && edit && !edit.fromBar;
    return (
      <div key={c} data-r={r} data-c={c} className={cls} style={style} title={sheet!.notes?.[key(r, c)] ?? (shown.text.length > 14 && !editingHere ? shown.text : undefined)}
        onMouseDown={(e) => onCellDown(e, r, c)}
        onMouseUp={onCellUp}
        onDoubleClick={() => startEdit(rawV)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "cell" }); }}
      >
        {look?.bar && <span className="cell-bar" style={{ width: `${Math.max(0, Math.min(1, look.bar.pct)) * 100}%`, background: `linear-gradient(90deg, ${look.bar.color}, ${look.bar.color}55)` }} />}
        {border && <span className="cell-border" style={{ borderTop: side(border.t), borderRight: side(border.r), borderBottom: side(border.b), borderLeft: side(border.l) }} />}
        {sheet!.notes?.[key(r, c)] && <span className="cell-note" />}
        {!covered && sheet!.sparklines?.[key(r, c)] && (() => {
          const sp = sheet!.sparklines![key(r, c)];
          return <SparklineSvg values={sparkValues(sp.range)} kind={sp.kind} color={sp.color} highLow={sp.highLow} w={width - 2} h={height - 2} />;
        })()}
        {editingHere ? (
          <textarea
            ref={(el) => {
              cellInput.current = el;
              if (el && document.activeElement !== el) {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
            className="cell-input"
            defaultValue={edit.value}
            rows={1}
            spellCheck={false}
            onInput={(e) => {
              const box = e.currentTarget;
              if (barInput.current) barInput.current.value = box.value;
              setEdit((x) => x && { ...x, value: box.value, caret: box.selectionStart ?? box.value.length });
              pointing.current = null;
            }}
            onSelect={(e) => { const caret = e.currentTarget.selectionStart ?? 0; setEdit((x) => x && { ...x, caret }); }}
            onKeyDown={(e) => onEditorKey(e, false)}
            onBlur={() => !canPoint() && finishEdit()}
          />
        ) : links.length ? (
          <span className="cell-link">{shown.text}</span>
        ) : (
          <span className="cell-text" style={fm?.rotate ? { transform: `rotate(${-fm.rotate}deg)` } : undefined}>{shown.text}</span>
        )}
        {isSel && !edit && links.length > 0 && range.r1 === range.r2 && range.c1 === range.c2 && (
          <span className="link-card" onMouseDown={(e) => e.stopPropagation()}>
            {links.slice(0, 3).map((l) => (
              <button key={l.index} title={`Open ${l.href.replace(/^mailto:/, "")}`} onClick={() => openLink(l.href)}>
                {l.href.startsWith("mailto:") ? <Mail /> : <ExternalLink />}
                <span>{l.text.replace(/^https?:\/\//, "")}</span>
              </button>
            ))}
          </span>
        )}
        {isSel && !edit && listRule?.type === "list" && (
          <button className="cell-drop" title="Choose from the list" aria-label="Choose from the list" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDropdown({ r, c, items: listItems(listRule, book!, si) }); }}><ChevronDown /></button>
        )}
        {r === range.r2 && c === range.c2 && !edit && <span className="fill-handle" title="Drag to fill" onMouseDown={startFill} onDoubleClick={fillDoubleClick} />}
        {((af && r === af.header && c >= af.c1 && c <= af.c2) || (tbl && tbl.header !== false && tbl.filter !== false && r === tbl.r1 && !(isSel && edit))) && (
          <button className={"af-btn" + (af && af.header === r && af.hide[c]?.length ? " on" : "")} title="Filter and sort" aria-label="Filter and sort" onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (tbl && r === tbl.r1 && (!af || af.header !== tbl.r1 || af.c1 !== tbl.c1)) setAf({ header: tbl.r1, c1: tbl.c1, c2: tbl.c2, r2: dataRows(tbl).d2, hide: {} });
            else if (tbl && af && af.header === tbl.r1) setAf({ ...af, c2: tbl.c2, r2: dataRows(tbl).d2 });
            setAfMenu(afMenu === c ? null : c);
          }}><Filter /></button>
        )}
        {isSel && !edit && tbl?.totals && r === tbl.r2 && c !== tbl.c1 && (
          <button className="cell-drop" title="Total" aria-label="Choose a total" onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const t = tbl;
            setDropdown({ r, c, items: TOTAL_FNS.map((x) => x.label), pick: (label) => {
              const code = TOTAL_FNS.find((x) => x.label === label)?.code ?? 0;
              commitValue(r, c, totalFormula(t, headerTexts(sheet!, t)[c - t.c1], code));
            } });
          }}><ChevronDown /></button>
        )}
      </div>
    );
  }

  function renderRow(r: number, top: number) {
    const h = geo!.rh(r);
    const inRows = r >= range.r1 && r <= range.r2;
    const gap = geo!.colX[visCols[0] ?? fc] - geo!.colX[fc];
    return (
      <div key={r} className="grid-row" style={{ top, height: h }}>
        <div className={"row-head" + (inRows ? " on" : "")} style={{ width: HEAD_W, height: h }}
          onMouseDown={(e) => {
            if (edit) finishEdit();
            if (!e.shiftKey) setAnchor({ r, c: 0 });
            setSel({ r, c: geo!.nCols - 1 });
          }}
          onContextMenu={(e) => { e.preventDefault(); if (!inRows) { setAnchor({ r, c: 0 }); setSel({ r, c: geo!.nCols - 1 }); } setMenu({ x: e.clientX, y: e.clientY, kind: "row" }); }}
        >
          {r + 1}
          <span className="row-resize" onMouseDown={(e) => startResize(e, "row", r)} onDoubleClick={() => updateSheet((s) => { const rowH = { ...(s.rowH ?? {}) }; delete rowH[r]; return { ...s, rowH }; })} />
        </div>
        {frozenCols.map((c) => renderCell(r, c, true))}
        {gap > 0 && <div style={{ width: gap, flex: "none" }} />}
        {visCols.map((c) => renderCell(r, c, false))}
      </div>
    );
  }

  const colHeads = (
    <div className="grid-head" style={{ width: HEAD_W + totalW }}>
      <div className="corner" style={{ width: HEAD_W }} onClick={() => { setAnchor({ r: 0, c: 0 }); setSel({ r: geo.nRows - 1, c: geo.nCols - 1 }); }} />
      {[...frozenCols, -1, ...visCols].map((c) =>
        c === -1 ? (
          <div key="gap" style={{ width: geo.colX[visCols[0] ?? fc] - geo.colX[fc], flex: "none" }} />
        ) : (
          <div
            key={c}
            className={"col-head" + (c >= range.c1 && c <= range.c2 ? " on" : "")}
            style={{ width: geo.cw(c), ...(c < fc ? { position: "sticky", left: HEAD_W + geo.colX[c], zIndex: 3 } : {}) }}
            onMouseDown={(e) => {
              if (edit) finishEdit();
              if (e.shiftKey) setSel({ r: geo.nRows - 1, c });
              else {
                setAnchor({ r: 0, c });
                setSel({ r: geo.nRows - 1, c });
              }
            }}
            onContextMenu={(e) => { e.preventDefault(); if (!(c >= range.c1 && c <= range.c2)) { setAnchor({ r: 0, c }); setSel({ r: geo.nRows - 1, c }); } setMenu({ x: e.clientX, y: e.clientY, kind: "col" }); }}
          >
            {colName(c)}
            <span className="col-resize" onMouseDown={(e) => startResize(e, "col", c)} onDoubleClick={() => updateSheet((s) => ({ ...s, colW: { ...(s.colW ?? {}), [c]: autofitCol(c) } }))} />
          </div>
        ),
      )}
    </div>
  );

  const barValue = edit ? edit.value : raw(sel.r, sel.c);
  const numFmtLabel = NUMBER_FORMATS.find((n) => n.code === (curFmt.num ?? formatOf(raw(sel.r, sel.c), curFmt) ?? "General"))?.label ?? (curFmt.num ? "Custom" : "General");
  const afValues = (c: number) => {
    if (!af) return [];
    const set = new Set<string>();
    for (let r = af.header + 1; r <= (af.r2 ?? cells.length - 1); r++) set.add(cellText(ev(r, c), raw(r, c), fmtAt(r, c)).text);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  return (
    <div className="app-page sheets">
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="sheets">
        <button className={showAi ? "on" : ""} title="Ask AI to fill in, calculate or explain (Groq)" aria-pressed={showAi} onClick={() => setShowAi(!showAi)}><Sparkles /> AI</button>
        <Menu label="Export">
          <button role="menuitem" onClick={exportXLSX}>Excel workbook (.xlsx)</button>
          <button role="menuitem" onClick={() => exportDelimited("csv")}>This sheet as CSV</button>
          <button role="menuitem" onClick={() => exportDelimited("tsv")}>This sheet as TSV</button>
          <button role="menuitem" onClick={exportJSON}>This sheet as JSON</button>
          <button role="menuitem" onClick={exportHTML}>Web page (.html)</button>
          <button role="menuitem" onClick={() => printSheet()}>Print or save as PDF (Ctrl+P)</button>
          <button role="menuitem" onClick={() => printSheet(true)}>Print the selection</button>
        </Menu>
      </TitleBar>

      <div className="toolbar sh-toolbar" onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}>
        <button title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} disabled={!history.current.undo.length}><Undo2 /></button>
        <button title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo} disabled={!history.current.redo.length}><Redo2 /></button>
        <button className={painter ? "on" : ""} title="Format painter: click, then select cells to copy this formatting. Double-click to keep it on." aria-label="Format painter"
          onClick={() => setPainter(painter ? null : { fmt: Array.from({ length: range.r2 - range.r1 + 1 }, (_, i) => Array.from({ length: range.c2 - range.c1 + 1 }, (_, j) => fmtAt(range.r1 + i, range.c1 + j))), keep: false })}
          onDoubleClick={() => setPainter({ fmt: [[fmtAt(sel.r, sel.c)]], keep: true })}
        ><Brush /></button>
        <span className="sep" />
        <Menu label={<span className="sh-numfmt">{numFmtLabel}</span>} align="left">
          {NUMBER_FORMATS.map((n) => (
            <button key={n.code} role="menuitem" onClick={() => patchFmt(fmtBox(), { num: n.code === "General" ? undefined : n.code })}>
              <span className="grow">{n.label}</span>
              <span className="muted small">{typeof ev(sel.r, sel.c) === "number" ? formatValue(ev(sel.r, sel.c) as number, n.code).text : ""}</span>
            </button>
          ))}
          <button role="menuitem" onClick={async () => {
            const code = await askText("Custom number format", { value: curFmt.num ?? "#,##0.00", label: "Excel format code, e.g. #,##0.00;[Red](#,##0.00) or dd/mm/yyyy", confirmLabel: "Apply" });
            if (code) patchFmt(fmtBox(), { num: code });
          }}>Custom format…</button>
        </Menu>
        <Menu label="$" align="left" className="sh-cur">
          {CURRENCIES.map((c) => <button key={c} role="menuitem" onClick={() => patchFmt(fmtBox(), { num: `${c}#,##0.00` })}>{c} {c === "$" ? "Dollar" : c === "€" ? "Euro" : c === "£" ? "Pound" : c === "¥" ? "Yen" : c === "₦" ? "Naira" : "Rupee"}</button>)}
        </Menu>
        <button title="Percent (Ctrl+Shift+%)" aria-label="Percent" onClick={() => patchFmt(fmtBox(), { num: "0%" })}>%</button>
        <button title="Thousands separator" aria-label="Thousands separator" onClick={() => patchFmt(fmtBox(), { num: "#,##0.00" })}>,</button>
        <button title="Fewer decimal places" aria-label="Fewer decimals" onClick={() => patchFmt(fmtBox(), (cur, r, c) => ({ ...cur, num: adjustDecimals(cur.num ?? formatOf(raw(r, c), cur), -1, typeof ev(r, c) === "number" ? (ev(r, c) as number) : 0) }))}>.0←</button>
        <button title="More decimal places" aria-label="More decimals" onClick={() => patchFmt(fmtBox(), (cur, r, c) => ({ ...cur, num: adjustDecimals(cur.num ?? formatOf(raw(r, c), cur), 1, typeof ev(r, c) === "number" ? (ev(r, c) as number) : 0) }))}>.00→</button>
        <span className="sep" />
        <select aria-label="Font" value={curFmt.font ?? "Calibri"} onChange={(e) => patchFmt(fmtBox(), { font: e.target.value === "Calibri" ? undefined : e.target.value })} style={{ width: 110 }}>
          {!FONTS.includes(curFmt.font ?? "Calibri") && <option value={curFmt.font}>{curFmt.font}</option>}
          {FONTS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Font size" value={curFmt.size ?? 11} onChange={(e) => patchFmt(fmtBox(), { size: Number(e.target.value) === 11 ? undefined : Number(e.target.value) })} style={{ width: 56 }}>
          {!SIZES.includes(curFmt.size ?? 11) && <option value={curFmt.size}>{curFmt.size}</option>}
          {SIZES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button className={curFmt.bold ? "on" : ""} title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => toggleFmt("bold")}><Bold /></button>
        <button className={curFmt.italic ? "on" : ""} title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => toggleFmt("italic")}><Italic /></button>
        <button className={curFmt.underline ? "on" : ""} title="Underline (Ctrl+U)" aria-label="Underline" onClick={() => toggleFmt("underline")}><Underline /></button>
        <button className={curFmt.strike ? "on" : ""} title="Strikethrough" aria-label="Strikethrough" onClick={() => toggleFmt("strike")}><Strikethrough /></button>
        <ColorMenu icon={<Baseline />} title="Text color" value={curFmt.color} onPick={(c) => patchFmt(fmtBox(), { color: c })} noneLabel="Automatic" />
        <ColorMenu icon={<PaintBucket />} title="Fill color" value={curFmt.bg} onPick={(c) => patchFmt(fmtBox(), { bg: c })} noneLabel="No fill" />
        <BorderMenu onPick={applyBorders} />
        <span className="sep" />
        <button className={curFmt.align === "left" ? "on" : ""} title="Align left" aria-label="Align left" onClick={() => patchFmt(fmtBox(), { align: curFmt.align === "left" ? undefined : "left" })}><AlignLeft /></button>
        <button className={curFmt.align === "center" ? "on" : ""} title="Center" aria-label="Center" onClick={() => patchFmt(fmtBox(), { align: curFmt.align === "center" ? undefined : "center" })}><AlignCenter /></button>
        <button className={curFmt.align === "right" ? "on" : ""} title="Align right" aria-label="Align right" onClick={() => patchFmt(fmtBox(), { align: curFmt.align === "right" ? undefined : "right" })}><AlignRight /></button>
        <Menu label={<FoldVertical />} align="left">
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { valign: "top" })}><ArrowUpToLine /> Top</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { valign: "middle" })}><FoldVertical /> Middle</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { valign: undefined })}><ArrowDownToLine /> Bottom</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), (cur) => ({ ...cur, indent: (cur.indent ?? 0) + 1 }))}>Increase indent</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), (cur) => ({ ...cur, indent: Math.max(0, (cur.indent ?? 0) - 1) || undefined }))}>Decrease indent</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { rotate: 90 })}>Rotate text up</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { rotate: 45 })}>Angle text 45°</button>
          <button role="menuitem" onClick={() => patchFmt(fmtBox(), { rotate: undefined })}>No rotation</button>
        </Menu>
        <button className={curFmt.wrap ? "on" : ""} title="Wrap text" aria-label="Wrap text" onClick={() => patchFmt(fmtBox(), { wrap: !curFmt.wrap || undefined })}><WrapText /></button>
        <Menu label={<Merge />} align="left">
          <button role="menuitem" onClick={() => merge("all")}>Merge and center</button>
          <button role="menuitem" onClick={() => merge("across")}>Merge across each row</button>
          <button role="menuitem" onClick={() => merge("none")}>Unmerge</button>
        </Menu>
        <span className="sep" />
        <button title="AutoSum (Alt+=)" aria-label="AutoSum" onClick={autoSum}><Sigma /></button>
        <button title="Insert function" aria-label="Insert function" onClick={() => setDialog("fx")}><i>fx</i></button>
        <button title="Insert a chart from the selection" aria-label="Insert chart" onClick={addChart}><BarChart3 /></button>
        <button className={af ? "on" : ""} title="Filter: add dropdowns to the header row" aria-label="Filter"
          onClick={() => {
            if (af) return setAf(null);
            const b = dataRegion();
            setAf({ header: b.r1, c1: b.c1, c2: b.c2, hide: {} });
          }}><Filter /></button>
        <button onClick={() => quickSort(false)} title={`Sort A–Z by column ${colName(sel.c)}`} aria-label="Sort A to Z"><ArrowDownAZ /></button>
        <button onClick={() => quickSort(true)} title={`Sort Z–A by column ${colName(sel.c)}`} aria-label="Sort Z to A"><ArrowDownZA /></button>
        {selTable && (
          <TableDesign
            key={selTable.name}
            table={selTable}
            onPatch={(patch) => updateSheet((s) => ({ ...s, tables: (s.tables ?? []).map((t) => (t.name === selTable.name ? { ...t, ...patch } : t)) }))}
            onRename={(name) => {
              const bad = badTableName(data, name, selTable.name);
              if (bad) return bad;
              commit(renameTable(data, selTable.name, name));
              return null;
            }}
            onTotals={(on) => commit(setTotals(data, si, selTable.name, on))}
            onResize={async () => {
              const r = await askText("Resize table", { value: rangeText(selTable.r1, selTable.c1, selTable.r2, selTable.c2), label: "New range for the table (the header row stays put)", confirmLabel: "Resize" });
              if (!r) return;
              const res = resizeTable(data, si, selTable.name, r.toUpperCase());
              if (typeof res === "string") toast(res, "error");
              else commit(res);
            }}
            onConvert={async () => {
              if (await askConfirm(`Convert ${selTable.name} to a normal range?`, { body: "Its look stays, and formulas that use the table switch to cell references.", confirmLabel: "Convert" })) commit(convertToRange(data, si, selTable.name));
            }}
            onSelect={() => { setAnchor({ r: selTable.r2, c: selTable.c2 }); setSel({ r: selTable.r1, c: selTable.c1 }); }}
            onPivot={() => setDialog({ pivot: selTable.name })}
          />
        )}
        <span className="sep" />
        <Menu label="Insert" align="left">
          <button role="menuitem" onClick={() => insertRows(true)}>Row above</button>
          <button role="menuitem" onClick={() => insertRows(false)}>Row below</button>
          <button role="menuitem" onClick={() => insertCols(true)}>Column left</button>
          <button role="menuitem" onClick={() => insertCols(false)}>Column right</button>
          <button role="menuitem" onClick={() => setDialog("table")}>Table… <span className="key">Ctrl T</span></button>
          <button role="menuitem" onClick={() => setDialog({ pivot: defaultPivotSource() })}>PivotTable…</button>
          <button role="menuitem" onClick={addChart}>Chart</button>
          <button role="menuitem" onClick={() => setDialog("spark")}>Sparklines…</button>
          <button role="menuitem" onClick={() => setDialog("fx")}>Function…</button>
          <button role="menuitem" onClick={async () => { const n = await askText("Note", { value: sheet.notes?.[key(sel.r, sel.c)] ?? "", confirmLabel: "Save" }); if (n !== null && n !== undefined) updateSheet((s) => { const notes = { ...(s.notes ?? {}) }; if (n) notes[key(sel.r, sel.c)] = n; else delete notes[key(sel.r, sel.c)]; return { ...s, notes }; }); }}>Note…</button>
          <button role="menuitem" onClick={() => addSheet()}>Sheet</button>
        </Menu>
        <Menu label="Data" align="left">
          <button role="menuitem" onClick={() => setDialog("sort")}>Sort range…</button>
          <button role="menuitem" onClick={() => setDialog("cond")}>Conditional formatting…</button>
          <button role="menuitem" onClick={() => setDialog("valid")}>Data validation…</button>
          <button role="menuitem" onClick={() => setDialog("names")}>Named ranges…</button>
          <button role="menuitem" onClick={refreshAllPivots}>Refresh all PivotTables</button>
          <button role="menuitem" onClick={removeDuplicates}>Remove duplicate rows</button>
          <button role="menuitem" onClick={trimSpaces}>Trim extra spaces</button>
          <button role="menuitem" onClick={splitColumn}>Split text to columns…</button>
          <button role="menuitem" onClick={() => changeCase("upper")}>UPPERCASE</button>
          <button role="menuitem" onClick={() => changeCase("lower")}>lowercase</button>
          <button role="menuitem" onClick={() => changeCase("proper")}>Proper Case</button>
        </Menu>
        <Menu label="View" align="left">
          <button role="menuitem" onClick={() => updateSheet((s) => ({ ...s, freeze: { r: 1, c: s.freeze?.c ?? 0 } }))}>Freeze top row</button>
          <button role="menuitem" onClick={() => updateSheet((s) => ({ ...s, freeze: { r: s.freeze?.r ?? 0, c: 1 } }))}>Freeze first column</button>
          <button role="menuitem" onClick={() => updateSheet((s) => ({ ...s, freeze: { r: sel.r, c: sel.c } }))}>Freeze above and left of {colName(sel.c)}{sel.r + 1}</button>
          <button role="menuitem" onClick={() => updateSheet((s) => ({ ...s, freeze: undefined }))}>Unfreeze</button>
          <button role="menuitem" onClick={() => updateSheet((s) => ({ ...s, showGrid: s.showGrid === false ? undefined : false }))}>{sheet.showGrid === false ? "Show gridlines" : "Hide gridlines"}</button>
          <button role="menuitem" onClick={() => setShowFormulas(!showFormulas)}>{showFormulas ? "Show values" : "Show formulas"} (Ctrl+`)</button>
          <button role="menuitem" onClick={autofitCols}>Autofit selected columns</button>
          <button role="menuitem" onClick={() => { hideRows(false); hideCols(false); }}>Unhide rows and columns in selection</button>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => <button key={z} role="menuitem" onClick={() => setZoom(z)}>{z === zoom ? "✓ " : ""}Zoom {z * 100}%</button>)}
        </Menu>
        <button title="Find and replace (Ctrl+F)" aria-label="Find" onClick={() => setFind({ replace: false })}><Search /></button>
        <span className="sep" />
        <input className="filter" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={() => importRef.current?.click()} title="Each sheet in the file becomes a new tab here">Add a file…</button>
        <input ref={importRef} type="file" hidden accept=".csv,.tsv,.xlsx,.xlsm,.xls,.ods" onChange={(e) => { const file = e.target.files?.[0]; if (file) importInto(file).catch((err) => toast(`Couldn’t import ${file.name}: ${errorText(err)}`, "error")); e.target.value = ""; }} />
      </div>

      {find && (
        <FindBar replaceMode={find.replace} count={findCount} onFind={findNext} onReplace={replaceOne} onReplaceAll={replaceAll} onClose={() => { setFind(null); grid.current?.focus(); }} />
      )}

      <div className="sheet-body">
        <div className="sheet-main">
          <div className="formula-bar">
            <input
              className="addr"
              aria-label="Name box"
              key={selText}
              defaultValue={selText}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = e.currentTarget.value.trim();
                const named = data.names?.[v] ?? Object.entries(data.names ?? {}).find(([n]) => n.toUpperCase() === v.toUpperCase())?.[1];
                const target = named ?? v;
                const sheetName = /^'?([^'!]+)'?!/.exec(target)?.[1];
                const b = parseRange(target);
                if (b) {
                  if (sheetName) {
                    const i = data.sheets.findIndex((s) => s.name.toLowerCase() === sheetName.toLowerCase());
                    if (i >= 0) setActive(i);
                  }
                  setAnchor({ r: b.r2, c: b.c2 });
                  setSel({ r: b.r1, c: b.c1 });
                  ensureVisible(b.r1, b.c1);
                } else if (/^[A-Za-z_][\w.]*$/.test(v)) {
                  commit({ ...data, names: { ...(data.names ?? {}), [v]: `${/\s/.test(sheet.name) ? `'${sheet.name}'` : sheet.name}!${selText.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}` } });
                  toast(`Named ${selText} “${v}”`, "success");
                } else toast("Type a cell like B4, a range like A1:C9, or a name", "error");
                grid.current?.focus();
              }}
            />
            <button className="fx" title="Insert function" onClick={() => setDialog("fx")}>fx</button>
            <div className="bar-wrap">
              <input
                ref={barInput}
                value={barValue}
                aria-label="Cell contents"
                spellCheck={false}
                onFocus={() => !edit && startEdit(raw(sel.r, sel.c), true)}
                onChange={(e) => setEdit({ value: e.target.value, fromBar: true, caret: e.target.selectionStart ?? e.target.value.length })}
                onSelect={(e) => edit && setEdit({ ...edit, caret: e.currentTarget.selectionStart ?? 0 })}
                onKeyDown={(e) => onEditorKey(e, true)}
                onBlur={() => edit?.fromBar && !canPoint() && finishEdit()}
              />
              {edit?.fromBar && (suggestions.length > 0 || inside) && <Suggest list={suggestions} active={suggest} inside={inside} onPick={acceptSuggestion} />}
            </div>
          </div>
          <div
            className={"grid" + (painter ? " painting" : "")}
            ref={grid}
            tabIndex={0}
            onKeyDown={onKey}
            onCopy={(e) => onCopy(e)}
            onCut={(e) => onCopy(e, true)}
            onPaste={onPaste}
            onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft, height: e.currentTarget.clientHeight, width: e.currentTarget.clientWidth })}
            onWheel={(e) => {
              if (!(e.ctrlKey || e.metaKey)) return;
              e.preventDefault();
              setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10)));
            }}
          >
            <div className="grid-inner" style={{ width: (HEAD_W + totalW) * zoom, height: (HEAD_H + totalH + 40) * zoom, zoom } as React.CSSProperties}>
              <div style={{ width: HEAD_W + totalW, height: HEAD_H + totalH + 40, position: "relative" }}>
                <div className="grid-sticky">
                  {colHeads}
                  {frozenRows.length > 0 && (
                    <div className="frozen-rows" style={{ height: frozenH, width: HEAD_W + totalW }}>
                      {frozenRows.map((r) => renderRow(r, geo.tops[geo.index.get(r)!]))}
                    </div>
                  )}
                </div>
                {visibleRows.map((r) => (r < fr ? null : renderRow(r, HEAD_H + frozenH + geo.tops[geo.index.get(r)!] - bodyTop0)))}
                {activeSpill && (() => {
                  const i = geo.index.get(sel.r);
                  if (i === undefined) return null;
                  const top = HEAD_H + (sel.r < fr ? geo.tops[i] : frozenH + geo.tops[i] - bodyTop0);
                  const h = Array.from({ length: activeSpill.rows }, (_, k) => sel.r + k).filter((x) => geo.index.has(x)).reduce((s, x) => s + geo.rh(x), 0);
                  return <div className="spill-outline" style={{ left: HEAD_W + geo.colX[sel.c], top, width: geo.colX[Math.min(geo.nCols, sel.c + activeSpill.cols)] - geo.colX[sel.c], height: h }} />;
                })()}
                {(sheet.charts ?? []).map((c) => {
                  const chart = chartData(c);
                  return (
                    <div key={c.id} className={"sh-chart" + (chartSel === c.id ? " on" : "")} style={{ left: HEAD_W + c.x, top: HEAD_H + c.y, width: c.w, height: c.h }}
                      onMouseDown={(e) => chartDrag(e, c, "move")}
                      onDoubleClick={() => setDialog({ chart: c.id })}
                    >
                      {chart && <SheetChartView model={chart} w={c.w - 16} h={c.h - 16} />}
                      {chartSel === c.id && (
                        <>
                          <button className="sh-chart-edit" onMouseDown={(e) => e.stopPropagation()} onClick={() => setDialog({ chart: c.id })}>Edit chart</button>
                          <span className="sh-chart-size" onMouseDown={(e) => chartDrag(e, c, "resize")} />
                        </>
                      )}
                    </div>
                  );
                })}
                {edit && !edit.fromBar && (suggestions.length > 0 || inside) && (() => {
                  const i = geo.index.get(sel.r);
                  if (i === undefined) return null;
                  const top = HEAD_H + (sel.r < fr ? geo.tops[i] : frozenH + geo.tops[i] - bodyTop0) + geo.rh(sel.r);
                  return <div style={{ position: "absolute", left: HEAD_W + geo.colX[sel.c], top, zIndex: 20 }}><Suggest list={suggestions} active={suggest} inside={inside} onPick={acceptSuggestion} /></div>;
                })()}
                {dropdown && (() => {
                  const i = geo.index.get(dropdown.r);
                  if (i === undefined) return null;
                  const top = HEAD_H + (dropdown.r < fr ? geo.tops[i] : frozenH + geo.tops[i] - bodyTop0) + geo.rh(dropdown.r);
                  return (
                    <div className="sh-dropdown pop" style={{ left: HEAD_W + geo.colX[dropdown.c], top, minWidth: geo.cw(dropdown.c) }}>
                      {dropdown.items.map((it) => <button key={it} onMouseDown={(e) => e.preventDefault()} onClick={() => { if (dropdown.pick) dropdown.pick(it); else commitValue(dropdown.r, dropdown.c, it); setDropdown(null); grid.current?.focus(); }}>{it}</button>)}
                      {!dropdown.items.length && <span className="muted small">No items</span>}
                    </div>
                  );
                })()}
                {af && afMenu !== null && (() => {
                  const i = geo.index.get(af.header);
                  const top = HEAD_H + (i === undefined ? 0 : af.header < fr ? geo.tops[i] + geo.rh(af.header) : frozenH + geo.tops[i] - bodyTop0 + geo.rh(af.header));
                  return (
                    <AutoFilterMenu
                      left={HEAD_W + geo.colX[afMenu]}
                      top={top}
                      values={afValues(afMenu)}
                      hidden={af.hide[afMenu] ?? []}
                      onSort={(desc) => { sortBy([{ col: afMenu, desc }], true, { r1: af.header, c1: af.c1, r2: af.r2 ?? cells.length - 1, c2: af.c2 }); setAfMenu(null); }}
                      onApply={(hidden) => { setAf({ ...af, hide: { ...af.hide, [afMenu]: hidden } }); setAfMenu(null); }}
                      onClose={() => setAfMenu(null)}
                    />
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="sheet-tabs">
            <Menu label={<Plus />} className="add" align="left">
              <button role="menuitem" onClick={() => addSheet()}>New sheet</button>
              {data.sheets.map((s, i) => (s.hidden ? <button key={i} role="menuitem" onClick={() => { updateSheet((x) => ({ ...x, hidden: undefined }), undefined, i); setActive(i); }}>Unhide “{s.name}”</button> : null))}
            </Menu>
            {data.sheets.map((s, i) =>
              s.hidden ? null : (
                <div key={i} className={"tab" + (i === si ? " on" : "")} style={s.tabColor ? ({ "--tab": s.tabColor } as React.CSSProperties) : undefined}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/x-forma-sheet", String(i))}
                  onDragOver={(e) => e.dataTransfer.types.includes("text/x-forma-sheet") && e.preventDefault()}
                  onDrop={(e) => { const from = Number(e.dataTransfer.getData("text/x-forma-sheet")); if (!isNaN(from)) moveTab(from, i); }}
                >
                  <button className="tab-name" onClick={() => { if (edit && canPoint()) return; setActive(i); }} onDoubleClick={() => renameTab(i)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "tab", tab: i }); }} title="Double-click to rename, right-click for more">
                    {s.name}
                  </button>
                </div>
              ),
            )}
            <span className="grow" />
            {stats && (
              <span className="stats">
                Sum <b>{display(stats.sum)}</b>&emsp;Average <b>{display(Number(stats.avg.toPrecision(10)))}</b>&emsp;Count <b>{stats.filled}</b>
                {stats.count > 0 && <>&emsp;Min <b>{display(stats.min)}</b>&emsp;Max <b>{display(stats.max)}</b></>}
              </span>
            )}
            {filter && <span className="stats">{geo.rows.length - 1} matching rows</span>}
            <span className="stats">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        {pivotHere && pivotSrc && pivotClosed !== pivotHere.id && !showAi && (
          <PivotPanel
            key={pivotHere.id}
            pivot={pivotHere}
            fields={typeof pivotSrc === "string" ? [] : pivotSrc.fields}
            dates={typeof pivotSrc === "string" ? new Set() : pivotSrc.dates}
            numeric={typeof pivotSrc === "string" ? new Set() : pivotSrc.numeric}
            items={(field) => pivotItems(data, si, pivotHere, field)}
            error={typeof pivotSrc === "string" ? pivotSrc : undefined}
            onChange={(p) => updatePivot(p)}
            onRefresh={() => updatePivot(pivotHere)}
            onClose={() => setPivotClosed(pivotHere.id)}
          />
        )}
        {showAi && (
          <AiPanel
            intro="I can fill in tables, write formulas, add totals and summaries, clean up or sort data, add sheets, and answer questions about the numbers. One Ctrl+Z undoes a whole answer."
            quick={["Add a total row under the data", "Summarize this sheet", "Sort by the second column, largest first", "Add a column with each row’s share of the total"]}
            placeholder="Ask AI about this spreadsheet…"
            onAsk={askAi}
            onClose={() => setShowAi(false)}
          />
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.kind === "tab" && menu.tab !== undefined ? (
            <>
              <button onClick={() => renameTab(menu.tab!)}>Rename</button>
              <button onClick={() => duplicateTab(menu.tab!)}>Duplicate</button>
              <button onClick={() => moveTab(menu.tab!, menu.tab! - 1)}>Move left</button>
              <button onClick={() => moveTab(menu.tab!, menu.tab! + 1)}>Move right</button>
              <button onClick={() => { if (data.sheets.filter((s) => !s.hidden).length > 1) { updateSheet((s) => ({ ...s, hidden: true }), undefined, menu.tab); setActive(data.sheets.findIndex((s, j) => j !== menu.tab && !s.hidden)); } else toast("A spreadsheet needs at least one visible sheet"); }}>Hide sheet</button>
              <div className="ctx-colors">
                {["#e06666", "#f6b26b", "#ffd966", "#93c47d", "#6fa8dc", "#8e7cc3", "#c27ba0"].map((c) => <button key={c} style={{ background: c }} title={`Tab color ${c}`} aria-label={`Tab color ${c}`} onClick={() => updateSheet((s) => ({ ...s, tabColor: c }), undefined, menu.tab)} />)}
                <button className="ctx-nocolor" title="No color" aria-label="No tab color" onClick={() => updateSheet((s) => ({ ...s, tabColor: undefined }), undefined, menu.tab)}><X /></button>
              </div>
              <button className="danger-text" onClick={() => removeTab(menu.tab!)}>Delete sheet</button>
            </>
          ) : (
            <>
              <button onClick={() => { const t = copy(true); navigator.clipboard?.writeText(t).catch(() => {}); }}>Cut <span className="key">Ctrl X</span></button>
              <button onClick={() => { const t = copy(false); navigator.clipboard?.writeText(t).catch(() => {}); }}>Copy <span className="key">Ctrl C</span></button>
              <button disabled={!clip} onClick={() => pasteClip("all")}>Paste <span className="key">Ctrl V</span></button>
              <button disabled={!clip} onClick={() => pasteClip("values")}>Paste values only</button>
              <button disabled={!clip} onClick={() => pasteClip("formats")}>Paste formatting only</button>
              <button disabled={!clip} onClick={() => pasteClip("transpose")}>Paste transposed</button>
              <hr />
              {menu.kind !== "col" && <><button onClick={() => insertRows(true)}>Insert row above</button><button onClick={() => insertRows(false)}>Insert row below</button><button onClick={deleteRows}>Delete row{range.r2 > range.r1 ? "s" : ""}</button></>}
              {menu.kind !== "row" && <><button onClick={() => insertCols(true)}>Insert column left</button><button onClick={() => insertCols(false)}>Insert column right</button><button onClick={deleteCols}>Delete column{range.c2 > range.c1 ? "s" : ""}</button></>}
              {menu.kind === "row" && <><button onClick={() => hideRows(true)}>Hide rows <span className="key">Ctrl 9</span></button><button onClick={() => hideRows(false)}>Unhide rows</button><button onClick={async () => { const h = await askText("Row height (pixels)", { value: String(geo.rh(range.r1)), confirmLabel: "Set" }); if (h && Number(h) > 0) updateSheet((s) => { const rowH = { ...(s.rowH ?? {}) }; for (let r = range.r1; r <= range.r2; r++) rowH[r] = Number(h); return { ...s, rowH }; }); }}>Row height…</button></>}
              {menu.kind === "col" && <><button onClick={() => hideCols(true)}>Hide columns <span className="key">Ctrl 0</span></button><button onClick={() => hideCols(false)}>Unhide columns</button><button onClick={async () => { const w = await askText("Column width (pixels)", { value: String(geo.cw(range.c1)), confirmLabel: "Set" }); if (w && Number(w) > 0) updateSheet((s) => { const colW = { ...(s.colW ?? {}) }; for (let c = range.c1; c <= range.c2; c++) colW[c] = Number(w); return { ...s, colW }; }); }}>Column width…</button><button onClick={autofitCols}>Autofit width</button></>}
              <hr />
              <button onClick={() => clearBox("contents")}>Clear contents <span className="key">Del</span></button>
              <button onClick={() => clearBox("formats")}>Clear formatting</button>
              <button onClick={() => quickSort(false)}>Sort A → Z</button>
              <button onClick={() => quickSort(true)}>Sort Z → A</button>
              <button onClick={async () => { const n = await askText("Note", { value: sheet.notes?.[key(sel.r, sel.c)] ?? "", confirmLabel: "Save" }); if (n !== null && n !== undefined) updateSheet((s) => { const notes = { ...(s.notes ?? {}) }; if (n) notes[key(sel.r, sel.c)] = n; else delete notes[key(sel.r, sel.c)]; return { ...s, notes }; }); }}>{sheet.notes?.[key(sel.r, sel.c)] ? "Edit note…" : "Insert note…"}</button>
              <button onClick={() => setDialog("cond")}>Conditional formatting…</button>
              <button onClick={() => setDialog("valid")}>Data validation…</button>
            </>
          )}
        </ContextMenu>
      )}

      {dialog === "table" && (
        <CreateTableDialog
          range={(() => { const b = dataRegion(); return rangeText(b.r1, b.c1, b.r2, b.c2); })()}
          onCreate={(r, header) => {
            const b = parseRange(r);
            if (!b) return "Type a range like A1:D20.";
            const res = createTable(data, si, b, header);
            if (typeof res === "string") return res;
            commit(res);
            if (af) setAf(null);
            return null;
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {typeof dialog === "object" && dialog && "pivot" in dialog && <CreatePivotDialog source={dialog.pivot} onCreate={createPivot} onClose={() => setDialog(null)} />}
      {dialog === "spark" && (() => {
        const existing = sheet.sparklines?.[key(sel.r, sel.c)];
        const b = dataRegion();
        const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
        const dataGuess = existing?.range ?? rangeText(b.r1 + (typeof ev(b.r1, b.c2) === "string" ? 1 : 0), b.c1 + (typeof ev(b.r2, b.c1) === "string" ? 1 : 0), b.r2, b.c2);
        const locGuess = multi ? selText : rangeText(sel.r, sel.c, sel.r, sel.c);
        return (
          <SparklineDialog
            data={dataGuess}
            location={locGuess}
            onSave={saveSparklines}
            onRemove={(loc) => {
              const L = parseRange(loc);
              if (!L) return;
              updateSheet((s) => {
                const sparklines = { ...(s.sparklines ?? {}) };
                for (let r = L.r1; r <= L.r2; r++) for (let cc = L.c1; cc <= L.c2; cc++) delete sparklines[key(r, cc)];
                return { ...s, sparklines };
              });
            }}
            onClose={() => setDialog(null)}
          />
        );
      })()}
      {dialog === "cond" && <CondDialog rules={sheet.cond ?? []} selection={selText} onSave={(rules) => updateSheet((s) => ({ ...s, cond: rules }))} onClose={() => setDialog(null)} />}
      {dialog === "valid" && (
        <ValidDialog
          rule={validationAt(sheet, sel.r, sel.c)}
          selection={selText}
          onSave={(v) => updateSheet((s) => ({ ...s, valid: [...(s.valid ?? []).filter((x) => x.id !== v.id), v] }))}
          onRemove={() => { const v = validationAt(sheet, sel.r, sel.c); if (v) updateSheet((s) => ({ ...s, valid: (s.valid ?? []).filter((x) => x.id !== v.id) })); }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "sort" && (() => {
        const b = dataRegion();
        return <SortDialog range={b} headers={Array.from({ length: b.c2 - b.c1 + 1 }, (_, i) => cellText(ev(b.r1, b.c1 + i), raw(b.r1, b.c1 + i)).text)} onSort={(keys, hdr) => sortBy(keys, hdr, b)} onClose={() => setDialog(null)} />;
      })()}
      {dialog === "names" && <NamesDialog names={data.names ?? {}} selection={`${/\s/.test(sheet.name) ? `'${sheet.name}'` : sheet.name}!${selText.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`} onSave={(names) => commit({ ...data, names })} onClose={() => setDialog(null)} />}
      {dialog === "fx" && (
        <FunctionPicker
          onPick={(name) => {
            if (edit) {
              const v = editText();
              const next = (v.startsWith("=") ? v : "=" + v) + name + "(";
              setEdit({ ...edit, value: next, caret: next.length });
              const box = edit.fromBar ? barInput.current : cellInput.current;
              if (box) box.value = next;
            } else startEdit(`=${name}(`);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {typeof dialog === "object" && dialog && "chart" in dialog && (() => {
        const c = sheet.charts?.find((x) => x.id === dialog.chart);
        if (!c) return null;
        return <ChartDialog chart={c} preview={chartData} onSave={(n) => updateSheet((s) => ({ ...s, charts: (s.charts ?? []).map((x) => (x.id === n.id ? n : x)) }))} onDelete={() => updateSheet((s) => ({ ...s, charts: (s.charts ?? []).filter((x) => x.id !== c.id) }))} onClose={() => setDialog(null)} />;
      })()}
    </div>
  );
}

function Suggest({ list, active, inside, onPick }: { list: string[]; active: number; inside?: string; onPick: (n: string) => void }) {
  return (
    <div className="sh-suggest pop" onMouseDown={(e) => e.preventDefault()}>
      {list.map((n, i) => (
        <button key={n} className={i === active ? "on" : ""} onClick={() => onPick(n)}>
          <b>{n}</b>
          {SIGNATURES[n] && <span className="muted small">({SIGNATURES[n]})</span>}
        </button>
      ))}
      {!list.length && inside && (
        <div className="sh-sig">
          <b>{inside}</b>({SIGNATURES[inside] ?? "…"})
        </div>
      )}
      {list.length > 0 && <div className="sh-sig muted small">Tab to insert</div>}
    </div>
  );
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", close);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx-menu pop" style={{ left: pos.x, top: pos.y }} role="menu" onClick={(e) => (e.target as HTMLElement).closest("button:not(.ctx-colors button)") && onClose()}>
      {children}
    </div>
  );
}

function AutoFilterMenu({ left, top, values, hidden, onSort, onApply, onClose }: { left: number; top: number; values: string[]; hidden: string[]; onSort: (desc: boolean) => void; onApply: (hidden: string[]) => void; onClose: () => void }) {
  const [off, setOff] = useState(new Set(hidden));
  const [q, setQ] = useState("");
  const shown = values.filter((v) => v.toLowerCase().includes(q.toLowerCase()));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".af-btn") && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", close, true);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", close, true);
      removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="sh-af pop" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
      <button onClick={() => onSort(false)}><ArrowDownAZ /> Sort A → Z</button>
      <button onClick={() => onSort(true)}><ArrowDownZA /> Sort Z → A</button>
      <hr />
      <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="sh-af-row">
        <button className="link" onClick={() => setOff(new Set())}>Select all</button>
        <button className="link" onClick={() => setOff(new Set(values))}>Clear</button>
      </div>
      <div className="sh-af-list">
        {shown.map((v) => (
          <label key={v} className="check">
            <input type="checkbox" checked={!off.has(v)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(v); else n.add(v); setOff(n); }} />
            <span>{v === "" ? "(Blanks)" : v}</span>
          </label>
        ))}
      </div>
      <div className="sh-af-row">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onApply([...off])}>OK</button>
      </div>
    </div>
  );
}
