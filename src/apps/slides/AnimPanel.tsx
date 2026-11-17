// The Animations pane: effects on the current slide in play order, and the slide's transition.
import { ArrowDown, ArrowUp, Play, Plus, X } from "lucide-react";
import { Menu } from "../../ui";
import { effectLength, effectName, makeEffect, PRESETS, schedule } from "./anim";
import type { Effect, El, Slide, Transition } from "./types";
import { plainText } from "./types";

const TRANSITIONS: { type: Transition["type"]; name: string; dir?: boolean }[] = [
  { type: "none", name: "None" },
  { type: "fade", name: "Fade" },
  { type: "black", name: "Fade through black" },
  { type: "push", name: "Push", dir: true },
  { type: "wipe", name: "Wipe", dir: true },
  { type: "cover", name: "Cover", dir: true },
  { type: "uncover", name: "Uncover", dir: true },
  { type: "split", name: "Split" },
  { type: "zoom", name: "Zoom" },
  { type: "circle", name: "Circle" },
  { type: "flip", name: "Flip", dir: true },
  { type: "dissolve", name: "Dissolve" },
];
const DIRS: { v: NonNullable<Transition["dir"]>; name: string }[] = [
  { v: "l", name: "From right" },
  { v: "r", name: "From left" },
  { v: "u", name: "From bottom" },
  { v: "d", name: "From top" },
];
const CLASSES: { cls: Effect["cls"]; name: string }[] = [
  { cls: "entr", name: "Entrance" },
  { cls: "emph", name: "Emphasis" },
  { cls: "exit", name: "Exit" },
  { cls: "path", name: "Motion path" },
];

export function targetName(slide: Slide, target: string) {
  const el = slide.els.find((e) => e.id === target);
  if (!el) return slide.els.some((e) => e.groups?.includes(target)) ? "Group" : "Missing";
  const text = plainText(el.text).trim().replace(/\s+/g, " ");
  return text ? (text.length > 28 ? text.slice(0, 27) + "…" : text) : el.name || (el.type === "image" ? "Picture" : el.type === "media" ? "Video" : el.type === "table" ? "Table" : el.type === "chart" ? "Chart" : "Shape");
}

const secs = (ms: number) => Math.round(ms / 10) / 100;

