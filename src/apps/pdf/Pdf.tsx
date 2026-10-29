import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Check, Eraser, EyeOff, FilePlus2, GripVertical, Highlighter, ImageIcon, Minus, MousePointer2, PenLine, Redo2, Send, Sparkles, TextCursorInput, Signature, Square, Trash2, Type, Undo2, X as XIcon, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { askConfirm, errorText, toast } from "../../lib/dialog";
import { findLinks, isSafeHref, openLink } from "../../lib/links";
import { useFile } from "../../lib/useFile";
import { safeName, saveAs } from "../../lib/platform";
import { uid } from "../../lib/store";
import { Missing, TitleBar } from "../../ui";
import { rasterizePage } from "./redact";
import { appendPdf, buildPdf, deletePage, insertBlankPage, movePage, readFields, type FieldInfo } from "./exportPdf";
import { imageToPng, SignaturePad } from "./SignaturePad";
import { isBoldName, matchFont } from "./fonts";
import { askAi, getGroqKey, setGroqKey, type AiOp } from "./ai";
import { CSS_FONT, FONT_LABEL, lineEnds, type Ann, type Font, type PdfData, type Span } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PageLink = { x: number; y: number; w: number; h: number; href: string };

/** A run of text already printed on the page, in page points from the top-left. */
export type TextRun = { x: number; top: number; w: number; h: number; baseline: number; size: number; str: string; fontName: string; family: string };

async function pageText(doc: PDFDocumentProxy, index: number): Promise<TextRun[]> {
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

const BULLET = /^\s*([•▪◦‣∙·\-–—*]|\d{1,2}[.)])\s/;

/**
 * The block of text a click belongs to: the run's whole line (fragments split by bold or
 * style changes), plus the following lines of the same paragraph — same size, same spacing,
 * lined up with the first line. A new bullet starts a new block.
 */
