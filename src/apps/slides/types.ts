// The Slides data model. Positions and sizes are CSS pixels at 96 dpi on the slide
// (1 px = 9525 EMU), font sizes are points. Text formatting is stored fully resolved on each
// run, so rendering never needs the PowerPoint inheritance chain an imported deck came with.

export const EMU_PER_PX = 9525;

export interface Run {
  text: string;
  size: number;
  font: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Superscript (positive) or subscript (negative), as a percentage of the line. */
  baseline?: number;
  caps?: boolean;
  highlight?: string;
  link?: string;
}

export interface Bullet {
  /** A character bullet, such as • or –. */
  char?: string;
  /** An automatic number, in PowerPoint's scheme names (arabicPeriod, romanUcPeriod, alphaLcParenR…). */
  auto?: string;
  startAt?: number;
  color?: string;
  font?: string;
  /** Bullet size relative to the text, 1 = same size. */
  scale?: number;
}

export interface Para {
  runs: Run[];
  align?: "l" | "ctr" | "r" | "just";
  level?: number;
  /** Left margin of the paragraph, px. */
  marL?: number;
  /** First-line indent relative to marL, px; negative leaves room for the bullet. */
  indent?: number;
  bullet?: Bullet;
  /** Line spacing as a multiple of single spacing, or a fixed height in points. */
  line?: { pct: number } | { pt: number };
  spaceBefore?: number;
  spaceAfter?: number;
  /** Font size of an empty paragraph, so blank lines keep their height. */
  endSize?: number;
}

export interface TextBody {
  paras: Para[];
  anchor?: "t" | "ctr" | "b";
  /** Insets left, top, right, bottom in px. */
  inset?: [number, number, number, number];
  wrap?: boolean;
  /** Shrink-to-fit scale from PowerPoint's autofit, 1 = none. */
  fontScale?: number;
  lineReduce?: number;
  vert?: "vert" | "vert270";
  cols?: number;
}

export type Fill =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "grad"; angle: number; radial?: boolean; stops: { pos: number; color: string }[] }
  | { type: "image"; asset: string; tile?: boolean };

export interface Line {
  color: string;
  width: number;
  dash?: string;
  head?: string;
  tail?: string;
}

/** One sub-path of a custom shape, in a coordinate box of w × h. */
export type PathCmd =
  | { c: "M" | "L"; p: [number, number] }
  | { c: "C"; p: [number, number, number, number, number, number] }
  | { c: "Q"; p: [number, number, number, number] }
  | { c: "Z" };
export interface CustomPath {
  w: number;
  h: number;
  cmds: PathCmd[];
  fill?: boolean;
  stroke?: boolean;
}

export interface Shadow {
  dx: number;
  dy: number;
  blur: number;
  color: string;
}

export interface TableCell {
  text: TextBody;
  fill?: Fill;
  borders?: { l?: Line; t?: Line; r?: Line; b?: Line };
  span?: number;
  rowSpan?: number;
  /** Covered by a neighbouring merged cell. */
  merged?: boolean;
}
export interface Table {
  cols: number[];
  rows: { h: number; cells: TableCell[] }[];
}

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
  /** Per-point colors, for pies. */
  colors?: string[];
}
export interface Chart {
  kind: "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";
  horizontal?: boolean;
  stacked?: boolean;
  percent?: boolean;
  title?: string;
  categories: string[];
  series: ChartSeries[];
  legend?: "r" | "b" | "t" | "l";
  labels?: boolean;
  textColor?: string;
}

export interface El {
  id: string;
  type: "shape" | "image" | "table" | "chart" | "media";
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
  /** Preset geometry name as in PowerPoint (rect, roundRect, ellipse, rightArrow, line…). */
  geom?: string;
  adj?: Record<string, number>;
  paths?: CustomPath[];
  fill?: Fill;
  line?: Line;
  shadow?: Shadow;
  opacity?: number;
  text?: TextBody;
  image?: { asset: string; crop?: [number, number, number, number] };
  table?: Table;
  chart?: Chart;
  media?: { asset: string; kind: "video" | "audio" };
  /** Hint shown in the editor while a placeholder is empty. */
  prompt?: string;
  /** Ids of the groups this element was inside in PowerPoint, outermost first. */
  groups?: string[];
  /** Shape id in the PowerPoint file it came from. */
  sid?: number;
  link?: string;
}

// ---- Animation ---------------------------------------------------------------------------

interface BhvBase {
  /** Start, ms after the effect starts. */
  delay: number;
  dur: number;
  repeat?: number;
  autoRev?: boolean;
  accel?: number;
  decel?: number;
}
export type Behavior = BhvBase &
  (
    | { t: "set"; attr: string; to: string }
    | { t: "effect"; transition: "in" | "out" | "none"; filter: string }
    | { t: "anim"; attr: string; keys: { tm: number; v: string | number; fmla?: string }[]; additive?: boolean }
    | { t: "scale"; from?: [number, number]; to?: [number, number]; by?: [number, number] }
    | { t: "rot"; by: number; from?: number; to?: number }
    | { t: "motion"; path: string }
    | { t: "color"; attr: string; to: string }
  );

