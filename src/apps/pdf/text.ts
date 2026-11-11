import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** A run of text already printed on the page, in page points from the top-left. */
export type TextRun = { x: number; top: number; w: number; h: number; baseline: number; size: number; str: string; fontName: string; family: string };

export async function pageText(doc: PDFDocumentProxy, index: number): Promise<TextRun[]> {
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of tc.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, item.transform);
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue; // rotated text isn't editable
    const size = Math.hypot(m[2], m[3]);
    if (!size) continue;
    const style = tc.styles[item.fontName] ?? {};
    const ascent = style.ascent || 0.8;
    const descent = style.descent || -0.2;
    runs.push({ x: m[4], top: m[5] - ascent * size, w: item.width, h: (ascent - descent) * size, baseline: m[5], size, str: item.str, fontName: item.fontName, family: style.fontFamily ?? "" });
  }
  return runs;
}

export const BULLET = /^\s*([•▪◦‣∙·\-–—*]|\d{1,2}[.)])\s/;

/**
 * The block of text a click belongs to: the run's whole line (fragments split by bold or
 * style changes), plus the following lines of the same paragraph — same size, same spacing,
 * lined up with the first line. A new bullet starts a new block.
 */
export function blockAt(all: TextRun[], hit: TextRun) {
  const size = hit.size;
  const same = (r: TextRun) => Math.abs(r.size - size) < size * 0.06;
  const lineOf = (seed: TextRun) => {
    const row = all.filter((r) => same(r) && Math.abs(r.baseline - seed.baseline) < size * 0.3).sort((a, b) => a.x - b.x);
    let lo = row.indexOf(seed);
    let hi = lo;
    while (lo > 0 && row[lo].x - (row[lo - 1].x + row[lo - 1].w) < size * 1.5) lo--;
    while (hi < row.length - 1 && row[hi + 1].x - (row[hi].x + row[hi].w) < size * 1.5) hi++;
    return row.slice(lo, hi + 1);
  };
  const text = (line: TextRun[]) =>
    line.reduce((t, r, i) => {
      if (!i) return r.str;
      const gap = r.x - (line[i - 1].x + line[i - 1].w);
      return t + (gap > size * 0.12 && !/\s$/.test(t) && !/^\s/.test(r.str) ? " " : "") + r.str;
    }, "");
  const lines = [lineOf(hit)];
  // After a bullet, only lines indented like the bullet's text belong to it.
  const bullet = BULLET.test(text(lines[0]));
  const anchors = bullet ? lines[0].slice(1, 2).map((r) => r.x) : lines[0].map((r) => r.x);
  const aligned = (line: TextRun[]) =>
    anchors.length
      ? anchors.some((x) => Math.abs(line[0].x - x) < size * 0.25)
      : line[0].x > lines[0][0].x + size * 0.4 && line[0].x < lines[0][0].x + size * 3;
  const step = (from: TextRun[], dir: 1 | -1) => {
    const b = from[0].baseline;
    const near = all
      .filter((r) => same(r) && (dir > 0 ? r.baseline > b + size * 0.8 && r.baseline < b + size * 2.2 : r.baseline < b - size * 0.8 && r.baseline > b - size * 2.2))
      .sort((p, q) => dir * (p.baseline - q.baseline) || p.x - q.x);
    return near.length ? lineOf(near[0]) : null;
  };
  let lead = 0;
  for (let cur = lines[0]; ; ) {
    const next = step(cur, 1);
    if (!next || !aligned(next) || BULLET.test(text(next))) break;
    const d = next[0].baseline - cur[0].baseline;
    if (lead && Math.abs(d - lead) > size * 0.2) break;
    lead = d;
    lines.push(next);
    cur = next;
  }
  if (!bullet) {
    for (let cur = lines[0]; ; ) {
      const prev = step(cur, -1);
      if (!prev || !aligned(prev)) break;
      const d = cur[0].baseline - prev[0].baseline;
      if (lead && Math.abs(d - lead) > size * 0.2) break;
      lead = d;
      lines.unshift(prev);
      cur = prev;
      if (BULLET.test(text(prev))) break;
    }
  }
  const runs = lines.flat();
  const x0 = Math.min(...runs.map((r) => r.x));
  const top = Math.min(...runs.map((r) => r.top));
  return {
    runs,
    lines,
    gapBefore: (line: TextRun[], i: number) => i > 0 && line[i].x - (line[i - 1].x + line[i - 1].w) > size * 0.12,
    text: lines.map(text).join("\n"),
    x: Math.min(...lines[0].map((r) => r.x)),
    baseline: lines[0][0].baseline,
    lead: lead || size * 1.2,
    box: { x: x0, y: top, w: Math.max(...runs.map((r) => r.x + r.w)) - x0, h: Math.max(...runs.map((r) => r.top + r.h)) - top },
  };
}
