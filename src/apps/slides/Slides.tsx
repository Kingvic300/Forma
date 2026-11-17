// Slides: a PowerPoint-style editor. Opens and saves .pptx, edits text, shapes and pictures on
// the canvas, adds animations and transitions, and presents full screen.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Baseline, Bold, BringToFront, Copy, Download, Eye, EyeOff, ImagePlus, Italic, List,
  ListOrdered, MoreHorizontal, PaintBucket, PenLine, Play, Plus, Redo2, SendToBack, Shapes, Sparkles, StickyNote, Trash2, Type, Underline, Undo2,
} from "lucide-react";
import { errorText, toast } from "../../lib/dialog";
import { safeName, saveAs } from "../../lib/platform";
import { useFile } from "../../lib/useFile";
import { Menu, Missing, TitleBar, usePane } from "../../ui";
import { Player, schedule } from "./anim";
import { AnimPanel } from "./AnimPanel";
import { Present } from "./Present";
import { Paragraphs, SlideView, textBoxStyle, Thumb, AssetContext } from "./render";
import { domToBody, formatAt, formatParas, formatRuns, getSel, setSel as setDomSel, type Sel } from "./textEdit";
import type { Asset, El, Para, Run, Slide, SlidesData, TextBody } from "./types";
import { LAYOUTS, newSlide, run, uid, type LayoutId } from "./types";
import { presetPath } from "./geometry";

export type { SlidesData } from "./types";

