// Read a PowerPoint (.pptx) file into the Slides model. Follows PowerPoint's inheritance:
// slide → layout → master → theme for placeholders, text styles, colors and fonts, so a deck
// looks the way it does in PowerPoint. Also reads tables, charts, SmartArt (from the drawing
// PowerPoint saves with it), groups, pictures, video, notes, transitions and animations.
import JSZip from "jszip";
import type { Asset, Base, Behavior, Bullet, Chart, CustomPath, Effect, El, Fill, Line, Para, PathCmd, Run, Shadow, Slide, SlidesData, Table, TableCell, TextBody, Transition } from "./types";
import { EMU_PER_PX, uid } from "./types";

type X = Element;

// ---- XML helpers -------------------------------------------------------------------------

const kids = (e: X | null | undefined, name?: string): X[] => (e ? Array.from(e.children).filter((c) => !name || c.localName === name) : []);
const kid = (e: X | null | undefined, name: string): X | null => (e ? Array.from(e.children).find((c) => c.localName === name) ?? null : null);
const path = (e: X | null | undefined, ...names: string[]): X | null => names.reduce<X | null>((cur, n) => kid(cur, n), e ?? null);
const at = (e: X | null | undefined, n: string) => e?.getAttribute(n) ?? null;
const desc = (e: X | Document | null | undefined, name: string): X[] => (e ? Array.from(e.getElementsByTagNameNS("*", name)) : []);
const numAt = (e: X | null | undefined, n: string, def = 0) => {
  const v = at(e, n);
  return v === null || v === "" || isNaN(Number(v)) ? def : Number(v);
};
const bool = (v: string | null) => v === "1" || v === "true" || v === "on";
const emu = (v: number) => v / EMU_PER_PX;
const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rid = (e: X | null | undefined, n: string) => e?.getAttributeNS(RELNS, n) ?? e?.getAttribute("r:" + n) ?? null;

interface Rel {
  target: string;
  type: string;
  external: boolean;
}

function resolvePath(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
};

class Pkg {
  private docs = new Map<string, Document | null>();
  private relCache = new Map<string, Map<string, Rel>>();
  private assetByPath = new Map<string, string | null>();
  assets: Record<string, Asset> = {};
  constructor(private zip: JSZip) {}

  async xml(p: string): Promise<Document | null> {
    if (this.docs.has(p)) return this.docs.get(p)!;
    const f = this.zip.file(p);
    const doc = f ? new DOMParser().parseFromString(await f.async("text"), "application/xml") : null;
    this.docs.set(p, doc);
    return doc;
  }
  async rels(part: string): Promise<Map<string, Rel>> {
    if (this.relCache.has(part)) return this.relCache.get(part)!;
    const dir = part.split("/").slice(0, -1).join("/");
    const file = `${dir ? dir + "/" : ""}_rels/${part.split("/").pop()}.rels`;
    const doc = await this.xml(file);
    const map = new Map<string, Rel>();
    for (const r of desc(doc, "Relationship")) {
      const external = at(r, "TargetMode") === "External";
      const target = at(r, "Target") ?? "";
      map.set(at(r, "Id") ?? "", { target: external ? target : resolvePath(part, target), type: at(r, "Type") ?? "", external });
    }
    this.relCache.set(part, map);
    return map;
  }
  /** Store a media part as an asset once, however many slides use it. Formats a browser can't show are skipped. */
  async asset(p: string): Promise<string | undefined> {
    if (this.assetByPath.has(p)) return this.assetByPath.get(p) ?? undefined;
    const ext = p.split(".").pop()!.toLowerCase();
    const f = this.zip.file(p);
    let key: string | null = null;
    if (f && MIME[ext]) {
      key = uid();
      this.assets[key] = { type: MIME[ext], bytes: await f.async("uint8array") };
    }
    this.assetByPath.set(p, key);
    return key ?? undefined;
  }
}

// ---- Theme and colors --------------------------------------------------------------------

interface Theme {
  colors: Record<string, string>;
  major: string;
  minor: string;
  fills: X[];
  bgFills: X[];
  lines: X[];
  effects: X[];
}

function parseTheme(doc: Document | null): Theme {
  const t: Theme = { colors: {}, major: "Calibri Light", minor: "Calibri", fills: [], bgFills: [], lines: [], effects: [] };
  if (!doc) return t;
  const scheme = desc(doc, "clrScheme")[0];
  for (const c of kids(scheme)) {
    const v = kid(c, "srgbClr") ?? kid(c, "sysClr");
    if (v) t.colors[c.localName] = (v.localName === "sysClr" ? at(v, "lastClr") : at(v, "val")) ?? "000000";
  }
  const fonts = desc(doc, "fontScheme")[0];
  t.major = at(path(fonts, "majorFont", "latin"), "typeface") || t.major;
  t.minor = at(path(fonts, "minorFont", "latin"), "typeface") || t.minor;
  const fmt = desc(doc, "fmtScheme")[0];
  t.fills = kids(kid(fmt, "fillStyleLst"));
  t.bgFills = kids(kid(fmt, "bgFillStyleLst"));
  t.lines = kids(kid(fmt, "lnStyleLst"));
  t.effects = kids(kid(fmt, "effectStyleLst"));
  return t;
}

interface Ctx {
  pkg: Pkg;
  part: string;
  rels: Map<string, Rel>;
  theme: Theme;
  clrMap: Record<string, string>;
}

type RGBA = [number, number, number, number];
const PRESET_COLORS: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", purple: "800080", silver: "C0C0C0", navy: "000080", darkBlue: "00008B", darkRed: "8B0000", darkGreen: "006400", lightGray: "D3D3D3", cyan: "00FFFF", magenta: "FF00FF" };
const hexRgb = (h: string | null | undefined): RGBA | null => {
  if (!h || !/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
};
const toLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLin = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
function rgbToHsl([r, g, b]: RGBA): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === R ? (G - B) / d + (G < B ? 6 : 0) : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number, a: number): RGBA {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, a];
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function applyMods(c: RGBA, el: X): RGBA {
  let [r, g, b, a] = c;
  for (const m of kids(el)) {
    const v = numAt(m, "val") / 100000;
    switch (m.localName) {
      case "alpha": a = v; break;
      case "alphaMod": a *= v; break;
      case "alphaOff": a += v; break;
      case "tint": [r, g, b] = [r, g, b].map((x) => fromLin(1 - (1 - toLin(x)) * v)); break;
      case "shade": [r, g, b] = [r, g, b].map((x) => fromLin(toLin(x) * v)); break;
      case "inv": [r, g, b] = [255 - r, 255 - g, 255 - b]; break;
      case "gray": { const y = 0.3 * r + 0.59 * g + 0.11 * b; [r, g, b] = [y, y, y]; break; }
      case "comp": { const [h, s, l] = rgbToHsl([r, g, b, a]); [r, g, b] = hslToRgb((h + 180) % 360, s, l, a); break; }
      case "lumMod": case "lumOff": case "satMod": case "satOff": case "hueMod": case "hueOff": case "lum": case "sat": case "hue": {
        let [h, s, l] = rgbToHsl([r, g, b, a]);
        if (m.localName === "lumMod") l *= v;
        else if (m.localName === "lumOff") l += v;
        else if (m.localName === "lum") l = v;
        else if (m.localName === "satMod") s *= v;
        else if (m.localName === "satOff") s += v;
        else if (m.localName === "sat") s = v;
        else if (m.localName === "hueMod") h *= v;
        else if (m.localName === "hueOff") h += numAt(m, "val") / 60000;
        else if (m.localName === "hue") h = numAt(m, "val") / 60000;
        [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp01(s), clamp01(l), a);
        break;
      }
    }
  }
  return [r, g, b, clamp01(a)];
}

