// Ask Groq to work on a presentation. The model never edits the file directly: it answers with a
// list of operations (add a slide, change some text, animate a shape…) that are applied here as
// one change, so a single Ctrl+Z takes the whole answer back.
import { groqChat } from "../../lib/groq";
import { parseJson, type AiHistory } from "../../lib/AiPanel";
import { effectLength, makeEffect, PRESETS } from "./anim";
import { formatParas, formatRuns } from "./textEdit";
import type { El, Fill, Para, Slide, SlidesData, TextBody, Transition } from "./types";
import { DEFAULT_COLOR, LAYOUTS, newSlide, plainText, run, textBox, uid, type LayoutId } from "./types";

type Box = { x: number; y: number; w: number; h: number };
type Fmt = { color?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; font?: string; align?: "l" | "ctr" | "r" | "just" };

export type SlideOp =
  | { op: "add_slide"; after?: number; layout?: LayoutId; title?: string; subtitle?: string; bullets?: string[]; left?: string[]; right?: string[]; notes?: string }
  | { op: "delete_slide"; slide: number }
  | { op: "move_slide"; slide: number; to: number }
  | { op: "duplicate_slide"; slide: number }
  | { op: "hide_slide"; slide: number; hidden: boolean }
  | { op: "set_text"; slide: number; id: string; text: string }
  | ({ op: "add_text"; slide: number; id?: string; text: string; bullets?: boolean } & Box & Fmt)
  | ({ op: "add_shape"; slide: number; id?: string; shape: string; fill?: string; line?: string; text?: string } & Box & Fmt)
  | ({ op: "update"; slide: number; id: string; x?: number; y?: number; w?: number; h?: number; rot?: number; fill?: string; line?: string } & Fmt)
  | { op: "delete"; slide: number; id: string }
  | { op: "background"; slide: number | "all"; color: string }
  | { op: "notes"; slide: number; text: string }
  | { op: "animate"; slide: number; id: string; effect: string; trigger?: "click" | "with" | "after"; duration?: number; delay?: number }
  | { op: "clear_animations"; slide: number; id?: string }
  | { op: "transition"; slide: number | "all"; type: Transition["type"]; dir?: Transition["dir"]; duration?: number };

const TRANSITION_TYPES = ["none", "fade", "black", "push", "wipe", "cover", "uncover", "split", "zoom", "circle", "flip", "dissolve"];

