// DOM helpers for the Docs editor: selections, blocks, font sizes, tables, caret save/restore and HTML clean-up.
import { isSafeHref } from "../../lib/links";

export const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

export const BLOCK_SEL = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div:not(.page-break):not(.toc)";

/** The selection's range, if it lies inside `root`. */
export function rangeIn(root: HTMLElement | null) {
  const sel = getSelection();
  if (!root || !sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return root.contains(r.commonAncestorContainer) ? r : null;
}

export function selectRange(r: Range) {
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

const elementOf = (n: Node | null) => (n ? (n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement) : null);

/** The element the caret (or the start of the selection) sits in. */
export function caretElement(root: HTMLElement) {
  const r = rangeIn(root);
  return r ? elementOf(r.startContainer) : null;
}

/** Paragraph-level elements touched by the selection. Loose text is wrapped in a paragraph first. */
export function selectedBlocks(root: HTMLElement): HTMLElement[] {
  let r = rangeIn(root);
  if (!r) return [];
  const own = (el: HTMLElement | null) => {
    const b = el?.closest<HTMLElement>(BLOCK_SEL);
    return b && b !== root && root.contains(b) ? b : null;
  };
  if (!own(elementOf(r.startContainer))) {
    exec("formatBlock", "p");
    r = rangeIn(root);
    if (!r) return [];
  }
  const list = [...root.querySelectorAll<HTMLElement>(BLOCK_SEL)].filter((b) => r!.intersectsNode(b) && !b.querySelector(BLOCK_SEL));
  const first = own(elementOf(r.startContainer));
  if (first && !list.includes(first)) list.unshift(first);
  return list;
}

/** Font size in points at the caret. */
export function sizeAt(root: HTMLElement) {
  const el = caretElement(root) ?? root;
  return Math.round((parseFloat(getComputedStyle(el).fontSize) || 14.67) * 0.75 * 2) / 2;
}

/** Set an exact point size on the selection (execCommand only knows sizes 1 to 7). */
export function setFontSize(root: HTMLElement, pt: number) {
  root.focus();
  exec("styleWithCSS", "false");
  exec("fontSize", "7");
  exec("styleWithCSS", "true");
  const made: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>('font[size="7"]').forEach((f) => {
    const s = document.createElement("span");
    s.style.fontSize = `${pt}pt`;
    if (f.getAttribute("face")) s.style.fontFamily = f.getAttribute("face")!;
    if (f.getAttribute("color")) s.style.color = f.getAttribute("color")!;
    s.append(...f.childNodes);
    s.querySelectorAll<HTMLElement>("[style]").forEach((e) => (e.style.fontSize = ""));
    f.replaceWith(s);
    made.push(s);
  });
  // Browsers that write CSS anyway use the keyword size for 7.
  root.querySelectorAll<HTMLElement>("[style]").forEach((e) => {
    if (e.style.fontSize === "xxx-large" || e.style.fontSize === "-webkit-xxx-large") {
      e.style.fontSize = `${pt}pt`;
      made.push(e);
    }
  });
  if (made.length) {
    const r = document.createRange();
    r.setStartBefore(made[0]);
    r.setEndAfter(made[made.length - 1]);
    selectRange(r);
  }
}

/** Every text node inside the range, with the part of it the range covers. */
function textPieces(root: HTMLElement, r: Range) {
  const out: { node: Text; from: number; to: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!r.intersectsNode(n)) continue;
    const from = n === r.startContainer ? r.startOffset : 0;
    const to = n === r.endContainer ? r.endOffset : n.length;
    if (to > from) out.push({ node: n, from, to });
  }
  return out;
}

/** lower / UPPER / Title Case on the selected words, keeping their formatting. */
export function changeCase(root: HTMLElement, mode: "lower" | "upper" | "title") {
  const r = rangeIn(root);
  if (!r || r.collapsed) return false;
  const pieces = textPieces(root, r);
  let prev = " ";
  for (const p of pieces) {
    const t = p.node.data;
    let mid = t.slice(p.from, p.to);
    if (mode === "lower") mid = mid.toLowerCase();
    else if (mode === "upper") mid = mid.toUpperCase();
    else mid = [...mid].map((ch, i) => ((i ? mid[i - 1] : prev).match(/[\s\-–—(/"“]/) ? ch.toUpperCase() : ch.toLowerCase())).join("");
    prev = mid.slice(-1) || prev;
    p.node.data = t.slice(0, p.from) + mid + t.slice(p.to);
  }
  const nr = document.createRange();
  nr.setStart(pieces[0].node, pieces[0].from);
  nr.setEnd(pieces[pieces.length - 1].node, pieces[pieces.length - 1].to);
  selectRange(nr);
  return true;
}

/** Caret / selection as character offsets in the page text, so it survives replacing the HTML. */
export function saveCaret(root: HTMLElement): [number, number] | null {
  const r = rangeIn(root);
  if (!r) return null;
  const at = (node: Node, offset: number) => {
    const m = document.createRange();
    m.setStart(root, 0);
    m.setEnd(node, offset);
    return m.toString().length;
  };
  return [at(r.startContainer, r.startOffset), at(r.endContainer, r.endOffset)];
}

export function restoreCaret(root: HTMLElement, pos: [number, number] | null) {
  if (!pos) return;
  const find = (n: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let left = n;
    let last: Text | null = null;
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      if (left <= t.length) return [t, left];
      left -= t.length;
      last = t;
    }
    return last ? [last, last.length] : [root, root.childNodes.length];
  };
  const r = document.createRange();
  r.setStart(...find(pos[0]));
  r.setEnd(...find(pos[1]));
  selectRange(r);
}

/* ---------- Tables ---------- */

export function cellAt(root: HTMLElement) {
  const c = caretElement(root)?.closest<HTMLTableCellElement>("td,th");
  return c && root.contains(c) ? c : null;
}

const blankCell = (like: HTMLTableCellElement) => {
  const c = document.createElement(like.tagName.toLowerCase() as "td");
  c.innerHTML = "<br>";
  if (like.style.backgroundColor) c.style.backgroundColor = like.style.backgroundColor;
  if (like.style.borderColor) c.style.borderColor = like.style.borderColor;
  if (like.style.borderWidth) c.style.borderWidth = like.style.borderWidth;
  return c;
};

export type TableOp = "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol" | "delTable" | "distribute" | "headerRow";

export function tableOp(cell: HTMLTableCellElement, op: TableOp) {
  const row = cell.parentElement as HTMLTableRowElement;
  const table = cell.closest("table")!;
  const idx = cell.cellIndex;
  const rows = [...table.rows];
  switch (op) {
    case "rowAbove":
    case "rowBelow": {
      const tr = document.createElement("tr");
      [...row.cells].forEach((c) => tr.append(blankCell(c)));
      row.parentElement!.insertBefore(tr, op === "rowAbove" ? row : row.nextSibling);
      return tr.cells[idx];
    }
    case "colLeft":
    case "colRight":
      for (const r of rows) {
        const ref = r.cells[Math.min(idx, r.cells.length - 1)];
        if (ref) r.insertBefore(blankCell(ref), op === "colLeft" ? ref : ref.nextSibling);
      }
      return null;
    case "delRow":
      if (rows.length <= 1) table.remove();
      else row.remove();
      return null;
    case "delCol":
      if (row.cells.length <= 1) table.remove();
      else for (const r of rows) r.cells[idx]?.remove();
      return null;
    case "delTable":
      table.remove();
      return null;
    case "distribute": {
      const n = Math.max(...rows.map((r) => r.cells.length));
      for (const r of rows) for (const c of r.cells) c.style.width = `${(100 / n).toFixed(2)}%`;
      return null;
    }
    case "headerRow": {
      const first = rows[0];
      const toTh = first.cells[0]?.tagName !== "TH";
      [...first.cells].forEach((c) => {
        const n = document.createElement(toTh ? "th" : "td");
        n.innerHTML = c.innerHTML;
        n.style.cssText = c.style.cssText;
        c.replaceWith(n);
      });
      return null;
    }
  }
}

/* ---------- Clean HTML (pasted from AI answers) ---------- */

const ALLOWED = new Set("P H1 H2 H3 H4 H5 H6 UL OL LI B STRONG I EM U S STRIKE DEL A BR BLOCKQUOTE PRE CODE TABLE THEAD TBODY TR TD TH SPAN SUB SUP HR IMG DIV".split(" "));
const ALLOWED_CLASS = new Set(["subtitle", "checklist", "checked", "page-break", "doc-table"]);

/** Keep only plain document markup: no scripts, handlers, outside images or unsafe links. */
export function cleanHtml(html: string, images: Map<string, string> = new Map()) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.tagName)) {
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(child.tagName)) child.remove();
        else {
          walk(child);
          child.replaceWith(...child.childNodes);
        }
        continue;
      }
      for (const a of [...child.attributes]) {
        const n = a.name.toLowerCase();
        const keep =
          (n === "href" && child.tagName === "A" && (isSafeHref(a.value) || a.value.startsWith("#"))) ||
          (n === "style" && !/url\(|expression|javascript:/i.test(a.value)) ||
          ((n === "colspan" || n === "rowspan") && /^\d+$/.test(a.value)) ||
          (n === "id" && /^h-[\w-]+$/.test(a.value)) ||
          n === "alt" ||
          (n === "src" && child.tagName === "IMG" && images.has(a.value)) ||
          (n === "class" && a.value.split(/\s+/).every((c) => ALLOWED_CLASS.has(c)));
        if (!keep) child.removeAttribute(a.name);
        else if (n === "src") child.setAttribute("src", images.get(a.value)!);
      }
      if (child.tagName === "IMG" && !child.getAttribute("src")) {
        child.remove();
        continue;
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** The page's HTML with image data swapped for short tokens (and the map to put them back). */
export function htmlForAi(html: string) {
  const images = new Map<string, string>();
  const out = html.replace(/(<img[^>]*?\ssrc=")([^"]*)(")/gi, (_, a, src, b) => {
    const token = `img:${images.size + 1}`;
    images.set(token, src);
    return a + token + b;
  });
  return { html: out, images };
}

/** Counts shown in Tools › Word count. */
export function counts(text: string) {
  const t = text.replace(/​/g, "");
  return { words: t.trim() ? t.trim().split(/\s+/).length : 0, chars: t.replace(/\n/g, "").length, noSpaces: t.replace(/\s/g, "").length };
}
