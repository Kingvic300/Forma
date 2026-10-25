import { PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFRadioGroup, PDFRef, PDFStream, PDFTextField, StandardFonts, rgb, type PDFFont, type PDFObject } from "pdf-lib";
import type { Ann, Font, PdfData } from "./types";

const hex = (h = "#000000") => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// The standard PDF fonts only cover Latin-1.
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

const FONT: Record<Font, [StandardFonts, StandardFonts]> = {
  helv: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

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

  const fonts = new Map<string, PDFFont>();
  const font = async (f: Font = "helv", bold = false) => {
    const k = f + bold;
    if (!fonts.has(k)) fonts.set(k, await pdf.embedFont(FONT[f][bold ? 1 : 0]));
    return fonts.get(k)!;
  };
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

  for (const a of data.anns) {
    const page = pdf.getPage(a.page);
    if (!page) continue;
    const box = page.getCropBox();
    const X = (x: number) => box.x + x;
    const Y = (y: number) => box.y + box.height - y; // flip: PDF origin is bottom-left
    draw(a);

    async function drawText(a: Ann) {
      const size = a.size ?? 14;
      const f = await font(a.font, a.bold);
      (a.text ?? "").split("\n").forEach((line, i) => {
        page.drawText(latin1(line), { x: X(a.x), y: Y(a.y + i * size * 1.2 + size * 0.93), size, font: f, color: hex(a.color) });
      });
    }
    function draw(a: Ann) {
      switch (a.type) {
        case "highlight":
          page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h, color: hex(a.color ?? "#ffeb3b"), opacity: 0.4 });
          break;
        case "whiteout":
          page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h, color: hex(a.color ?? "#ffffff") });
          break;
        case "rect":
          page.drawRectangle({ x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h, borderColor: hex(a.color ?? "#e53935"), borderWidth: 2 });
          break;
        case "line":
          page.drawLine({ start: { x: X(a.x), y: Y(a.y + a.h / 2) }, end: { x: X(a.x + a.w), y: Y(a.y + a.h / 2) }, thickness: 1.5, color: hex(a.color) });
          break;
        case "check": {
          const c = hex(a.color);
          const t = Math.max(1.5, a.w / 9);
          page.drawLine({ start: { x: X(a.x + a.w * 0.12), y: Y(a.y + a.h * 0.55) }, end: { x: X(a.x + a.w * 0.4), y: Y(a.y + a.h * 0.85) }, thickness: t, color: c });
          page.drawLine({ start: { x: X(a.x + a.w * 0.4), y: Y(a.y + a.h * 0.85) }, end: { x: X(a.x + a.w * 0.9), y: Y(a.y + a.h * 0.15) }, thickness: t, color: c });
          break;
        }
        case "cross": {
          const c = hex(a.color);
          const t = Math.max(1.5, a.w / 9);
          page.drawLine({ start: { x: X(a.x + a.w * 0.15), y: Y(a.y + a.h * 0.15) }, end: { x: X(a.x + a.w * 0.85), y: Y(a.y + a.h * 0.85) }, thickness: t, color: c });
          page.drawLine({ start: { x: X(a.x + a.w * 0.85), y: Y(a.y + a.h * 0.15) }, end: { x: X(a.x + a.w * 0.15), y: Y(a.y + a.h * 0.85) }, thickness: t, color: c });
          break;
        }
      }
    }
    if (a.type === "text") await drawText(a);
    if (a.type === "image" && a.src) {
      let img = images.get(a.src);
      if (!img) images.set(a.src, (img = await pdf.embedPng(a.src)));
      page.drawImage(img, { x: X(a.x), y: Y(a.y + a.h), width: a.w, height: a.h });
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
