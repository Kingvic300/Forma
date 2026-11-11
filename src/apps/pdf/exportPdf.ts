import fontkit from "@pdf-lib/fontkit";
import { degrees, LineCapStyle, popGraphicsState, PDFArray, pushGraphicsState, setLineWidth, setStrokingRgbColor, setTextRenderingMode, TextRenderingMode, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFRadioGroup, PDFRef, PDFStream, PDFTextField, rgb, type PDFFont, type PDFObject } from "pdf-lib";
import { fontBytes } from "./fonts";
import { arrowHead, CELL_PAD, cellBaseline, colsOf, dashArray, HEAD_FILL, lineEnds, rowsOf, type Ann, type Font, type PdfData, type Span } from "./types";

const hex = (h = "#000000") => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Lines of the annotation as weighted pieces. */
const linesOf = (a: Ann): Span[][] => a.spans ?? (a.text ?? "").split("\n").map((t) => [{ t, b: a.bold }]);

/** Break text into lines no wider than `max`, at spaces where possible, like CSS pre-wrap with overflow-wrap: anywhere. */
export function wrap(text: string, max: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (let w of para.match(/\S+\s*|\s+/g) ?? []) {
      if (width((line + w).trimEnd()) <= max) {
        line += w;
        continue;
      }
      if (line) out.push(line.trimEnd());
      // A word wider than the cell breaks between letters.
      while (w.length > 1 && width(w.trimEnd()) > max) {
        let n = 1;
        while (n < w.length && width(w.slice(0, n + 1)) <= max) n++;
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface FieldInfo {
  name: string;
  kind: "text" | "check" | "choice";
  value: string | boolean;
  options?: string[];
}

export async function readFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getForm().getFields().flatMap((f): FieldInfo[] => {
      const name = f.getName();
      if (f instanceof PDFTextField) return [{ name, kind: "text", value: f.getText() ?? "" }];
      if (f instanceof PDFCheckBox) return [{ name, kind: "check", value: f.isChecked() }];
      if (f instanceof PDFDropdown) return [{ name, kind: "choice", value: f.getSelected()[0] ?? "", options: f.getOptions() }];
      if (f instanceof PDFRadioGroup) return [{ name, kind: "choice", value: f.getSelected() ?? "", options: f.getOptions() }];
      return [];
    });
  } catch {
    return [];
  }
}

export type Box = { x: number; y: number; w: number; h: number };

/** Draws one page (with its form values) to a PNG and paints the boxes black. Supplied by the UI. */
export type Rasterize = (bytes: Uint8Array, page: number, boxes: Box[]) => Promise<{ png: Uint8Array; width: number; height: number }>;

/** Burn annotations and form values into a new PDF. Redactions need a page renderer. */
export async function buildPdf(data: PdfData, rasterize?: Rasterize): Promise<Uint8Array> {
  let pdf = await PDFDocument.load(data.bytes, { ignoreEncryption: true });

  if (Object.keys(data.fields).length) {
    const form = pdf.getForm();
    for (const [name, v] of Object.entries(data.fields)) {
      try {
        const f = form.getField(name);
        if (f instanceof PDFTextField) f.setText(String(v));
        else if (f instanceof PDFCheckBox) v ? f.check() : f.uncheck();
        else if (f instanceof PDFDropdown && v) f.select(String(v));
        else if (f instanceof PDFRadioGroup && v) f.select(String(v));
      } catch {
        // A field that can't take the value is left as it was.
      }
    }
  }

  const redactions = data.anns.filter((a) => a.type === "redact");
  if (redactions.length) {
    if (!rasterize) throw new Error("Redaction needs a page renderer");
    pdf = await applyRedactions(pdf, redactions, rasterize);
  }

  pdf.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  const font = async (f: Font = "helv", bold = false) => {
    const k = f + bold;
    if (!fonts.has(k)) fonts.set(k, await pdf.embedFont(await fontBytes(f, bold), {
          // Full font (pdf-lib subsetting drops glyphs) and no ligatures (pdf-lib mis-spaces them).
          features: { liga: false, clig: false, dlig: false, calt: false },
        }));
    return fonts.get(k)!;
  };
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

  for (const a of data.anns) {
    const page = pdf.getPage(a.page);
    if (!page) continue;
    const box = page.getCropBox();
    const X = (x: number) => box.x + x;
    const Y = (y: number) => box.y + box.height - y; // flip: PDF origin is bottom-left
    // Boxes, images and marks can be turned about their centre (clockwise on screen).
    const rot = a.type === "redact" || a.type === "text" || a.type === "line" || a.type === "table" ? 0 : a.rot ?? 0;
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const sin = Math.sin((rot * Math.PI) / 180);
    const cos = Math.cos((rot * Math.PI) / 180);
    /** A point in the unturned box, as a PDF point after turning. */
    const pt = (px: number, py: number) => ({ x: X(cx + (px - cx) * cos - (py - cy) * sin), y: Y(cy + (px - cx) * sin + (py - cy) * cos) });
    const corner = { ...pt(a.x, a.y + a.h), rotate: degrees(-rot) }; // bottom-left corner
    draw(a);

    async function drawText(a: Ann) {
      const size = a.size ?? 14;
      const bl = a.bl ?? size * 0.93;
      const lead = a.lead ?? size * 1.2;
      const lines = linesOf(a);
      for (let i = 0; i < lines.length; i++) {
        let x = X(a.x);
        for (const span of lines[i]) {
          if (!span.t) continue;
          const f = await font(a.font, !!span.b);
          // Leading spaces are dropped by drawText, so step over them explicitly.
          const lead0 = span.t.match(/^\s*/)![0];
          x += f.widthOfTextAtSize(lead0, size);
          const t = span.t.slice(lead0.length);
          if (t && a.stroke) {
            // Thicker text: fill each letter and stroke its outline in the same colour.
            const c = hex(a.color);
            page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(a.stroke), setStrokingRgbColor(c.red, c.green, c.blue));
            page.drawText(t, { x, y: Y(a.y + bl + i * lead), size, font: f, color: c });
            page.pushOperators(popGraphicsState());
          } else if (t) page.drawText(t, { x, y: Y(a.y + bl + i * lead), size, font: f, color: hex(a.color) });
          x += f.widthOfTextAtSize(t, size);
        }
      }
    }
    async function drawTable(a: Ann) {
      const cells = a.cells ?? [];
      const cw = colsOf(a).map((f) => f * a.w);
      const rh = rowsOf(a).map((f) => f * a.h);
      const size = a.size ?? 10;
      const c = hex(a.color);
      const thick = a.thick ?? 1;
      let y = a.y;
      for (let r = 0; r < cells.length; r++) {
        const head = !!a.head && r === 0;
        if (head) page.drawRectangle({ x: X(a.x), y: Y(y + rh[r]), width: a.w, height: rh[r], color: hex(HEAD_FILL) });
        const f = await font(a.font, head);
        const width = (t: string) => f.widthOfTextAtSize(t, size);
        let x = a.x;
        for (let k = 0; k < cw.length; k++) {
          const lines = wrap(cells[r][k] ?? "", cw[k] - CELL_PAD * 2, width);
          for (let i = 0; i < lines.length; i++) {
            const base = y + cellBaseline(size) + i * size * 1.2;
            if (base > y + rh[r]) break; // clipped, as on screen
            const t = lines[i].trimStart();
            if (t) page.drawText(t, { x: X(x + CELL_PAD) + width(lines[i].slice(0, lines[i].length - t.length)), y: Y(base), size, font: f, color: c });
          }
          x += cw[k];
        }
        y += rh[r];
      }
      if (thick <= 0) return;
      page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h, borderColor: c, borderWidth: thick });
      let at = a.x;
      for (const w of cw.slice(0, -1)) page.drawLine({ start: { x: X((at += w)), y: Y(a.y) }, end: { x: X(at), y: Y(a.y + a.h) }, thickness: thick, color: c });
      at = a.y;
      for (const h of rh.slice(0, -1)) page.drawLine({ start: { x: X(a.x), y: Y((at += h)) }, end: { x: X(a.x + a.w), y: Y(at) }, thickness: thick, color: c });
    }
    function draw(a: Ann) {
      switch (a.type) {
        case "highlight":
          page.drawRectangle({ ...corner, width: a.w, height: a.h, color: hex(a.color ?? "#ffeb3b"), opacity: 0.4 });
          break;
        case "whiteout":
          page.drawRectangle({ ...corner, width: a.w, height: a.h, color: hex(a.color ?? "#ffffff") });
          break;
        case "rect": {
          const t = a.thick ?? 2;
          page.drawRectangle({
            ...corner, width: a.w, height: a.h, borderColor: t ? hex(a.color ?? "#e53935") : undefined, borderWidth: t, borderDashArray: dashArray(a.dash, t),
            borderLineCap: a.dash === "dot" ? LineCapStyle.Round : undefined, color: a.fill ? hex(a.fill) : undefined, opacity: a.opacity ?? 1, borderOpacity: a.opacity ?? 1,
          });
          break;
        }
        case "ellipse": {
          const t = a.thick ?? 2;
          const c = pt(cx, cy);
          page.drawEllipse({
            x: c.x, y: c.y, xScale: a.w / 2, yScale: a.h / 2, rotate: degrees(-rot), borderColor: t ? hex(a.color ?? "#e53935") : undefined, borderWidth: t,
            borderDashArray: dashArray(a.dash, t), borderLineCap: a.dash === "dot" ? LineCapStyle.Round : undefined, color: a.fill ? hex(a.fill) : undefined,
            opacity: a.opacity ?? 1, borderOpacity: a.opacity ?? 1,
          });
          break;
        }
        case "line": {
          let [x1, y1, x2, y2] = lineEnds(a);
          const t = a.thick ?? 1.5;
          const c = hex(a.color);
          const opacity = a.opacity ?? 1;
          // Arrowheads are filled triangles; the line stops just inside them so its round end doesn't poke out.
          const heads: number[][][] = [];
          if (a.arrowEnd) {
            const h = arrowHead(x1, y1, x2, y2, t);
            heads.push([h.tip, h.left, h.right]);
            [x2, y2] = h.stop;
          }
          if (a.arrowStart) {
            const h = arrowHead(x2, y2, x1, y1, t);
            heads.push([h.tip, h.left, h.right]);
            [x1, y1] = h.stop;
          }
          page.drawLine({ start: { x: X(x1), y: Y(y1) }, end: { x: X(x2), y: Y(y2) }, thickness: t, color: c, lineCap: LineCapStyle.Round, dashArray: dashArray(a.dash, t), opacity }); // round ends, as on screen
          for (const [p1, p2, p3] of heads) page.drawSvgPath(`M${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} L${p3[0]} ${p3[1]} Z`, { x: X(0), y: Y(0), color: c, opacity });
          break;
        }
        case "check": {
          const c = hex(a.color);
          const t = Math.max(1.5, a.w / 9);
          page.drawLine({ start: pt(a.x + a.w * 0.12, a.y + a.h * 0.55), end: pt(a.x + a.w * 0.4, a.y + a.h * 0.85), thickness: t, color: c });
          page.drawLine({ start: pt(a.x + a.w * 0.4, a.y + a.h * 0.85), end: pt(a.x + a.w * 0.9, a.y + a.h * 0.15), thickness: t, color: c });
          break;
        }
        case "cross": {
          const c = hex(a.color);
          const t = Math.max(1.5, a.w / 9);
          page.drawLine({ start: pt(a.x + a.w * 0.15, a.y + a.h * 0.15), end: pt(a.x + a.w * 0.85, a.y + a.h * 0.85), thickness: t, color: c });
          page.drawLine({ start: pt(a.x + a.w * 0.85, a.y + a.h * 0.15), end: pt(a.x + a.w * 0.15, a.y + a.h * 0.85), thickness: t, color: c });
          break;
        }
      }
    }
    if (a.type === "text") await drawText(a);
    if (a.type === "table") await drawTable(a);
    if (a.type === "image" && a.src) {
      let img = images.get(a.src);
      if (!img) images.set(a.src, (img = await pdf.embedPng(a.src)));
      page.drawImage(img, { ...corner, width: a.w, height: a.h });
    }
  }
  // Redacted pages leave their old content behind as unreferenced objects; make sure none is written.
  if (redactions.length) dropUnreferenced(pdf);
  return pdf.save();
}

