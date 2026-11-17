// The slide show: full screen, slide transitions, click-by-click animations, auto-advance.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { openExternal, setFullscreen } from "../../lib/platform";
import { Player, schedule, type Step } from "./anim";
import { SlideView } from "./render";
import type { SlidesData, Transition } from "./types";

interface Layer {
  key: string;
  index: number;
  /** Show the slide with all its animations already played (when stepping backwards). */
  built: boolean;
}

function transitionFrames(t: Transition): { into: Keyframe[]; out: Keyframe[]; outOnTop?: boolean; outFirst?: boolean } {
  const d = t.dir ?? "l";
  const axis = d === "l" || d === "r" ? "X" : "Y";
  const sign = d === "l" || d === "u" ? 1 : -1;
  const from = `translate${axis}(${sign * 100}%)`;
  const away = `translate${axis}(${-sign * 100}%)`;
  const still: Keyframe[] = [{ opacity: 1 }, { opacity: 1 }];
  switch (t.type) {
    case "fade":
    case "dissolve":
      return { into: [{ opacity: 0 }, { opacity: 1 }], out: still };
    case "black":
      return { into: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], outOnTop: true };
    case "push":
      return { into: [{ transform: from }, { transform: "none" }], out: [{ transform: "none" }, { transform: away }] };
    case "cover":
      return { into: [{ transform: from }, { transform: "none" }], out: still };
    case "uncover":
      return { into: still, out: [{ transform: "none" }, { transform: away }], outOnTop: true };
    case "wipe": {
      const start = d === "l" ? "inset(0 0 0 100%)" : d === "r" ? "inset(0 100% 0 0)" : d === "u" ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
      return { into: [{ clipPath: start }, { clipPath: "inset(0 0 0 0)" }], out: still };
    }
    case "split":
      return { into: [{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0% 0 0%)" }], out: still };
    case "circle":
      return { into: [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }], out: still };
    case "zoom":
      return { into: [{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }] };
    case "flip":
      return { into: [{ transform: "perspective(2000px) rotateY(90deg)" }, { transform: "perspective(2000px) rotateY(90deg)", offset: 0.5 }, { transform: "none" }], out: [{ transform: "none" }, { transform: "perspective(2000px) rotateY(-90deg)", offset: 0.5 }, { transform: "perspective(2000px) rotateY(-90deg)" }], outOnTop: true };
    default:
      return { into: still, out: still };
  }
}