export const css = ([r, g, b, a]: RGBA) => {
  const h = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return a >= 0.999 ? `#${h(r)}${h(g)}${h(b)}` : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`;
};
function parseCss(c: string): RGBA {
  if (c.startsWith("#")) return hexRgb(c.slice(1, 7)) ?? [0, 0, 0, 1];
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(",");
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  return [0, 0, 0, 1];
}

const COLOR_TAGS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"]);

/** The color held by `parent` (a solidFill, a style reference, a gradient stop…). */
function colorOf(parent: X | null | undefined, ctx: Ctx, ph?: string): string | undefined {
  const c = kids(parent).find((k) => COLOR_TAGS.has(k.localName));
  if (!c) return undefined;
  let rgb: RGBA | null = null;
  const val = at(c, "val") ?? "";
  switch (c.localName) {
    case "srgbClr": rgb = hexRgb(val); break;
    case "schemeClr":
      if (val === "phClr") rgb = ph ? parseCss(ph) : null;
      else rgb = hexRgb(ctx.theme.colors[ctx.clrMap[val] ?? val]);
      break;
    case "sysClr": rgb = hexRgb(at(c, "lastClr") ?? (val === "window" ? "FFFFFF" : "000000")); break;
    case "prstClr": rgb = hexRgb(PRESET_COLORS[val] ?? "000000"); break;
    case "scrgbClr": rgb = [fromLin(numAt(c, "r") / 100000), fromLin(numAt(c, "g") / 100000), fromLin(numAt(c, "b") / 100000), 1]; break;
    case "hslClr": rgb = hslToRgb(numAt(c, "hue") / 60000, numAt(c, "sat") / 100000, numAt(c, "lum") / 100000, 1); break;
  }
  return rgb ? css(applyMods(rgb, c)) : undefined;
}
const schemeColor = (ctx: Ctx, name: string) => css(hexRgb(ctx.theme.colors[ctx.clrMap[name] ?? name]) ?? [0, 0, 0, 1]);

// ---- Fills, lines, effects ----------------------------------------------------------------

const FILL_TAGS = new Set(["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]);
const fillEl = (spPr: X | null | undefined) => kids(spPr).find((k) => FILL_TAGS.has(k.localName)) ?? null;

async function blipAsset(blip: X | null, ctx: Ctx): Promise<string | undefined> {
  if (!blip) return undefined;
  // PowerPoint stores an SVG next to its PNG fallback; the SVG is sharper.
  const svg = desc(blip, "svgBlip")[0];
  for (const id of [rid(svg, "embed"), rid(blip, "embed"), rid(blip, "link")]) {
    const rel = id ? ctx.rels.get(id) : undefined;
    if (rel && !rel.external) {
      const a = await ctx.pkg.asset(rel.target);
      if (a) return a;
    }
  }
  return undefined;
}

async function parseFill(f: X | null, ctx: Ctx, ph?: string): Promise<Fill | undefined> {
  if (!f) return undefined;
  switch (f.localName) {
    case "noFill":
      return { type: "none" };
    case "solidFill": {
      const color = colorOf(f, ctx, ph);
      return color ? { type: "solid", color } : undefined;
    }
    case "gradFill": {
      const stops = kids(kid(f, "gsLst"), "gs")
        .map((g) => ({ pos: numAt(g, "pos") / 100000, color: colorOf(g, ctx, ph) ?? "#000000" }))
        .sort((x, y) => x.pos - y.pos);
      if (!stops.length) return undefined;
      const lin = kid(f, "lin");
      const p = kid(f, "path");
      return { type: "grad", angle: numAt(lin, "ang") / 60000, radial: !!p, stops };
    }
    case "pattFill": {
      const color = colorOf(kid(f, "fgClr"), ctx, ph);
      return color ? { type: "solid", color } : undefined;
    }
    case "blipFill": {
      const asset = await blipAsset(kid(f, "blip"), ctx);
      return asset ? { type: "image", asset, tile: !!kid(f, "tile") } : undefined;
    }
  }
  return undefined;
}

function parseLine(ln: X | null, ctx: Ctx, ph?: string, base?: X | null): Line | undefined {
  const own = ln ? fillEl(ln) : null;
  const inherited = base ? fillEl(base) : null;
  const f = own ?? inherited;
  if (!f || f.localName === "noFill") return undefined;
  let color: string | undefined;
  if (f.localName === "solidFill") color = colorOf(f, ctx, ph);
  else if (f.localName === "gradFill") color = colorOf(kid(kid(f, "gsLst"), "gs"), ctx, ph);
  if (!color) return undefined;
  const w = at(ln, "w") ?? at(base, "w");
  const dash = at(kid(ln, "prstDash"), "val") ?? at(kid(base, "prstDash"), "val") ?? undefined;
  const head = at(kid(ln, "headEnd"), "type") ?? undefined;
  const tail = at(kid(ln, "tailEnd"), "type") ?? undefined;
  return {
    color,
    width: Math.max(emu(Number(w ?? 9525)), 0.5),
    dash: dash && dash !== "solid" ? dash : undefined,
    head: head && head !== "none" ? head : undefined,
    tail: tail && tail !== "none" ? tail : undefined,
  };
}

function parseShadow(effectLst: X | null, ctx: Ctx, ph?: string): Shadow | undefined {
  const s = kid(effectLst, "outerShdw");
  if (!s) return undefined;
  const dist = emu(numAt(s, "dist"));
  const dir = ((numAt(s, "dir") / 60000) * Math.PI) / 180;
  return { dx: Math.cos(dir) * dist, dy: Math.sin(dir) * dist, blur: emu(numAt(s, "blurRad")), color: colorOf(s, ctx, ph) ?? "rgba(0,0,0,0.4)" };
}

// ---- Geometry ------------------------------------------------------------------------------

function parseGeom(spPr: X | null): { geom?: string; adj?: Record<string, number>; paths?: CustomPath[] } {
  const prst = kid(spPr, "prstGeom");
  if (prst) {
    const adj: Record<string, number> = {};
    for (const gd of kids(kid(prst, "avLst"), "gd")) {
      const m = (at(gd, "fmla") ?? "").match(/^val\s+(-?\d+)/);
      if (m) adj[at(gd, "name") ?? ""] = Number(m[1]);
    }
    return { geom: at(prst, "prst") ?? "rect", adj: Object.keys(adj).length ? adj : undefined };
  }
  const cust = kid(spPr, "custGeom");
  if (!cust) return {};
  const paths: CustomPath[] = [];
  for (const p of kids(kid(cust, "pathLst"), "path")) {
    const cmds: PathCmd[] = [];
    let cur: [number, number] = [0, 0];
    const pt = (e: X | null): [number, number] => [numAt(e, "x"), numAt(e, "y")];
    for (const c of kids(p)) {
      const pts = kids(c, "pt").map(pt);
      if (c.localName === "moveTo" && pts[0]) cmds.push({ c: "M", p: (cur = pts[0]) });
      else if (c.localName === "lnTo" && pts[0]) cmds.push({ c: "L", p: (cur = pts[0]) });
      else if (c.localName === "cubicBezTo" && pts.length === 3) {
        cmds.push({ c: "C", p: [...pts[0], ...pts[1], ...pts[2]] });
        cur = pts[2];
      } else if (c.localName === "quadBezTo" && pts.length === 2) {
        cmds.push({ c: "Q", p: [...pts[0], ...pts[1]] });
        cur = pts[1];
      } else if (c.localName === "arcTo") {
        // Approximate the arc with line segments; exact enough at slide scale.
        const wR = numAt(c, "wR"), hR = numAt(c, "hR");
        const st = ((numAt(c, "stAng") / 60000) * Math.PI) / 180;
        const sw = ((numAt(c, "swAng") / 60000) * Math.PI) / 180;
        const cx = cur[0] - wR * Math.cos(st), cy = cur[1] - hR * Math.sin(st);
        const n = Math.max(4, Math.ceil(Math.abs(sw) / (Math.PI / 16)));
        for (let i = 1; i <= n; i++) {
          const t = st + (sw * i) / n;
          cur = [cx + wR * Math.cos(t), cy + hR * Math.sin(t)];
          cmds.push({ c: "L", p: cur });
        }
      } else if (c.localName === "close") cmds.push({ c: "Z" });
    }
    paths.push({ w: numAt(p, "w"), h: numAt(p, "h"), cmds, fill: at(p, "fill") !== "none", stroke: at(p, "stroke") !== "0" && at(p, "stroke") !== "false" });
  }
  // A path with no size of its own is drawn in the shape's own EMU space.
  return { geom: "custom", paths };
}

// ---- Text ------------------------------------------------------------------------------------

interface TextCtx {
  /** List styles (lstStyle or txStyles entries) that win over a shape style's fontRef. */
  lst: X[];
  /** Fallback list styles: the master's text styles and the presentation default. */
  generic: X[];
  bodyPrs: X[];
  fontColor?: string;
  fontFace?: string;
  bold?: boolean;
  slideNum: number;
}

const resolveFont = (f: string | null, ctx: Ctx) => (f === "+mj-lt" || f === "+mj-ea" ? ctx.theme.major : f === "+mn-lt" || f === "+mn-ea" ? ctx.theme.minor : f || null);
const ALIGN: Record<string, Para["align"]> = { l: "l", ctr: "ctr", r: "r", just: "just", dist: "just", justLow: "just", thaiDist: "just" };

function parseBody(txBody: X | null, ctx: Ctx, tc: TextCtx): TextBody | undefined {
  if (!txBody) return undefined;
  const bodyPrs = [kid(txBody, "bodyPr"), ...tc.bodyPrs].filter((b): b is X => !!b);
  const bp = (n: string) => bodyPrs.map((b) => at(b, n)).find((v) => v !== null) ?? null;
  const ins = (n: string, def: number) => emu(Number(bp(n) ?? def));
  const autofit = bodyPrs.map((b) => kid(b, "normAutofit")).find(Boolean);
  const own = kid(txBody, "lstStyle");
  const specific = [own, ...tc.lst].filter((e): e is X => !!e);
  const anchor = bp("anchor");
  const vert = bp("vert");

  const paras: Para[] = kids(txBody, "p").map((p) => {
    const pPr = kid(p, "pPr");
    const lvl = numAt(pPr, "lvl");
    const lvlName = `lvl${lvl + 1}pPr`;
    const spec = [pPr, ...specific.map((s) => kid(s, lvlName))].filter((e): e is X => !!e);
    const gen = tc.generic.map((s) => kid(s, lvlName)).filter((e): e is X => !!e);
    const all = [...spec, ...gen];
    const pa = (n: string) => all.map((e) => at(e, n)).find((v) => v !== null) ?? null;
    const firstWith = (names: string[]) => all.map((e) => kids(e).find((k) => names.includes(k.localName))).find(Boolean) ?? null;

    const runProps = (rPr: X | null): Omit<Run, "text"> => {
      const specR = [rPr, ...spec.map((e) => kid(e, "defRPr"))].filter((e): e is X => !!e);
      const genR = gen.map((e) => kid(e, "defRPr")).filter((e): e is X => !!e);
      const allR = [...specR, ...genR];
      const ra = (n: string) => allR.map((e) => at(e, n)).find((v) => v !== null) ?? null;
      const colorFrom = (list: X[]) => {
        for (const e of list) {
          const f = fillEl(e);
          if (f?.localName === "solidFill") return colorOf(f, ctx);
          if (f?.localName === "gradFill") return colorOf(kid(kid(f, "gsLst"), "gs"), ctx);
          if (f?.localName === "noFill") return "transparent";
        }
        return undefined;
      };
      const fontFrom = (list: X[]) => list.map((e) => resolveFont(at(kid(e, "latin"), "typeface"), ctx)).find(Boolean) ?? undefined;
      const link = kid(rPr, "hlinkClick");
      const linkRel = link ? ctx.rels.get(rid(link, "id") ?? "") : undefined;
      const u = ra("u");
      const strike = ra("strike");
      const b = at(rPr, "b") ?? specR.map((e) => at(e, "b")).find((v) => v !== null) ?? (tc.bold !== undefined ? (tc.bold ? "1" : "0") : null) ?? genR.map((e) => at(e, "b")).find((v) => v !== null) ?? null;
      const hl = kid(rPr, "highlight");
      const props: Omit<Run, "text"> = {
        size: Number(ra("sz") ?? 1800) / 100,
        font: fontFrom(specR) ?? tc.fontFace ?? fontFrom(genR) ?? ctx.theme.minor,
        color: colorFrom(specR) ?? tc.fontColor ?? colorFrom(genR) ?? schemeColor(ctx, "tx1"),
      };
      if (bool(b)) props.bold = true;
      if (bool(ra("i"))) props.italic = true;
      if (u && u !== "none") props.underline = true;
      if (strike && strike !== "noStrike") props.strike = true;
      if (ra("baseline")) props.baseline = Number(ra("baseline")) / 1000;
      if (ra("cap") === "all") props.caps = true;
      if (hl) props.highlight = colorOf(hl, ctx);
      if (linkRel?.external) {
        props.link = linkRel.target;
        if (!colorFrom([rPr].filter((e): e is X => !!e))) props.color = schemeColor(ctx, "hlink");
        props.underline = true;
      }
      return props;
    };

    const runs: Run[] = [];
    for (const c of kids(p)) {
      if (c.localName === "r") runs.push({ text: kid(c, "t")?.textContent ?? "", ...runProps(kid(c, "rPr")) });
      else if (c.localName === "br") runs.push({ text: "\n", ...runProps(kid(c, "rPr")) });
      else if (c.localName === "fld") {
        const t = at(c, "type") === "slidenum" ? String(tc.slideNum) : kid(c, "t")?.textContent ?? "";
        runs.push({ text: t, ...runProps(kid(c, "rPr")) });
      }
    }
    const endProps = runProps(kid(p, "endParaRPr"));
    if (!runs.length) runs.push({ text: "", ...endProps });

    const para: Para = { runs };
    const algn = pa("algn");
    if (algn && ALIGN[algn] && ALIGN[algn] !== "l") para.align = ALIGN[algn];
    if (lvl) para.level = lvl;
    const marL = pa("marL"), indent = pa("indent");
    if (marL) para.marL = emu(Number(marL));
    if (indent) para.indent = emu(Number(indent));

    const bu = firstWith(["buNone", "buChar", "buAutoNum", "buBlip"]);
    if (bu && bu.localName !== "buNone") {
      const b: Bullet = bu.localName === "buAutoNum" ? { auto: at(bu, "type") ?? "arabicPeriod", startAt: numAt(bu, "startAt", 1) } : { char: bu.localName === "buChar" ? at(bu, "char") ?? "•" : "•" };
      const clr = firstWith(["buClr", "buClrTx"]);
      if (clr?.localName === "buClr") b.color = colorOf(clr, ctx);
      const font = firstWith(["buFont", "buFontTx"]);
      if (font?.localName === "buFont") b.font = resolveFont(at(font, "typeface"), ctx) ?? undefined;
      const sz = firstWith(["buSzPct", "buSzPts", "buSzTx"]);
      if (sz?.localName === "buSzPct") b.scale = numAt(sz, "val", 100000) / 100000;
      // Symbol-font bullets: map the common Wingdings code points to Unicode.
      if (b.char && b.font && /wingdings|symbol/i.test(b.font)) {
        b.char = WINGDINGS[b.char] ?? "•";
        b.font = undefined;
      }
      if (runs.some((r) => r.text.trim())) para.bullet = b;
    }
    const spacing = (name: string): { pct: number } | { pt: number } | undefined => {
      const e = firstWith([name]);
      if (!e) return undefined;
      const pts = kid(e, "spcPts"), pct = kid(e, "spcPct");
      if (pts) return { pt: numAt(pts, "val") / 100 };
      if (pct) return { pct: numAt(pct, "val") / 100000 };
      return undefined;
    };
    const ln = spacing("lnSpc");
    if (ln) para.line = ln;
    const size = runs[0]?.size ?? 18;
    const toPt = (s?: { pct: number } | { pt: number }) => (!s ? undefined : "pt" in s ? s.pt : s.pct * size * 1.2);
    const sb = toPt(spacing("spcBef")), sa = toPt(spacing("spcAft"));
    if (sb) para.spaceBefore = sb;
    if (sa) para.spaceAfter = sa;
    if (!runs.some((r) => r.text)) para.endSize = endProps.size;
    return para;
  });

  const body: TextBody = {
    paras,
    anchor: anchor === "ctr" || anchor === "b" ? anchor : "t",
    inset: [ins("lIns", 91440), ins("tIns", 45720), ins("rIns", 91440), ins("bIns", 45720)],
    wrap: bp("wrap") !== "none",
  };
  if (autofit) {
    const fs = numAt(autofit, "fontScale", 100000) / 100000;
    const lr = numAt(autofit, "lnSpcReduction", 0) / 100000;
    if (fs < 1) body.fontScale = fs;
    if (lr) body.lineReduce = lr;
  }
  if (vert === "vert" || vert === "eaVert") body.vert = "vert";
  else if (vert === "vert270") body.vert = "vert270";
  const cols = Number(bp("numCol") ?? 1);
  if (cols > 1) body.cols = cols;
  return body;
}

const WINGDINGS: Record<string, string> = { "§": "■", "Ø": "➢", "ü": "✓", "q": "❑", "v": "❖", "n": "■", "l": "●", "Ü": "➤", "ð": "⇨", "o": "□", "w": "◆", "": "•", "": "■", "": "➢", "": "✓", "": "❖", "": "■", "": "•", "": "□" };

// ---- Shapes ----------------------------------------------------------------------------------

/** Maps a child's coordinates (EMU) through the groups it sits in. */
interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  rot: number;
  /** Rotation centre of the enclosing groups, EMU after mapping. */
  pivots: { x: number; y: number; rot: number }[];
}
const IDENTITY: Xf = { ox: 0, oy: 0, sx: 1, sy: 1, cx: 0, cy: 0, rot: 0, pivots: [] };

function readXfrm(x: X | null) {
  if (!x) return null;
  const off = kid(x, "off"), ext = kid(x, "ext");
  return {
    x: numAt(off, "x"),
    y: numAt(off, "y"),
    w: numAt(ext, "cx"),
    h: numAt(ext, "cy"),
    rot: numAt(x, "rot") / 60000,
    flipH: bool(at(x, "flipH")),
    flipV: bool(at(x, "flipV")),
    chx: numAt(kid(x, "chOff"), "x"),
    chy: numAt(kid(x, "chOff"), "y"),
    chw: numAt(kid(x, "chExt"), "cx"),
    chh: numAt(kid(x, "chExt"), "cy"),
  };
}

function place(xf: Xf, b: { x: number; y: number; w: number; h: number; rot: number }) {
  let x = xf.ox + (b.x - xf.cx) * xf.sx;
  let y = xf.oy + (b.y - xf.cy) * xf.sy;
  const w = b.w * xf.sx, h = b.h * xf.sy;
  // Rotate the centre around each enclosing group's centre, innermost first.
  for (let i = xf.pivots.length - 1; i >= 0; i--) {
    const p = xf.pivots[i];
    if (!p.rot) continue;
    const t = (p.rot * Math.PI) / 180;
    const mx = x + w / 2 - p.x, my = y + h / 2 - p.y;
    x = p.x + mx * Math.cos(t) - my * Math.sin(t) - w / 2;
    y = p.y + mx * Math.sin(t) + my * Math.cos(t) - h / 2;
  }
  return { x: emu(x), y: emu(y), w: emu(w), h: emu(h), rot: b.rot + xf.rot };
}

interface PhInfo {
  type: string;
  idx: string | null;
}
const phOf = (sp: X): PhInfo | null => {
  const ph = desc(kid(sp, sp.localName === "pic" ? "nvPicPr" : sp.localName === "graphicFrame" ? "nvGraphicFramePr" : "nvSpPr"), "ph")[0];
  return ph ? { type: at(ph, "type") ?? "obj", idx: at(ph, "idx") } : null;
};
const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const masterType = (t: string) => (TITLE_TYPES.has(t) ? "title" : t === "dt" || t === "ftr" || t === "sldNum" ? t : "body");

function findPh(tree: X | null, ph: PhInfo, master: boolean): X | null {
  if (!tree) return null;
  const all = desc(tree, "sp").concat(desc(tree, "pic"));
  const withPh = all.map((s) => [s, phOf(s)] as const).filter((p): p is readonly [X, PhInfo] => !!p[1]);
  if (master) {
    const want = masterType(ph.type);
    return withPh.find(([, p]) => masterType(p.type) === want && (want !== "body" || p.type !== "title"))?.[0] ?? null;
  }
  if (ph.idx !== null) {
    const byIdx = withPh.find(([, p]) => p.idx === ph.idx);
    if (byIdx) return byIdx[0];
  }
  return withPh.find(([, p]) => p.type === ph.type || (TITLE_TYPES.has(p.type) && TITLE_TYPES.has(ph.type)))?.[0] ?? null;
}

interface Layer {
  ctx: Ctx;
  tree: X | null;
}
interface PartInfo {
  ctx: Ctx;
  /** Layout and master shape trees this part inherits placeholders from. */
  layout?: Layer;
  master?: Layer;
  txStyles: X | null;
  defaultText: X | null;
  slideNum: number;
  /** Drawing a layout or master: placeholders are prompts, not content. */
  isBase: boolean;
  tableStyles: Document | null;
}

const spPrOf = (sp: X | null) => kid(sp, "spPr");

async function readElements(tree: X, info: PartInfo, xf: Xf, groups: string[], out: El[]) {
  for (const c of kids(tree)) {
    if (c.localName === "AlternateContent") {
      const before = out.length;
      const choice = kid(c, "Choice");
      if (choice) await readElements(choice, info, xf, groups, out);
      const fb = kid(c, "Fallback");
      if (out.length === before && fb) await readElements(fb, info, xf, groups, out);
      continue;
    }
    try {
      if (c.localName === "sp" || c.localName === "cxnSp") {
        const el = await shapeEl(c, info, xf, groups);
        if (el) out.push(el);
      } else if (c.localName === "pic") {
        const el = await picEl(c, info, xf, groups);
        if (el) out.push(el);
      } else if (c.localName === "grpSp") {
        if (bool(at(desc(c, "cNvPr")[0], "hidden"))) continue;
        const g = readXfrm(kid(kid(c, "grpSpPr"), "xfrm"));
        const id = `g${at(path(c, "nvGrpSpPr", "cNvPr"), "id") ?? uid()}`;
        let inner = xf;
        if (g) {
          const sx = g.chw ? g.w / g.chw : 1, sy = g.chh ? g.h / g.chh : 1;
          const ox = xf.ox + (g.x - xf.cx) * xf.sx;
          const oy = xf.oy + (g.y - xf.cy) * xf.sy;
          inner = {
            ox,
            oy,
            sx: xf.sx * sx,
            sy: xf.sy * sy,
            cx: g.chx,
            cy: g.chy,
            rot: xf.rot + g.rot,
            // Pivots are kept in the unrotated space of the outermost group, so they compose.
            pivots: [...xf.pivots, { x: ox + (g.w * xf.sx) / 2, y: oy + (g.h * xf.sy) / 2, rot: g.rot }],
          };
        }
        await readElements(c, info, inner, [...groups, id], out);
      } else if (c.localName === "graphicFrame") {
        const els = await frameEls(c, info, xf, groups);
        out.push(...els);
      } else if (c.localName === "contentPart") {
        // Ink: no fallback picture here, skip.
      }
    } catch (e) {
      console.warn("Slides: skipped a shape it couldn't read", e);
    }
  }
}

async function shapeEl(sp: X, info: PartInfo, xf: Xf, groups: string[]): Promise<El | null> {
  const { ctx } = info;
  const nv = kid(sp, sp.localName === "cxnSp" ? "nvCxnSpPr" : "nvSpPr");
  const cNvPr = kid(nv, "cNvPr");
  if (bool(at(cNvPr, "hidden"))) return null;
  const ph = phOf(sp);
  if (ph && info.isBase) return null; // layout prompts never show on slides
  const layoutPh = ph && info.layout ? findPh(info.layout.tree, ph, false) : null;
  const masterPh = ph && info.master ? findPh(info.master.tree, layoutPh ? phOf(layoutPh) ?? ph : ph, true) : null;
  const chain = [sp, layoutPh, masterPh].filter((e): e is X => !!e);
  const spPr = spPrOf(sp);

  const xfrmSrc = chain.map((s) => kid(spPrOf(s), "xfrm")).find(Boolean) ?? null;
  const x = readXfrm(xfrmSrc);
  if (!x) return null;
  // Placeholders in a layout or master position themselves in that part's own space.
  const box = place(xf, x);

  const geomSrc = chain.map((s) => spPrOf(s)).find((p) => kid(p, "prstGeom") || kid(p, "custGeom")) ?? spPr;
  const g = parseGeom(geomSrc);
  const style = kid(sp, "style");
  const fillRef = kid(style, "fillRef"), lnRef = kid(style, "lnRef"), fontRef = kid(style, "fontRef"), effectRef = kid(style, "effectRef");
  const refColor = (r: X | null) => colorOf(r, ctx);

  let fill: Fill | undefined;
  const fe = chain.map((s) => fillEl(spPrOf(s))).find(Boolean) ?? null;
  if (fe) fill = await parseFill(fe, ctx);
  else if (fillRef && numAt(fillRef, "idx") > 0) {
    const idx = numAt(fillRef, "idx");
    const themeFill = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
    fill = await parseFill(themeFill ?? null, ctx, refColor(fillRef));
  }
  const lnSrc = chain.map((s) => kid(spPrOf(s), "ln")).find(Boolean) ?? null;
  const themeLn = lnRef && numAt(lnRef, "idx") > 0 ? ctx.theme.lines[numAt(lnRef, "idx") - 1] : null;
  const line = parseLine(lnSrc, ctx, refColor(lnRef), themeLn);
  const effectLst = kid(spPr, "effectLst") ?? (effectRef && numAt(effectRef, "idx") > 0 ? kid(ctx.theme.effects[numAt(effectRef, "idx") - 1], "effectLst") : null);
  const shadow = parseShadow(effectLst, ctx, refColor(effectRef));

  const isTitle = !!ph && TITLE_TYPES.has(ph.type);
  const txStyle = ph ? kid(info.txStyles, isTitle ? "titleStyle" : ph.type === "dt" || ph.type === "ftr" || ph.type === "sldNum" ? "otherStyle" : "bodyStyle") : null;
  const lst = chain.slice(1).map((s) => kid(kid(s, "txBody"), "lstStyle")).filter((e): e is X => !!e);
  const generic = ph ? [txStyle].filter((e): e is X => !!e) : [info.defaultText, kid(info.txStyles, "otherStyle")].filter((e): e is X => !!e);
  const tc: TextCtx = {
    lst,
    generic,
    bodyPrs: chain.slice(1).map((s) => kid(kid(s, "txBody"), "bodyPr")).filter((e): e is X => !!e),
    fontColor: fontRef ? refColor(fontRef) : undefined,
    fontFace: fontRef ? (at(fontRef, "idx") === "major" ? ctx.theme.major : ctx.theme.minor) : undefined,
    slideNum: info.slideNum,
  };
  let text = parseBody(kid(sp, "txBody"), ctx, tc);
  // SmartArt drawings place their text in a separate box inside the shape.
  const txX = readXfrm(kid(sp, "txXfrm"));
  if (text && txX) {
    const tb = place(xf, txX);
    const [l, t, r, b] = text.inset ?? [0, 0, 0, 0];
    text.inset = [tb.x - box.x + l, tb.y - box.y + t, box.x + box.w - (tb.x + tb.w) + r, box.y + box.h - (tb.y + tb.h) + b];
  }
  const hasText = !!text?.paras.some((p) => p.runs.some((r) => r.text.trim()));
  let prompt: string | undefined;
  if (ph && !hasText) {
    if (ph.type === "dt" || ph.type === "ftr" || ph.type === "sldNum") return null;
    prompt = (layoutPh && plain(kid(layoutPh, "txBody"))) || (isTitle ? "Click to add title" : "Click to add text");
    // An empty placeholder keeps the layout's formatting so typing into it looks right.
    if (!text || !text.paras.length) text = parseBody(kid(layoutPh, "txBody") ?? kid(masterPh, "txBody"), ctx, tc);
    if (text) text.paras = [{ ...text.paras[0], runs: [{ ...text.paras[0].runs[0], text: "" }] }];
  }
  if (!hasText && !prompt && (!fill || fill.type === "none") && !line) return null;

  const el: El = {
    id: uid(),
    type: "shape",
    name: at(cNvPr, "name") ?? undefined,
    sid: numAt(cNvPr, "id") || undefined,
    ...box,
    geom: g.geom ?? "rect",
  };
  if (!el.rot) delete el.rot;
  if (x.flipH) el.flipH = true;
  if (x.flipV) el.flipV = true;
  if (g.adj) el.adj = g.adj;
  if (g.paths) el.paths = g.paths;
  el.fill = fill ?? { type: "none" };
  if (line) el.line = line;
  if (shadow) el.shadow = shadow;
  if (text) el.text = text;
  if (prompt) el.prompt = prompt;
  if (groups.length) el.groups = groups;
  const link = kid(cNvPr, "hlinkClick");
  const linkRel = link ? ctx.rels.get(rid(link, "id") ?? "") : undefined;
  if (linkRel?.external) el.link = linkRel.target;
  return el;
}

const plain = (txBody: X | null) => kids(txBody, "p").map((p) => desc(p, "t").map((t) => t.textContent).join("")).join("\n").trim();

async function picEl(pic: X, info: PartInfo, xf: Xf, groups: string[]): Promise<El | null> {
  const { ctx } = info;
  const nv = kid(pic, "nvPicPr");
  const cNvPr = kid(nv, "cNvPr");
  if (bool(at(cNvPr, "hidden"))) return null;
  const ph = phOf(pic);
  if (ph && info.isBase) return null;
  const layoutPh = ph && info.layout ? findPh(info.layout.tree, ph, false) : null;
  const spPr = kid(pic, "spPr");
  const x = readXfrm(kid(spPr, "xfrm") ?? kid(spPrOf(layoutPh), "xfrm"));
  if (!x) return null;
  const blipFill = kid(pic, "blipFill");
  const asset = await blipAsset(kid(blipFill, "blip"), ctx);
  const src = kid(blipFill, "srcRect");
  const crop: [number, number, number, number] | undefined = src ? [numAt(src, "l") / 100000, numAt(src, "t") / 100000, numAt(src, "r") / 100000, numAt(src, "b") / 100000] : undefined;

  // Video and audio: the picture is the poster frame.
  const nvPr = kid(nv, "nvPr");
  const mediaRef = kid(nvPr, "videoFile") ?? kid(nvPr, "audioFile");
  const p14 = desc(nvPr, "media")[0];
  let media: El["media"];
  for (const id of [rid(p14, "embed"), rid(mediaRef, "link")]) {
    const rel = id ? ctx.rels.get(id) : undefined;
    if (rel && !rel.external) {
      const a = await ctx.pkg.asset(rel.target);
      if (a) {
        media = { asset: a, kind: mediaRef?.localName === "audioFile" || ctx.pkg.assets[a].type.startsWith("audio") ? "audio" : "video" };
        break;
      }
    }
  }
  if (!asset && !media) return null;
  const g = parseGeom(spPr);
  const el: El = {
    id: uid(),
    type: media ? "media" : "image",
    name: at(cNvPr, "name") ?? undefined,
    sid: numAt(cNvPr, "id") || undefined,
    ...place(xf, x),
  };
  if (!el.rot) delete el.rot;
  if (x.flipH) el.flipH = true;
  if (x.flipV) el.flipV = true;
  if (asset) el.image = { asset, ...(crop && crop.some((v) => v) ? { crop } : {}) };
  if (media) el.media = media;
  if (g.geom && g.geom !== "rect") {
    el.geom = g.geom;
    if (g.adj) el.adj = g.adj;
  }
  const line = parseLine(kid(spPr, "ln"), ctx);
  if (line) el.line = line;
  const shadow = parseShadow(kid(spPr, "effectLst"), ctx);
  if (shadow) el.shadow = shadow;
  if (groups.length) el.groups = groups;
  return el;
}

async function frameEls(fr: X, info: PartInfo, xf: Xf, groups: string[]): Promise<El[]> {
  const { ctx } = info;
  const cNvPr = path(fr, "nvGraphicFramePr", "cNvPr");
  if (bool(at(cNvPr, "hidden"))) return [];
  const x = readXfrm(kid(fr, "xfrm"));
  if (!x) return [];
  const box = place(xf, x);
  const data = path(fr, "graphic", "graphicData");
  const sid = numAt(cNvPr, "id") || undefined;
  const base = { id: uid(), name: at(cNvPr, "name") ?? undefined, sid, ...box, ...(groups.length ? { groups } : {}) };
  if (!base.rot) delete (base as Partial<El>).rot;

  const tbl = kid(data, "tbl");
  if (tbl) return [{ ...base, type: "table", table: parseTable(tbl, info) }];

  const chartRef = kid(data, "chart");
  if (chartRef) {
    const rel = ctx.rels.get(rid(chartRef, "id") ?? "");
    const doc = rel ? await ctx.pkg.xml(rel.target) : null;
    const chart = doc ? parseChart(doc, ctx) : null;
    return chart ? [{ ...base, type: "chart", chart }] : [];
  }

  const dgm = kid(data, "relIds");
  if (dgm) {
    // SmartArt: PowerPoint saves the laid-out shapes as a drawing part next to the data.
    const dataRel = ctx.rels.get(rid(dgm, "dm") ?? "");
    let drawing: string | undefined;
    if (dataRel) {
      const dm = await ctx.pkg.xml(dataRel.target);
      const ext = desc(dm, "dataModelExt")[0];
      const relId = at(ext, "relId");
      if (relId) drawing = ctx.rels.get(relId)?.target;
    }
    if (!drawing) drawing = [...ctx.rels.values()].find((r) => r.type.endsWith("/diagramDrawing"))?.target;
    const doc = drawing ? await ctx.pkg.xml(drawing) : null;
    const tree = desc(doc, "spTree")[0];
    if (!tree || !drawing) return [];
    const dctx: Ctx = { ...ctx, part: drawing, rels: await ctx.pkg.rels(drawing) };
    const out: El[] = [];
    const inner: Xf = { ...xf, ox: xf.ox + (x.x - xf.cx) * xf.sx, oy: xf.oy + (x.y - xf.cy) * xf.sy, cx: 0, cy: 0 };
    await readElements(tree, { ...info, ctx: dctx, layout: undefined, master: undefined, isBase: false }, inner, [...groups, `g${sid}`], out);
    return out;
  }

  const ole = kid(data, "oleObj") ?? desc(data, "oleObj")[0];
  const pic = desc(ole ?? data, "pic")[0];
  if (pic) {
    const el = await picEl(pic, info, xf, groups);
    if (el) return [{ ...el, ...box, sid }];
  }
  return [];
}

// ---- Tables -----------------------------------------------------------------------------------

function parseTable(tbl: X, info: PartInfo): Table {
  const { ctx } = info;
  const tblPr = kid(tbl, "tblPr");
  const flags = { firstRow: bool(at(tblPr, "firstRow")), lastRow: bool(at(tblPr, "lastRow")), firstCol: bool(at(tblPr, "firstCol")), lastCol: bool(at(tblPr, "lastCol")), bandRow: bool(at(tblPr, "bandRow")), bandCol: bool(at(tblPr, "bandCol")) };
  const styleId = kid(tblPr, "tableStyleId")?.textContent?.trim();
  // PowerPoint's built-in styles aren't always written to tableStyles.xml; the default one is.
  const style = styleId ? desc(info.tableStyles, "tblStyle").find((s) => at(s, "styleId") === styleId) ?? defaultTableStyle() : null;
  const cols = kids(kid(tbl, "tblGrid"), "gridCol").map((c) => emu(numAt(c, "w")));
  const trs = kids(tbl, "tr");
  const nRows = trs.length;

  const parts = (r: number, c: number) => {
    const list: string[] = ["wholeTbl"];
    const dataRow = r - (flags.firstRow ? 1 : 0);
    const dataCol = c - (flags.firstCol ? 1 : 0);
    if (flags.bandCol && dataCol >= 0) list.push(dataCol % 2 ? "band2V" : "band1V");
    if (flags.bandRow && dataRow >= 0) list.push(dataRow % 2 ? "band2H" : "band1H");
    if (flags.lastCol && c === cols.length - 1) list.push("lastCol");
    if (flags.firstCol && c === 0) list.push("firstCol");
    if (flags.lastRow && r === nRows - 1) list.push("lastRow");
    if (flags.firstRow && r === 0) list.push("firstRow");
    return list.map((n) => kid(style, n)).filter((e): e is X => !!e);
  };

  const rows = trs.map((tr, r) => ({
    h: emu(numAt(tr, "h")),
    cells: kids(tr, "tc").map((tc, c): TableCell => {
      const ps = parts(r, c);
      const txStyles = ps.map((p) => kid(p, "tcTxStyle")).filter((e): e is X => !!e);
      const lastTx = txStyles[txStyles.length - 1];
      const fontColor = txStyles.map((t) => colorOf(t, ctx) ?? colorOf(kid(t, "fontRef"), ctx)).filter(Boolean).pop();
      const bold = txStyles.map((t) => at(t, "b")).filter((v) => v !== null).pop();
      const tcPr = kid(tc, "tcPr");
      const text = parseBody(kid(tc, "txBody"), ctx, {
        lst: [],
        generic: [kid(info.txStyles, "otherStyle"), info.defaultText].filter((e): e is X => !!e),
        bodyPrs: [],
        fontColor,
        fontFace: lastTx && kid(lastTx, "fontRef") ? (at(kid(lastTx, "fontRef"), "idx") === "major" ? ctx.theme.major : ctx.theme.minor) : undefined,
        bold: bold === null || bold === undefined ? undefined : bold === "on",
        slideNum: info.slideNum,
      }) ?? { paras: [{ runs: [{ text: "", size: 18, font: ctx.theme.minor, color: schemeColor(ctx, "tx1") }] }] };
      text.inset = [emu(numAt(tcPr, "marL", 91440)), emu(numAt(tcPr, "marT", 45720)), emu(numAt(tcPr, "marR", 91440)), emu(numAt(tcPr, "marB", 45720))];
      const anchor = at(tcPr, "anchor");
      text.anchor = anchor === "ctr" || anchor === "b" ? anchor : "t";
      const cell: TableCell = { text };
      // Fill: the cell's own, else the most specific table-style part's.
      const own = fillEl(tcPr);
      if (own) {
        const f = own.localName === "solidFill" ? colorOf(own, ctx) : own.localName === "noFill" ? null : colorOf(kid(kid(own, "gsLst"), "gs"), ctx);
        if (f) cell.fill = { type: "solid", color: f };
      } else {
        for (const p of ps) {
          const tcs = kid(p, "tcStyle");
          const f = fillEl(kid(tcs, "fill"));
          if (f?.localName === "solidFill") cell.fill = { type: "solid", color: colorOf(f, ctx) ?? "transparent" };
          else if (f?.localName === "noFill") cell.fill = undefined;
          const ref = kid(tcs, "fillRef");
          if (ref) cell.fill = { type: "solid", color: colorOf(ref, ctx) ?? "transparent" };
        }
      }
      const borders: TableCell["borders"] = {};
      const styleBorder = (side: "left" | "right" | "top" | "bottom", inner: "insideH" | "insideV", isEdge: boolean) => {
        let found: Line | undefined;
        for (const p of ps) {
          const bdr = kid(kid(p, "tcStyle"), "tcBdr");
          const e = kid(bdr, isEdge || p.localName !== "wholeTbl" ? side : inner) ?? (p.localName === "wholeTbl" ? null : null);
          const ln = kid(e, "ln");
          if (ln) found = parseLine(ln, ctx);
          const ref = kid(e, "lnRef");
          if (ref && numAt(ref, "idx") > 0) found = parseLine(null, ctx, colorOf(ref, ctx), ctx.theme.lines[numAt(ref, "idx") - 1]);
        }
        return found;
      };
      const span = numAt(tc, "gridSpan", 1);
      const sides: [keyof NonNullable<TableCell["borders"]>, string, "left" | "right" | "top" | "bottom", "insideH" | "insideV", boolean][] = [
        ["l", "lnL", "left", "insideV", c === 0],
        ["r", "lnR", "right", "insideV", c + span >= cols.length],
        ["t", "lnT", "top", "insideH", r === 0],
        ["b", "lnB", "bottom", "insideH", r === nRows - 1],
      ];
      for (const [k, tag, side, inner, edge] of sides) {
        const ln = kid(tcPr, tag);
        const v = ln ? parseLine(ln, ctx) : styleBorder(side, inner, edge);
        if (v) borders[k] = v;
      }
      if (Object.keys(borders).length) cell.borders = borders;
      if (span > 1) cell.span = span;
      const rs = numAt(tc, "rowSpan", 1);
      if (rs > 1) cell.rowSpan = rs;
      if (bool(at(tc, "hMerge")) || bool(at(tc, "vMerge"))) cell.merged = true;
      return cell;
    }),
  }));
  return { cols, rows };
}

let defaultStyle: X | null = null;
/** "Medium Style 2 – Accent 1", PowerPoint's default table style. */
function defaultTableStyle(): X {
  if (defaultStyle) return defaultStyle;
  const ln = (w: number) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>`;
  const sides = ["left", "right", "top", "bottom", "insideH", "insideV"].map((s) => `<a:${s}>${ln(12700)}</a:${s}>`).join("");
  const fill = (inner: string) => `<a:fill><a:solidFill><a:schemeClr val="accent1">${inner}</a:schemeClr></a:solidFill></a:fill>`;
  const head = (bdr: string) => `<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${bdr}</a:tcBdr>${fill("")}</a:tcStyle>`;
  const xml = `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${sides}</a:tcBdr>${fill('<a:tint val="20000"/>')}</a:tcStyle></a:wholeTbl>
    <a:band1H><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1H>
    <a:band1V><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1V>
    <a:lastCol>${head("")}</a:lastCol><a:firstCol>${head("")}</a:firstCol>
    <a:lastRow>${head(`<a:top>${ln(38100)}</a:top>`)}</a:lastRow>
    <a:firstRow>${head(`<a:bottom>${ln(38100)}</a:bottom>`)}</a:firstRow>
  </a:tblStyle>`;
  defaultStyle = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  return defaultStyle;
}

