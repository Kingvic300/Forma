// Plays PowerPoint animations with the Web Animations API. Effects are stored as PowerPoint's
// own behaviours (set, animEffect, anim, animScale, animRot, animMotion), so imported effects
// play as PowerPoint defines them rather than through a lookup table of effect names.
import type { Behavior, Effect, El, Slide } from "./types";
import { uid } from "./types";

// ---- Timing --------------------------------------------------------------------------------

const iterations = (b: Behavior) => (b.repeat && isFinite(b.repeat) ? b.repeat : 1) * (b.autoRev ? 2 : 1);
export const effectLength = (e: Effect) => Math.max(0, ...e.behaviors.map((b) => b.delay + b.dur * iterations(b)));

export interface Step {
  /** Starts by itself when the slide (or the step before) begins, rather than on a click. */
  auto: boolean;
  subs: { start: number; effects: Effect[] }[];
  length: number;
}

/** Group effects into click steps and "after previous" sub-groups, the way PowerPoint runs them. */
export function schedule(anims: Effect[]): Step[] {
  const steps: Step[] = [];
  let step: Step | null = null;
  let sub: Step["subs"][number] | null = null;
  for (const e of anims) {
    if (!step || e.trigger === "click") {
      step = { auto: e.trigger !== "click", subs: [], length: 0 };
      steps.push(step);
      sub = null;
    }
    if (!sub || e.trigger === "after" || e.trigger === "click") {
      const start: number = e.trigger === "after" ? step.length : 0;
      sub = { start, effects: [] };
      step.subs.push(sub);
    }
    sub.effects.push(e);
    step.length = Math.max(step.length, sub.start + e.delay + effectLength(e));
  }
  return steps;
}