export function AnimPanel({ slide, selected, onChange, onSelect, onPreview, onApplyAll }: {
  slide: Slide;
  selected?: El;
  onChange: (s: Slide, tag?: string) => void;
  onSelect: (id: string) => void;
  onPreview: () => void;
  onApplyAll: (t: Slide["transition"], advance: Slide["advance"]) => void;
}) {
  const steps = schedule(slide.anims);
  // Click number for each step, as PowerPoint shows it; a step that starts by itself is 0.
  const stepOf = new Map<string, number>();
  let clicks = 0;
  for (const s of steps) {
    const n = s.auto ? 0 : ++clicks;
    s.subs.forEach((sub) => sub.effects.forEach((e) => stepOf.set(e.id, n)));
  }
  const setAnims = (anims: Effect[], tag?: string) => onChange({ ...slide, anims }, tag);
  const patch = (i: number, p: Partial<Effect>, tag?: string) => setAnims(slide.anims.map((e, j) => (j === i ? { ...e, ...p, xml: undefined } : e)), tag);
  const move = (i: number, d: number) => {
    const a = slide.anims.slice();
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setAnims(a.map((e) => ({ ...e, xml: undefined })));
  };
  const t = slide.transition ?? { type: "none" as const, dur: 700 };
  const setT = (p: Partial<Transition>, tag?: string) => onChange({ ...slide, transition: { ...t, ...p, xml: undefined } }, tag);
  const tInfo = TRANSITIONS.find((x) => x.type === t.type);

  return (
    <aside className="sl-panel" aria-label="Animations">
      <div className="sl-panel-head">
        <h3>Animations</h3>
        <span className="grow" />
        <button onClick={onPreview} disabled={!slide.anims.length} title="Play this slide’s animations">
          <Play /> Preview
        </button>
      </div>
      <Menu
        label={<><Plus /> Add effect</>}
        align="left"
        className="primary sl-add-fx"
        disabled={!selected}
      >
        {CLASSES.map((c) => (
          <div key={c.cls} className="sl-fx-group">
            <div className="menu-label">{c.name}</div>
            {PRESETS.filter((p) => p.cls === c.cls).map((p) => (
              <button key={p.key} role="menuitem" onClick={() => selected && setAnims([...slide.anims, makeEffect(p, selected.id)])}>
                {p.name}
              </button>
            ))}
          </div>
        ))}
      </Menu>
      {!selected && <p className="muted small">Select something on the slide to animate it.</p>}

      <ol className="sl-fx-list">
        {slide.anims.map((e, i) => (
          <li key={e.id} className={"sl-fx " + e.cls + (selected && (selected.id === e.target || selected.groups?.includes(e.target)) ? " on" : "")}>
            <button className="sl-fx-name" onClick={() => onSelect(e.target)} title="Select what this effect animates">
              <span className="sl-fx-step">{e.trigger === "click" || i === 0 ? stepOf.get(e.id) ?? "" : ""}</span>
              <span className="sl-fx-dot" />
              <span className="sl-fx-text">
                <b>{effectName(e)}</b>
                <span>{targetName(slide, e.target)}{e.paras ? ` (paragraph ${e.paras[0] + 1}${e.paras[1] !== e.paras[0] ? `–${e.paras[1] + 1}` : ""})` : ""}</span>
              </span>
            </button>
            <div className="sl-fx-row">
              <select value={e.trigger} aria-label="Start" onChange={(ev) => patch(i, { trigger: ev.target.value as Effect["trigger"] })}>
                <option value="click">On click</option>
                <option value="with">With previous</option>
                <option value="after">After previous</option>
              </select>
              <label title="Duration in seconds">
                <input
                  type="number"
                  min={0.05}
                  step={0.25}
                  value={secs(effectLength(e))}
                  onChange={(ev) => {
                    const d = Math.max(50, Number(ev.target.value) * 1000);
                    const k = d / Math.max(1, effectLength(e));
                    patch(i, { behaviors: e.behaviors.map((b) => ({ ...b, delay: b.delay * k, dur: b.t === "set" ? b.dur : b.dur * k })) }, "dur" + e.id);
                  }}
                />
                s
              </label>
              <label title="Delay in seconds">
                +
                <input type="number" min={0} step={0.25} value={secs(e.delay)} onChange={(ev) => patch(i, { delay: Math.max(0, Number(ev.target.value) * 1000) }, "delay" + e.id)} />
                s
              </label>
              <span className="grow" />
              <button className="icon" title="Earlier" aria-label="Move earlier" disabled={!i} onClick={() => move(i, -1)}><ArrowUp /></button>
              <button className="icon" title="Later" aria-label="Move later" disabled={i === slide.anims.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
              <button className="icon" title="Remove effect" aria-label="Remove effect" onClick={() => setAnims(slide.anims.filter((_, j) => j !== i))}><X /></button>
            </div>
          </li>
        ))}
        {!slide.anims.length && <li className="muted small sl-fx-empty">No effects on this slide.</li>}
      </ol>

      <div className="sl-panel-head">
        <h3>Transition</h3>
      </div>
      <div className="sl-trans">
        <label>
          <span>Effect</span>
          <select value={t.type} onChange={(e) => setT({ type: e.target.value as Transition["type"] })}>
            {TRANSITIONS.map((x) => <option key={x.type} value={x.type}>{x.name}</option>)}
          </select>
        </label>
        {tInfo?.dir && (
          <label>
            <span>Direction</span>
            <select value={t.dir ?? "l"} onChange={(e) => setT({ dir: e.target.value as Transition["dir"] })}>
              {DIRS.map((d) => <option key={d.v} value={d.v}>{d.name}</option>)}
            </select>
          </label>
        )}
        {t.type !== "none" && (
          <label>
            <span>Duration</span>
            <input type="number" min={0.1} step={0.25} value={secs(t.dur)} onChange={(e) => setT({ dur: Math.max(100, Number(e.target.value) * 1000) }, "tdur")} /> s
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={slide.advance !== undefined}
            onChange={(e) => onChange({ ...slide, advance: e.target.checked ? 5000 : undefined, transition: slide.transition && { ...slide.transition, xml: undefined } })}
          />
          <span>Move on automatically after</span>
          <input
            type="number"
            min={0}
            step={0.5}
            disabled={slide.advance === undefined}
            value={secs(slide.advance ?? 5000)}
            onChange={(e) => onChange({ ...slide, advance: Math.max(0, Number(e.target.value) * 1000), transition: slide.transition && { ...slide.transition, xml: undefined } }, "adv")}
          />
          s
        </label>
        <button onClick={() => onApplyAll(slide.transition, slide.advance)}>Apply to all slides</button>
      </div>
    </aside>
  );
}