// ---- Charts -----------------------------------------------------------------------------------

function cache(e: X | null): string[] {
  const multi = desc(e, "multiLvlStrCache")[0];
  if (multi) {
    // Multi-level categories: the first level is the one shown under each bar.
    const n = numAt(kid(multi, "ptCount"), "val", 0);
    const out: string[] = Array(n).fill("");
    for (const p of kids(kid(multi, "lvl"), "pt")) out[numAt(p, "idx")] = kid(p, "v")?.textContent ?? "";
    return out;
  }
  const c = desc(e, "strCache")[0] ?? desc(e, "numCache")[0];
  if (!c) {
    // Literal values, used by some generators.
    const lit = desc(e, "strLit")[0] ?? desc(e, "numLit")[0];
    if (!lit) return [];
    return kids(lit, "pt").map((p) => kid(p, "v")?.textContent ?? "");
  }
  const n = numAt(kid(c, "ptCount"), "val", 0);
  const out: string[] = Array(n).fill("");
  for (const p of kids(c, "pt")) out[numAt(p, "idx")] = kid(p, "v")?.textContent ?? "";
  return out;
}

function parseChart(doc: Document, ctx: Ctx): Chart | null {
  const chart = desc(doc, "chart")[0];
  const plot = kid(chart, "plotArea");
  const KINDS: Record<string, Chart["kind"]> = { barChart: "bar", bar3DChart: "bar", lineChart: "line", line3DChart: "line", stockChart: "line", radarChart: "line", pieChart: "pie", pie3DChart: "pie", ofPieChart: "pie", doughnutChart: "doughnut", areaChart: "area", area3DChart: "area", scatterChart: "scatter", bubbleChart: "scatter" };
  const typeEl = kids(plot).find((k) => KINDS[k.localName]);
  if (!typeEl) return null;
  const kind = KINDS[typeEl.localName];
  const grouping = at(kid(typeEl, "grouping"), "val") ?? "clustered";
  const accents = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((a) => schemeColor(ctx, a));
  const sers = kids(typeEl, "ser");
  let categories: string[] = [];
  const series = sers.map((s, i) => {
    const cat = cache(kid(s, "cat") ?? kid(s, "xVal"));
    if (cat.length > categories.length) categories = cat;
    const values = cache(kid(s, "val") ?? kid(s, "yVal")).map(Number);
    const spPr = kid(s, "spPr");
    const f = fillEl(spPr);
    const lineFill = fillEl(kid(spPr, "ln"));
    const color = (kind === "line" || kind === "scatter" ? colorOf(lineFill, ctx) : undefined) ?? (f?.localName === "solidFill" ? colorOf(f, ctx) : undefined) ?? accents[i % 6];
    const out: Chart["series"][number] = { name: cache(kid(s, "tx")).join(" ") || `Series ${i + 1}`, color, values };
    if (kind === "pie" || kind === "doughnut") {
      out.colors = values.map((_, j) => accents[j % 6]);
      for (const dp of kids(s, "dPt")) {
        const c = colorOf(fillEl(kid(dp, "spPr")), ctx);
        if (c) out.colors[numAt(kid(dp, "idx"), "val")] = c;
      }
    }
    return out;
  });
  const titleEl = kid(chart, "title");
  const title = titleEl ? desc(titleEl, "t").map((t) => t.textContent).join("") || (sers.length === 1 ? series[0]?.name : undefined) : undefined;
  const legend = kid(chart, "legend");
  const pos = at(kid(legend, "legendPos"), "val");
  return {
    kind,
    horizontal: at(kid(typeEl, "barDir"), "val") === "bar",
    stacked: grouping === "stacked" || grouping === "percentStacked",
    percent: grouping === "percentStacked",
    title: bool(at(kid(chart, "autoTitleDeleted"), "val")) ? undefined : title,
    categories: categories.length ? categories : (series[0]?.values ?? []).map((_, i) => String(i + 1)),
    series,
    legend: legend ? ((pos === "b" || pos === "t" || pos === "l" ? pos : "r") as Chart["legend"]) : undefined,
    labels: desc(typeEl, "showVal").some((e) => bool(at(e, "val"))),
    textColor: schemeColor(ctx, "tx1"),
  };
}