const SHAPES: [string, string][] = [
  ["rect", "Rectangle"], ["roundRect", "Rounded rectangle"], ["ellipse", "Oval"], ["triangle", "Triangle"], ["rtTriangle", "Right triangle"],
  ["diamond", "Diamond"], ["pentagon", "Pentagon"], ["hexagon", "Hexagon"], ["star5", "Star"], ["rightArrow", "Right arrow"],
  ["leftArrow", "Left arrow"], ["upArrow", "Up arrow"], ["downArrow", "Down arrow"], ["chevron", "Chevron"], ["heart", "Heart"],
  ["wedgeRoundRectCallout", "Speech bubble"], ["line", "Line"], ["arrow", "Arrow"],
];
const FONTS = ["Calibri", "Calibri Light", "Arial", "Helvetica", "Verdana", "Tahoma", "Georgia", "Times New Roman", "Garamond", "Courier New"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
const LINE_WIDTHS = [0.75, 1, 1.5, 2.25, 3, 4.5, 6];

let clipboard: { els: El[]; assets: Record<string, Asset> } | null = null;

function toHex(c: string | undefined, fallback = "#000000") {
  if (!c) return fallback;
  if (/^#[0-9a-f]{6}/i.test(c)) return c.slice(0, 7);
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  return "#" + m[1].split(",").slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
}
const canText = (el?: El) => !!el && el.type === "shape" && !["line", "straightConnector1"].includes(el.geom ?? "");
const isEmptyBox = (el: El) => (!el.fill || el.fill.type === "none") && !el.line && !el.text?.paras.some((p) => p.runs.some((r) => r.text));

/** The editable text box, drawn once per editing session so the browser owns its contents. */
const Editable = memo(
  function Editable({ body, setRef, onInput, onKeyDown, onBlur }: { body: TextBody; setRef: (n: HTMLDivElement | null) => void; onInput: () => void; onKeyDown: (e: React.KeyboardEvent) => void; onBlur: (e: React.FocusEvent) => void }) {
    return (
      <div className="sl-editing" contentEditable suppressContentEditableWarning spellCheck ref={setRef} style={textBoxStyle(body)} onInput={onInput} onKeyDown={onKeyDown} onBlur={onBlur}>
        <Paragraphs body={body} editing />
      </div>
    );
  },
  () => true,
);

export default function Slides({ id }: { id: string }) {
  const f = useFile<SlidesData>(id);
  const pane = usePane();
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; session: number } | null>(null);
  const [panel, setPanel] = useState(false);
  const [notes, setNotes] = useState(true);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [scale, setScale] = useState(0.5);
  const [selTick, setSelTick] = useState(0);
  const [dragSlide, setDragSlide] = useState<{ from: number; to: number } | null>(null);
  const history = useRef<{ undo: SlidesData[]; redo: SlidesData[]; tag?: string; at: number }>({ undo: [], redo: [], at: 0 });
  const dataRef = useRef<SlidesData | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const savedSel = useRef<Sel | null>(null);
  const pendingSel = useRef<Sel | "end" | null>(null);
  const editBefore = useRef<SlidesData | null>(null);
  const session = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewing = useRef<Player | null>(null);
  dataRef.current = f.data;

  const deck = f.data;
  const idx = deck ? Math.min(cur, deck.slides.length - 1) : 0;
  const slide = deck?.slides[idx];
  const selected = useMemo(() => (slide ? slide.els.filter((e) => sel.includes(e.id)) : []), [slide, sel]);
  const one = selected.length === 1 ? selected[0] : undefined;

  // Fit the slide to the space it has.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !deck) return;
    const fit = () => setScale(Math.max(0.05, Math.min((el.clientWidth - 48) / deck.w, (el.clientHeight - 48) / deck.h)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [deck?.w, deck?.h, deck !== null]);

  // Keep the text selection while the toolbar has focus, so a format change applies to it.
  useEffect(() => {
    if (!editing) return;
    const onSel = () => {
      const root = editRef.current;
      if (!root) return;
      const s = getSel(root);
      if (s) {
        savedSel.current = s;
        setSelTick((t) => t + 1);
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editing]);

  // Focus a fresh editing session and put the caret where it belongs.
  useLayoutEffect(() => {
    const root = editRef.current;
    if (!editing || !root) return;
    root.focus();
    const p = pendingSel.current;
    pendingSel.current = null;
    if (p && p !== "end") setDomSel(root, p);
    else {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
    }
  }, [editing]);

  // ---- Changes and undo --------------------------------------------------------------------

  const commit = useCallback(
    (next: SlidesData, tag?: string) => {
      const h = history.current;
      const now = Date.now();
      // Typing in a number box or dragging a color picker makes one undo step, not hundreds.
      if (!(tag && tag === h.tag && now - h.at < 1500)) {
        h.undo.push(dataRef.current!);
        if (h.undo.length > 100) h.undo.shift();
      }
      h.tag = tag;
      h.at = now;
      h.redo = [];
      f.setData(next);
    },
    [f.setData],
  );
  const pushHistory = (before: SlidesData) => {
    const h = history.current;
    h.undo.push(before);
    if (h.undo.length > 100) h.undo.shift();
    h.redo = [];
    h.tag = undefined;
  };
  const undo = () => {
    if (editing) finishEdit();
    const prev = history.current.undo.pop();
    if (!prev) return;
    history.current.redo.push(dataRef.current!);
    history.current.tag = undefined;
    f.setData(prev);
  };
  const redo = () => {
    const next = history.current.redo.pop();
    if (!next) return;
    history.current.undo.push(dataRef.current!);
    f.setData(next);
  };

  const mapSlide = (d: SlidesData, fn: (s: Slide) => Slide, at = idx): SlidesData => ({ ...d, slides: d.slides.map((s, i) => (i === at ? fn(s) : s)) });
  const updateSlide = (fn: (s: Slide) => Slide, tag?: string) => deck && commit(mapSlide(deck, fn), tag);
  const updateEls = (fn: (el: El) => El, ids = sel, tag?: string) => updateSlide((s) => ({ ...s, els: s.els.map((e) => (ids.includes(e.id) ? fn(e) : e)) }), tag);

  // ---- Slides -----------------------------------------------------------------------------------

  const addSlide = (layout: LayoutId) => {
    if (!deck) return;
    const s = newSlide(deck, layout);
    if (slide?.bg) s.bg = slide.bg;
    if (slide?.base) {
      s.base = slide.base;
      delete s.bg;
    }
    const slides = deck.slides.slice();
    slides.splice(idx + 1, 0, s);
    commit({ ...deck, slides });
    setCur(idx + 1);
    setSel([]);
  };
  const duplicateSlide = (at = idx) => {
    if (!deck) return;
    const src = deck.slides[at];
    const ids = new Map(src.els.map((e) => [e.id, uid()]));
    const copy: Slide = {
      ...structuredClone({ ...src, els: [], anims: [] }),
      id: uid(),
      els: src.els.map((e) => ({ ...structuredClone(e), id: ids.get(e.id)! })),
      anims: src.anims.map((a) => ({ ...a, id: uid(), target: ids.get(a.target) ?? a.target })),
    };
    const slides = deck.slides.slice();
    slides.splice(at + 1, 0, copy);
    commit({ ...deck, slides });
    setCur(at + 1);
  };
  const deleteSlide = (at = idx) => {
    if (!deck) return;
    if (deck.slides.length === 1) return toast("A presentation needs at least one slide");
    commit({ ...deck, slides: deck.slides.filter((_, i) => i !== at) });
    setCur(Math.max(0, Math.min(at, deck.slides.length - 2)));
    setSel([]);
  };
  const moveSlide = (from: number, to: number) => {
    if (!deck || from === to) return;
    const slides = deck.slides.slice();
    const [s] = slides.splice(from, 1);
    slides.splice(to > from ? to - 1 : to, 0, s);
    commit({ ...deck, slides });
    setCur(to > from ? to - 1 : to);
  };
  const goSlide = (i: number) => {
    if (editing) finishEdit();
    setCur(i);
    setSel([]);
  };

  // ---- Elements ---------------------------------------------------------------------------------

  const insert = (els: El[], assets?: Record<string, Asset>) => {
    if (!deck) return;
    commit({ ...mapSlide(deck, (s) => ({ ...s, els: [...s.els, ...els] })), assets: assets ? { ...deck.assets, ...assets } : deck.assets });
    setSel(els.map((e) => e.id));
  };
  const deleteSelected = () => {
    if (!sel.length) return;
    updateSlide((s) => ({ ...s, els: s.els.filter((e) => !sel.includes(e.id)), anims: s.anims.filter((a) => !sel.includes(a.target)) }));
    setSel([]);
  };
  const duplicateSelected = () => {
    const copies = selected.map((e) => ({ ...structuredClone(e), id: uid(), x: e.x + 16, y: e.y + 16, groups: undefined, sid: undefined }));
    if (copies.length) insert(copies);
  };
  const copySelected = (cut = false) => {
    if (!deck || !selected.length) return;
    const assets: Record<string, Asset> = {};
    for (const e of selected) for (const k of [e.image?.asset, e.media?.asset, e.fill?.type === "image" ? e.fill.asset : undefined]) if (k && deck.assets[k]) assets[k] = deck.assets[k];
    clipboard = { els: structuredClone(selected), assets };
    if (cut) deleteSelected();
  };
  const paste = () => {
    if (!clipboard) return;
    insert(clipboard.els.map((e) => ({ ...structuredClone(e), id: uid(), x: e.x + 16, y: e.y + 16, groups: undefined, sid: undefined })), clipboard.assets);
  };
  const arrange = (how: "front" | "back" | "forward" | "backward") =>
    updateSlide((s) => {
      const els = s.els.slice();
      if (how === "front" || how === "back") {
        const moving = els.filter((e) => sel.includes(e.id));
        const rest = els.filter((e) => !sel.includes(e.id));
        return { ...s, els: how === "front" ? [...rest, ...moving] : [...moving, ...rest] };
      }
      const order = how === "forward" ? [...els.keys()].reverse() : [...els.keys()];
      for (const i of order) {
        const j = how === "forward" ? i + 1 : i - 1;
        if (sel.includes(els[i].id) && els[j] && !sel.includes(els[j].id)) [els[i], els[j]] = [els[j], els[i]];
      }
      return { ...s, els };
    });

  const center = () => ({ x: (deck?.w ?? 1280) / 2, y: (deck?.h ?? 720) / 2 });
  const addTextBox = () => {
    const c = center();
    const el: El = { id: uid(), type: "shape", geom: "rect", x: c.x - 200, y: c.y - 30, w: 400, h: 60, fill: { type: "none" }, text: { paras: [{ runs: [run("", 24)] }], anchor: "t", wrap: true, inset: [9.6, 4.8, 9.6, 4.8] } };
    insert([el]);
    startEdit(el, true);
  };
  const addShape = (geom: string) => {
    const c = center();
    const line = geom === "line" || geom === "arrow";
    const el: El = line
      ? { id: uid(), type: "shape", geom: "line", x: c.x - 150, y: c.y, w: 300, h: 0, line: { color: "#4472c4", width: 2, ...(geom === "arrow" ? { tail: "triangle" } : {}) } }
      : {
          id: uid(), type: "shape", geom, x: c.x - 120, y: c.y - 80, w: 240, h: 160, fill: { type: "solid", color: "#4472c4" }, line: { color: "#2f528f", width: 1 },
          text: { paras: [{ runs: [run("", 18, { color: "#ffffff" })], align: "ctr" }], anchor: "ctr", wrap: true, inset: [9.6, 4.8, 9.6, 4.8] },
        };
    insert([el]);
  };
  async function addFiles(files: File[]) {
    if (!deck) return;
    const els: El[] = [];
    const assets: Record<string, Asset> = {};
    for (const file of files) {
      const key = uid();
      const type = file.type || "application/octet-stream";
      assets[key] = { type, bytes: new Uint8Array(await file.arrayBuffer()) };
      let w = 640, h = 360;
      if (type.startsWith("image/")) {
        try {
          const bmp = await createImageBitmap(file);
          w = bmp.width;
          h = bmp.height;
          bmp.close();
        } catch {
          // SVG and some formats can't be measured this way; keep the default size.
        }
      } else if (type.startsWith("audio/")) {
        w = 320;
        h = 60;
      } else if (!type.startsWith("video/")) {
        toast(`${file.name} isn’t a picture, video or sound`, "error");
        continue;
      }
      const k = Math.min(1, (deck.w * 0.6) / w, (deck.h * 0.6) / h);
      w *= k;
      h *= k;
      const c = center();
      const base = { id: uid(), x: c.x - w / 2 + els.length * 16, y: c.y - h / 2 + els.length * 16, w, h, name: file.name };
      els.push(type.startsWith("image/") ? { ...base, type: "image", image: { asset: key } } : { ...base, type: "media", media: { asset: key, kind: type.startsWith("audio/") ? "audio" : "video" } });
    }
    if (els.length) insert(els, assets);
  }

  // ---- Text editing --------------------------------------------------------------------------------

  function startEdit(el: El, fresh = false) {
    if (!canText(el) || !dataRef.current) return;
    editBefore.current = fresh ? history.current.undo[history.current.undo.length - 1] ?? dataRef.current : dataRef.current;
    if (!el.text) {
      const filled = el.fill && el.fill.type !== "none";
      const text: TextBody = { paras: [{ runs: [run("", 18, { color: filled ? "#ffffff" : "#1f1f1f" })], align: "ctr" }], anchor: "ctr", wrap: true, inset: [9.6, 4.8, 9.6, 4.8] };
      f.setData((d) => mapSlide(d, (s) => ({ ...s, els: s.els.map((e) => (e.id === el.id ? { ...e, text } : e)) })));
    }
    setSel([el.id]);
    pendingSel.current = "end";
    setEditing({ id: el.id, session: session.current++ });
  }
  const readEdit = (): { el: El; body: TextBody } | null => {
    const root = editRef.current;
    const el = editing && dataRef.current ? dataRef.current.slides[idx]?.els.find((e) => e.id === editing.id) : undefined;
    if (!root || !el?.text) return null;
    return { el, body: domToBody(root, el.text) };
  };
  const setText = (elId: string, body: TextBody, extra: Partial<El> = {}) => f.setData((d) => mapSlide(d, (s) => ({ ...s, els: s.els.map((e) => (e.id === elId ? { ...e, ...extra, text: body } : e)) })));

  function finishEdit() {
    const r = readEdit();
    const before = editBefore.current;
    if (r) {
      const after = { ...r.el, text: r.body };
      if (isEmptyBox(after) && !after.prompt) {
        f.setData((d) => mapSlide(d, (s) => ({ ...s, els: s.els.filter((e) => e.id !== r.el.id), anims: s.anims.filter((a) => a.target !== r.el.id) })));
        setSel([]);
      } else setText(r.el.id, r.body);
      if (before && JSON.stringify(before.slides[idx]?.els.find((e) => e.id === r.el.id)?.text) !== JSON.stringify(r.body)) pushHistory(before);
    }
    editBefore.current = null;
    editRef.current = null;
    savedSel.current = null;
    setEditing(null);
  }

  function onEditInput() {
    const r = readEdit();
    if (!r) return;
    const extra: Partial<El> = {};
    // Text boxes grow to fit their text, as in PowerPoint.
    const root = editRef.current!;
    if ((!r.el.fill || r.el.fill.type === "none") && root.scrollHeight > r.el.h + 1) extra.h = root.scrollHeight;
    setText(r.el.id, r.body, extra);
  }

  /** Re-draw the editing session from the model, keeping the selection. */
  function refreshEdit(s: Sel | null) {
    if (!editing) return;
    pendingSel.current = s ?? "end";
    setEditing({ id: editing.id, session: session.current++ });
  }

  const formatRun = (patch: Partial<Run>) => {
    if (editing) {
      const r = readEdit();
      if (!r) return;
      const s = (editRef.current && getSel(editRef.current)) ?? savedSel.current;
      setText(r.el.id, formatRuns(r.body, patch, s));
      refreshEdit(s);
      return;
    }
    updateEls((e) => (e.text ? { ...e, text: formatRuns(e.text, patch) } : e), sel.filter((x) => canText(slide?.els.find((e) => e.id === x))));
  };
  const formatPara = (patch: Partial<Para> | ((p: Para) => Partial<Para>)) => {
    if (editing) {
      const r = readEdit();
      if (!r) return;
      const s = (editRef.current && getSel(editRef.current)) ?? savedSel.current;
      setText(r.el.id, formatParas(r.body, patch, s));
      refreshEdit(s);
      return;
    }
    updateEls((e) => (e.text ? { ...e, text: formatParas(e.text, patch) } : e));
  };
  const setAnchor = (anchor: TextBody["anchor"]) => updateEls((e) => (e.text ? { ...e, text: { ...e.text, anchor } } : e));

  function onEditKey(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      finishEdit();
    } else if (mod && !e.shiftKey && ["b", "i", "u"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const cur = textFormat;
      const k = e.key.toLowerCase();
      formatRun(k === "b" ? { bold: !cur?.bold } : k === "i" ? { italic: !cur?.italic } : { underline: !cur?.underline });
    } else if (e.key === "Tab") {
      e.preventDefault();
      const d = e.shiftKey ? -1 : 1;
      formatPara((p) => ({ level: Math.max(0, Math.min(8, (p.level ?? 0) + d)), marL: Math.max(0, (p.marL ?? 0) + d * 36) }));
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      finishEdit();
      undo();
    }
    e.stopPropagation();
  }

  // ---- Pointer -----------------------------------------------------------------------------------

  function onCanvasDown(e: React.PointerEvent) {
    if (e.button !== 0 || !slide) return;
    const t = e.target as HTMLElement;
    if (t.closest(".sl-handle, .sl-editing")) return;
    if (editing) finishEdit();
    const id = t.closest<HTMLElement>("[data-el]")?.dataset.el;
    const el = id ? slide.els.find((x) => x.id === id) : undefined;
    if (!el) return setSel([]);
    let ids = sel;
    if (e.shiftKey) ids = sel.includes(el.id) ? sel.filter((x) => x !== el.id) : [...sel, el.id];
    else if (!sel.includes(el.id)) ids = [el.id];
    setSel(ids);
    drag(e, ids, "move");
  }

  type Handle = "move" | "rot" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  function drag(e: React.PointerEvent, ids: string[], handle: Handle) {
    e.preventDefault();
    const before = dataRef.current!;
    const start = { x: e.clientX, y: e.clientY };
    const orig = new Map(before.slides[idx].els.filter((x) => ids.includes(x.id)).map((x) => [x.id, x]));
    let moved = false;
    const rect = canvas.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / scale, dy = (ev.clientY - start.y) / scale;
      if (!moved && Math.hypot(dx, dy) * scale < 3) return;
      moved = true;
      f.setData((d) =>
        mapSlide(d, (s) => ({
          ...s,
          els: s.els.map((x) => {
            const o = orig.get(x.id);
            if (!o) return x;
            if (handle === "move") {
              let nx = o.x + dx, ny = o.y + dy;
              // Snap to the slide's centre lines and edges.
              const snap = 6 / scale;
              for (const [pos, size, target] of [[nx, o.w, d.w / 2], [nx, o.w, 0], [nx, o.w, d.w]] as const) {
                if (Math.abs(pos + size / 2 - target) < snap) nx = target - size / 2;
                else if (Math.abs(pos - target) < snap) nx = target;
                else if (Math.abs(pos + size - target) < snap) nx = target - size;
              }
              for (const [pos, size, target] of [[ny, o.h, d.h / 2], [ny, o.h, 0], [ny, o.h, d.h]] as const) {
                if (Math.abs(pos + size / 2 - target) < snap) ny = target - size / 2;
                else if (Math.abs(pos - target) < snap) ny = target;
                else if (Math.abs(pos + size - target) < snap) ny = target - size;
              }
              return { ...x, x: ev.altKey ? o.x + dx : nx, y: ev.altKey ? o.y + dy : ny };
            }
            if (handle === "rot") {
              const cx = rect.left + (o.x + o.w / 2) * scale, cy = rect.top + (o.y + o.h / 2) * scale;
              let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
              if (ev.shiftKey) a = Math.round(a / 15) * 15;
              a = ((a % 360) + 360) % 360;
              return { ...x, rot: a || undefined };
            }
            // Resize in the element's own (rotated) frame.
            const t = ((o.rot ?? 0) * Math.PI) / 180;
            const lx = dx * Math.cos(t) + dy * Math.sin(t), ly = -dx * Math.sin(t) + dy * Math.cos(t);
            let { x: nx, y: ny, w, h } = o;
            const line = o.geom === "line" || o.geom === "straightConnector1";
            const min = line ? 0 : 8;
            if (handle.includes("e")) w = Math.max(min, o.w + lx);
            if (handle.includes("s")) h = Math.max(min, o.h + ly);
            if (handle.includes("w")) {
              w = Math.max(min, o.w - lx);
              nx = o.x + o.w - w;
            }
            if (handle.includes("n")) {
              h = Math.max(min, o.h - ly);
              ny = o.y + o.h - h;
            }
            const keep = (ev.shiftKey || o.type === "image") && handle.length === 2 && o.w && o.h;
            if (keep) {
              const k = Math.max(w / o.w, h / o.h);
              w = o.w * k;
              h = o.h * k;
              if (handle.includes("w")) nx = o.x + o.w - w;
              if (handle.includes("n")) ny = o.y + o.h - h;
            }
            return { ...x, x: nx, y: ny, w, h };
          }),
        })),
      );
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      if (moved) pushHistory(before);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  // ---- Keyboard ------------------------------------------------------------------------------------

  useEffect(() => {
    if (!pane.active || presenting !== null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], .modal, .palette")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inRail = !!t.closest(".sl-rail");
      if (e.key === "F5") {
        e.preventDefault();
        return setPresenting(e.shiftKey ? idx : 0);
      }
      if (mod && k === "z" && !e.shiftKey) return e.preventDefault(), undo();
      if (mod && (k === "y" || (k === "z" && e.shiftKey))) return e.preventDefault(), redo();
      if (mod && k === "m") return e.preventDefault(), addSlide("content");
      if (mod && k === "a" && !inRail) return e.preventDefault(), setSel(slide?.els.map((x) => x.id) ?? []);
      if (mod && k === "c" && sel.length) return e.preventDefault(), copySelected();
      if (mod && k === "x" && sel.length) return e.preventDefault(), copySelected(true);
      if (mod && k === "d") return e.preventDefault(), sel.length && !inRail ? duplicateSelected() : duplicateSlide();
      if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault();
        return sel.length && !inRail ? deleteSelected() : inRail ? deleteSlide() : undefined;
      }
      if (e.key === "Escape" && sel.length) return setSel([]);
      if ((e.key === "Enter" || e.key === "F2") && one && canText(one)) return e.preventDefault(), startEdit(one);
      if (e.key.startsWith("Arrow") && sel.length && !inRail) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        return updateEls((x) => ({ ...x, x: x.x + dx, y: x.y + dy }), sel, "nudge");
      }
      if (!sel.length && deck && (e.key === "PageDown" || e.key === "ArrowDown" || e.key === "ArrowRight")) return e.preventDefault(), goSlide(Math.min(deck.slides.length - 1, idx + 1));
      if (!sel.length && (e.key === "PageUp" || e.key === "ArrowUp" || e.key === "ArrowLeft")) return e.preventDefault(), goSlide(Math.max(0, idx - 1));
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, [contenteditable=true]")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((x) => /^(image|video|audio)\//.test(x.type));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      } else if (clipboard) {
        e.preventDefault();
        paste();
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("paste", onPaste);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("paste", onPaste);
    };
  });

  // ---- Preview -----------------------------------------------------------------------------------

  async function preview() {
    if (!slide || !canvas.current) return;
    if (editing) finishEdit();
    setSel([]);
    previewing.current?.reset();
    const p = new Player(canvas.current, slide, deck!);
    previewing.current = p;
    p.reset();
    for (const step of schedule(slide.anims)) {
      if (previewing.current !== p) return;
      await Promise.all(p.play(step).map((a) => a.finished.catch(() => {})));
      await new Promise((r) => setTimeout(r, 400));
    }
    setTimeout(() => {
      if (previewing.current === p) {
        p.reset();
        canvas.current?.querySelectorAll<HTMLElement>("[data-anim], [data-para]").forEach((n) => (n.style.visibility = ""));
        previewing.current = null;
      }
    }, 600);
  }

  async function download() {
    if (!deck || !f.meta) return;
    try {
      const bytes = await (await import("./exportPptx")).exportPptx(deck);
      await saveAs(`${safeName(f.meta.name)}.pptx`, bytes);
    } catch (e) {
      toast(`Couldn’t save the PowerPoint file: ${errorText(e)}`, "error");
    }
  }

  if (f.missing) return <Missing app="slides" />;
  if (!deck || !f.meta || !slide) return <div className="loading">Loading…</div>;

  const editEl = editing ? slide.els.find((e) => e.id === editing.id) : undefined;
  const textTargets = editing ? (editEl ? [editEl] : []) : selected.filter(canText);
  const textBody = textTargets[0]?.text;
  void selTick;
  const textFormat = textBody ? formatAt(editing && editRef.current ? domToBody(editRef.current, textBody) : textBody, editing ? savedSel.current : null) : undefined;
  const paraFormat = textBody?.paras[editing && savedSel.current ? savedSel.current.start.p : 0];
  const shapeTargets = selected.filter((e) => e.type === "shape" || e.type === "image");
  const fillable = selected.filter((e) => e.type === "shape" && !["line", "straightConnector1"].includes(e.geom ?? ""));
  const bg = slide.bg ?? (slide.base ? deck.bases[slide.base]?.bg : undefined);

  return (
    <div className="app-page slides">
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="slides">
        <button className="icon" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} disabled={!history.current.undo.length}><Undo2 /></button>
        <button className="icon" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo} disabled={!history.current.redo.length}><Redo2 /></button>
        <button className={"icon" + (notes ? " on" : "")} title="Speaker notes" aria-label="Speaker notes" aria-pressed={notes} onClick={() => setNotes(!notes)}><StickyNote /></button>
        <button className={panel ? "on" : ""} title="Animations and transitions" aria-pressed={panel} onClick={() => setPanel(!panel)}><Sparkles /> Animations</button>
        <Menu label={<><Download /> Download</>}>
          <button role="menuitem" onClick={download}>PowerPoint (.pptx)</button>
        </Menu>
        <button className="primary" onClick={() => setPresenting(idx)} title="Present from this slide (Shift+F5). F5 starts from the beginning.">
          <Play /> Present
        </button>
      </TitleBar>

      <div className="toolbar sl-toolbar" ref={toolbar} onMouseDown={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}>
        <Menu label={<><Plus /> New slide</>} align="left">
          {LAYOUTS.map((l) => (
            <button key={l.id} role="menuitem" onClick={() => addSlide(l.id)}>{l.name}</button>
          ))}
        </Menu>
        <span className="sep" />
        <button title="Text box" onClick={addTextBox}><Type /> Text</button>
        <Menu label={<><Shapes /> Shapes</>} align="left">
          <div className="sl-shape-grid">
            {SHAPES.map(([g, name]) => (
              <button key={g} role="menuitem" title={name} aria-label={name} onClick={() => addShape(g)}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
                  <ShapeIcon geom={g} />
                </svg>
              </button>
            ))}
          </div>
        </Menu>
        <button title="Picture, video or sound" onClick={() => fileInput.current?.click()}><ImagePlus /> Media</button>

        {textTargets.length > 0 && (
          <>
            <span className="sep" />
            <select aria-label="Font" value={textFormat?.font ?? ""} onChange={(e) => formatRun({ font: e.target.value })}>
              {!FONTS.includes(textFormat?.font ?? "") && textFormat && <option value={textFormat.font}>{textFormat.font}</option>}
              {FONTS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <select aria-label="Font size" value={textFormat?.size ?? 18} onChange={(e) => formatRun({ size: Number(e.target.value) })} style={{ width: 64 }}>
              {!SIZES.includes(textFormat?.size ?? 18) && <option value={textFormat?.size}>{textFormat?.size}</option>}
              {SIZES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <button className={textFormat?.bold ? "on" : ""} title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => formatRun({ bold: !textFormat?.bold })}><Bold /></button>
            <button className={textFormat?.italic ? "on" : ""} title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => formatRun({ italic: !textFormat?.italic })}><Italic /></button>
            <button className={textFormat?.underline ? "on" : ""} title="Underline (Ctrl+U)" aria-label="Underline" onClick={() => formatRun({ underline: !textFormat?.underline })}><Underline /></button>
            <label className="color" title="Text color" style={{ "--swatch": textFormat?.color } as React.CSSProperties}>
              <Baseline />
              <input type="color" value={toHex(textFormat?.color)} onChange={(e) => formatRun({ color: e.target.value })} />
            </label>
            <span className="sep" />
            {(["l", "ctr", "r", "just"] as const).map((a) => {
              const Icon = a === "l" ? AlignLeft : a === "ctr" ? AlignCenter : a === "r" ? AlignRight : AlignJustify;
              return (
                <button key={a} className={(paraFormat?.align ?? "l") === a ? "on" : ""} title={{ l: "Align left", ctr: "Center", r: "Align right", just: "Justify" }[a]} aria-label={a} onClick={() => formatPara({ align: a === "l" ? undefined : a })}>
                  <Icon />
                </button>
              );
            })}
            <button
              className={paraFormat?.bullet?.char ? "on" : ""}
              title="Bullets"
              aria-label="Bullets"
              onClick={() => formatPara(paraFormat?.bullet?.char ? { bullet: undefined, marL: 0, indent: 0 } : { bullet: { char: "•" }, marL: 28, indent: -28 })}
            >
              <List />
            </button>
            <button
              className={paraFormat?.bullet?.auto ? "on" : ""}
              title="Numbering"
              aria-label="Numbering"
              onClick={() => formatPara(paraFormat?.bullet?.auto ? { bullet: undefined, marL: 0, indent: 0 } : { bullet: { auto: "arabicPeriod", startAt: 1 }, marL: 36, indent: -36 })}
            >
              <ListOrdered />
            </button>
            {!editing && (
              <Menu label={<><ArrowUpToLine /></>} align="left">
                <button role="menuitem" onClick={() => setAnchor("t")}><ArrowUpToLine /> Text at top</button>
                <button role="menuitem" onClick={() => setAnchor("ctr")}><AlignCenter /> Text in the middle</button>
                <button role="menuitem" onClick={() => setAnchor("b")}><ArrowDownToLine /> Text at bottom</button>
              </Menu>
            )}
          </>
        )}

        {shapeTargets.length > 0 && !editing && (
          <>
            <span className="sep" />
            {fillable.length > 0 && (
              <>
                <label className="color" title="Fill color" style={{ "--swatch": fillable[0].fill?.type === "solid" ? fillable[0].fill.color : undefined } as React.CSSProperties}>
                  <PaintBucket />
                  <input type="color" value={toHex(fillable[0].fill?.type === "solid" ? fillable[0].fill.color : "#4472c4")} onChange={(e) => updateEls((x) => (fillable.includes(x) || fillable.some((y) => y.id === x.id) ? { ...x, fill: { type: "solid", color: e.target.value } } : x), sel, "fill")} />
                </label>
                <button title="No fill" onClick={() => updateEls((x) => (fillable.some((y) => y.id === x.id) ? { ...x, fill: { type: "none" } } : x))}>No fill</button>
              </>
            )}
            <label className="color" title="Line color" style={{ "--swatch": shapeTargets[0].line?.color } as React.CSSProperties}>
              <PenLine />
              <input type="color" value={toHex(shapeTargets[0].line?.color, "#2f528f")} onChange={(e) => updateEls((x) => ({ ...x, line: { width: 1, ...x.line, color: e.target.value } }), sel, "line")} />
            </label>
            <select aria-label="Line width" value={shapeTargets[0].line ? String(Math.round(shapeTargets[0].line.width * 0.75 * 100) / 100) : "0"} onChange={(e) => updateEls((x) => (Number(e.target.value) ? { ...x, line: { color: "#2f528f", ...x.line, width: Number(e.target.value) / 0.75 } } : { ...x, line: undefined }))} style={{ width: 84 }}>
              <option value="0">No line</option>
              {!LINE_WIDTHS.includes(Math.round((shapeTargets[0].line?.width ?? 0) * 0.75 * 100) / 100) && shapeTargets[0].line && <option value={String(Math.round(shapeTargets[0].line.width * 0.75 * 100) / 100)}>{Math.round(shapeTargets[0].line.width * 0.75 * 100) / 100} pt</option>}
              {LINE_WIDTHS.map((w) => <option key={w} value={String(w)}>{w} pt</option>)}
            </select>
          </>
        )}

        {sel.length > 0 && !editing && (
          <>
            <span className="sep" />
            <Menu label={<><BringToFront /> Arrange</>} align="left">
              <button role="menuitem" onClick={() => arrange("front")}><BringToFront /> Bring to front</button>
              <button role="menuitem" onClick={() => arrange("forward")}><ArrowUpToLine /> Bring forward</button>
              <button role="menuitem" onClick={() => arrange("backward")}><ArrowDownToLine /> Send backward</button>
              <button role="menuitem" onClick={() => arrange("back")}><SendToBack /> Send to back</button>
            </Menu>
            <button title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={duplicateSelected}><Copy /></button>
            <button title="Delete (Del)" aria-label="Delete" onClick={deleteSelected}><Trash2 /></button>
          </>
        )}

        {!sel.length && !editing && (
          <>
            <span className="sep" />
            <label className="color" title="Slide background" style={{ "--swatch": bg?.type === "solid" ? bg.color : undefined } as React.CSSProperties}>
              <PaintBucket />
              <input type="color" value={toHex(bg?.type === "solid" ? bg.color : "#ffffff", "#ffffff")} onChange={(e) => updateSlide((s) => ({ ...s, bg: { type: "solid", color: e.target.value } }), "bg")} />
            </label>
            <button title="Use this background on every slide" onClick={() => bg && commit({ ...deck, slides: deck.slides.map((s) => ({ ...s, bg })) })}>Background for all</button>
          </>
        )}

      </div>

      <div className="sl-body">
        <nav className="sl-rail" aria-label="Slides">
          {deck.slides.map((s, i) => (
            <div
              key={s.id}
              className={"sl-rail-item" + (i === idx ? " on" : "") + (s.hidden ? " hidden-slide" : "") + (dragSlide?.to === i ? " drop-before" : "") + (dragSlide?.to === deck.slides.length && i === deck.slides.length - 1 ? " drop-after" : "")}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-forma-slide", String(i));
                setDragSlide({ from: i, to: i });
              }}
              onDragOver={(e) => {
                if (!dragSlide) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setDragSlide({ ...dragSlide, to: e.clientY > r.top + r.height / 2 ? i + 1 : i });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragSlide) moveSlide(dragSlide.from, dragSlide.to);
                setDragSlide(null);
              }}
              onDragEnd={() => setDragSlide(null)}
            >
              <span className="sl-num">{i + 1}</span>
              <button className="sl-thumb-btn" aria-label={`Slide ${i + 1}`} aria-current={i === idx} onClick={() => goSlide(i)}>
                <Thumb deck={deck} slide={s} width={150} />
                {s.anims.length > 0 && <Sparkles className="sl-has-fx" aria-label="Has animations" />}
              </button>
              <Menu label={<MoreHorizontal />} className="icon sl-rail-more" align="left">
                <button role="menuitem" onClick={() => duplicateSlide(i)}><Copy /> Duplicate</button>
                <button role="menuitem" onClick={() => commit({ ...deck, slides: deck.slides.map((x, j) => (j === i ? { ...x, hidden: !x.hidden || undefined } : x)) })}>
                  {s.hidden ? <Eye /> : <EyeOff />} {s.hidden ? "Show in slide show" : "Hide in slide show"}
                </button>
                <button role="menuitem" onClick={() => deleteSlide(i)}><Trash2 /> Delete</button>
              </Menu>
            </div>
          ))}
          <button className="sl-rail-add" onClick={() => addSlide("content")}><Plus /> New slide</button>
        </nav>

        <div className="sl-main">
          <div className="sl-canvas-wrap" ref={wrap} onPointerDown={(e) => e.target === e.currentTarget && (editing ? finishEdit() : setSel([]))}>
            <div className="sl-canvas-box" style={{ width: deck.w * scale, height: deck.h * scale }}>
              <div
                className="sl-canvas"
                ref={canvas}
                style={{ transform: `scale(${scale})` }}
                onPointerDown={onCanvasDown}
                onDoubleClick={(e) => {
                  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-el]")?.dataset.el;
                  const el = slide.els.find((x) => x.id === id);
                  if (el && canText(el) && editing?.id !== el.id) startEdit(el);
                }}
                onDragOver={(e) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), e.stopPropagation())}
                onDrop={(e) => {
                  const files = Array.from(e.dataTransfer.files).filter((x) => /^(image|video|audio)\//.test(x.type));
                  if (files.length) {
                    e.preventDefault();
                    e.stopPropagation();
                    addFiles(files);
                  }
                }}
              >
                <SlideView deck={deck} slide={slide} opts={{ prompts: true, hideText: editing?.id }}>
                  <AssetContext.Provider value={deck.assets}>
                    {editEl?.text && (
                      <div className="sl-edit-box" style={{ left: editEl.x, top: editEl.y, width: editEl.w, height: editEl.h, transform: editEl.rot ? `rotate(${editEl.rot}deg)` : undefined }}>
                        <Editable
                          key={editing!.session}
                          body={editEl.text}
                          setRef={(n) => (editRef.current = n)}
                          onInput={onEditInput}
                          onKeyDown={onEditKey}
                          onBlur={(e) => {
                            const to = e.relatedTarget as Node | null;
                            if (to && (toolbar.current?.contains(to) || (to as HTMLElement).closest?.(".menu-pop"))) return;
                            if (editRef.current === e.currentTarget) finishEdit();
                          }}
                        />
                      </div>
                    )}
                    {selected.map((el) => (
                      <div key={el.id} className={"sl-sel" + (editing?.id === el.id ? " editing" : "")} style={{ left: el.x, top: el.y, width: el.w, height: el.h, transform: el.rot ? `rotate(${el.rot}deg)` : undefined, "--k": 1 / scale } as React.CSSProperties}>
                        {selected.length === 1 && editing?.id !== el.id && (
                          <>
                            {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((h) => (
                              <span key={h} className={"sl-handle h-" + h} onPointerDown={(e) => (e.stopPropagation(), drag(e, [el.id], h))} />
                            ))}
                            <span className="sl-handle h-rot" title="Rotate (Shift snaps to 15°)" onPointerDown={(e) => (e.stopPropagation(), drag(e, [el.id], "rot"))} />
                          </>
                        )}
                      </div>
                    ))}
                  </AssetContext.Provider>
                </SlideView>
              </div>
            </div>
          </div>
          {notes && (
            <textarea
              className="sl-notes"
              placeholder="Click to add speaker notes"
              aria-label="Speaker notes"
              value={slide.notes}
              onChange={(e) => updateSlide((s) => ({ ...s, notes: e.target.value }), "notes" + slide.id)}
            />
          )}
        </div>

        {panel && (
          <AnimPanel
            slide={slide}
            selected={one}
            onChange={(s, tag) => updateSlide(() => s, tag)}
            onSelect={(t) => {
              const ids = slide.els.filter((e) => e.id === t || e.groups?.includes(t)).map((e) => e.id);
              setSel(ids);
            }}
            onPreview={preview}
            onApplyAll={(transition, advance) => commit({ ...deck, slides: deck.slides.map((s) => ({ ...s, transition: transition && { ...transition }, advance })) })}
          />
        )}
      </div>

      <div className="docbar">
        <span>Slide {idx + 1} of {deck.slides.length}</span>
        {slide.hidden && <span>Hidden in slide show</span>}
        <span className="grow" />
        <span>{Math.round(scale * 100)}%</span>
      </div>

      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/*,video/*,audio/*"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          addFiles(list);
        }}
      />
      {presenting !== null && (
        <Present
          deck={deck}
          start={presenting}
          onExit={(at) => {
            setPresenting(null);
            setCur(at);
          }}
        />
      )}
    </div>
  );
}

function ShapeIcon({ geom }: { geom: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  if (geom === "line") return <path d="M4 18 L20 6" {...p} />;
  if (geom === "arrow") return <path d="M4 18 L19 7 M13 7 H19 V13" {...p} />;
  const wide = ["rect", "roundRect", "chevron", "wedgeRoundRectCallout", "rightArrow", "leftArrow"].includes(geom);
  return (
    <g transform={`translate(3 ${wide ? 5.5 : 3})`}>
      <path d={presetPath(geom, 18, wide ? 13 : 18)} {...p} />
    </g>
  );
}
