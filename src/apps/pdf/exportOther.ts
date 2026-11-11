import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun as DocxRun,
  WidthType,
  type FileChild,
} from "docx";
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPdf, type Box, type Rasterize } from "./exportPdf";
import { isBoldName } from "./fonts";
import { blockAt, pageText, type TextRun } from "./text";
import { colsOf, HEAD_FILL, rowsOf, type Ann, type PdfData } from "./types";

/** Formats the PDF can be downloaded as, besides PDF itself. */
export type OtherFormat = "docx" | "png" | "txt";

type Para = { kind: "para"; y: number; bottom: number; x: number; text: string; size: number; bold: boolean; color?: string; center: boolean };
type Item = Para | { kind: "table"; y: number; bottom: number; ann: Ann } | { kind: "image"; y: number; bottom: number; ann: Ann };
type PageContent = { index: number; w: number; h: number; left: number; items: Item[] };

const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (px: number, py: number, b: Box) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;

/**
 * The page's words as paragraphs, plus what was added in Forma (text, tables, pictures, marks), top to bottom.
 * Words under white-out are left out; anything touching a black-out box is dropped completely.
 */
async function pageContent(doc: PDFDocumentProxy, index: number, anns: Ann[]): Promise<PageContent> {
  const page = await doc.getPage(index + 1);
  const { width: w, height: h } = page.getViewport({ scale: 1 });
  const redact = anns.filter((a) => a.type === "redact");
  const white = anns.filter((a) => a.type === "whiteout");
  const gone = (b: Box) => redact.some((r) => hits(b, r));

  const all = await pageText(doc, index);
  const fontNames = new Map<string, string>();
  try {
    await page.getOperatorList(); // loads the fonts so their names (and so their weight) are known
    for (const r of all) if (page.commonObjs.has(r.fontName)) fontNames.set(r.fontName, page.commonObjs.get(r.fontName)?.name ?? "");
  } catch {
    // Weight is only a nicety.
  }
  const runs = all.filter((r) => !gone({ x: r.x, y: r.top, w: r.w, h: r.h }) && !white.some((b) => inside(r.x + r.w / 2, r.top + r.h / 2, b)));

  const items: Item[] = [];
  const seen = new Set<TextRun>();
  for (const r of runs) {
    if (seen.has(r)) continue;
    const b = blockAt(runs, r);
    b.runs.forEach((x) => seen.add(x));
    const text = b.lines
      .map((line) => line.reduce((t, x, i) => t + (b.gapBefore(line, i) && !/\s$/.test(t) && !/^\s/.test(x.str) ? " " : "") + x.str, ""))
      .reduce((t, l) => (!t ? l : /-$/.test(t) && /^[a-z]/.test(l) ? t.slice(0, -1) + l : `${t} ${l}`), "");
    items.push({
      kind: "para", y: b.box.y, bottom: b.box.y + b.box.h, x: b.box.x, text, size: r.size,
      bold: b.runs.every((x) => isBoldName(fontNames.get(x.fontName) ?? "")),
      center: Math.abs(b.box.x + b.box.w / 2 - w / 2) < 6 && b.box.w < w * 0.7,
    });
  }
  for (const a of anns) {
    if (a.type === "redact" || a.type === "whiteout") continue;
    const box = { x: a.x, y: a.y, w: Math.max(a.w, 1), h: Math.max(a.h, (a.size ?? 14) * 1.2) };
    if (a.type === "table") {
      // Black-out over part of a table empties the cells it touches.
      const cw = colsOf(a).map((f) => f * a.w);
      const rh = rowsOf(a).map((f) => f * a.h);
      let y = a.y;
      const cells = (a.cells ?? []).map((row, r) => {
        let x = a.x;
        const out = row.map((t, k) => (gone({ x: (x += cw[k]) - cw[k], y, w: cw[k], h: rh[r] }) ? "" : t));
        y += rh[r];
        return out;
      });
      items.push({ kind: "table", y: a.y, bottom: a.y + a.h, ann: { ...a, cells } });
      continue;
    }
    if (gone(box)) continue;
    if (a.type === "image" && a.src) items.push({ kind: "image", y: a.y, bottom: a.y + a.h, ann: a });
    if (a.type === "check" || a.type === "cross")
      items.push({ kind: "para", y: a.y, bottom: a.y + a.h, x: a.x, text: a.type === "check" ? "✓" : "✗", size: a.h * 0.8, bold: false, color: a.color, center: false });
    if (a.type === "text" && (a.text ?? "").trim()) {
      const lines = (a.text ?? "").split("\n");
      const size = a.size ?? 14;
      items.push({ kind: "para", y: a.y, bottom: a.y + lines.length * (a.lead ?? size * 1.2), x: a.x, text: a.text!, size, bold: !!a.bold, color: a.color, center: false });
    }
  }
  items.sort((p, q) => p.y - q.y || ("x" in p && "x" in q ? p.x - q.x : 0));
  const xs = items.map((i) => ("x" in i ? i.x : i.ann.x));
  return { index, w, h, left: xs.length ? Math.max(18, Math.min(...xs)) : 72, items };
}

async function allPages(data: PdfData, doc: PDFDocumentProxy) {
  const out: PageContent[] = [];
  for (let i = 0; i < doc.numPages; i++) out.push(await pageContent(doc, i, data.anns.filter((a) => a.page === i)));
  return out;
}

const pt = (v: number) => Math.round(v * 20); // points to twentieths of a point
const halfPt = (v: number) => Math.max(2, Math.round(v * 2));
const docxColor = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) && c.toLowerCase() !== "#000000" ? c.slice(1) : undefined);