/**
 * Replace every page that has redaction boxes with an image of that page with the boxes burned
 * in. Nothing under a box survives: the page's text, images, links and form fields go, and so
 * does every object that is no longer referenced (pdf-lib would otherwise still write them).
 */
async function applyRedactions(pdf: PDFDocument, boxes: Ann[], rasterize: Rasterize) {
  const filled = await pdf.save(); // includes form values, so they show in the page images
  const out = await PDFDocument.load(filled, { ignoreEncryption: true });
  const form = out.getForm();
  for (const index of [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b)) {
    const old = out.getPage(index);
    if (!old) continue;
    const image = await rasterize(filled, index, boxes.filter((b) => b.page === index));
    const onPage = new Set(old.node.Annots()?.asArray() ?? []);
    for (const field of form.getFields()) {
      const widgets = field.acroField.getWidgets();
      if (widgets.some((w) => w.P() === old.ref || onPage.has(out.context.getObjectRef(w.dict)!))) {
        try {
          form.removeField(field);
        } catch {
          // A field whose widgets can't be located is dropped by the clean-up below.
        }
      }
    }
    const png = await out.embedPng(image.png);
    out.removePage(index);
    out.insertPage(index, [image.width, image.height]).drawImage(png, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return out;
}

/**
 * Delete every indirect object that can't be reached from the document catalog or info dict.
 * Run it last: pdf-lib caches shared objects (such as the q/Q streams it wraps page content in)
 * that only become referenced when something is drawn.
 */
function dropUnreferenced(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const stack: (PDFObject | undefined)[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt];
  while (stack.length) {
    let o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      o = ctx.lookup(o);
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stack.push(v);
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref);
}

export async function deletePage(bytes: Uint8Array, index: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (pdf.getPageCount() <= 1) throw new Error("A PDF needs at least one page");
  pdf.removePage(index);
  return pdf.save();
}

export async function movePage(bytes: Uint8Array, from: number, to: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const [page] = await pdf.copyPages(pdf, [from]);
  pdf.removePage(from);
  pdf.insertPage(to, page);
  return pdf.save();
}

export async function appendPdf(bytes: Uint8Array, other: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const src = await PDFDocument.load(other, { ignoreEncryption: true });
  const pages = await pdf.copyPages(src, src.getPageIndices());
  pages.forEach((p) => pdf.addPage(p));
  return pdf.save();
}

export async function insertBlankPage(bytes: Uint8Array, at: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ref = pdf.getPage(Math.min(at, pdf.getPageCount() - 1));
  const { width, height } = ref.getSize();
  pdf.insertPage(at, [width, height]);
  return pdf.save();
}