function blockAt(all: TextRun[], hit: TextRun) {
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

/** Where the first baseline sits in a text box drawn with this font, size and line spacing. */
function measureBaseline(font: Font, bold: boolean, size: number, lead: number) {
  const box = document.createElement("div");
  box.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-size:100px;line-height:${(100 * lead) / size}px;font-family:${CSS_FONT[font]};font-weight:${bold ? 700 : 400}`;
  const mark = document.createElement("span");
  mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  box.append("Hg", mark);
  document.body.append(box);
  const ratio = mark.offsetTop / 100;
  box.remove();
  return ratio * size;
}

/** The run under a point, or the nearest one within a few points. */
function runAt(runs: TextRun[], x: number, y: number) {
  let best: TextRun | null = null;
  let bestD = 4;
  for (const r of runs) {
    const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
    const dy = y < r.top ? r.top - y : y > r.top + r.h ? y - (r.top + r.h) : 0;
    const d = Math.hypot(dx, dy);
    if (d < bestD) [best, bestD] = [r, d];
  }
  return best;
}

/** Clickable areas on a page: the PDF's own link annotations, plus addresses written as plain text. */
async function pageLinks(doc: PDFDocumentProxy, index: number): Promise<PageLink[]> {
  const page = await doc.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const out: PageLink[] = [];
  const rect = (r: number[]) => {
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  };
  for (const a of await page.getAnnotations()) {
    if (a.subtype === "Link" && typeof a.url === "string" && isSafeHref(a.url)) out.push({ ...rect(a.rect), href: a.url });
  }
  const known = new Set(out.map((l) => l.href));
  for (const item of (await page.getTextContent()).items) {
    if (!("str" in item) || !item.str) continue;
    for (const l of findLinks(item.str)) {
      if (known.has(l.href)) continue;
      const m = pdfjs.Util.transform(vp.transform, item.transform);
      const size = Math.hypot(m[2], m[3]);
      const perChar = item.width / item.str.length;
      out.push({ x: m[4] + l.index * perChar, y: m[5] - size, w: l.text.length * perChar, h: size * 1.2, href: l.href });
    }
  }
  return out;
}

type Tool = "select" | "edit" | "text" | "date" | "sign" | "initials" | "image" | "highlight" | "whiteout" | "redact" | "rect" | "line" | "check" | "cross";
const DRAG_TOOLS: Tool[] = ["highlight", "whiteout", "redact", "rect", "line"];
const TOOLS: [Tool, typeof Type, string][] = [
  ["select", MousePointer2, "Select"],
  ["edit", TextCursorInput, "Edit text"],
  ["text", Type, "Add text"],
  ["sign", Signature, "Sign"],
  ["initials", PenLine, "Initials"],
  ["date", CalendarDays, "Date"],
  ["check", Check, "Tick"],
  ["cross", XIcon, "Cross"],
  ["image", ImageIcon, "Image"],
  ["highlight", Highlighter, "Highlight (drag)"],
  ["whiteout", Eraser, "White-out (drag)"],
  ["redact", EyeOff, "Black out (drag)"],
  ["rect", Square, "Box (drag)"],
  ["line", Minus, "Line (drag)"],
];

type Size = { w: number; h: number };

export default function Pdf({ id }: { id: string }) {
  const f = useFile<PdfData>(id);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1.3);
  const [tool, setTool] = useState<Tool>("select");
  const [pending, setPending] = useState<{ src: string; ratio: number } | null>(null);
  const [sigFor, setSigFor] = useState<Tool | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusText, setFocusText] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [showFields, setShowFields] = useState(true);
  const [busy, setBusy] = useState("");
  const [showAi, setShowAi] = useState(false);
  const past = useRef<PdfData[]>([]);
  const future = useRef<PdfData[]>([]);
  const lastEdit = useRef({ key: "", at: 0 });
  const keepView = useRef<{ x: number; y: number } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const bytes = f.data?.bytes;

  useEffect(() => {
    if (!bytes) return;
    let alive = true;
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
    task.promise
      .then(async (d) => {
        const out: Size[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 });
          out.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        setDoc(d);
        setSizes(out);
        setError("");
      })
      .catch((e) => alive && setError(e?.name === "PasswordException" ? "This PDF is password-protected." : `Could not open this PDF: ${e?.message ?? e}`));
    readFields(bytes).then((x) => alive && setFields(x));
    return () => {
      alive = false;
      task.destroy();
    };
  }, [bytes]);

  /** Every change to the file goes through here so Ctrl+Z can take it back. Quick repeats with one key (typing) share a step. */
  const mutate = (fn: (d: PdfData) => PdfData, key = "") => {
    f.setData((d) => {
      const now = Date.now();
      if (!key || key !== lastEdit.current.key || now - lastEdit.current.at > 800) {
        past.current.push(d);
        if (past.current.length > 100) past.current.shift();
      }
      lastEdit.current = { key, at: now };
      future.current = [];
      return fn(d);
    });
  };
  const undo = () => {
    if (!past.current.length) return;
    f.setData((d) => {
      future.current.push(d);
      return past.current.pop()!;
    });
    lastEdit.current = { key: "", at: 0 };
    setSelected(null);
  };
  const redo = () => {
    if (!future.current.length) return;
    f.setData((d) => {
      past.current.push(d);
      return future.current.pop()!;
    });
    lastEdit.current = { key: "", at: 0 };
    setSelected(null);
  };

  // No rounding: trackpad pinch sends tiny steps that would round back to the same zoom.
  const zoomBy = (factor: number) => {
    const el = document.querySelector<HTMLElement>(".pdf-scroll");
    if (el) keepView.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setScale((s) => Math.min(4, Math.max(0.4, s * factor)));
  };
  // Keep the same spot of the document in view after the pages change size.
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(".pdf-scroll");
    const v = keepView.current;
    if (!el || !v) return;
    keepView.current = null;
    el.scrollLeft = v.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = v.y * el.scrollHeight - el.clientHeight / 2;
  }, [scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const editing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") { setTool("select"); setSelected(null); setPending(null); }
      if (!editing && selected && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); remove(selected); }
      // Text boxes are ours to undo; other fields (rename, AI box) keep the browser's own undo.
      if (mod && !e.altKey && (k === "z" || k === "y") && (!editing || el.classList.contains("ann-text"))) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) redo();
        else undo();
      }
      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomBy(1.15); }
      if (mod && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoomBy(1 / 1.15); }
      if (mod && e.key === "0") { e.preventDefault(); setScale(1.3); }
    };
    // Ctrl + wheel / pinch zooms the PDF, not the whole app window.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)));
    };
    const stop = (e: Event) => e.preventDefault();
    addEventListener("keydown", onKey);
    addEventListener("wheel", onWheel, { passive: false });
    for (const g of ["gesturestart", "gesturechange", "gestureend"]) addEventListener(g, stop);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("wheel", onWheel);
      for (const g of ["gesturestart", "gesturechange", "gestureend"]) removeEventListener(g, stop);
    };
  });

  if (f.missing) return <Missing app="pdf" />;
  if (!f.data || !f.meta) return <div className="loading">Loading…</div>;
  const data = f.data;

  const update = (aid: string, patch: Partial<Ann>) => mutate((d) => ({ ...d, anns: d.anns.map((a) => (a.id === aid ? { ...a, ...patch } : a)) }), `u:${aid}`);
  const add = (a: Omit<Ann, "id">) => {
    const ann = { ...a, id: uid() };
    mutate((d) => ({ ...d, anns: [...d.anns, ann] }));
    setSelected(ann.id);
    return ann;
  };
  /** Removing replacement text also removes its white patch, so the original words show again. */
  function remove(aid: string) {
    mutate((d) => {
      const cover = d.anns.find((a) => a.id === aid)?.cover;
      return { ...d, anns: d.anns.filter((a) => a.id !== aid && a.id !== cover) };
    });
    setSelected(null);
  }

  /** Turn a line already on the page into editable text: hide it under white and type over it. */
  async function makeEdit(page: number, run: TextRun, all: TextRun[], newText?: string): Promise<[Ann, Ann]> {
    const block = blockAt(all, run);
    const nameOf = new Map<string, string>();
    try {
      const p = doc ? await doc.getPage(page + 1) : null;
      for (const r of block.runs) if (p?.commonObjs.has(r.fontName)) nameOf.set(r.fontName, p.commonObjs.get(r.fontName)?.name ?? "");
    } catch {
      // Font details are only a hint for matching the style.
    }
    const name = (r: TextRun) => nameOf.get(r.fontName) ?? "";
    const font = matchFont(name(run), run.family);
    // Keep bold words bold: each line becomes pieces of one weight.
    const spans: Span[][] = block.lines.map((line) => {
      const out: Span[] = [];
      line.forEach((r, i) => {
        const b = isBoldName(name(r));
        const t = (block.gapBefore(line, i) && !/\s$/.test(out[out.length - 1]?.t ?? "") && !/^\s/.test(r.str) ? " " : "") + r.str;
        const last = out[out.length - 1];
        if (last && !!last.b === b) last.t += t;
        else out.push({ t, b });
      });
      return out;
    });
    const bold = spans.every((l) => l.every((x) => x.b));
    const size = Math.round(run.size * 10) / 10;
    await document.fonts.load(`${bold ? 700 : 400} 20px ${CSS_FONT[font]}`).catch(() => {});
    await document.fonts.load(`700 20px ${CSS_FONT[font]}`).catch(() => {});
    const bl = measureBaseline(font, bold, size, block.lead);
    const pad = size * 0.1;
    const cover: Ann = { id: uid(), page, type: "whiteout", x: block.box.x - pad, y: block.box.y - pad, w: block.box.w + pad * 2, h: block.box.h + pad * 2, color: "#ffffff" };
    const text: Ann = {
      id: uid(), page, type: "text", x: block.x, y: block.baseline - bl, w: 0, h: 0, text: block.text, spans,
      size, font, bold, color: "#000000", cover: cover.id, bl, lead: block.lead,
    };
    if (newText !== undefined) {
      text.text = newText;
      text.spans = newText.split("\n").map((t) => [{ t, b: bold }]);
    }
    return [cover, text];
  }

  async function editRun(page: number, run: TextRun, all: TextRun[]) {
    const [cover, text] = await makeEdit(page, run, all);
    mutate((d) => ({ ...d, anns: [...d.anns, cover, text] }));
    setSelected(text.id);
    setFocusText(text.id);
  }

  const sel = data.anns.find((a) => a.id === selected);

  /** Change font, size or weight, keeping edited text on its original baseline and spacing. */
  function restyle(a: Ann, patch: Partial<Ann>) {
    const next = { ...a, ...patch };
    if (a.bl === undefined) return update(a.id, patch);
    const k = (next.size ?? 14) / (a.size ?? 14);
    const lead = (a.lead ?? (a.size ?? 14) * 1.2) * k;
    const bl = measureBaseline(next.font ?? "helv", !!next.bold, next.size ?? 14, lead);
    const baseline = a.y + a.bl;
    update(a.id, { ...patch, lead, bl, y: baseline - bl });
  }

  function pickTool(t: Tool) {
    setSelected(null);
    if (t === "sign" || t === "initials") { setSigFor(t); return; }
    if (t === "image") { imageInput.current?.click(); return; }
    setPending(null);
    setTool(t);
  }

  async function usePending(src: string, t: Tool) {
    const img = new Image();
    img.src = src;
    await img.decode();
    setPending({ src, ratio: img.height / img.width });
    setTool(t);
  }

  function place(page: number, x: number, y: number) {
    const base = { page, x, y, w: 0, h: 0 };
    if (tool === "text" || tool === "date") {
      add({ ...base, y: y - 8, type: "text", text: tool === "date" ? new Date().toLocaleDateString() : "", size: 14, font: "helv", color: "#000000" });
      setTool("select");
    } else if (tool === "check" || tool === "cross") {
      add({ ...base, type: tool, x: x - 8, y: y - 8, w: 16, h: 16, color: tool === "check" ? "#1b5e20" : "#b71c1c" });
    } else if ((tool === "sign" || tool === "initials" || tool === "image") && pending) {
      const w = tool === "initials" ? 70 : tool === "sign" ? 160 : 200;
      const h = w * pending.ratio;
      add({ ...base, type: "image", src: pending.src, x: x - w / 2, y: y - h / 2, w, h });
      setPending(null);
      setTool("select");
    }
  }

  async function pageOp(label: string, op: () => Promise<Uint8Array>, mapAnns: (a: Ann[]) => Ann[] = (a) => a) {
    setBusy(label);
    try {
      const next = await op();
      setSelected(null);
      mutate((d) => ({ ...d, bytes: next, anns: mapAnns(d.anns) }));
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy("");
    }
  }
  const delPage = async (i: number) =>
    (await askConfirm(`Delete page ${i + 1}?`, { body: "Anything you added to this page is removed with it.", danger: true, confirmLabel: "Delete page" })) &&
    pageOp("Deleting page…", () => deletePage(data.bytes, i), (anns) => anns.filter((a) => a.page !== i).map((a) => (a.page > i ? { ...a, page: a.page - 1 } : a)));
  const swapPage = (i: number, j: number) =>
    pageOp("Moving page…", () => movePage(data.bytes, i, j), (anns) => anns.map((a) => (a.page === i ? { ...a, page: j } : a.page === j ? { ...a, page: i } : a)));
  const blankAfter = (i: number) =>
    pageOp("Adding page…", () => insertBlankPage(data.bytes, i + 1), (anns) => anns.map((a) => (a.page > i ? { ...a, page: a.page + 1 } : a)));

  async function download() {
    const blackedOut = new Set(data.anns.filter((a) => a.type === "redact").map((a) => a.page)).size;
    const one = blackedOut === 1;
    if (
      blackedOut &&
      !(await askConfirm("Download with blacked-out parts?", {
        body: `Anything under the black boxes will be gone for good from the file you download. To make sure of that, ${one ? "the page with black boxes is" : `the ${blackedOut} pages with black boxes are`} saved as ${one ? "a picture" : "pictures"}, so ${one ? "its" : "their"} words can't be copied or searched. You can still change the boxes here in Forma.`,
        confirmLabel: "Black out and download",
      }))
    )
      return;
    setBusy(blackedOut ? "Blacking out…" : "Building PDF…");
    try {
      await saveAs(`${safeName(f.meta!.name)}${blackedOut ? " (blacked out)" : ""}.pdf`, await buildPdf(data, rasterizePage));
    } catch (e) {
      toast(`Couldn’t build the PDF: ${errorText(e)}`, "error");
    } finally {
      setBusy("");
    }
  }

  /** Send the request to Groq with the PDF's text and annotations, then apply its operations as one undo step. */
  async function runAi(key: string, request: string, history: { role: "user" | "assistant"; content: string }[]) {
    if (!doc) throw new Error("The PDF is still loading.");
    const covers = new Set(data.anns.map((a) => a.cover).filter(Boolean));
    const coverBoxes = data.anns.filter((a) => covers.has(a.id));
    const blocks = new Map<string, { page: number; run: TextRun; all: TextRun[] }>();
    const lines: string[] = [];
    let n = 0;
    for (let i = 0; i < sizes.length; i++) {
      const all = await pageText(doc, i);
      const seen = new Set<TextRun>();
      for (const r of all) {
        if (seen.has(r)) continue;
        const b = blockAt(all, r);
        b.runs.forEach((x) => seen.add(x));
        const cx = b.box.x + b.box.w / 2;
        const cy = b.box.y + b.box.h / 2;
        // Words already replaced by an edit are hidden under a white patch; the edit stands in for them.
        if (coverBoxes.some((c) => c.page === i && cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h)) continue;
        const id = `p${i}b${n++}`;
        blocks.set(id, { page: i, run: r, all });
        lines.push(JSON.stringify({ id, page: i, x: Math.round(b.x), y: Math.round(b.box.y), text: b.text }));
      }
    }
    const round = (v: number) => Math.round(v * 10) / 10;
    const anns = data.anns
      .filter((a) => !covers.has(a.id))
      .map((a) => ({ id: a.id, page: a.page, type: a.type, x: round(a.x), y: round(a.y), w: round(a.w), h: round(a.h), x2: a.x2, y2: a.y2, text: a.text, size: a.size, color: a.color, thick: a.thick }));
    const context = [
      `Pages (width x height in points): ${sizes.map((z, i) => `${i}: ${Math.round(z.w)}x${Math.round(z.h)}`).join(", ")}`,
      `Blocks:\n${lines.join("\n").slice(0, 14000)}`,
      `Annotations:\n${JSON.stringify(anns).slice(0, 4000)}`,
    ].join("\n\n");

    const out = await askAi(key, context, history, request);
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    const color = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
    const pageOk = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < sizes.length;

    const edits = new Map<string, string>();
    for (const op of out.ops) if (op.op === "edit_text" && blocks.has(op.block) && typeof op.text === "string") edits.set(op.block, op.text);
    const made: [Ann, Ann][] = [];
    for (const [block, text] of edits) {
      const b = blocks.get(block)!;
      made.push(await makeEdit(b.page, b.run, b.all, text));
    }

    let applied = made.length;
    mutate((d) => {
      let list = [...d.anns];
      const fresh: Ann[] = [];
      for (const [cover, text] of made) fresh.push(cover, text);
      const apply = (op: AiOp) => {
        if (op.op === "add_text" && pageOk(op.page) && typeof op.text === "string") {
          fresh.push({ id: uid(), page: op.page, type: "text", x: num(op.x, 72), y: num(op.y, 72), w: 0, h: 0, text: op.text, size: num(op.size, 14), font: "helv", bold: !!op.bold, color: color(op.color) ?? "#000000" });
        } else if (op.op === "add_shape" && pageOk(op.page) && ["rect", "line", "highlight", "whiteout", "redact"].includes(op.type)) {
          const x = num(op.x, 72);
          const y = num(op.y, 72);
          const base = { id: uid(), page: op.page, type: op.type, x, y, w: Math.max(1, num(op.w, 100)), h: Math.max(1, num(op.h, 20)), color: color(op.color) ?? (op.type === "highlight" ? "#ffeb3b" : op.type === "whiteout" ? "#ffffff" : op.type === "rect" ? "#e53935" : "#000000"), thick: typeof op.thick === "number" ? op.thick : undefined } as Ann;
          if (op.type === "line") Object.assign(base, { w: 0, h: 0, x2: num(op.x2, x + 100), y2: num(op.y2, y) });
          fresh.push(base);
        } else if (op.op === "update") {
          const i = list.findIndex((a) => a.id === op.id);
          if (i < 0) return false;
          const a = list[i];
          const patch: Partial<Ann> = {};
          for (const k of ["x", "y", "w", "h", "x2", "y2", "size", "thick"] as const) if (typeof op[k] === "number") patch[k] = op[k];
          if (color(op.color)) patch.color = color(op.color);
          if (typeof op.bold === "boolean") patch.bold = op.bold;
          if (typeof op.text === "string" && a.type === "text") Object.assign(patch, { text: op.text, spans: a.spans ? op.text.split("\n").map((t) => [{ t, b: a.bold }]) : undefined });
          list[i] = { ...a, ...patch };
        } else if (op.op === "delete") {
          const a = list.find((x) => x.id === op.id);
          if (!a) return false;
          list = list.filter((x) => x.id !== a.id && x.id !== a.cover);
        } else return op.op === "edit_text";
        return true;
      };
      for (const op of out.ops) if (op.op !== "edit_text" && apply(op)) applied++;
      return { ...d, anns: [...list, ...fresh] };
    });
    return `${out.reply || (applied ? "Done." : "Nothing to change.")}${applied ? ` (${applied} change${applied === 1 ? "" : "s"} — Ctrl Z undoes all)` : ""}`;
  }

  const fieldValue = (fi: FieldInfo) => (fi.name in data.fields ? data.fields[fi.name] : fi.value);
  const setField = (name: string, v: string | boolean) => mutate((d) => ({ ...d, fields: { ...d.fields, [name]: v } }), `f:${name}`);

  return (
    <div className="app-page pdf">
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="pdf">
        {busy && <span className="muted">{busy}</span>}
        <button onClick={() => mergeInput.current?.click()} title="Add all pages of another PDF to the end of this one">Add pages from a PDF…</button>
        <button className="primary" onClick={download} disabled={!!busy}>Download PDF</button>
      </TitleBar>
      <div className="toolbar pdf-tools">
        {TOOLS.map(([t, Icon, label]) => (
          <button key={t} className={"tool" + (tool === t ? " on" : "")} title={label} onClick={() => pickTool(t)}>
            <Icon />
            <span className="tl">{label.replace(/ \(drag\)$/, "")}</span>
          </button>
        ))}
        <span className="grow" />
        <button onClick={undo} title="Undo (Ctrl Z)"><Undo2 /></button>
        <button onClick={redo} title="Redo (Ctrl Y)"><Redo2 /></button>
        <button onClick={() => zoomBy(1 / 1.15)} title="Zoom out (Ctrl -)"><ZoomOut /></button>
        <span className="zoom">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomBy(1.15)} title="Zoom in (Ctrl +)"><ZoomIn /></button>
        <button className={showAi ? "on" : ""} onClick={() => setShowAi(!showAi)} title="Ask AI to edit this PDF"><Sparkles /> AI</button>
        {fields.length > 0 && <button className={showFields ? "on" : ""} onClick={() => setShowFields(!showFields)}>Form fields ({fields.length})</button>}
      </div>
      {sel && (
        <div className="props">
          <span className="muted">{sel.type === "text" ? "Text" : sel.type === "image" ? "Image" : sel.type}</span>
          {sel.type !== "image" && sel.type !== "redact" && <label className="color" title="Color">Color <input type="color" value={sel.color ?? "#000000"} onChange={(e) => update(sel.id, { color: e.target.value })} /></label>}
          {sel.type === "text" && (
            <>
              <select value={sel.font ?? "helv"} onChange={(e) => restyle(sel, { font: e.target.value as Font })}>
                {(Object.keys(FONT_LABEL) as Font[]).map((k) => <option key={k} value={k}>{FONT_LABEL[k]}</option>)}
              </select>
              <select value={sel.size ?? 14} onChange={(e) => restyle(sel, { size: Number(e.target.value) })}>
                {[...new Set([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 64, sel.size ?? 14])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} pt</option>)}
              </select>
              <button className={sel.bold ? "on" : ""} onClick={() => restyle(sel, { bold: !sel.bold })}><b>B</b></button>
            </>
          )}
          {(sel.type === "line" || sel.type === "rect") && (
            <select value={sel.thick ?? (sel.type === "line" ? 1.5 : 2)} title="Thickness" onChange={(e) => update(sel.id, { thick: Number(e.target.value) })}>
              {[...new Set([0.5, 1, 1.5, 2, 3, 4, 6, 8, sel.thick ?? (sel.type === "line" ? 1.5 : 2)])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} pt</option>)}
            </select>
          )}
          <button onClick={() => add({ ...sel, x: sel.x + 12, y: sel.y + 12, x2: sel.x2 === undefined ? undefined : sel.x2 + 12, y2: sel.y2 === undefined ? undefined : sel.y2 + 12 })}>Duplicate</button>
          <button onClick={() => remove(sel.id)}>Delete</button>
        </div>
      )}
      {tool !== "select" && (
        <div className="hint-bar">
          {tool === "edit"
            ? "Click a line of text to change it. Tip: with Select, double-click text to do the same."
            : tool === "redact"
            ? "Drag over anything you want gone for good. It’s deleted from the file you download, not just hidden."
            : tool === "whiteout"
              ? "Drag over text to hide it under white. The old words are still in the file underneath; use Black out to remove them for good."
              : DRAG_TOOLS.includes(tool)
              ? "Drag on the page to draw."
              : pending
                ? "Click where it should go."
                : "Click on the page to place."}{" "}
          Press Esc to stop.
        </div>
      )}
      <div className="pdf-body">
        <div className="pdf-scroll">
          {error && <div className="empty"><p>{error}</p></div>}
          {doc &&
            sizes.map((size, i) => (
              <div key={`${i}-${sizes.length}`} className="page-wrap">
                <div className="page-bar">
                  <span>Page {i + 1} of {sizes.length}</span>
                  <span className="grow" />
                  <button className="icon" title="Move up" disabled={i === 0 || !!busy} onClick={() => swapPage(i, i - 1)}><ArrowUp /></button>
                  <button className="icon" title="Move down" disabled={i === sizes.length - 1 || !!busy} onClick={() => swapPage(i, i + 1)}><ArrowDown /></button>
                  <button className="icon" title="Insert blank page after" disabled={!!busy} onClick={() => blankAfter(i)}><FilePlus2 /></button>
                  <button className="icon" title="Delete page" disabled={sizes.length === 1 || !!busy} onClick={() => delPage(i)}><Trash2 /></button>
                </div>
                <PageView
                  doc={doc}
                  index={i}
                  size={size}
                  scale={scale}
                  tool={tool}
                  anns={data.anns.filter((a) => a.page === i)}
                  selected={selected}
                  onSelect={setSelected}
                  onPlace={(x, y) => place(i, x, y)}
                  onDraw={(r) => add({ page: i, type: tool as Ann["type"], ...r, color: tool === "highlight" ? "#ffeb3b" : tool === "whiteout" ? "#ffffff" : tool === "rect" ? "#e53935" : "#000000" })}
                  onChange={update}
                  onRemove={remove}
                  onEditRun={(run, all) => editRun(i, run, all)}
                  focusText={focusText}
                />
              </div>
            ))}
        </div>
        {showAi && <AiPanel onAsk={runAi} onClose={() => setShowAi(false)} />}
        {showFields && fields.length > 0 && (
          <aside className="fields">
            <h3>Form fields</h3>
            <p className="muted">Values are written into the PDF when you download it.</p>
            {fields.map((fi) => (
              <label key={fi.name} className="field">
                <span>{fi.name}</span>
                {fi.kind === "check" ? (
                  <input type="checkbox" checked={!!fieldValue(fi)} onChange={(e) => setField(fi.name, e.target.checked)} />
                ) : fi.kind === "choice" ? (
                  <select value={String(fieldValue(fi))} onChange={(e) => setField(fi.name, e.target.value)}>
                    <option value="">—</option>
                    {fi.options!.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={String(fieldValue(fi))} onChange={(e) => setField(fi.name, e.target.value)} />
                )}
              </label>
            ))}
          </aside>
        )}
      </div>

      {sigFor && (
        <SignaturePad
          title={sigFor === "initials" ? "Add initials" : "Add signature"}
          onClose={() => setSigFor(null)}
          onPick={(src) => { const t = sigFor; setSigFor(null); usePending(src, t); }}
        />
      )}
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) usePending(await imageToPng(file), "image"); }} />
      <input
        ref={mergeInput}
        type="file"
        accept=".pdf"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pageOp("Merging…", async () => appendPdf(data.bytes, new Uint8Array(await file.arrayBuffer())));
        }}
      />
    </div>
  );
}

