// Text editing on the canvas. The editable box is ordinary HTML drawn from the model; when an
// edit or a format change happens it is read back into paragraphs and runs. Formatting travels
// on data attributes, which browsers copy when they split a paragraph or a run.
import type { Para, Run, TextBody } from "./types";

export interface Caret {
  p: number;
  o: number;
}
export interface Sel {
  start: Caret;
  end: Caret;
}

const isBlock = (n: Node): n is HTMLElement => n instanceof HTMLElement && (n.tagName === "DIV" || n.tagName === "P");

/** The paragraph blocks of an editable box, in order. */
function blocks(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    const inner = Array.from(el.children).filter(isBlock);
    if (!inner.length || el.dataset.para !== undefined) out.push(el);
    else inner.forEach(walk);
  };
  const top = Array.from(root.childNodes);
  if (!top.length) return [];
  // Text typed straight into the box (no paragraph yet) counts as one paragraph.
  if (top.some((n) => !isBlock(n) && (n.textContent ?? "").replace(/​/g, "").length)) return [root];
  top.filter(isBlock).forEach(walk);
  return out;
}

/** Text nodes and line breaks of one paragraph, skipping the bullet. */
function pieces(block: HTMLElement): (Text | HTMLBRElement)[] {
  const out: (Text | HTMLBRElement)[] = [];
  const walk = (n: Node) => {
    if (n instanceof HTMLElement && n.dataset.bullet !== undefined) return;
    if (n.nodeType === Node.TEXT_NODE) out.push(n as Text);
    else if (n instanceof HTMLBRElement) out.push(n);
    else n.childNodes.forEach(walk);
  };
  block.childNodes.forEach(walk);
  // A trailing <br> only keeps an empty line open.
  while (out.length && out[out.length - 1] instanceof HTMLBRElement) out.pop();
  return out;
}
const pieceText = (n: Text | HTMLBRElement) => (n instanceof HTMLBRElement ? "\n" : (n.data ?? "").replace(/​/g, ""));

export function domToBody(root: HTMLElement, before: TextBody): TextBody {
  const fallbackPara = before.paras[0] ?? { runs: [] };
  const fallbackRun: Omit<Run, "text"> = (() => {
    const { text: _t, ...r } = fallbackPara.runs[0] ?? { text: "", size: 18, font: "Calibri", color: "#1f1f1f" };
    return r;
  })();
  const paras: Para[] = [];
  for (const b of blocks(root)) {
    const pp: Omit<Para, "runs"> = b.dataset.pp ? JSON.parse(b.dataset.pp) : paras.length ? { ...paras[paras.length - 1], runs: undefined } : { ...fallbackPara, runs: undefined };
    delete (pp as Partial<Para>).runs;
    const runs: Run[] = [];
    let last: Omit<Run, "text"> = (() => {
      const first = b.querySelector<HTMLElement>("[data-run]");
      return first ? JSON.parse(first.dataset.run!) : paras.length ? (({ text: _t, ...r }) => r)(paras[paras.length - 1].runs[0]) : fallbackRun;
    })();
    for (const n of pieces(b)) {
      const span = (n instanceof Text ? n.parentElement : n)?.closest<HTMLElement>("[data-run]");
      const props: Omit<Run, "text"> = span && b.contains(span) ? JSON.parse(span.dataset.run!) : last;
      last = props;
      const text = pieceText(n);
      if (!text) continue;
      const prev = runs[runs.length - 1];
      if (prev && sameFormat(prev, props)) prev.text += text;
      else runs.push({ ...props, text });
    }
    if (!runs.length) runs.push({ ...last, text: "" });
    paras.push({ ...(pp as Omit<Para, "runs">), runs });
  }
  if (!paras.length) paras.push({ ...fallbackPara, runs: [{ ...fallbackRun, text: "" }] });
  return { ...before, paras };
}

const KEYS: (keyof Run)[] = ["size", "font", "color", "bold", "italic", "underline", "strike", "baseline", "caps", "highlight", "link"];
export const sameFormat = (a: Partial<Run>, b: Partial<Run>) => KEYS.every((k) => (a[k] ?? false) === (b[k] ?? false));