// ---- Backgrounds --------------------------------------------------------------------------------

async function parseBg(cSld: X | null, ctx: Ctx): Promise<Fill | undefined> {
  const bg = kid(cSld, "bg");
  if (!bg) return undefined;
  const pr = kid(bg, "bgPr");
  if (pr) return parseFill(fillEl(pr), ctx);
  const ref = kid(bg, "bgRef");
  if (ref) {
    const idx = numAt(ref, "idx");
    const f = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
    return parseFill(f ?? null, ctx, colorOf(ref, ctx));
  }
  return undefined;
}

// ---- Animations and transitions --------------------------------------------------------------------

const cond = (cTn: X | null) => {
  const c = kids(kid(cTn, "stCondLst"), "cond");
  const d = c.map((x) => at(x, "delay")).find((v) => v !== null && v !== "indefinite");
  return d ? Number(d) || 0 : 0;
};
const ms = (v: string | null) => (v === null || v === "indefinite" ? 0 : Number(v) || 0);

function parseBehaviors(list: X | null, ctx: Ctx, offset: number, out: Behavior[], targets: { spid?: number; pRg?: [number, number] }[]) {
  for (const b of kids(list)) {
    if (b.localName === "par" || b.localName === "seq") {
      const cTn = kid(b, "cTn");
      parseBehaviors(kid(cTn, "childTnLst"), ctx, offset + cond(cTn), out, targets);
      continue;
    }
    const cBhvr = kid(b, "cBhvr");
    const cTn = kid(cBhvr, "cTn");
    if (!cTn) continue;
    const tgt = kid(cBhvr, "tgtEl");
    const sp = kid(tgt, "spTgt");
    if (sp) {
      const pRg = desc(sp, "pRg")[0];
      targets.push({ spid: numAt(sp, "spid"), pRg: pRg ? [numAt(pRg, "st"), numAt(pRg, "end")] : undefined });
    }
    const repeat = at(cTn, "repeatCount");
    const common = {
      delay: offset + cond(cTn),
      dur: ms(at(cTn, "dur")),
      ...(repeat ? { repeat: repeat === "indefinite" ? Infinity : Number(repeat) / 1000 } : {}),
      ...(bool(at(cTn, "autoRev")) ? { autoRev: true } : {}),
      ...(at(cTn, "accel") ? { accel: numAt(cTn, "accel") / 100000 } : {}),
      ...(at(cTn, "decel") ? { decel: numAt(cTn, "decel") / 100000 } : {}),
    };
    const attrs = kids(kid(cBhvr, "attrNameLst"), "attrName").map((a) => a.textContent?.trim() ?? "");
    const valOf = (v: X | null): string | number => {
      const s = kid(v, "strVal"), f = kid(v, "fltVal"), i = kid(v, "intVal"), bo = kid(v, "boolVal");
      return s ? at(s, "val") ?? "" : f ? numAt(f, "val") : i ? numAt(i, "val") : bo ? at(bo, "val") ?? "" : "";
    };
    switch (b.localName) {
      case "set":
        out.push({ t: "set", attr: attrs[0] ?? "", to: String(valOf(kid(b, "to"))), ...common, dur: Math.max(common.dur, 1) });
        break;
      case "animEffect":
        out.push({ t: "effect", transition: (at(b, "transition") as "in" | "out" | null) ?? "in", filter: at(b, "filter") ?? "fade", ...common });
        break;
      case "anim": {
        const keys = kids(kid(b, "tavLst"), "tav").map((t) => ({ tm: ms(at(t, "tm")) / 100000, v: valOf(kid(t, "val")), ...(at(t, "fmla") ? { fmla: at(t, "fmla")! } : {}) }));
        if (!keys.length) {
          const from = at(b, "from"), to = at(b, "to"), by = at(b, "by");
          if (to !== null) keys.push(...(from !== null ? [{ tm: 0, v: from }] : []), { tm: 1, v: to });
          else if (by !== null) keys.push({ tm: 0, v: "#" + attrs[0] }, { tm: 1, v: `#${attrs[0]}+${by}` });
        }
        if (keys.length && keys[0].tm > 0 && keys.length === 1) keys.unshift({ tm: 0, v: "#" + attrs[0] });
        out.push({ t: "anim", attr: attrs[0] ?? "", keys, additive: at(cBhvr, "additive") === "sum", ...common });
        break;
      }
      case "animScale": {
        const pair = (e: X | null): [number, number] | undefined => (e ? [numAt(e, "x", 100000) / 100000, numAt(e, "y", 100000) / 100000] : undefined);
        out.push({ t: "scale", from: pair(kid(b, "from")), to: pair(kid(b, "to")), by: pair(kid(b, "by")), ...common });
        break;
      }
      case "animRot":
        out.push({ t: "rot", by: numAt(b, "by") / 60000, ...(at(b, "from") ? { from: numAt(b, "from") / 60000 } : {}), ...(at(b, "to") ? { to: numAt(b, "to") / 60000 } : {}), ...common });
        break;
      case "animMotion":
        out.push({ t: "motion", path: at(b, "path") ?? "", ...common });
        break;
      case "animClr": {
        const to = colorOf(kid(b, "to"), ctx);
        if (to) out.push({ t: "color", attr: attrs[0] ?? "style.color", to, ...common });
        break;
      }
    }
  }
}