type Chat = { role: "user" | "assistant"; content: string; error?: boolean };

function AiPanel({ onAsk, onClose }: { onAsk: (key: string, request: string, history: { role: "user" | "assistant"; content: string }[]) => Promise<string>; onClose: () => void }) {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [draftKey, setDraftKey] = useState("");
  const [chat, setChat] = useState<Chat[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getGroqKey().then((k) => setKey(k || null));
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [chat, busy]);

  async function send() {
    const request = text.trim();
    if (!request || busy || !key) return;
    const history = chat.filter((m) => !m.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: "user", content: request }]);
    setText("");
    setBusy(true);
    try {
      const reply = await onAsk(key, request, history);
      setChat((c) => [...c, { role: "assistant", content: reply }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: errorText(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="fields ai">
      <div className="ai-head">
        <h3><Sparkles size={14} /> Ask AI</h3>
        <span className="grow" />
        {key && <button className="icon" title="Change Groq API key" onClick={() => { setDraftKey(""); setKey(null); }}>Key</button>}
        <button className="icon" title="Close" onClick={onClose}><XIcon size={14} /></button>
      </div>
      {key === undefined ? null : !key ? (
        <>
          <p className="muted">Paste a Groq API key to use this. It stays on this computer and is sent only to Groq.</p>
          <input type="password" placeholder="gsk_…" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draftKey.trim()) { setGroqKey(draftKey); setKey(draftKey.trim()); } }} />
          <button className="primary" disabled={!draftKey.trim()} onClick={() => { setGroqKey(draftKey); setKey(draftKey.trim()); }}>Save key</button>
        </>
      ) : (
        <>
          <div className="ai-chat">
            {!chat.length && <p className="muted">Tell me what to change. For example: “change the date to 5 May 2026”, “black out the phone number”, “add a red box around the total”, “underline the title”.</p>}
            {chat.map((m, i) => <div key={i} className={`ai-msg ${m.role}${m.error ? " error" : ""}`}>{m.content}</div>)}
            {busy && <div className="ai-msg assistant muted">Working…</div>}
            <div ref={end} />
          </div>
          <div className="ai-input">
            <textarea
              rows={3}
              placeholder="Ask AI to edit this PDF…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="primary" disabled={busy || !text.trim()} onClick={send} title="Send (Enter)"><Send size={14} /></button>
          </div>
        </>
      )}
    </aside>
  );
}

