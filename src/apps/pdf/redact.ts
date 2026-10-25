import * as pdfjs from "pdfjs-dist";
import type { Box } from "./exportPdf";

const DPI = 200;

/** Render a page at print resolution, paint the redaction boxes black, and return it as PNG. */
export async function rasterizePage(bytes: Uint8Array, index: number, boxes: Box[]) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(index + 1);
    const size = page.getViewport({ scale: 1 });
    const scale = DPI / 72;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    // CPU-backed for the same WebKitGTK reason as the page view.
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    ctx.fillStyle = "#000";
    for (const b of boxes) ctx.fillRect(Math.floor(b.x * scale), Math.floor(b.y * scale), Math.ceil(b.w * scale) + 1, Math.ceil(b.h * scale) + 1);
    const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn’t encode the page"))), "image/png"));
    return { png: new Uint8Array(await blob.arrayBuffer()), width: size.width, height: size.height };
  } finally {
    doc.destroy();
  }
}