function caretOf(root: HTMLElement, node: Node, offset: number): Caret | null {
  const bs = blocks(root);
  for (let p = 0; p < bs.length; p++) {
    if (!bs[p].contains(node) && bs[p] !== node) continue;
    let o = 0;
    for (const piece of pieces(bs[p])) {
      if (piece === node) return { p, o: o + Math.min(offset, pieceText(piece).length) };
      // The caret sits between children of an element: count the pieces before that child.
      if (node.nodeType === Node.ELEMENT_NODE && node.contains(piece)) {
        const child = node.childNodes[offset];
        if (child && (child === piece || child.contains(piece))) return { p, o };
      }
      o += pieceText(piece).length;
    }
    return { p, o };
  }
  return null;
}

export function getSel(root: HTMLElement): Sel | null {
  const s = getSelection();
  if (!s || !s.rangeCount || !root.contains(s.anchorNode)) return null;
  const a = caretOf(root, s.anchorNode!, s.anchorOffset);
  const f = caretOf(root, s.focusNode!, s.focusOffset);
  if (!a || !f) return null;
  const forward = a.p < f.p || (a.p === f.p && a.o <= f.o);
  return forward ? { start: a, end: f } : { start: f, end: a };
}

export function setSel(root: HTMLElement, sel: Sel) {
  const find = (c: Caret): [Node, number] => {
    const b = blocks(root)[c.p];
    if (!b) return [root, root.childNodes.length];
    let o = c.o;
    for (const piece of pieces(b)) {
      const len = pieceText(piece).length;
      if (o <= len && piece instanceof Text) return [piece, o];
      o -= len;
    }
    return [b, b.childNodes.length];
  };
  const r = document.createRange();
  try {
    r.setStart(...find(sel.start));
    r.setEnd(...find(sel.end));
    const s = getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
  } catch {
    // The text changed under the caret; leave the selection where the browser put it.
  }
}

const collapsed = (s: Sel) => s.start.p === s.end.p && s.start.o === s.end.o;

/** Apply run formatting to a selection, or to every run when there is none. */
export function formatRuns(body: TextBody, patch: Partial<Run>, sel?: Sel | null): TextBody {
  if (!sel || collapsed(sel)) return { ...body, paras: body.paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, ...patch })) })) };
  const paras = body.paras.map((p, pi) => {
    if (pi < sel.start.p || pi > sel.end.p) return p;
    const from = pi === sel.start.p ? sel.start.o : 0;
    const to = pi === sel.end.p ? sel.end.o : Infinity;
    const runs: Run[] = [];
    let o = 0;
    for (const r of p.runs) {
      const a = o, b = o + r.text.length;
      o = b;
      const s = Math.max(a, from), e = Math.min(b, to);
      if (s >= e) {
        runs.push(r);
        continue;
      }
      if (s > a) runs.push({ ...r, text: r.text.slice(0, s - a) });
      runs.push({ ...r, ...patch, text: r.text.slice(s - a, e - a) });
      if (e < b) runs.push({ ...r, text: r.text.slice(e - a) });
    }
    // An empty paragraph inside the selection still takes the format, for what is typed next.
    if (!p.runs.some((r) => r.text)) return { ...p, runs: p.runs.map((r) => ({ ...r, ...patch })) };
    return { ...p, runs };
  });
  return { ...body, paras };
}

/** Apply paragraph formatting to the paragraphs a selection touches, or to all of them. */
export function formatParas(body: TextBody, patch: Partial<Para> | ((p: Para) => Partial<Para>), sel?: Sel | null): TextBody {
  return {
    ...body,
    paras: body.paras.map((p, i) => (!sel || (i >= sel.start.p && i <= sel.end.p) ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)),
  };
}

/** The format at the start of a selection, for showing the toolbar state. */
export function formatAt(body: TextBody, sel?: Sel | null): Run | undefined {
  const p = body.paras[sel?.start.p ?? 0];
  if (!p) return undefined;
  if (!sel) return p.runs.find((r) => r.text) ?? p.runs[0];
  let o = 0;
  for (const r of p.runs) {
    if (sel.start.o < o + r.text.length || (collapsed(sel) && sel.start.o === o + r.text.length)) return r;
    o += r.text.length;
  }
  return p.runs[p.runs.length - 1];
}