function docxTable(a: Ann) {
  const cw = colsOf(a).map((f) => f * a.w);
  const rh = rowsOf(a).map((f) => f * a.h);
  const size = a.size ?? 10;
  const thick = a.thick ?? 1;
  const color = docxColor(a.color) ?? "000000";
  const line = thick > 0 ? { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(thick * 8)), color } : { style: BorderStyle.NONE, size: 0, color };
  return new Table({
    columnWidths: cw.map(pt),
    width: { size: pt(a.w), type: WidthType.DXA },
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: (a.cells ?? []).map((row, r) => {
      const head = !!a.head && r === 0;
      return new TableRow({
        tableHeader: head,
        height: { value: pt(rh[r]), rule: "atLeast" },
        children: row.map((t, k) =>
          new TableCell({
            width: { size: pt(cw[k]), type: WidthType.DXA },
            shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: HEAD_FILL.slice(1) } : undefined,
            margins: { top: 40, bottom: 40, left: 60, right: 60 },
            children: t.split("\n").map((l) => new Paragraph({ children: [new DocxRun({ text: l, bold: head, size: halfPt(size), color: docxColor(a.color) })] })),
          }),
        ),
      });
    }),
  });
}

const dataUrlBytes = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));

/**
 * A Word file with the PDF's words as editable paragraphs and Forma tables as real Word tables, one
 * section per page. Pages with no words (scans, or pages flattened by black-out) come in as pictures.
 */
async function toDocx(data: PdfData, doc: PDFDocumentProxy, rasterize: Rasterize) {
  const pages = await allPages(data, doc);
  let flat: Uint8Array | null = null; // the finished PDF, only built if some page needs a picture
  const sections = [];
  for (const p of pages) {
    const margin = Math.min(p.left, 72);
    const children: FileChild[] = [];
    if (!p.items.some((i) => i.kind === "para")) {
      flat ??= await buildPdf(data, rasterize);
      const img = await rasterize(flat, p.index, []);
      const maxW = p.w - margin * 2;
      const k = Math.min(1, maxW / img.width, (p.h - margin * 2) / img.height);
      children.push(new Paragraph({ children: [new ImageRun({ type: "png", data: img.png, transformation: { width: (img.width * k * 96) / 72, height: (img.height * k * 96) / 72 } })] }));
      p.items = p.items.filter((i) => i.kind === "table"); // pictured already, except tables which stay editable
    }
    let prev = margin;
    for (const it of p.items) {
      const before = pt(Math.min(36, Math.max(0, it.y - prev - 2)));
      prev = Math.max(prev, it.bottom);
      if (it.kind === "table") {
        children.push(new Paragraph({ spacing: { before, after: 0 }, children: [] }), docxTable(it.ann));
      } else if (it.kind === "image") {
        const a = it.ann;
        children.push(
          new Paragraph({
            spacing: { before },
            indent: { left: pt(Math.max(0, a.x - margin)) },
            children: [new ImageRun({ type: "png", data: dataUrlBytes(a.src!), transformation: { width: (a.w * 96) / 72, height: (a.h * 96) / 72 } })],
          }),
        );
      } else {
        children.push(
          new Paragraph({
            spacing: { before, after: 0 },
            alignment: it.center ? AlignmentType.CENTER : AlignmentType.LEFT,
            indent: it.center ? undefined : { left: pt(Math.max(0, it.x - margin)) },
            children: it.text.split("\n").map((l, i) => new DocxRun({ text: l, break: i ? 1 : undefined, bold: it.bold, size: halfPt(it.size), color: docxColor(it.color) })),
          }),
        );
      }
    }
    if (!children.length) children.push(new Paragraph({ children: [] }));
    sections.push({
      properties: { page: { size: { width: pt(p.w), height: pt(p.h) }, margin: { top: pt(margin), bottom: pt(margin), left: pt(margin), right: pt(margin) } } },
      children,
    });
  }
  const file = new Document({ styles: { default: { document: { run: { font: "Calibri" } } } }, sections });
  return new Uint8Array(await (await Packer.toBlob(file)).arrayBuffer());
}

/** The words of every page, with tables as tab-separated rows. */
async function toText(data: PdfData, doc: PDFDocumentProxy) {
  const pages = await allPages(data, doc);
  return pages
    .map((p) =>
      p.items
        .map((it) => (it.kind === "para" ? it.text : it.kind === "table" ? (it.ann.cells ?? []).map((r) => r.map((c) => c.replace(/\s*\n\s*/g, " ")).join("\t")).join("\n") : ""))
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n\f");
}

/** Every page as a PNG picture with all edits burned in; several pages come zipped. */
async function toPng(data: PdfData, rasterize: Rasterize, base: string) {
  const flat = await buildPdf(data, rasterize);
  const { PDFDocument } = await import("pdf-lib");
  const n = (await PDFDocument.load(flat, { ignoreEncryption: true })).getPageCount();
  if (n === 1) return { name: `${base}.png`, bytes: (await rasterize(flat, 0, [])).png };
  const zip = new JSZip();
  const digits = String(n).length;
  for (let i = 0; i < n; i++) zip.file(`${base} - page ${String(i + 1).padStart(digits, "0")}.png`, (await rasterize(flat, i, [])).png);
  return { name: `${base} (pages).zip`, bytes: await zip.generateAsync({ type: "uint8array" }) };
}

export async function exportAs(format: OtherFormat, data: PdfData, doc: PDFDocumentProxy, rasterize: Rasterize, base: string): Promise<{ name: string; bytes: Uint8Array | string }> {
  if (format === "docx") return { name: `${base}.docx`, bytes: await toDocx(data, doc, rasterize) };
  if (format === "txt") return { name: `${base}.txt`, bytes: await toText(data, doc) };
  return toPng(data, rasterize, base);
}