export function Present({ deck, start, onExit }: { deck: SlidesData; start: number; onExit: (at: number) => void }) {
  const order = deck.slides.map((s, i) => (s.hidden && i !== start ? -1 : i)).filter((i) => i >= 0);
  const [layers, setLayers] = useState<Layer[]>([{ key: "0", index: start, built: false }]);
  const [ended, setEnded] = useState(false);
  const [blank, setBlank] = useState<"" | "black" | "white">("");
  const [scale, setScale] = useState(1);
  const [idle, setIdle] = useState(false);
  const layerEls = useRef(new Map<string, HTMLDivElement>());
  const player = useRef<{ p: Player; steps: Step[]; at: number } | null>(null);
  const timer = useRef<number>();
  const counter = useRef(1);
  const busy = useRef<Animation[]>([]);
  const current = layers[layers.length - 1];
  const pos = order.indexOf(current.index);

  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / deck.w, innerHeight / deck.h));
    fit();
    addEventListener("resize", fit);
    const was = setFullscreen(true);
    return () => {
      removeEventListener("resize", fit);
      was.then((on) => !on && setFullscreen(false));
      clearTimeout(timer.current);
    };
  }, [deck.w, deck.h]);

  useEffect(() => {
    let t: number;
    const move = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 2500);
    };
    move();
    addEventListener("pointermove", move);
    return () => {
      clearTimeout(t);
      removeEventListener("pointermove", move);
    };
  }, []);

  const scheduleAdvance = useCallback(() => {
    clearTimeout(timer.current);
    const pl = player.current;
    if (!pl) return;
    const slide = deck.slides[current.index];
    const step = pl.steps[pl.at - 1];
    // "After" timing: wait for the running animations, then the slide's own delay.
    if (slide.advance === undefined) return;
    timer.current = window.setTimeout(() => nextRef.current(), (step ? step.length : 0) + slide.advance);
  }, [deck.slides, current.index]);

  // Set up the slide that just came on screen.
  useLayoutEffect(() => {
    const el = layerEls.current.get(current.key);
    if (!el) return;
    const slide = deck.slides[current.index];
    const p = new Player(el, slide, deck);
    const steps = schedule(slide.anims);
    p.reset();
    let at = 0;
    if (current.built) {
      for (const s of steps) p.play(s, true);
      at = steps.length;
    }
    player.current = { p, steps, at };

    // Transition from the slide before.
    const prev = layers.length > 1 ? layerEls.current.get(layers[0].key) : undefined;
    const t = slide.transition;
    const run: Animation[] = [];
    if (prev && t && t.type !== "none" && !current.built) {
      const f = transitionFrames(t);
      const opts: KeyframeAnimationOptions = { duration: t.dur, easing: "ease-in-out", fill: "both" };
      if (f.outOnTop) prev.style.zIndex = "2";
      run.push(el.animate(f.into, opts), prev.animate(f.out, opts));
    }
    busy.current = run;
    const done = () => {
      setLayers((ls) => (ls.length > 1 ? ls.slice(-1) : ls));
      busy.current = [];
      const pl = player.current;
      if (pl && !current.built && pl.at === 0 && steps[0]?.auto) {
        pl.p.play(steps[0]);
        pl.at = 1;
      }
      scheduleAdvance();
    };
    if (run.length) Promise.all(run.map((a) => a.finished)).then(done, done);
    else done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key]);

  const show = useCallback((index: number, built = false) => {
    clearTimeout(timer.current);
    for (const a of busy.current) a.finish();
    setLayers((ls) => [ls[ls.length - 1], { key: String(counter.current++), index, built }]);
  }, []);

  const next = useCallback(() => {
    if (blank) return setBlank("");
    if (ended) return onExit(order[order.length - 1] ?? 0);
    for (const a of busy.current) a.finish();
    const pl = player.current;
    if (pl && pl.at < pl.steps.length) {
      clearTimeout(timer.current);
      pl.p.finishAll();
      pl.p.play(pl.steps[pl.at]);
      pl.at++;
      scheduleAdvance();
      return;
    }
    if (pos < order.length - 1) show(order[pos + 1]);
    else setEnded(true);
  }, [blank, ended, order, pos, onExit, show, scheduleAdvance]);
  const nextRef = useRef(next);
  nextRef.current = next;

  const prev = useCallback(() => {
    if (blank) return setBlank("");
    if (ended) return setEnded(false);
    clearTimeout(timer.current);
    const pl = player.current;
    const first = pl?.steps[0]?.auto ? 1 : 0;
    if (pl && pl.at > first) {
      pl.p.reset();
      pl.at--;
      for (let i = 0; i < pl.at; i++) pl.p.play(pl.steps[i], true);
      return;
    }
    if (pos > 0) show(order[pos - 1], true);
  }, [blank, ended, order, pos, show]);

  useEffect(() => {
    let typed = "";
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (/^\d$/.test(k)) {
        typed += k;
        return;
      }
      if (k === "Enter" && typed) {
        const n = Number(typed) - 1;
        typed = "";
        if (deck.slides[n]) show(n);
        return;
      }
      typed = "";
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(k)) {
        e.preventDefault();
        next();
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) {
        e.preventDefault();
        prev();
      } else if (k === "Home") show(order[0]);
      else if (k === "End") show(order[order.length - 1], true);
      else if (k === "Escape") {
        e.preventDefault();
        onExit(current.index);
      } else if (k === "b" || k === "B" || k === ".") setBlank((b) => (b === "black" ? "" : "black"));
      else if (k === "w" || k === "W" || k === ",") setBlank((b) => (b === "white" ? "" : "white"));
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [next, prev, show, onExit, order, current.index, deck.slides]);

  function click(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("video, audio, .pr-bar")) return;
    const link = t.closest<HTMLElement>("[data-link]")?.dataset.link;
    if (link && /^(https?:|mailto:)/i.test(link)) return void openExternal(link);
    next();
  }

  return (
    <div
      className={"present" + (idle ? " idle" : "")}
      onClick={click}
      onContextMenu={(e) => {
        e.preventDefault();
        prev();
      }}
      onWheel={(e) => (e.deltaY > 0 ? next() : prev())}
    >
      <div className="pr-stage" style={{ width: deck.w * scale, height: deck.h * scale }}>
        {layers.map((l) => (
          <div
            key={l.key}
            className="pr-layer"
            ref={(n) => {
              if (n) layerEls.current.set(l.key, n);
              else layerEls.current.delete(l.key);
            }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
              <SlideView deck={deck} slide={deck.slides[l.index]} opts={{ live: true }} />
            </div>
          </div>
        ))}
      </div>
      {blank && <div className="pr-blank" style={{ background: blank }} />}
      {ended && (
        <div className="pr-end">
          <p>End of slide show. Click to exit.</p>
        </div>
      )}
      <div className="pr-bar" role="toolbar" aria-label="Slide show">
        <button className="icon" title="Previous (←)" aria-label="Previous" onClick={prev}><ChevronLeft /></button>
        <span>
          {pos + 1} / {order.length}
        </span>
        <button className="icon" title="Next (→ or click)" aria-label="Next" onClick={next}><ChevronRight /></button>
        <button className="icon" title="End show (Esc)" aria-label="End show" onClick={() => onExit(current.index)}><X /></button>
      </div>
    </div>
  );
}
