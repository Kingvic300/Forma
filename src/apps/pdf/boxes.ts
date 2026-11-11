// Copy and paste of boxes, and dragging boxes and pages between the two sides of the split view.
// Both PDF editors live in one window, so the copied boxes are kept here and shared by both.
import { uid } from "../../lib/store";
import { lineEnds, type Ann } from "./types";

/** Move a box by (dx, dy) points. Lines move both ends. */
export function shiftAnn(a: Ann, dx: number, dy: number): Ann {
  const out = { ...a, x: a.x + dx, y: a.y + dy };
  if (a.x2 !== undefined) out.x2 = a.x2 + dx;
  if (a.y2 !== undefined) out.y2 = a.y2 + dy;
  return out;
}

/** Fresh copies on `page`: new ids, white patches still tied to their own text, links to boxes left behind dropped. */
export function cloneAnns(list: Ann[], page: number, dx = 0, dy = 0): Ann[] {
  const ids = new Map(list.map((a) => [a.id, uid()]));
  return list.map((a) => {
    const c = shiftAnn({ ...a, id: ids.get(a.id)!, page }, dx, dy);
    if (a.cover && ids.has(a.cover)) c.cover = ids.get(a.cover);
    else delete c.cover;
    return c;
  });
}

/** The area a group of boxes covers, in points. */
export function bounds(list: Ann[]) {
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const a of list) {
    const [ax1, ay1, ax2, ay2] = a.type === "line" ? lineEnds(a) : [a.x, a.y, a.x + a.w, a.y + a.h];
    x1 = Math.min(x1, ax1, ax2);
    y1 = Math.min(y1, ay1, ay2);
    x2 = Math.max(x2, ax1, ax2);
    y2 = Math.max(y2, ay1, ay2);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** How far to move a group so it stays on a page of this size (top left wins when it is too big). */
export function keepOnPage(list: Ann[], size: { w: number; h: number }) {
  const b = bounds(list);
  const dx = Math.min(Math.max(b.x, 0), Math.max(0, size.w - b.w)) - b.x;
  const dy = Math.min(Math.max(b.y, 0), Math.max(0, size.h - b.h)) - b.y;
  return { dx, dy };
}

// ---- Clipboard -----------------------------------------------------------

interface Clip {
  anns: Ann[];
  file: string;
  page: number;
  tag: string;
  /** Pasted this many times onto the page it came from; each paste steps a little further. */
  n: number;
  /** Nothing was copied anywhere since, so a paste means these boxes. */
  fresh: boolean;
}
let clip: Clip | null = null;
let ours = false;
const MARK = "forma-pdf-boxes:";

/** Copy boxes. The system clipboard gets a marker, so a later paste can tell whether something newer was copied. */
export function copyBoxes(anns: Ann[], file: string, page: number) {
  if (!anns.length) return;
  clip = { anns: structuredClone(anns), file, page, tag: uid(), n: 0, fresh: true };
  ours = true;
  setTimeout(() => (ours = false));
  try {
    navigator.clipboard?.writeText(MARK + clip.tag).catch(() => {});
  } catch {
    // No clipboard access: the copy still works inside Forma.
  }
}
export const hasClip = () => !!clip;

/** The copied boxes as new copies for `file`, or null. Pasting on the page they came from steps them down and right. */
export function takeClip(file: string, page: number): Ann[] | null {
  if (!clip) return null;
  const step = clip.file === file && clip.page === page ? 12 * ++clip.n : 0;
  return cloneAnns(clip.anns, page, step, step);
}

/** What a paste event should put on the page: our boxes, a picture, or plain text. */
export function pasteKind(dt: DataTransfer | null): { kind: "boxes" } | { kind: "image"; file: File } | { kind: "text"; text: string } | null {
  const text = dt?.getData("text/plain") ?? "";
  if (clip && (clip.fresh || text === MARK + clip.tag)) return { kind: "boxes" };
  const image = [...(dt?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (image) return { kind: "image", file: image };
  if (text.trim() && !text.startsWith(MARK)) return { kind: "text", text: text.replace(/\r\n?/g, "\n").replace(/\n+$/, "") };
  return clip ? { kind: "boxes" } : null;
}

if (typeof window !== "undefined") {
  // Ctrl+C on a box: put the marker in the system clipboard. Copying anything else replaces the boxes.
  addEventListener("copy", (e) => {
    if (ours && clip) {
      e.clipboardData?.setData("text/plain", MARK + clip.tag);
      e.preventDefault();
    } else if (getSelection()?.toString() || (e.target as HTMLElement | null)?.isContentEditable) clip = null;
  });
  addEventListener("cut", () => (clip = ours ? clip : null));
  // Another program may get something copied meanwhile; the marker check decides then.
  addEventListener("blur", () => clip && (clip.fresh = false));
}

// ---- Drag between pages and sides ----------------------------------------

export const DROP_ANN = "forma-drop-ann";
export const DROP_PAGE = "forma-drop-page";

export interface AnnDrop {
  file: string;
  anns: Ann[];
  /** Where the pointer held the first box, in points from its (x, y). */
  grab: { x: number; y: number };
  clientX: number;
  clientY: number;
}
export interface PageDrop {
  file: string;
  bytes: Uint8Array;
  page: number;
  anns: Ann[];
  /** Insert before this page of the target. */
  at: number;
}

/** A see-through copy of an element that follows the pointer, scaled to the zoom of the page under it. */
export function ghost(node: HTMLElement, grab: { x: number; y: number }, clone = true) {
  const wrap = document.createElement("div");
  wrap.className = "drag-ghost";
  wrap.style.transformOrigin = `${grab.x}px ${grab.y}px`;
  const copy = clone ? (node.cloneNode(true) as HTMLElement) : node;
  copy.classList.remove("sel", "dragging", "leaving");
  copy.removeAttribute("contenteditable");
  copy.querySelectorAll(".resize,.rotate,.ann-del,.grip,.handle,.tdiv").forEach((n) => n.remove());
  copy.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
  copy.style.left = "0px";
  copy.style.top = "0px";
  wrap.append(copy);
  document.body.append(wrap);
  return {
    move(x: number, y: number, k = 1) {
      wrap.style.left = `${x - grab.x}px`;
      wrap.style.top = `${y - grab.y}px`;
      wrap.style.transform = `scale(${k})`;
    },
    remove: () => wrap.remove(),
  };
}

/** Mark one element as the drop target (with a class), clearing the last one. */
export function marker() {
  let on: HTMLElement | null = null;
  let cls = "";
  return (el: HTMLElement | null, c = "drop-target") => {
    if (on === el && cls === c) return;
    on?.classList.remove(cls);
    on = el;
    cls = c;
    el?.classList.add(c);
  };
}