function PageView(props: {
  doc: PDFDocumentProxy;
  index: number;
  size: Size;
  scale: number;
  tool: Tool;
  anns: Ann[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  onDraw: (r: { x: number; y: number; w: number; h: number; x2?: number; y2?: number }) => void;
  onChange: (id: string, patch: Partial<Ann>) => void;
  onRemove: (id: string) => void;
  onEditRun: (run: TextRun, all: TextRun[]) => void;
  focusText: string | null;
}) {
  const { doc, index, size, scale, tool } = props;
  const runs = useRef<TextRun[] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [links, setLinks] = useState<PageLink[]>([]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    pageLinks(doc, index).then((l) => alive && setLinks(l)).catch(() => {});
    pageText(doc, index).then((r) => alive && (runs.current = r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [doc, index, visible]);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "800px" });
    io.observe(wrap.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    doc.getPage(index + 1).then((page) => {
      if (cancelled || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      // A CPU-backed canvas: WebKitGTK's accelerated 2D canvas drops or shifts parts of
      // pdf.js output (missing text bands, blocks drawn in the wrong place).
      task = page.render({ canvasContext: c.getContext("2d", { willReadFrequently: true })!, viewport: vp });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, scale, visible]);

  const toPage = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  return (
    <div
      ref={wrap}
      className={"page" + (tool === "edit" ? " editing" : tool !== "select" ? " placing" : "")}
      style={{ width: size.w * scale, height: size.h * scale }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget && e.target !== canvas.current) return;
        if (tool === "select") return props.onSelect(null);
        const p = toPage(e);
        if (tool === "edit") {
          e.preventDefault(); // otherwise the mousedown that follows takes focus away from the new text
          const run = runs.current && runAt(runs.current, p.x, p.y);
          return run ? props.onEditRun(run, runs.current!) : undefined;
        }
        if (DRAG_TOOLS.includes(tool)) {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDraft({ x0: p.x, y0: p.y, x: p.x, y: p.y });
        } else {
          e.preventDefault(); // same reason: keep focus on the text box that placing creates
          props.onPlace(p.x, p.y);
        }
      }}
      onPointerMove={(e) => draft && setDraft({ ...draft, ...toPage(e) })}
      onDoubleClick={(e) => {
        // Double-clicking printed text with Select is a shortcut for Edit text.
        if (tool !== "select" || (e.target !== e.currentTarget && e.target !== canvas.current)) return;
        const r = wrap.current!.getBoundingClientRect();
        const run = runs.current && runAt(runs.current, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        if (run) props.onEditRun(run, runs.current!);
      }}
      onPointerUp={() => {
        if (!draft) return;
        let r = { x: Math.min(draft.x0, draft.x), y: Math.min(draft.y0, draft.y), w: Math.abs(draft.x - draft.x0), h: Math.abs(draft.y - draft.y0) };
        setDraft(null);
        if (tool === "line") {
          const far = Math.hypot(draft.x - draft.x0, draft.y - draft.y0) >= 4;
          return props.onDraw({ x: draft.x0, y: draft.y0, w: 0, h: 0, x2: far ? draft.x : draft.x0 + 100, y2: far ? draft.y : draft.y0 });
        }
        if (r.w < 4 && r.h < 4) r = { x: draft.x0 - 50, y: draft.y0 - 8, w: 100, h: 16 };
        props.onDraw(r);
      }}
    >
      <canvas ref={canvas} style={{ width: size.w * scale, height: size.h * scale }} />
      {draft && tool === "line" && (
        <svg className="draft-line" width={size.w * scale} height={size.h * scale}>
          <line x1={draft.x0 * scale} y1={draft.y0 * scale} x2={draft.x * scale} y2={draft.y * scale} stroke="#111" strokeWidth={1.5 * scale} strokeLinecap="round" />
        </svg>
      )}
      {draft && tool !== "line" && (
        <div
          className={"draft " + tool}
          style={{ left: Math.min(draft.x0, draft.x) * scale, top: Math.min(draft.y0, draft.y) * scale, width: Math.abs(draft.x - draft.x0) * scale, height: Math.abs(draft.y - draft.y0) * scale }}
        />
      )}
      {tool === "select" &&
        links.map((l, i) => (
          <a
            key={i}
            className="pdf-link"
            href={l.href}
            title={`${l.href.replace(/^mailto:/, "")}  (click to open)`}
            style={{ left: l.x * scale, top: l.y * scale, width: Math.max(l.w * scale, 8), height: Math.max(l.h * scale, 8) }}
            onClick={(e) => {
              e.preventDefault();
              openLink(l.href);
            }}
          />
        ))}
      {props.anns.map((a) => (
        <AnnView key={a.id} a={a} scale={scale} focus={props.focusText === a.id} selected={props.selected === a.id} onSelect={() => props.onSelect(a.id)} onChange={(p) => props.onChange(a.id, p)} onRemove={() => props.onRemove(a.id)} />
      ))}
    </div>
  );
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const spansToHtml = (lines: Span[][]) => lines.map((l) => l.map((x) => (x.b ? `<b>${esc(x.t)}</b>` : esc(x.t))).join("")).join("\n");

/** Read an edited box back into lines of bold / normal pieces (Ctrl+B adds <b>; Enter adds <br> or <div>). */
function readSpans(root: HTMLElement): Span[][] {
  const lines: Span[][] = [[]];
  const push = (t: string, b: boolean) => {
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && !!last.b === b) last.t += t;
    else line.push({ t, b });
  };
  const walk = (n: Node, b: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      (n.nodeValue ?? "").split("\n").forEach((part, i) => {
        if (i) lines.push([]);
        if (part) push(part, b);
      });
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.tagName === "BR") return void lines.push([]);
    const bold = b || /^(B|STRONG)$/.test(n.tagName) || Number(n.style.fontWeight) >= 600 || n.style.fontWeight === "bold";
    const block = n.tagName === "DIV" || n.tagName === "P";
    if (block && lines[lines.length - 1].length) lines.push([]);
    n.childNodes.forEach((c) => walk(c, bold));
  };
  root.childNodes.forEach((c) => walk(c, false));
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines;
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: [Handle, number, number][] = [["nw", 0, 0], ["n", 50, 0], ["ne", 100, 0], ["e", 100, 50], ["se", 100, 100], ["s", 50, 100], ["sw", 0, 100], ["w", 0, 50]];
const CURSOR: Record<Handle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

const TEXT_EDGE = 6; // px of draggable border around a text box

function AnnView({ a, scale, focus, selected, onSelect, onChange, onRemove }: { a: Ann; scale: number; focus: boolean; selected: boolean; onSelect: () => void; onChange: (p: Partial<Ann>) => void; onRemove: () => void }) {
  const [live, setLive] = useState<Partial<Ann> | null>(null); // position/size while dragging
  const text = useRef<HTMLDivElement>(null);
  const v = { ...a, ...live };

  useEffect(() => {
    if (a.type !== "text" || !text.current) return;
    if (a.spans) text.current.innerHTML = spansToHtml(a.spans);
    else text.current.innerText = a.text ?? "";
    if (!a.text || focus) {
      text.current.focus();
      // Caret at the end, ready to change the words.
      const range = document.createRange();
      range.selectNodeContents(text.current);
      range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
    // Only on mount: afterwards the element owns its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo / redo changes the words from outside: copy them into the box unless it already shows them.
  useEffect(() => {
    const el = text.current;
    if (a.type !== "text" || !el) return;
    const shown = a.spans ? readSpans(el).map((l) => l.map((x) => x.t).join("")).join("\n") : el.innerText.replace(/\n$/, "");
    if (shown === (a.text ?? "")) return;
    if (a.spans) el.innerHTML = spansToHtml(a.spans);
    else el.innerText = a.text ?? "";
  }, [a.type, a.text, a.spans]);

  function drag(e: React.PointerEvent, mode: "move" | "p1" | "p2" | "rotate" | Handle) {
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, a: { x: a.x, y: a.y, w: a.w, h: a.h } };
    const rot = ((a.rot ?? 0) * Math.PI) / 180;
    const box = (e.currentTarget as HTMLElement).closest(".ann")!.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const keepRatio = a.type === "image" || a.type === "check" || a.type === "cross";
    let last: Partial<Ann> = {};
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale;
      const dy = (ev.clientY - start.y) / scale;
      if (a.type === "line") {
        const [x1, y1, x2, y2] = lineEnds(a);
        last = mode === "p1" ? { x: x1 + dx, y: y1 + dy, x2, y2 } : mode === "p2" ? { x: x1, y: y1, x2: x2 + dx, y2: y2 + dy } : { x: x1 + dx, y: y1 + dy, x2: x2 + dx, y2: y2 + dy };
      } else if (mode === "move") last = { x: start.a.x + dx, y: start.a.y + dy };
      else if (mode === "rotate") {
        let deg = (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) / Math.PI + 90;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        last = { rot: Math.round(((deg % 360) + 360) % 360 * 10) / 10 };
      } else {
        // Resize in the box's own (turned) frame; the opposite side stays where it is.
        const lx = dx * Math.cos(rot) + dy * Math.sin(rot);
        const ly = -dx * Math.sin(rot) + dy * Math.cos(rot);
        const sx = mode.includes("e") ? 1 : mode.includes("w") ? -1 : 0;
        const sy = mode.includes("s") ? 1 : mode.includes("n") ? -1 : 0;
        const { w, h } = start.a;
        let dw = sx ? Math.max(6 - w, sx * lx) : 0;
        let dh = sy ? Math.max(6 - h, sy * ly) : 0;
        if (keepRatio) {
          dw = Math.max(6, w + sx * lx) - w;
          dh = (dw * h) / w;
        }
        const ox = (sx * dw) / 2;
        const oy = (sy * dh) / 2;
        const cx = start.a.x + w / 2 + ox * Math.cos(rot) - oy * Math.sin(rot);
        const cy = start.a.y + h / 2 + ox * Math.sin(rot) + oy * Math.cos(rot);
        last = { x: cx - (w + dw) / 2, y: cy - (h + dh) / 2, w: w + dw, h: h + dh };
      }
      setLive(last);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setLive(null);
      if (Object.keys(last).length) onChange(last);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  // Text boxes get a thin border zone (outside the typing area) that drags the box; the text itself stays put.
  const LINE_PAD = 10;
  const [lx1, ly1, lx2, ly2] = lineEnds(v);
  const box: React.CSSProperties = a.type === "line"
    ? { left: Math.min(lx1, lx2) * scale - LINE_PAD, top: Math.min(ly1, ly2) * scale - LINE_PAD, width: Math.abs(lx2 - lx1) * scale + LINE_PAD * 2, height: Math.abs(ly2 - ly1) * scale + LINE_PAD * 2 }
    : a.type === "text" ? { left: v.x * scale - TEXT_EDGE, top: v.y * scale - TEXT_EDGE, padding: TEXT_EDGE, cursor: "move" } : { left: v.x * scale, top: v.y * scale };
  if (a.type !== "text" && a.type !== "line") Object.assign(box, { width: v.w * scale, height: v.h * scale });
  if (v.rot) box.transform = `rotate(${v.rot}deg)`;
  const keepShape = a.type === "image" || a.type === "check" || a.type === "cross";
  const turnable = a.type !== "text" && a.type !== "line" && a.type !== "redact";

  let body: React.ReactNode = null;
  switch (a.type) {
    case "text":
      body = (
        <div
          ref={text}
          className="ann-text"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          style={{ fontSize: (a.size ?? 14) * scale, lineHeight: a.lead ? `${a.lead * scale}px` : undefined, fontFamily: CSS_FONT[a.font ?? "helv"], color: a.color, fontWeight: a.bold ? 700 : 400 }}
          onInput={(e) => {
            if (!a.spans) return onChange({ text: e.currentTarget.innerText.replace(/\n$/, "") });
            const spans = readSpans(e.currentTarget);
            onChange({ spans, text: spans.map((l) => l.map((x) => x.t).join("")).join("\n") });
          }}
          onFocus={onSelect}
          onBlur={(e) => !e.currentTarget.innerText.trim() && !a.cover && onRemove()}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}
        />
      );
      break;
    case "image":
      body = <img src={a.src} alt="" draggable={false} />;
      break;
    case "check":
    case "cross":
      body = (
        <svg viewBox="0 0 10 10" width="100%" height="100%">
          <path d={a.type === "check" ? "M1.2 5.5 4 8.5 9 1.5" : "M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5"} stroke={a.color} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      );
      break;
    case "line":
      {
        const ox = Math.min(lx1, lx2) * scale - LINE_PAD;
        const oy = Math.min(ly1, ly2) * scale - LINE_PAD;
        const p = [lx1 * scale - ox, ly1 * scale - oy, lx2 * scale - ox, ly2 * scale - oy];
        body = (
          <svg className="ann-line-svg" width="100%" height="100%">
            <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke="transparent" strokeWidth={Math.max(14, (v.thick ?? 1.5) * scale)} strokeLinecap="round" />
            <line x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke={v.color ?? "#000000"} strokeWidth={(v.thick ?? 1.5) * scale} strokeLinecap="round" />
          </svg>
        );
      }
      break;
    default:
      body = null;
  }

  return (
    <div
      className={`ann ann-${a.type}` + (selected ? " sel" : "")}
      style={{ ...box, ...(a.type === "highlight" || a.type === "whiteout" ? { background: a.color } : a.type === "rect" ? { borderColor: a.color, borderWidth: (a.thick ?? 2) * scale } : {}) }}
      onPointerDown={(e) => { if (a.type === "text" && e.target !== e.currentTarget) return; e.preventDefault(); onSelect(); drag(e, "move"); }}
    >
      {body}
      {selected && (
        <>
          {a.type === "text" && <span className="grip" title="Drag to move" onPointerDown={(e) => { e.preventDefault(); drag(e, "move"); }}><GripVertical size={14} /></span>}
          {a.type === "line" && (
            <>
              <span className="handle" style={{ left: lx1 * scale - Math.min(lx1, lx2) * scale + LINE_PAD, top: ly1 * scale - Math.min(ly1, ly2) * scale + LINE_PAD }} onPointerDown={(e) => { e.preventDefault(); drag(e, "p1"); }} />
              <span className="handle" style={{ left: lx2 * scale - Math.min(lx1, lx2) * scale + LINE_PAD, top: ly2 * scale - Math.min(ly1, ly2) * scale + LINE_PAD }} onPointerDown={(e) => { e.preventDefault(); drag(e, "p2"); }} />
            </>
          )}
          {a.type !== "text" && a.type !== "line" &&
            HANDLES.filter(([h]) => !keepShape || h.length === 2).map(([h, l, t]) => (
              <span key={h} className="resize" style={{ left: `${l}%`, top: `${t}%`, cursor: CURSOR[h] }} onPointerDown={(e) => { e.preventDefault(); drag(e, h); }} />
            ))}
          {turnable && <span className="rotate" title="Drag to turn (hold Shift for steps)" onPointerDown={(e) => { e.preventDefault(); drag(e, "rotate"); }} />}
          <button className="ann-del" title="Delete" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}><XIcon size={12} /></button>
        </>
      )}
    </div>
  );
}
