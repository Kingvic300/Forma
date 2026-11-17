// A sheet as an HTML table with its formatting, for printing (and Save as PDF) and HTML export.
import { Book } from "./formula";
import { makeCondEval } from "./rules";
import { cellText } from "./view";
import type { Sheet } from "./types";
import { key } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sheetHtml(sheet: Sheet, book: Book, si: number, opts: { gridlines?: boolean; range?: { r1: number; c1: number; r2: number; c2: number } } = {}) {
  const rows = sheet.cells.length;
  const cols = Math.max(0, ...sheet.cells.map((r) => r?.length ?? 0), ...Object.keys(sheet.fmt ?? {}).map((k) => Number(k.split(",")[1]) + 1));
  const b = opts.range ?? { r1: 0, c1: 0, r2: rows - 1, c2: cols - 1 };
  const hiddenR = new Set(sheet.hiddenRows), hiddenC = new Set(sheet.hiddenCols);
  const cond = makeCondEval(sheet, book, si);
  const covered = new Set<string>();
  const spans = new Map<string, [number, number]>();
  for (const m of sheet.merges ?? []) {
    spans.set(key(m.r1, m.c1), [m.r2 - m.r1 + 1, m.c2 - m.c1 + 1]);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(key(r, c));
  }
  const grid = opts.gridlines !== false ? "1px solid #d4d4d4" : "none";
  let html = `<table style="border-collapse:collapse;table-layout:fixed;font:11pt Calibri,Carlito,Arial,sans-serif">`;
  html += "<colgroup>";
  for (let c = b.c1; c <= b.c2; c++) if (!hiddenC.has(c)) html += `<col style="width:${sheet.colW?.[c] ?? 100}px">`;
  html += "</colgroup>";
  for (let r = b.r1; r <= b.r2; r++) {
    if (hiddenR.has(r)) continue;
    html += `<tr style="height:${sheet.rowH?.[r] ?? 24}px">`;
    for (let c = b.c1; c <= b.c2; c++) {
      if (hiddenC.has(c) || covered.has(key(r, c))) continue;
      const f = sheet.fmt?.[key(r, c)] ?? {};
      const raw = sheet.cells[r]?.[c] ?? "";
      const v = book.value(si, r, c);
      const { text, color, align } = cellText(v, raw, f);
      const look = cond(r, c);
      const st: string[] = [`border:${grid}`, "padding:2px 4px", "overflow:hidden", f.wrap ? "white-space:pre-wrap" : "white-space:nowrap"];
      if (f.bold || look?.bold) st.push("font-weight:700");
      if (f.italic) st.push("font-style:italic");
      if (f.underline || f.strike) st.push(`text-decoration:${[f.underline && "underline", f.strike && "line-through"].filter(Boolean).join(" ")}`);
      if (f.font) st.push(`font-family:'${f.font}'`);
      if (f.size) st.push(`font-size:${f.size}pt`);
      const col = look?.color ?? color ?? f.color;
      if (col) st.push(`color:${col}`);
      const bg = look?.bg ?? f.bg;
      if (bg) st.push(`background:${bg}`);
      st.push(`text-align:${f.align ?? align}`);
      st.push(`vertical-align:${f.valign === "top" ? "top" : f.valign === "middle" ? "middle" : "bottom"}`);
      const side = (x?: { color: string; style: string }) => (x ? `${x.style === "thick" ? 3 : x.style === "medium" ? 2 : x.style === "double" ? 3 : 1}px ${x.style === "dashed" ? "dashed" : x.style === "dotted" ? "dotted" : x.style === "double" ? "double" : "solid"} ${x.color}` : null);
      const t = side(f.border?.t), rr = side(f.border?.r), bb = side(f.border?.b), l = side(f.border?.l);
      if (t) st.push(`border-top:${t}`);
      if (rr) st.push(`border-right:${rr}`);
      if (bb) st.push(`border-bottom:${bb}`);
      if (l) st.push(`border-left:${l}`);
      const span = spans.get(key(r, c));
      html += `<td${span ? ` rowspan="${span[0]}" colspan="${span[1]}"` : ""} style="${st.join(";")}">${esc(text)}</td>`;
    }
    html += "</tr>";
  }
  return html + "</table>";
}

export function printHtml(title: string, body: string, landscape = false) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:${landscape ? "landscape" : "portrait"};margin:12mm}body{margin:0;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font:600 13pt sans-serif;margin:0 0 8px}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 200);
}