function parseTiming(sld: X, ctx: Ctx, sidToTarget: Map<number, string>): Effect[] {
  const timing = kid(sld, "timing");
  const main = desc(timing, "cTn").find((c) => at(c, "nodeType") === "mainSeq");
  if (!main) return [];
  const effects: Effect[] = [];
  const ser = new XMLSerializer();
  for (const group of kids(kid(main, "childTnLst"), "par")) {
    for (const sub of kids(kid(kid(group, "cTn"), "childTnLst"), "par")) {
      for (const eff of kids(kid(kid(sub, "cTn"), "childTnLst"), "par")) {
        const cTn = kid(eff, "cTn");
        const behaviors: Behavior[] = [];
        const targets: { spid?: number; pRg?: [number, number] }[] = [];
        parseBehaviors(kid(cTn, "childTnLst"), ctx, 0, behaviors, targets);
        const t = targets.find((x) => x.spid);
        const target = t?.spid !== undefined ? sidToTarget.get(t.spid) : undefined;
        if (!target || !behaviors.length) continue;
        const node = at(cTn, "nodeType");
        const cls = at(cTn, "presetClass");
        effects.push({
          id: uid(),
          target,
          ...(t?.pRg ? { paras: t.pRg } : {}),
          cls: cls === "entr" || cls === "exit" || cls === "emph" || cls === "path" || cls === "verb" ? cls : cls === "mediacall" ? "media" : "emph",
          presetId: numAt(cTn, "presetID"),
          subtype: numAt(cTn, "presetSubtype"),
          trigger: node === "clickEffect" ? "click" : node === "afterEffect" ? "after" : "with",
          delay: cond(cTn),
          behaviors,
          xml: ser.serializeToString(eff),
        });
      }
    }
  }
  return effects;
}