/** Elements and paragraphs that start hidden because their first effect brings them in. */
export function startsHidden(anims: Effect[]) {
  const seen = new Set<string>();
  const hidden: { target: string; paras?: [number, number] }[] = [];
  for (const e of anims) {
    const key = e.target + (e.paras ? `:${e.paras[0]}-${e.paras[1]}` : "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.cls === "entr") hidden.push({ target: e.target, paras: e.paras });
  }
  return hidden;
}

// ---- Formulas ------------------------------------------------------------------------------

/** Evaluate a PowerPoint animation formula such as "0-#ppt_w/2" or "#ppt_y+sin(pi*$)/3". */
export function evalFormula(src: string, vars: Record<string, number>): number {
  const toks = src.match(/\d*\.\d+(?:e[-+]?\d+)?|\d+(?:e[-+]?\d+)?|#?[a-z_][\w.]*|\$|[-+*/^(),]/gi) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const FN: Record<string, (...a: number[]) => number> = {
    abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, ceil: Math.ceil, cos: Math.cos, cosh: Math.cosh,
    deg: (r) => (r * 180) / Math.PI, exp: Math.exp, floor: Math.floor, ln: Math.log, max: Math.max, min: Math.min,
    rad: (d) => (d * Math.PI) / 180, rand: (n) => Math.random() * n, sin: Math.sin, sinh: Math.sinh, sqrt: Math.sqrt, tan: Math.tan, tanh: Math.tanh,
  };
  const primary = (): number => {
    const t = toks[i++];
    if (t === undefined) return 0;
    if (t === "(") {
      const v = expr();
      i++;
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (/^[\d.]/.test(t)) return Number(t);
    if (t === "$") return vars.$ ?? 0;
    const name = t.replace(/^#/, "").toLowerCase();
    if (peek() === "(" && FN[name]) {
      i++;
      const args = [expr()];
      while (peek() === ",") {
        i++;
        args.push(expr());
      }
      i++;
      return FN[name](...args);
    }
    if (name === "pi") return Math.PI;
    if (name === "e") return Math.E;
    return vars[name] ?? 0;
  };
  const power = (): number => {
    const b = primary();
    if (peek() === "^") {
      i++;
      return b ** power();
    }
    return b;
  };
  const term = (): number => {
    let v = power();
    while (peek() === "*" || peek() === "/") v = toks[i++] === "*" ? v * power() : v / power();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") v = toks[i++] === "+" ? v + term() : v - term();
    return v;
  };
  try {
    const v = expr();
    return isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

// ---- Playing -------------------------------------------------------------------------------

function clipFor(filter: string): [string, string] | null {
  const [, name = filter, arg = ""] = filter.match(/^(\w+)(?:\((.*)\))?$/) ?? [];
  const full = "inset(0% 0% 0% 0%)";
  switch (name) {
    case "wipe":
      // The direction is the way the edge moves: wipe(up) starts at the bottom.
      return [arg === "up" ? "inset(100% 0% 0% 0%)" : arg === "down" ? "inset(0% 0% 100% 0%)" : arg === "left" ? "inset(0% 0% 0% 100%)" : "inset(0% 100% 0% 0%)", full];
    case "slide":
      return [arg === "fromBottom" ? "inset(100% 0% 0% 0%)" : arg === "fromTop" ? "inset(0% 0% 100% 0%)" : arg === "fromLeft" ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 0% 100%)", full];
    case "barn":
      return [arg.includes("Horizontal") ? "inset(50% 0% 50% 0%)" : "inset(0% 50% 0% 50%)", full];
    case "box":
      return ["inset(50% 50% 50% 50%)", full];
    case "circle":
    case "wheel":
    case "wedge":
    case "plus":
      return ["circle(0% at 50% 50%)", "circle(75% at 50% 50%)"];
    case "diamond":
      return ["polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)", "polygon(50% -50%, 150% 50%, 50% 150%, -50% 50%)"];
    case "blinds":
    case "strips":
    case "randombar":
      return [arg.includes("vertical") ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 100% 0%)", full];
  }
  return null;
}

/** Points along a motion path such as "M 0 0 L 0.25 0.1 C … E", in slide fractions. */
function samplePath(d: string): [number, number][] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let cur: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  let cmd = "M";
  let i = 0;
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const off = (p: [number, number]): [number, number] => (rel ? [cur[0] + p[0], cur[1] + p[1]] : p);
    switch (cmd.toUpperCase()) {
      case "M":
        cur = start = off([n(), n()]);
        pts.push(cur);
        break;
      case "L":
        cur = off([n(), n()]);
        pts.push(cur);
        break;
      case "C": {
        const c1 = off([n(), n()]), c2 = off([n(), n()]), p = off([n(), n()]);
        const p0 = cur;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          pts.push([u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p[0], u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p[1]]);
        }
        cur = p;
        break;
      }
      case "Z":
        cur = start;
        pts.push(cur);
        break;
      case "E":
        i = toks.length;
        break;
      default:
        i++;
    }
  }
  return pts.length ? pts : [[0, 0]];
}

const easing = (b: Behavior) => (b.accel && b.decel ? "ease-in-out" : b.accel ? "ease-in" : b.decel ? "ease-out" : "linear");

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Runs one slide's effects on a rendered slide (see SlideView). */
export class Player {
  private running: Animation[] = [];
  constructor(private root: HTMLElement, private slide: Slide, private size: { w: number; h: number }) {}

  private els(target: string) {
    return Array.from(this.root.querySelectorAll<HTMLElement>("[data-el]")).filter((n) => n.dataset.el === target || (n.dataset.groups ?? "").split(" ").includes(target));
  }
  private nodes(target: string, paras?: [number, number]): HTMLElement[] {
    return this.els(target).flatMap((el) => {
      if (paras) {
        const ps = Array.from(el.querySelectorAll<HTMLElement>("[data-para]")).filter((p) => {
          const n = Number(p.dataset.para);
          return n >= paras[0] && n <= paras[1];
        });
        if (ps.length) return ps;
      }
      const a = el.querySelector<HTMLElement>("[data-anim]");
      return a ? [a] : [];
    });
  }
  private box(target: string): Box {
    const list: El[] = this.slide.els.filter((e) => e.id === target || e.groups?.includes(target));
    if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.min(...list.map((e) => e.x)), y = Math.min(...list.map((e) => e.y));
    return { x, y, w: Math.max(...list.map((e) => e.x + e.w)) - x, h: Math.max(...list.map((e) => e.y + e.h)) - y };
  }

  /** Put the slide in its starting state: effects cleared, entrance targets hidden. */
  reset() {
    for (const a of this.running) a.cancel();
    this.running = [];
    this.root.querySelectorAll<HTMLElement>("[data-anim], [data-para]").forEach((n) => (n.style.visibility = ""));
    for (const h of startsHidden(this.slide.anims)) for (const n of this.nodes(h.target, h.paras)) n.style.visibility = "hidden";
  }

  /** Start a step. With `instant`, jump straight to its end state. */
  play(step: Step, instant = false) {
    const made: Animation[] = [];
    for (const sub of step.subs) for (const e of sub.effects) made.push(...this.effect(e, sub.start + e.delay));
    this.running.push(...made);
    if (instant) for (const a of made) a.finish();
    return made;
  }

  finishAll() {
    for (const a of this.running) a.finish();
  }

  private animate(node: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
    try {
      return node.animate(frames, opts);
    } catch {
      // An engine without additive transforms: play the effect on its own.
      try {
        const { composite: _c, ...rest } = opts;
        return node.animate(frames, rest);
      } catch {
        return null;
      }
    }
  }

  private effect(e: Effect, begin: number): Animation[] {
    const nodes = this.nodes(e.target, e.paras);
    const b0 = this.box(e.target);
    const W = this.size.w, H = this.size.h;
    const vars = { ppt_x: (b0.x + b0.w / 2) / W, ppt_y: (b0.y + b0.h / 2) / H, ppt_w: b0.w / W, ppt_h: b0.h / H };
    const out: Animation[] = [];
    for (const b of e.behaviors) {
      const opts: KeyframeAnimationOptions = {
        delay: begin + b.delay,
        duration: Math.max(1, b.dur),
        fill: "forwards",
        easing: easing(b),
        iterations: b.repeat ?? 1,
        direction: b.autoRev ? "alternate" : "normal",
      };
      if (b.autoRev) opts.iterations = (b.repeat ?? 1) * 2;
      const frames = this.frames(b, vars, W, H);
      if (!frames) continue;
      for (const n of nodes) {
        const a = this.animate(n, frames.frames, { ...opts, ...(frames.composite ? { composite: frames.composite } : {}) });
        if (a) out.push(a);
      }
    }
    return out;
  }

  private frames(b: Behavior, vars: Record<string, number>, W: number, H: number): { frames: Keyframe[]; composite?: CompositeOperation } | null {
    switch (b.t) {
      case "set": {
        if (b.attr === "style.visibility") return { frames: [{ visibility: b.to }, { visibility: b.to }] };
        if (b.attr === "style.opacity") return { frames: [{ opacity: b.to }, { opacity: b.to }] };
        if (b.attr === "style.rotation") return { frames: [{ transform: `rotate(${Number(b.to) || 0}deg)` }, { transform: `rotate(${Number(b.to) || 0}deg)` }], composite: "add" };
        return null;
      }
      case "effect": {
        const name = b.filter.split("(")[0];
        const clip = clipFor(b.filter);
        let frames: Keyframe[];
        if (clip && name !== "fade") frames = [{ clipPath: clip[0] }, { clipPath: clip[1] }];
        else frames = [{ opacity: 0 }, { opacity: 1 }];
        if (b.transition === "out") frames.reverse();
        if (b.transition === "none") return null;
        // Keep the end state of an "in" effect without pinning it forever.
        if (b.transition === "in") frames = frames.map((f, i) => (i === frames.length - 1 ? { ...f, visibility: "visible" } : { ...f, visibility: "visible" }));
        return { frames };
      }
      case "anim": {
        const keys = b.keys.length ? b.keys : [];
        if (!keys.length) return null;
        const values: { offset: number; v: number }[] = [];
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          const raw = (x: string | number) => (typeof x === "number" ? x : evalFormula(x, vars));
          if (key.fmla && k < keys.length - 1) {
            const next = keys[k + 1];
            for (let s = 0; s < 12; s++) {
              const t = s / 12;
              const val = raw(key.v) + (raw(next.v) - raw(key.v)) * t;
              values.push({ offset: key.tm + (next.tm - key.tm) * t, v: evalFormula(key.fmla, { ...vars, $: val }) });
            }
          } else values.push({ offset: key.tm, v: key.fmla ? evalFormula(key.fmla, { ...vars, $: raw(key.v) }) : raw(key.v) });
        }
        const clampO = (o: number) => Math.min(1, Math.max(0, o));
        const map = (fn: (v: number) => Keyframe) => values.map((x) => ({ ...fn(x.v), offset: clampO(x.offset) }));
        switch (b.attr) {
          case "ppt_x":
            return { frames: map((v) => ({ transform: `translateX(${(v - vars.ppt_x) * W}px)` })), composite: "add" };
          case "ppt_y":
            return { frames: map((v) => ({ transform: `translateY(${(v - vars.ppt_y) * H}px)` })), composite: "add" };
          case "ppt_w":
            return { frames: map((v) => ({ transform: `scaleX(${vars.ppt_w ? v / vars.ppt_w : 1})` })), composite: "add" };
          case "ppt_h":
            return { frames: map((v) => ({ transform: `scaleY(${vars.ppt_h ? v / vars.ppt_h : 1})` })), composite: "add" };
          case "r":
          case "style.rotation":
            return { frames: map((v) => ({ transform: `rotate(${v}deg)` })), composite: "add" };
          case "xshear":
            return { frames: map((v) => ({ transform: `skewX(${v}deg)` })), composite: "add" };
          case "yshear":
            return { frames: map((v) => ({ transform: `skewY(${v}deg)` })), composite: "add" };
          case "style.opacity":
            return { frames: map((v) => ({ opacity: String(v) })) };
          case "style.visibility":
            return { frames: b.keys.map((k) => ({ visibility: String(k.v), offset: clampO(k.tm) })) };
        }
        return null;
      }
      case "scale": {
        const from = b.from ?? [1, 1];
        const to = b.to ?? (b.by ? [from[0] * b.by[0], from[1] * b.by[1]] : [1, 1]);
        return { frames: [{ transform: `scale(${from[0]}, ${from[1]})` }, { transform: `scale(${to[0]}, ${to[1]})` }], composite: "add" };
      }
      case "rot": {
        const from = b.from ?? 0;
        const to = b.to ?? from + b.by;
        return { frames: [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], composite: "add" };
      }
      case "motion": {
        const pts = samplePath(b.path);
        let total = 0;
        const lens = pts.map((p, k) => (k ? (total += Math.hypot((p[0] - pts[k - 1][0]) * W, (p[1] - pts[k - 1][1]) * H)) : 0));
        return {
          frames: pts.map((p, k) => ({ transform: `translate(${p[0] * W}px, ${p[1] * H}px)`, offset: total ? lens[k] / total : k / Math.max(1, pts.length - 1) })),
          composite: "add",
        };
      }
      case "color":
        return null;
    }
  }
}

// ---- Effects you can add in the editor -------------------------------------------------------

export interface Preset {
  key: string;
  name: string;
  cls: Effect["cls"];
  presetId: number;
  subtype: number;
  make: () => Behavior[];
}

const show = (delay = 0): Behavior => ({ t: "set", attr: "style.visibility", to: "visible", delay, dur: 1 });
const hide = (delay: number): Behavior => ({ t: "set", attr: "style.visibility", to: "hidden", delay, dur: 1 });
const anim = (attr: string, from: string, to: string, dur = 500, extra: Partial<Behavior> = {}): Behavior => ({ t: "anim", attr, keys: [{ tm: 0, v: from }, { tm: 1, v: to }], delay: 0, dur, ...extra }) as Behavior;
const fx = (transition: "in" | "out", filter: string, dur = 500, delay = 0): Behavior => ({ t: "effect", transition, filter, delay, dur });

export const PRESETS: Preset[] = [
  { key: "appear", name: "Appear", cls: "entr", presetId: 1, subtype: 0, make: () => [show()] },
  { key: "fade", name: "Fade", cls: "entr", presetId: 10, subtype: 0, make: () => [show(), fx("in", "fade")] },
  { key: "fly-b", name: "Fly in from bottom", cls: "entr", presetId: 2, subtype: 4, make: () => [show(), anim("ppt_x", "#ppt_x", "#ppt_x"), anim("ppt_y", "1+#ppt_h/2", "#ppt_y", 500, { decel: 0.5 })] },
  { key: "fly-l", name: "Fly in from left", cls: "entr", presetId: 2, subtype: 8, make: () => [show(), anim("ppt_x", "0-#ppt_w/2", "#ppt_x", 500, { decel: 0.5 }), anim("ppt_y", "#ppt_y", "#ppt_y")] },
  { key: "fly-r", name: "Fly in from right", cls: "entr", presetId: 2, subtype: 2, make: () => [show(), anim("ppt_x", "1+#ppt_w/2", "#ppt_x", 500, { decel: 0.5 }), anim("ppt_y", "#ppt_y", "#ppt_y")] },
  { key: "fly-t", name: "Fly in from top", cls: "entr", presetId: 2, subtype: 1, make: () => [show(), anim("ppt_x", "#ppt_x", "#ppt_x"), anim("ppt_y", "0-#ppt_h/2", "#ppt_y", 500, { decel: 0.5 })] },
  { key: "float", name: "Float in", cls: "entr", presetId: 42, subtype: 0, make: () => [show(), fx("in", "fade", 1000), anim("ppt_x", "#ppt_x", "#ppt_x", 1000), anim("ppt_y", "#ppt_y+.1", "#ppt_y", 1000, { decel: 1 })] },
  { key: "wipe-b", name: "Wipe from bottom", cls: "entr", presetId: 22, subtype: 4, make: () => [show(), fx("in", "wipe(up)")] },
  { key: "wipe-l", name: "Wipe from left", cls: "entr", presetId: 22, subtype: 8, make: () => [show(), fx("in", "wipe(right)")] },
  { key: "split", name: "Split", cls: "entr", presetId: 16, subtype: 21, make: () => [show(), fx("in", "barn(outVertical)")] },
  { key: "wheel", name: "Wheel", cls: "entr", presetId: 21, subtype: 1, make: () => [show(), fx("in", "wheel(1)", 2000)] },
  { key: "circle", name: "Shape (circle)", cls: "entr", presetId: 6, subtype: 32, make: () => [show(), fx("in", "circle(out)", 2000)] },
  { key: "zoom", name: "Zoom", cls: "entr", presetId: 53, subtype: 16, make: () => [show(), anim("ppt_w", "0", "#ppt_w"), anim("ppt_h", "0", "#ppt_h"), fx("in", "fade")] },
  { key: "grow-turn", name: "Grow and turn", cls: "entr", presetId: 31, subtype: 0, make: () => [show(), anim("ppt_w", "0", "#ppt_w"), anim("ppt_h", "0", "#ppt_h"), anim("style.rotation", "90", "0"), fx("in", "fade")] },
  { key: "bounce", name: "Bounce", cls: "entr", presetId: 26, subtype: 0, make: () => [show(), { t: "anim", attr: "ppt_y", keys: [{ tm: 0, v: "#ppt_y-0.25" }, { tm: 0.5, v: "#ppt_y" }, { tm: 0.7, v: "#ppt_y-0.05" }, { tm: 0.85, v: "#ppt_y" }, { tm: 0.93, v: "#ppt_y-0.015" }, { tm: 1, v: "#ppt_y" }], delay: 0, dur: 1000 }, fx("in", "fade", 300)] },

  { key: "pulse", name: "Pulse", cls: "emph", presetId: 26, subtype: 0, make: () => [{ t: "scale", by: [1.05, 1.05], delay: 0, dur: 250, autoRev: true }] },
  { key: "grow", name: "Grow/Shrink", cls: "emph", presetId: 6, subtype: 0, make: () => [{ t: "scale", by: [1.5, 1.5], delay: 0, dur: 1000, decel: 0.5 }] },
  { key: "spin", name: "Spin", cls: "emph", presetId: 8, subtype: 0, make: () => [{ t: "rot", by: 360, delay: 0, dur: 2000 }] },
  { key: "teeter", name: "Teeter", cls: "emph", presetId: 32, subtype: 0, make: () => [{ t: "anim", attr: "r", keys: [{ tm: 0, v: 0 }, { tm: 0.2, v: 4 }, { tm: 0.4, v: -4 }, { tm: 0.6, v: 4 }, { tm: 0.8, v: -4 }, { tm: 1, v: 0 }], delay: 0, dur: 1000 }] },
  { key: "transp", name: "Transparency", cls: "emph", presetId: 9, subtype: 0, make: () => [{ t: "set", attr: "style.opacity", to: "0.5", delay: 0, dur: 2000 }] },

  { key: "x-disappear", name: "Disappear", cls: "exit", presetId: 1, subtype: 0, make: () => [hide(0)] },
  { key: "x-fade", name: "Fade out", cls: "exit", presetId: 10, subtype: 0, make: () => [fx("out", "fade"), hide(499)] },
  { key: "x-fly-b", name: "Fly out to bottom", cls: "exit", presetId: 2, subtype: 4, make: () => [anim("ppt_x", "#ppt_x", "#ppt_x"), anim("ppt_y", "#ppt_y", "1+#ppt_h/2", 500, { accel: 0.5 }), hide(499)] },
  { key: "x-zoom", name: "Zoom out", cls: "exit", presetId: 53, subtype: 16, make: () => [anim("ppt_w", "#ppt_w", "0"), anim("ppt_h", "#ppt_h", "0"), fx("out", "fade"), hide(499)] },
  { key: "x-wipe", name: "Wipe out", cls: "exit", presetId: 22, subtype: 8, make: () => [fx("out", "wipe(left)"), hide(499)] },

  { key: "p-down", name: "Move down", cls: "path", presetId: 42, subtype: 0, make: () => [{ t: "motion", path: "M 0 0 L 0 0.25 E", delay: 0, dur: 2000, accel: 0.5, decel: 0.5 }] },
  { key: "p-right", name: "Move right", cls: "path", presetId: 42, subtype: 0, make: () => [{ t: "motion", path: "M 0 0 L 0.25 0 E", delay: 0, dur: 2000, accel: 0.5, decel: 0.5 }] },
  { key: "p-left", name: "Move left", cls: "path", presetId: 42, subtype: 0, make: () => [{ t: "motion", path: "M 0 0 L -0.25 0 E", delay: 0, dur: 2000, accel: 0.5, decel: 0.5 }] },
  { key: "p-up", name: "Move up", cls: "path", presetId: 42, subtype: 0, make: () => [{ t: "motion", path: "M 0 0 L 0 -0.25 E", delay: 0, dur: 2000, accel: 0.5, decel: 0.5 }] },
  { key: "p-circle", name: "Circle path", cls: "path", presetId: 1, subtype: 0, make: () => [{ t: "motion", path: "M 0 0 C 0.069 0 0.125 0.056 0.125 0.125 C 0.125 0.194 0.069 0.25 0 0.25 C -0.069 0.25 -0.125 0.194 -0.125 0.125 C -0.125 0.056 -0.069 0 0 0 Z E", delay: 0, dur: 2000 }] },
];

export function makeEffect(p: Preset, target: string, trigger: Effect["trigger"] = "click"): Effect {
  return { id: uid(), target, cls: p.cls, presetId: p.presetId, subtype: p.subtype, trigger, delay: 0, behaviors: p.make() };
}

const ENTR_NAMES: Record<number, string> = { 1: "Appear", 2: "Fly in", 3: "Blinds", 4: "Box", 5: "Checkerboard", 6: "Shape", 7: "Crawl in", 8: "Diamond", 9: "Dissolve in", 10: "Fade", 12: "Peek in", 14: "Random bars", 16: "Split", 17: "Stretch", 18: "Strips", 21: "Wheel", 22: "Wipe", 23: "Zoom", 26: "Bounce", 31: "Grow and turn", 37: "Rise up", 42: "Float in", 47: "Swivel", 49: "Spiral in", 53: "Zoom", 55: "Fade", 56: "Expand" };
const EXIT_NAMES: Record<number, string> = { 1: "Disappear", 2: "Fly out", 10: "Fade out", 16: "Split", 21: "Wheel", 22: "Wipe", 23: "Zoom", 53: "Zoom out", 42: "Float out" };
const EMPH_NAMES: Record<number, string> = { 6: "Grow/Shrink", 8: "Spin", 9: "Transparency", 26: "Pulse", 27: "Color pulse", 32: "Teeter", 35: "Blink" };

export function effectName(e: Effect) {
  if (!e.xml) {
    const p = PRESETS.find((x) => x.cls === e.cls && x.presetId === e.presetId && x.subtype === e.subtype);
    if (p) return p.name;
  }
  if (e.cls === "entr") return ENTR_NAMES[e.presetId] ?? "Entrance";
  if (e.cls === "exit") return EXIT_NAMES[e.presetId] ?? "Exit";
  if (e.cls === "emph") return EMPH_NAMES[e.presetId] ?? "Emphasis";
  if (e.cls === "path") return "Motion path";
  if (e.cls === "media") return "Media";
  return "Effect";
}