function system(deck: SlidesData) {
  return `You are the AI assistant inside a presentation editor (like PowerPoint). You can answer questions about the deck and change it.
Reply with JSON only: {"reply": "<short message to the user>", "ops": [ ... ]}.
Slides are numbered from 1. Coordinates and sizes are pixels on a ${deck.w} x ${deck.h} slide, origin top-left. Font sizes are points. Colors are "#rrggbb".
Operations run in order; a slide number always means the deck as it is after the operations before it.
Each op is one of:
 {"op":"add_slide","after":<slide number, 0 = first>,"layout":"${LAYOUTS.map((l) => l.id).join("|")}","title":"...","subtitle":"...","bullets":["..."],"left":["..."],"right":["..."],"notes":"..."}
   (title layout uses title+subtitle; content uses title+bullets; two uses title+left+right; section uses title+subtitle)
 {"op":"delete_slide","slide":2}   {"op":"move_slide","slide":5,"to":2}   {"op":"duplicate_slide","slide":3}   {"op":"hide_slide","slide":4,"hidden":true}
 {"op":"set_text","slide":1,"id":"<element id>","text":"line one\\nline two"}   (replaces all text, keeps its formatting; one line per paragraph)
 {"op":"add_text","slide":1,"id":"<your own id, optional>","text":"...","x":100,"y":100,"w":600,"h":80,"size":24,"color":"#222222","bold":false,"align":"l|ctr|r","bullets":false}
 {"op":"add_shape","slide":1,"id":"<optional>","shape":"rect|roundRect|ellipse|triangle|diamond|star5|rightArrow|leftArrow|chevron|hexagon|heart|line","x":0,"y":0,"w":200,"h":120,"fill":"#4472c4","line":"#2f528f","text":"...","color":"#ffffff","size":18}
 {"op":"update","slide":1,"id":"...", any of: "x","y","w","h","rot","fill" ("none" for no fill),"line" ("none" for no line),"color","size","bold","italic","underline","font","align"}
 {"op":"delete","slide":1,"id":"..."}
 {"op":"background","slide":1 or "all","color":"#ffffff"}
 {"op":"notes","slide":1,"text":"speaker notes"}
 {"op":"animate","slide":1,"id":"...","effect":"<effect key>","trigger":"click|with|after","duration":0.5,"delay":0}
   effect keys: ${PRESETS.map((p) => `${p.key} (${p.name})`).join(", ")}
 {"op":"clear_animations","slide":1,"id":"<optional, else whole slide>"}
 {"op":"transition","slide":1 or "all","type":"${TRANSITION_TYPES.join("|")}","dir":"l|r|u|d","duration":0.7}
Element ids you create with add_text/add_shape can be used by later ops in the same answer.
Rules: change only what the user asked for. For a slide with a title and bullet points, use add_slide with "layout":"content", "title" and "bullets" rather than separate text boxes; its elements then get ids you can see next time, so to animate those bullets in the same answer, add the text with add_text instead and give it an id. Keep text concise and slide-friendly (short bullets, 3-6 per slide). When asked to make a presentation, add complete slides with real content, speaker notes and a consistent look. Keep elements inside the slide. If the request is a question or can't be done, return "ops": [] and answer in "reply". Never output anything outside the JSON object.`;
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const r = Math.round;

function fillText(f?: Fill) {
  if (!f || f.type === "none") return "none";
  if (f.type === "solid") return f.color;
  if (f.type === "grad") return `gradient ${f.stops[0]?.color}→${f.stops[f.stops.length - 1]?.color}`;
  return "picture";
}

/** The deck described for the model: every slide, element ids, boxes, text and effects. */
export function describe(deck: SlidesData, current: number, selected: string[]) {
  const lines: string[] = [`Slide size ${deck.w} x ${deck.h}. ${deck.slides.length} slides. The user is looking at slide ${current + 1}.${selected.length ? ` Selected element ids: ${selected.join(", ")}.` : ""}`];
  deck.slides.forEach((s, i) => {
    const bg = s.bg ?? (s.base ? deck.bases[s.base]?.bg : undefined);
    lines.push(`\nSlide ${i + 1}${s.hidden ? " (hidden)" : ""}: background ${fillText(bg)}${s.transition && s.transition.type !== "none" ? `, transition ${s.transition.type}` : ""}`);
    for (const e of s.els) {
      const text = plainText(e.text).trim();
      const run0 = e.text?.paras.find((p) => p.runs.some((x) => x.text))?.runs[0] ?? e.text?.paras[0]?.runs[0];
      const kind = e.type === "shape" ? (e.geom === "rect" && (!e.fill || e.fill.type === "none") ? "textbox" : `shape ${e.geom}`) : e.type;
      let line = `  - id=${e.id} ${kind}${e.name ? ` "${e.name}"` : ""} box=${r(e.x)},${r(e.y)},${r(e.w)}x${r(e.h)}`;
      if (e.rot) line += ` rot=${r(e.rot)}`;
      if (e.type === "shape") line += ` fill=${fillText(e.fill)}`;
      if (run0) line += ` font=${run0.font} ${run0.size}pt ${run0.color}${run0.bold ? " bold" : ""}`;
      if (text) line += ` text=${JSON.stringify(short(text, 500))}`;
      else if (e.prompt) line += ` (empty placeholder: ${e.prompt})`;
      if (e.chart) line += ` chart ${e.chart.kind}: ${e.chart.series.map((x) => x.name).join(", ")} over ${e.chart.categories.join(", ")}`;
      if (e.table) line += ` table ${e.table.rows.length}x${e.table.cols.length}: ${short(e.table.rows.map((row) => row.cells.map((c) => plainText(c.text)).join(" | ")).join(" / "), 400)}`;
      lines.push(line);
    }
    if (s.anims.length) lines.push(`  animations: ${s.anims.map((a, k) => `${k + 1}. ${a.cls} ${a.presetId} on ${a.target} (${a.trigger})`).join("; ")}`);
    if (s.notes.trim()) lines.push(`  notes: ${JSON.stringify(short(s.notes.trim(), 300))}`);
  });
  let out = lines.join("\n");
  if (out.length > 60000) out = out.slice(0, 60000) + "\n(…the rest of the deck is cut for length)";
  return out;
}

export async function askSlides(key: string, deck: SlidesData, current: number, selected: string[], history: AiHistory, request: string) {
  const content = await groqChat(
    key,
    [
      { role: "system", content: system(deck) },
      ...history,
      { role: "user", content: `Current presentation:\n${describe(deck, current, selected)}\n\nRequest: ${request}` },
    ],
    { json: true, temperature: 0.3 },
  );
  const parsed = parseJson<{ reply?: string; ops?: SlideOp[] }>(content);
  return { reply: String(parsed.reply ?? ""), ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
}

// ---- Applying operations ------------------------------------------------------------------------

const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Replace a body's text line by line, keeping each paragraph's formatting. */
function retext(body: TextBody | undefined, text: string): TextBody {
  const base: TextBody = body ?? { paras: [{ runs: [run("", 18)] }], anchor: "t", wrap: true, inset: [9.6, 4.8, 9.6, 4.8] };
  const lines = String(text).split(/\r?\n/);
  const paras: Para[] = lines.map((line, i) => {
    const tpl = base.paras[Math.min(i, base.paras.length - 1)] ?? { runs: [run("", 18)] };
    const r0 = tpl.runs.find((x) => x.text) ?? tpl.runs[0] ?? run("", 18);
    return { ...tpl, runs: [{ ...r0, text: line.replace(/^\s*[-•]\s+/, tpl.bullet ? "" : "$&") }] };
  });
  return { ...base, paras };
}

function applyFmt(body: TextBody, f: Fmt): TextBody {
  const patch: Partial<Para["runs"][number]> = {};
  if (isColor(f.color)) patch.color = f.color;
  if (typeof f.size === "number" && f.size > 0) patch.size = Math.min(400, f.size);
  if (typeof f.bold === "boolean") patch.bold = f.bold;
  if (typeof f.italic === "boolean") patch.italic = f.italic;
  if (typeof f.underline === "boolean") patch.underline = f.underline;
  if (typeof f.font === "string" && f.font) patch.font = f.font;
  let out = Object.keys(patch).length ? formatRuns(body, patch) : body;
  if (f.align && ["l", "ctr", "r", "just"].includes(f.align)) out = formatParas(out, { align: f.align === "l" ? undefined : f.align });
  return out;
}

const box = (o: Partial<Box>, deck: SlidesData, def: Box): Box => {
  const n = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  const w = Math.max(4, n(o.w, def.w)), h = Math.max(0, n(o.h, def.h));
  return { x: Math.min(deck.w - 4, n(o.x, def.x)), y: Math.min(deck.h - 4, n(o.y, def.y)), w, h };
};

export function applyOps(start: SlidesData, ops: SlideOp[]): { deck: SlidesData; applied: number; focus?: number } {
  let deck: SlidesData = { ...start, slides: start.slides.map((s) => ({ ...s })) };
  const ids = new Map<string, string>();
  const real = (id: string) => ids.get(id) ?? id;
  let applied = 0;
  let focus: number | undefined;
  const at = (n: unknown) => (typeof n === "number" && n >= 1 && n <= deck.slides.length ? n - 1 : -1);
  const setSlide = (i: number, fn: (s: Slide) => Slide) => {
    deck.slides[i] = fn(deck.slides[i]);
    focus = i;
  };
  const findEl = (i: number, id: string) => deck.slides[i].els.find((e) => e.id === real(id));

  for (const op of ops) {
    try {
      switch (op.op) {
        case "add_slide": {
          const after = typeof op.after === "number" ? Math.max(0, Math.min(deck.slides.length, op.after)) : deck.slides.length;
          const layout = LAYOUTS.some((l) => l.id === op.layout) ? op.layout! : op.bullets?.length ? "content" : "titleOnly";
          const s = newSlide(deck, layout);
          const like = deck.slides[Math.max(0, after - 1)];
          if (like?.base) {
            s.base = like.base;
            delete s.bg;
          } else if (like?.bg) s.bg = like.bg;
          const named = (name: string) => s.els.find((e) => e.name === name);
          const put = (name: string, text?: string | string[]) => {
            const el = named(name);
            if (!el || text === undefined || (Array.isArray(text) && !text.length)) return;
            el.text = retext(el.text, Array.isArray(text) ? text.join("\n") : text);
          };
          put("Title", op.title);
          put("Subtitle", op.subtitle);
          put(layout === "section" ? "Text" : "Content", layout === "section" ? op.subtitle : op.bullets);
          put("Left", op.left);
          put("Right", op.right);
          if (op.notes) s.notes = String(op.notes);
          // Drop placeholders the answer left empty, so slides don't show "Click to add text".
          s.els = s.els.filter((e) => plainText(e.text).trim());
          deck.slides.splice(after, 0, s);
          focus = after;
          break;
        }
        case "delete_slide": {
          const i = at(op.slide);
          if (i < 0 || deck.slides.length === 1) continue;
          deck.slides.splice(i, 1);
          focus = Math.min(i, deck.slides.length - 1);
          break;
        }
        case "move_slide": {
          const i = at(op.slide);
          if (i < 0) continue;
          const [s] = deck.slides.splice(i, 1);
          const to = Math.max(0, Math.min(deck.slides.length, (op.to ?? 1) - 1));
          deck.slides.splice(to, 0, s);
          focus = to;
          break;
        }
        case "duplicate_slide": {
          const i = at(op.slide);
          if (i < 0) continue;
          const src = deck.slides[i];
          const map = new Map(src.els.map((e) => [e.id, uid()]));
          deck.slides.splice(i + 1, 0, {
            ...structuredClone({ ...src, els: [], anims: [] }),
            id: uid(),
            els: src.els.map((e) => ({ ...structuredClone(e), id: map.get(e.id)! })),
            anims: src.anims.map((a) => ({ ...a, id: uid(), target: map.get(a.target) ?? a.target })),
          });
          focus = i + 1;
          break;
        }
        case "hide_slide": {
          const i = at(op.slide);
          if (i < 0) continue;
          setSlide(i, (s) => ({ ...s, hidden: op.hidden ? true : undefined }));
          break;
        }
        case "set_text": {
          const i = at(op.slide);
          if (i < 0 || !findEl(i, op.id)) continue;
          setSlide(i, (s) => ({ ...s, els: s.els.map((e) => (e.id === real(op.id) ? { ...e, text: retext(e.text, op.text) } : e)) }));
          break;
        }
        case "add_text":
        case "add_shape": {
          const i = at(op.slide);
          if (i < 0) continue;
          const b = box(op, deck, { x: deck.w * 0.1, y: deck.h * 0.4, w: deck.w * 0.4, h: op.op === "add_text" ? 60 : 160 });
          const id = uid();
          if (op.id) ids.set(op.id, id);
          let el: El;
          if (op.op === "add_text") {
            const lines = String(op.text ?? "").split(/\r?\n/);
            el = textBox(b.x, b.y, b.w, b.h, lines.map((l) => ({
              runs: [run(l.replace(/^\s*[-•]\s+/, ""), op.size ?? 24, { color: isColor(op.color) ? op.color : DEFAULT_COLOR, ...(op.bold ? { bold: true } : {}) })],
              ...(op.bullets ? { bullet: { char: "•" }, marL: 28, indent: -28 } : {}),
            })), {}, "t");
            el.id = id;
          } else {
            const line = op.shape === "line";
            el = {
              id, type: "shape", geom: line ? "line" : op.shape || "rect", ...b,
              ...(line ? {} : { fill: op.fill === "none" ? { type: "none" } : { type: "solid", color: isColor(op.fill) ? op.fill : "#4472c4" } }),
              ...(op.line === "none" ? {} : { line: { color: isColor(op.line) ? op.line : line ? "#4472c4" : "#2f528f", width: line ? 2 : 1 } }),
              ...(line ? {} : { text: { paras: [{ runs: [run(String(op.text ?? ""), op.size ?? 18, { color: isColor(op.color) ? op.color : "#ffffff" })], align: "ctr" as const }], anchor: "ctr" as const, wrap: true, inset: [9.6, 4.8, 9.6, 4.8] as [number, number, number, number] } }),
            };
          }
          if (el.text && op.align) el.text = applyFmt(el.text, { align: op.align });
          setSlide(i, (s) => ({ ...s, els: [...s.els, el] }));
          break;
        }
        case "update": {
          const i = at(op.slide);
          if (i < 0 || !findEl(i, op.id)) continue;
          setSlide(i, (s) => ({
            ...s,
            els: s.els.map((e) => {
              if (e.id !== real(op.id)) return e;
              const n: El = { ...e };
              for (const k of ["x", "y", "w", "h", "rot"] as const) if (typeof op[k] === "number" && isFinite(op[k]!)) n[k] = op[k]!;
              if (op.fill === "none") n.fill = { type: "none" };
              else if (isColor(op.fill)) n.fill = { type: "solid", color: op.fill };
              if (op.line === "none") n.line = undefined;
              else if (isColor(op.line)) n.line = { width: 1, ...n.line, color: op.line };
              if (n.text) n.text = applyFmt(n.text, op);
              return n;
            }),
          }));
          break;
        }
        case "delete": {
          const i = at(op.slide);
          if (i < 0 || !findEl(i, op.id)) continue;
          const id = real(op.id);
          setSlide(i, (s) => ({ ...s, els: s.els.filter((e) => e.id !== id), anims: s.anims.filter((a) => a.target !== id) }));
          break;
        }
        case "background": {
          if (!isColor(op.color)) continue;
          const bg: Fill = { type: "solid", color: op.color };
          if (op.slide === "all") deck.slides = deck.slides.map((s) => ({ ...s, bg }));
          else {
            const i = at(op.slide);
            if (i < 0) continue;
            setSlide(i, (s) => ({ ...s, bg }));
          }
          break;
        }
        case "notes": {
          const i = at(op.slide);
          if (i < 0) continue;
          setSlide(i, (s) => ({ ...s, notes: String(op.text ?? "") }));
          break;
        }
        case "animate": {
          const i = at(op.slide);
          const p = PRESETS.find((x) => x.key === op.effect);
          if (i < 0 || !p || !findEl(i, op.id)) continue;
          const fx = makeEffect(p, real(op.id), op.trigger === "with" || op.trigger === "after" ? op.trigger : "click");
          if (typeof op.duration === "number" && op.duration > 0) {
            const k = (op.duration * 1000) / Math.max(1, effectLength(fx));
            fx.behaviors = fx.behaviors.map((b) => ({ ...b, delay: b.delay * k, dur: b.t === "set" ? b.dur : b.dur * k }));
          }
          if (typeof op.delay === "number" && op.delay > 0) fx.delay = op.delay * 1000;
          setSlide(i, (s) => ({ ...s, anims: [...s.anims, fx] }));
          break;
        }
        case "clear_animations": {
          const i = at(op.slide);
          if (i < 0) continue;
          setSlide(i, (s) => ({ ...s, anims: op.id ? s.anims.filter((a) => a.target !== real(op.id!)) : [] }));
          break;
        }
        case "transition": {
          if (!TRANSITION_TYPES.includes(op.type)) continue;
          const t: Transition = { type: op.type, dur: typeof op.duration === "number" && op.duration > 0 ? op.duration * 1000 : 700, ...(op.dir && "lrud".includes(op.dir) ? { dir: op.dir } : {}) };
          if (op.slide === "all") deck.slides = deck.slides.map((s) => ({ ...s, transition: t }));
          else {
            const i = at(op.slide);
            if (i < 0) continue;
            setSlide(i, (s) => ({ ...s, transition: t }));
          }
          break;
        }
        default:
          continue;
      }
      applied++;
    } catch {
      // A malformed operation is skipped; the rest still apply.
    }
  }
  deck = { ...deck, slides: deck.slides.slice() };
  return { deck, applied, focus };
}