const TRANSITIONS: Record<string, Transition["type"]> = {
  fade: "fade", push: "push", wipe: "wipe", cover: "cover", pull: "uncover", split: "split", zoom: "zoom", cut: "none",
  circle: "circle", diamond: "circle", plus: "circle", wedge: "circle", wheel: "circle", wheelReverse: "circle", newsflash: "zoom",
  dissolve: "dissolve", randomBar: "dissolve", blinds: "wipe", checker: "dissolve", strips: "wipe", random: "fade",
  vortex: "zoom", ripple: "zoom", warp: "zoom", flythrough: "zoom", glitter: "dissolve", honeycomb: "dissolve", shred: "dissolve", flash: "fade",
  reveal: "fade", doors: "split", window: "split", ferris: "push", gallery: "push", conveyor: "push", pan: "push", switch: "flip", flip: "flip", prism: "push",
  prstTrans: "fade", morph: "fade",
};

function parseTransition(sld: X): { transition?: Transition; advance?: number } {
  let tr = kid(sld, "transition");
  let raw: X | null = tr;
  const ac = kids(sld, "AlternateContent").find((a) => desc(a, "transition").length);
  if (ac) {
    tr = desc(kid(ac, "Choice"), "transition")[0] ?? desc(ac, "transition")[0];
    raw = ac;
  }
  if (!tr) return {};
  const fx = kids(tr).find((k) => k.localName !== "sndAc" && k.localName !== "extLst");
  const name = fx?.localName ?? "";
  let type: Transition["type"] = fx ? TRANSITIONS[name] ?? "fade" : "none";
  if ((name === "fade" || name === "cut") && bool(at(fx, "thruBlk"))) type = "black";
  const spd = at(tr, "spd");
  const dur = at(tr, "dur") ? Number(at(tr, "dur")) : spd === "fast" ? 500 : spd === "slow" ? 1000 : 750;
  const d = at(fx, "dir");
  const dir = d === "l" || d === "r" || d === "u" || d === "d" ? d : undefined;
  const out: { transition?: Transition; advance?: number } = {};
  if (type !== "none" || raw) out.transition = { type, ...(dir ? { dir } : {}), dur, xml: raw ? new XMLSerializer().serializeToString(raw) : undefined };
  if (at(tr, "advTm") !== null) out.advance = Number(at(tr, "advTm"));
  return out;
}