export interface Effect {
  id: string;
  /** An element id, or a group id from El.groups. */
  target: string;
  /** Only these paragraphs of the target's text, inclusive. */
  paras?: [number, number];
  cls: "entr" | "exit" | "emph" | "path" | "verb" | "media";
  presetId: number;
  subtype: number;
  trigger: "click" | "with" | "after";
  /** Wait after the trigger, ms. */
  delay: number;
  behaviors: Behavior[];
  /** The effect's original PowerPoint XML, written back unchanged on export. */
  xml?: string;
}

export interface Transition {
  type: "none" | "fade" | "black" | "push" | "wipe" | "cover" | "uncover" | "split" | "zoom" | "circle" | "flip" | "dissolve";
  dir?: "l" | "r" | "u" | "d";
  dur: number;
  /** The original PowerPoint XML, written back unchanged on export. */
  xml?: string;
}

export interface Slide {
  id: string;
  bg?: Fill;
  /** Key into SlidesData.bases: the layout and master drawn under this slide. */
  base?: string;
  /** PowerPoint's "Hide background graphics". */
  noBase?: boolean;
  els: El[];
  notes: string;
  hidden?: boolean;
  anims: Effect[];
  transition?: Transition;
  /** Move to the next slide automatically after this many ms. */
  advance?: number;
}

export interface Base {
  bg?: Fill;
  els: El[];
}

export interface Asset {
  type: string;
  bytes: Uint8Array;
}

export interface SlidesData {
  w: number;
  h: number;
  slides: Slide[];
  bases: Record<string, Base>;
  assets: Record<string, Asset>;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function emptyDeck(): SlidesData {
  const deck: SlidesData = { w: 1280, h: 720, slides: [], bases: {}, assets: {} };
  deck.slides.push(newSlide(deck, "title"));
  return deck;
}

export const DEFAULT_FONT = "Calibri";
export const DEFAULT_COLOR = "#1f1f1f";

export function run(text: string, size: number, extra: Partial<Run> = {}): Run {
  return { text, size, font: DEFAULT_FONT, color: DEFAULT_COLOR, ...extra };
}

export function textBox(x: number, y: number, w: number, h: number, paras: Para[], extra: Partial<El> = {}, anchor: TextBody["anchor"] = "t"): El {
  return { id: uid(), type: "shape", geom: "rect", x, y, w, h, fill: { type: "none" }, text: { paras, anchor, wrap: true, inset: [9.6, 4.8, 9.6, 4.8] }, ...extra };
}

export type LayoutId = "title" | "content" | "section" | "two" | "titleOnly" | "blank";
export const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: "title", name: "Title slide" },
  { id: "content", name: "Title and content" },
  { id: "section", name: "Section header" },
  { id: "two", name: "Two content" },
  { id: "titleOnly", name: "Title only" },
  { id: "blank", name: "Blank" },
];

const bulletPara = (size: number): Para => ({ runs: [run("", size)], marL: 28, indent: -28, bullet: { char: "•" }, spaceBefore: 10, line: { pct: 0.9 } });

export function newSlide(deck: Pick<SlidesData, "w" | "h">, layout: LayoutId): Slide {
  const { w, h } = deck;
  const m = w * 0.0625;
  const els: El[] = [];
  const title = (y: number, hh: number, size: number, align: Para["align"], anchor: TextBody["anchor"], prompt = "Click to add title") =>
    els.push(textBox(m, y, w - 2 * m, hh, [{ runs: [run("", size, { font: "Calibri Light" })], align, line: { pct: 0.9 } }], { prompt, name: "Title" }, anchor));
  switch (layout) {
    case "title":
      title(h * 0.16, h * 0.36, 60, "ctr", "b");
      els.push(textBox(m * 2, h * 0.55, w - 4 * m, h * 0.25, [{ runs: [run("", 24)], align: "ctr" }], { prompt: "Click to add subtitle", name: "Subtitle" }));
      break;
    case "content":
      title(h * 0.05, h * 0.18, 44, "l", "ctr");
      els.push(textBox(m, h * 0.27, w - 2 * m, h * 0.63, [bulletPara(28)], { prompt: "Click to add text", name: "Content" }));
      break;
    case "section":
      title(h * 0.25, h * 0.38, 60, "l", "b", "Click to add section title");
      els.push(textBox(m, h * 0.64, w - 2 * m, h * 0.15, [{ runs: [run("", 24, { color: "#6b6b6b" })] }], { prompt: "Click to add text", name: "Text" }));
      break;
    case "two":
      title(h * 0.05, h * 0.18, 44, "l", "ctr");
      els.push(textBox(m, h * 0.27, (w - 2 * m) / 2 - 12, h * 0.63, [bulletPara(28)], { prompt: "Click to add text", name: "Left" }));
      els.push(textBox(w / 2 + 12, h * 0.27, (w - 2 * m) / 2 - 12, h * 0.63, [bulletPara(28)], { prompt: "Click to add text", name: "Right" }));
      break;
    case "titleOnly":
      title(h * 0.05, h * 0.18, 44, "l", "ctr");
      break;
    case "blank":
      break;
  }
  return { id: uid(), bg: { type: "solid", color: "#ffffff" }, els, notes: "", anims: [] };
}

/** Plain text of a body, paragraphs separated by newlines. */
export const plainText = (t?: TextBody) => (t ? t.paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n") : "");