// ---- The package -------------------------------------------------------------------------------

function clrMapOf(e: X | null, fallback?: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = { ...(fallback ?? { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" }) };
  if (!e) return map;
  for (const a of Array.from(e.attributes)) map[a.localName] = a.value;
  return map;
}

export async function importPptx(buf: ArrayBuffer): Promise<SlidesData> {
  const zip = await JSZip.loadAsync(buf);
  const pkg = new Pkg(zip);
  const presPath = "ppt/presentation.xml";
  const pres = await pkg.xml(presPath);
  if (!pres) throw new Error("This isn’t a PowerPoint file (no ppt/presentation.xml)");
  const presRels = await pkg.rels(presPath);
  const sz = desc(pres, "sldSz")[0];
  const deck: SlidesData = { w: Math.round(emu(numAt(sz, "cx", 12192000))), h: Math.round(emu(numAt(sz, "cy", 6858000))), slides: [], bases: {}, assets: pkg.assets };
  const defaultText = desc(pres, "defaultTextStyle")[0] ?? null;
  const tableStylesRel = [...presRels.values()].find((r) => r.type.endsWith("/tableStyles"));
  const tableStyles = tableStylesRel ? await pkg.xml(tableStylesRel.target) : null;

  const themes = new Map<string, Theme>();
  const themeFor = async (part: string) => {
    const rel = [...(await pkg.rels(part)).values()].find((r) => r.type.endsWith("/theme"));
    if (!rel) return parseTheme(null);
    if (!themes.has(rel.target)) themes.set(rel.target, parseTheme(await pkg.xml(rel.target)));
    return themes.get(rel.target)!;
  };

  const ids = kids(desc(pres, "sldIdLst")[0], "sldId");
  for (let i = 0; i < ids.length; i++) {
    const rel = presRels.get(rid(ids[i], "id") ?? "");
    if (!rel) continue;
    try {
      deck.slides.push(await readSlide(pkg, rel.target, i + 1, deck, themeFor, defaultText, tableStyles));
    } catch (e) {
      console.warn("Slides: couldn't read", rel.target, e);
    }
  }
  if (!deck.slides.length) throw new Error("No slides could be read from this file");
  return deck;
}

async function readSlide(
  pkg: Pkg,
  part: string,
  num: number,
  deck: SlidesData,
  themeFor: (part: string) => Promise<Theme>,
  defaultText: X | null,
  tableStyles: Document | null,
): Promise<Slide> {
  const doc = (await pkg.xml(part))!;
  const sld = doc.documentElement;
  const rels = await pkg.rels(part);
  const layoutPath = [...rels.values()].find((r) => r.type.endsWith("/slideLayout"))?.target;
  const layoutDoc = layoutPath ? await pkg.xml(layoutPath) : null;
  const layoutRels = layoutPath ? await pkg.rels(layoutPath) : new Map<string, Rel>();
  const masterPath = [...layoutRels.values()].find((r) => r.type.endsWith("/slideMaster"))?.target;
  const masterDoc = masterPath ? await pkg.xml(masterPath) : null;
  const theme = await themeFor(masterPath ?? part);

  const masterMap = clrMapOf(desc(masterDoc, "clrMap")[0] ?? null);
  const ovr = (d: Document | X | null) => desc(d, "overrideClrMapping")[0] ?? null;
  const layoutMap = clrMapOf(ovr(layoutDoc), masterMap);
  const slideMap = clrMapOf(ovr(sld), layoutMap);

  const mctx: Ctx = { pkg, part: masterPath ?? "", rels: masterPath ? await pkg.rels(masterPath) : new Map(), theme, clrMap: masterMap };
  const lctx: Ctx = { pkg, part: layoutPath ?? "", rels: layoutRels, theme, clrMap: layoutMap };
  const sctx: Ctx = { pkg, part, rels, theme, clrMap: slideMap };
  const txStyles = desc(masterDoc, "txStyles")[0] ?? null;
  const masterTree = desc(masterDoc, "spTree")[0] ?? null;
  const layoutTree = desc(layoutDoc, "spTree")[0] ?? null;
  const common = { txStyles, defaultText, tableStyles };

  // The layout and master drawing under the slide, read once per layout.
  const baseKey = layoutPath ?? masterPath ?? "";
  if (baseKey && !deck.bases[baseKey]) {
    const base: Base = { els: [] };
    const showMaster = at(layoutDoc?.documentElement, "showMasterSp") !== "0";
    if (masterTree && showMaster) await readElements(masterTree, { ...common, ctx: mctx, slideNum: num, isBase: true }, IDENTITY, [], base.els);
    if (layoutTree) await readElements(layoutTree, { ...common, ctx: lctx, master: { ctx: mctx, tree: masterTree }, slideNum: num, isBase: true }, IDENTITY, [], base.els);
    base.bg = (await parseBg(desc(layoutDoc, "cSld")[0] ?? null, lctx)) ?? (await parseBg(desc(masterDoc, "cSld")[0] ?? null, mctx)) ?? { type: "solid", color: "#ffffff" };
    deck.bases[baseKey] = base;
  }

  const els: El[] = [];
  const tree = desc(sld, "spTree")[0];
  if (tree) await readElements(tree, { ...common, ctx: sctx, layout: { ctx: lctx, tree: layoutTree }, master: { ctx: mctx, tree: masterTree }, slideNum: num, isBase: false }, IDENTITY, [], els);

  const sidToTarget = new Map<number, string>();
  for (const el of els) {
    if (el.sid !== undefined && !sidToTarget.has(el.sid)) sidToTarget.set(el.sid, el.id);
    for (const g of el.groups ?? []) {
      const n = Number(g.slice(1));
      if (!isNaN(n) && !sidToTarget.has(n)) sidToTarget.set(n, g);
    }
  }

  let notes = "";
  const notesRel = [...rels.values()].find((r) => r.type.endsWith("/notesSlide"));
  if (notesRel) {
    const nd = await pkg.xml(notesRel.target);
    const body = desc(nd, "sp").find((s) => phOf(s)?.type === "body");
    notes = plain(kid(body ?? null, "txBody"));
  }

  const slide: Slide = {
    id: uid(),
    base: baseKey || undefined,
    els,
    notes,
    anims: parseTiming(sld, sctx, sidToTarget),
    ...parseTransition(sld),
  };
  const bg = await parseBg(desc(sld, "cSld")[0] ?? null, sctx);
  if (bg) slide.bg = bg;
  if (at(sld, "showMasterSp") === "0") slide.noBase = true;
  if (at(sld, "show") === "0") slide.hidden = true;
  return slide;
}
