// Write a deck as a PowerPoint file. pptxgenjs builds the slides; animations and transitions,
// which it can't write, are added to each slide's XML afterwards. Effects and transitions that
// came from an imported file and weren't changed are written back exactly as they were.
import JSZip from "jszip";
import { schedule } from "./anim";
import type { Behavior, Effect, El, Fill, Line, Para, Run, Slide, SlidesData, Transition } from "./types";

type Pptx = InstanceType<typeof import("pptxgenjs").default>;
type Slide_ = ReturnType<Pptx["addSlide"]>;

const IN = 96;
const inch = (px: number) => px / IN;
const pt = (px: number) => px * 0.75;

function color(c: string | undefined): { color: string; transparency?: number } | undefined {
  if (!c || c === "transparent") return undefined;
  if (c.startsWith("#")) return { color: c.slice(1, 7).toUpperCase() };
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return undefined;
  const [r, g, b, a = "1"] = m[1].split(",").map((v) => v.trim());
  const hex = [r, g, b].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("").toUpperCase();
  const alpha = Number(a);
  return alpha < 1 ? { color: hex, transparency: Math.round((1 - alpha) * 100) } : { color: hex };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** PNG data for images PowerPoint can't take as they are (SVG, WebP, BMP) or that are cropped. */
async function raster(src: Blob, w: number, h: number, crop?: [number, number, number, number]): Promise<string> {
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const [l, t, r, b] = crop ?? [0, 0, 0, 0];
    const nw = img.naturalWidth || w * 2, nh = img.naturalHeight || h * 2;
    const sx = l * nw, sy = t * nh, sw = nw * (1 - l - r), sh = nh * (1 - t - b);
    const scale = Math.min(4, Math.max(1, (w * 2) / Math.max(1, sw)));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").replace(/^data:/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fillOpt(fill: Fill | undefined) {
  if (!fill || fill.type === "none") return undefined;
  if (fill.type === "solid") return color(fill.color);
  if (fill.type === "grad") return color(fill.stops[Math.floor(fill.stops.length / 2)]?.color);
  return undefined;
}
const DASH: Record<string, string> = { dash: "dash", sysDash: "sysDash", sysDot: "sysDot", dot: "sysDot", lgDash: "lgDash", dashDot: "dashDot", lgDashDot: "lgDashDot", lgDashDotDot: "lgDashDotDot", sysDashDot: "dashDot", sysDashDotDot: "lgDashDotDot" };
const ARROW: Record<string, string> = { triangle: "triangle", arrow: "arrow", stealth: "stealth", oval: "oval", diamond: "diamond" };
function lineOpt(line: Line | undefined) {
  if (!line) return undefined;
  const c = color(line.color);
  if (!c) return undefined;
  return {
    ...c,
    width: pt(line.width),
    ...(line.dash ? { dashType: DASH[line.dash] ?? "dash" } : {}),
    ...(line.head ? { beginArrowType: ARROW[line.head] ?? "triangle" } : {}),
    ...(line.tail ? { endArrowType: ARROW[line.tail] ?? "triangle" } : {}),
  };
}

const ALIGN = { l: "left", ctr: "center", r: "right", just: "justify" } as const;

/** Text as pptxgenjs runs, one paragraph per line break. */
function textRuns(paras: Para[], scale = 1) {
  const out: { text: string; options: Record<string, unknown> }[] = [];
  paras.forEach((p, pi) => {
    const runs = p.runs.filter((r, i) => r.text || i === 0);
    runs.forEach((r: Run, ri) => {
      const o: Record<string, unknown> = {
        fontSize: Math.round(r.size * scale * 10) / 10,
        fontFace: r.font,
        bold: !!r.bold,
        italic: !!r.italic,
      };
      const c = color(r.color);
      if (c) {
        o.color = c.color;
        if (c.transparency) o.transparency = c.transparency;
      }
      if (r.underline) o.underline = { style: "sng" };
      if (r.strike) o.strike = "sngStrike";
      if (r.baseline && r.baseline > 0) o.superscript = true;
      if (r.baseline && r.baseline < 0) o.subscript = true;
      if (r.highlight) o.highlight = color(r.highlight)?.color;
      if (r.link) o.hyperlink = { url: r.link };
      if (ri === 0) {
        o.align = ALIGN[p.align ?? "l"];
        if (p.level) o.indentLevel = p.level;
        if (p.spaceBefore) o.paraSpaceBefore = p.spaceBefore;
        if (p.spaceAfter) o.paraSpaceAfter = p.spaceAfter;
        if (p.line) {
          if ("pt" in p.line) o.lineSpacing = p.line.pt;
          else o.lineSpacingMultiple = p.line.pct;
        }
        if (p.bullet) {
          const indent = p.indent && p.indent < 0 ? pt(-p.indent) : 18;
          o.bullet = p.bullet.auto
            ? { type: "number", numberType: p.bullet.auto, numberStartAt: p.bullet.startAt ?? 1, indent }
            : { code: (p.bullet.char ?? "•").codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"), indent };
        }
      }
      if (ri === runs.length - 1 && pi < paras.length - 1) o.breakLine = true;
      out.push({ text: r.text.replace(/\n/g, "\v"), options: o });
    });
  });
  return out;
}

async function addEl(s: Slide_, el: El, deck: SlidesData, name: string) {
  const box = { x: inch(el.x), y: inch(el.y), w: inch(Math.max(el.w, 0.1)), h: inch(Math.max(el.h, 0.1)) };
  const common = { ...box, objectName: name, ...(el.rot ? { rotate: el.rot } : {}), ...(el.flipH ? { flipH: true } : {}), ...(el.flipV ? { flipV: true } : {}) };
  const asset = (k?: string) => (k ? deck.assets[k] : undefined);

  if (el.type === "image" || (el.type === "media" && !el.media)) {
    const a = asset(el.image?.asset);
    if (!a) return;
    const ok = /^image\/(png|jpeg|gif)$/.test(a.type) && !el.image?.crop;
    const data = ok ? `${a.type};base64,${toBase64(a.bytes)}` : await raster(new Blob([a.bytes], { type: a.type }), el.w, el.h, el.image?.crop);
    s.addImage({ ...common, data, ...(el.geom === "ellipse" ? { rounding: true } : {}) });
    return;
  }
  if (el.type === "media" && el.media) {
    const a = asset(el.media.asset);
    if (!a) return;
    const poster = asset(el.image?.asset);
    s.addMedia({ ...common, type: el.media.kind, data: `${a.type};base64,${toBase64(a.bytes)}`, extn: a.type.split("/")[1] === "mpeg" ? "mp3" : a.type.split("/")[1], ...(poster ? { cover: `${poster.type};base64,${toBase64(poster.bytes)}` } : {}) } as never);
    return;
  }
  if (el.type === "table" && el.table) {
    const border = (l?: Line) => (l ? { type: "solid", pt: pt(l.width), color: color(l.color)?.color ?? "000000" } : { type: "none" });
    const rows = el.table.rows.map((row) =>
      row.cells
        .filter((c) => !c.merged)
        .map((c) => ({
          text: textRuns(c.text.paras),
          options: {
            ...(fillOpt(c.fill) ? { fill: fillOpt(c.fill) } : {}),
            border: [border(c.borders?.t), border(c.borders?.r), border(c.borders?.b), border(c.borders?.l)],
            valign: c.text.anchor === "ctr" ? "middle" : c.text.anchor === "b" ? "bottom" : "top",
            ...(c.span ? { colspan: c.span } : {}),
            ...(c.rowSpan ? { rowspan: c.rowSpan } : {}),
            ...(c.text.inset ? { margin: [pt(c.text.inset[1]), pt(c.text.inset[2]), pt(c.text.inset[3]), pt(c.text.inset[0])] } : {}),
          },
        })),
    );
    s.addTable(rows as never, { x: box.x, y: box.y, w: inch(el.table.cols.reduce((a, b) => a + b, 0)), colW: el.table.cols.map(inch), rowH: el.table.rows.map((r) => inch(r.h)), objectName: name } as never);
    return;
  }
  if (el.type === "chart" && el.chart) {
    const c = el.chart;
    const type = c.kind === "scatter" ? "line" : c.kind;
    const data = c.series.map((sr) => ({ name: sr.name, labels: c.categories, values: sr.values.map((v) => v || 0) }));
    const hex = (v: string) => color(v)?.color ?? "888888";
    s.addChart(type as never, data, {
      ...box,
      barDir: c.horizontal ? "bar" : "col",
      barGrouping: c.percent ? "percentStacked" : c.stacked ? "stacked" : "clustered",
      chartColors: c.kind === "pie" || c.kind === "doughnut" ? (c.series[0]?.colors ?? []).map(hex) : c.series.map((sr) => hex(sr.color)),
      showLegend: !!c.legend,
      legendPos: c.legend ?? "r",
      showTitle: !!c.title,
      title: c.title,
      showValue: !!c.labels,
    } as never);
    return;
  }

  // Shapes and text boxes.
  const geom = el.paths?.length ? "custGeom" : el.geom ?? "rect";
  const opts: Record<string, unknown> = { ...common, shape: geom };
  const f = fillOpt(el.fill);
  if (f) opts.fill = f;
  const l = lineOpt(el.line);
  if (l) opts.line = l;
  if (el.shadow) {
    const c = color(el.shadow.color);
    opts.shadow = { type: "outer", angle: Math.round((Math.atan2(el.shadow.dy, el.shadow.dx) * 180) / Math.PI + 360) % 360, blur: pt(el.shadow.blur), offset: pt(Math.hypot(el.shadow.dx, el.shadow.dy)), color: c?.color ?? "000000", opacity: c?.transparency ? 1 - c.transparency / 100 : 0.4 };
  }
  if (geom === "custGeom") {
    const pts: Record<string, unknown>[] = [];
    for (const p of el.paths!) {
      const sx = p.w ? el.w / p.w : 1, sy = p.h ? el.h / p.h : 1;
      const P = (x: number, y: number) => ({ x: inch(x * sx), y: inch(y * sy) });
      for (const c of p.cmds) {
        if (c.c === "M") pts.push({ ...P(c.p[0], c.p[1]), moveTo: true });
        else if (c.c === "L") pts.push(P(c.p[0], c.p[1]));
        else if (c.c === "C") pts.push({ ...P(c.p[4], c.p[5]), curve: { type: "cubic", x1: inch(c.p[0] * sx), y1: inch(c.p[1] * sy), x2: inch(c.p[2] * sx), y2: inch(c.p[3] * sy) } });
        else if (c.c === "Q") pts.push({ ...P(c.p[2], c.p[3]), curve: { type: "quadratic", x1: inch(c.p[0] * sx), y1: inch(c.p[1] * sy) } });
        else pts.push({ close: true });
      }
    }
    opts.points = pts;
  }
  const t = el.text;
  if (t && t.paras.some((p) => p.runs.some((r) => r.text))) {
    const [li, ti, ri, bi] = t.inset ?? [9.6, 4.8, 9.6, 4.8];
    s.addText(textRuns(t.paras, t.fontScale ?? 1) as never, {
      ...opts,
      margin: [pt(li), pt(ri), pt(bi), pt(ti)],
      valign: t.anchor === "ctr" ? "middle" : t.anchor === "b" ? "bottom" : "top",
      wrap: t.wrap !== false,
      ...(t.vert ? { vert: t.vert } : {}),
    } as never);
  } else if (f || l) {
    s.addShape(geom as never, opts as never);
  }
}

// ---- Animation and transition XML -------------------------------------------------------------

const bhvCTn = (b: Behavior, inner = "") => {
  const attrs = [`id="0"`, `dur="${Math.max(1, Math.round(b.dur))}"`, `fill="hold"`];
  if (b.repeat) attrs.push(`repeatCount="${isFinite(b.repeat) ? Math.round(b.repeat * 1000) : "indefinite"}"`);
  if (b.autoRev) attrs.push(`autoRev="1"`);
  if (b.accel) attrs.push(`accel="${Math.round(b.accel * 100000)}"`);
  if (b.decel) attrs.push(`decel="${Math.round(b.decel * 100000)}"`);
  return `<p:cTn ${attrs.join(" ")}>${b.delay ? `<p:stCondLst><p:cond delay="${Math.round(b.delay)}"/></p:stCondLst>` : ""}${inner}</p:cTn>`;
};
const tgt = (spid: number, paras?: [number, number]) => `<p:tgtEl><p:spTgt spid="${spid}">${paras ? `<p:txEl><p:pRg st="${paras[0]}" end="${paras[1]}"/></p:txEl>` : ""}</p:spTgt></p:tgtEl>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const val = (v: string | number) => (typeof v === "number" ? `<p:fltVal val="${v}"/>` : `<p:strVal val="${esc(v)}"/>`);

function behaviorXml(b: Behavior, spid: number, paras?: [number, number]): string {
  const cb = (attrs: string[] = [], extra = "") => `<p:cBhvr${extra}>${bhvCTn(b)}${tgt(spid, paras)}${attrs.length ? `<p:attrNameLst>${attrs.map((a) => `<p:attrName>${a}</p:attrName>`).join("")}</p:attrNameLst>` : ""}</p:cBhvr>`;
  switch (b.t) {
    case "set":
      return `<p:set>${cb([b.attr])}<p:to>${val(b.to)}</p:to></p:set>`;
    case "effect":
      return `<p:animEffect transition="${b.transition}" filter="${esc(b.filter)}">${cb()}</p:animEffect>`;
    case "anim":
      return `<p:anim calcmode="lin" valueType="num">${cb([b.attr], b.additive ? ` additive="sum"` : ` additive="base"`)}<p:tavLst>${b.keys
        .map((k) => `<p:tav tm="${Math.round(k.tm * 100000)}"${k.fmla ? ` fmla="${esc(k.fmla)}"` : ""}><p:val>${val(k.v)}</p:val></p:tav>`)
        .join("")}</p:tavLst></p:anim>`;
    case "scale": {
      const pair = (tag: string, v?: [number, number]) => (v ? `<p:${tag} x="${Math.round(v[0] * 100000)}" y="${Math.round(v[1] * 100000)}"/>` : "");
      return `<p:animScale>${cb()}${pair("by", b.by)}${pair("from", b.from)}${pair("to", b.to)}</p:animScale>`;
    }
    case "rot":
      return `<p:animRot by="${Math.round(b.by * 60000)}">${cb(["r"])}</p:animRot>`;
    case "motion":
      return `<p:animMotion origin="layout" path="${esc(b.path)}" pathEditMode="relative" ptsTypes="">${cb(["ppt_x", "ppt_y"])}</p:animMotion>`;
    case "color":
      return "";
  }
}

const NODE = { click: "clickEffect", with: "withEffect", after: "afterEffect" } as const;

function effectXml(e: Effect, spid: number, trigger: Effect["trigger"], sidMap: Map<number, number>): string {
  if (e.xml && trigger === e.trigger) {
    let ok = true;
    const xml = e.xml.replace(/spid="(\d+)"/g, (_, old) => {
      const n = sidMap.get(Number(old));
      if (n === undefined) ok = false;
      return `spid="${n}"`;
    });
    if (ok) return xml;
  }
  return `<p:par><p:cTn id="0" presetID="${e.presetId}" presetClass="${e.cls === "media" ? "mediacall" : e.cls}" presetSubtype="${e.subtype}" fill="hold" grpId="0" nodeType="${NODE[trigger]}"><p:stCondLst><p:cond delay="${Math.round(e.delay)}"/></p:stCondLst><p:childTnLst>${e.behaviors.map((b) => behaviorXml(b, spid, e.paras)).join("")}</p:childTnLst></p:cTn></p:par>`;
}

function timingXml(slide: Slide, idOf: Map<string, number>, sidMap: Map<number, number>, textIds: Set<number>): string {
  // Group targets become one effect per member shape, all starting together.
  const expanded: { e: Effect; spid: number; trigger: Effect["trigger"] }[] = [];
  for (const e of slide.anims) {
    const members = slide.els.filter((el) => el.id === e.target || el.groups?.includes(e.target)).map((el) => idOf.get(el.id)).filter((n): n is number => n !== undefined);
    members.forEach((spid, i) => expanded.push({ e: i ? { ...e, xml: undefined } : e, spid, trigger: i ? "with" : e.trigger }));
  }
  if (!expanded.length) return "";
  const steps = schedule(expanded.map((x) => ({ ...x.e, trigger: x.trigger, id: String(expanded.indexOf(x)) })));
  const groups = steps
    .map(
      (st, si) =>
        `<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${si === 0 && st.auto ? `<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>` : ""}</p:stCondLst><p:childTnLst>${st.subs
          .map(
            (sub) =>
              `<p:par><p:cTn id="0" fill="hold"><p:stCondLst><p:cond delay="${Math.round(sub.start)}"/></p:stCondLst><p:childTnLst>${sub.effects
                .map((fx) => {
                  const x = expanded[Number(fx.id)];
                  return effectXml(x.e, x.spid, x.trigger, sidMap);
                })
                .join("")}</p:childTnLst></p:cTn></p:par>`,
          )
          .join("")}</p:childTnLst></p:cTn></p:par>`,
    )
    .join("");
  const builds = [...new Set(expanded.map((x) => x.spid))]
    .filter((n) => textIds.has(n))
    .map((n) => `<p:bldP spid="${n}" grpId="0"${expanded.some((x) => x.spid === n && x.e.paras) ? ` build="p"` : ` animBg="1"`}/>`)
    .join("");
  let xml = `<p:timing><p:tnLst><p:par><p:cTn id="0" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="0" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${builds ? `<p:bldLst>${builds}</p:bldLst>` : ""}</p:timing>`;
  let n = 0;
  xml = xml.replace(/<p:cTn id="\d+"/g, () => `<p:cTn id="${++n}"`);
  return xml;
}

const TRANS_XML: Record<Transition["type"], (t: Transition) => string> = {
  none: () => "",
  fade: () => "<p:fade/>",
  black: () => `<p:fade thruBlk="1"/>`,
  dissolve: () => "<p:dissolve/>",
  push: (t) => `<p:push dir="${t.dir ?? "u"}"/>`,
  wipe: (t) => `<p:wipe dir="${t.dir ?? "l"}"/>`,
  cover: (t) => `<p:cover dir="${t.dir ?? "l"}"/>`,
  uncover: (t) => `<p:pull dir="${t.dir ?? "l"}"/>`,
  split: () => `<p:split orient="vert" dir="out"/>`,
  zoom: () => "<p:zoom/>",
  circle: () => "<p:circle/>",
  flip: (t) => `<p:push dir="${t.dir ?? "l"}"/>`,
};
function transitionXml(slide: Slide): string {
  const t = slide.transition;
  if (t?.xml) return t.xml;
  if (!t && slide.advance === undefined) return "";
  const spd = !t ? "med" : t.dur <= 500 ? "fast" : t.dur <= 800 ? "med" : "slow";
  return `<p:transition spd="${spd}"${slide.advance !== undefined ? ` advTm="${Math.round(slide.advance)}"` : ""}>${t ? TRANS_XML[t.type](t) : ""}</p:transition>`;
}

const EXTRA_NS = {
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  p14: "http://schemas.microsoft.com/office/powerpoint/2010/main",
  p15: "http://schemas.microsoft.com/office/powerpoint/2012/main",
  p159: "http://schemas.microsoft.com/office/powerpoint/2015/09/main",
  a14: "http://schemas.microsoft.com/office/drawing/2010/main",
};

export async function exportPptx(deck: SlidesData): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "FORMA", width: inch(deck.w), height: inch(deck.h) });
  pres.layout = "FORMA";

  for (const slide of deck.slides) {
    const s = pres.addSlide();
    const bg = slide.bg ?? (slide.base ? deck.bases[slide.base]?.bg : undefined);
    if (bg?.type === "image" && deck.assets[bg.asset]) {
      const a = deck.assets[bg.asset];
      s.background = { data: /^image\/(png|jpeg|gif)$/.test(a.type) ? `${a.type};base64,${toBase64(a.bytes)}` : await raster(new Blob([a.bytes], { type: a.type }), deck.w, deck.h) };
    } else {
      const c = fillOpt(bg);
      if (c) s.background = c;
    }
    if (slide.hidden) s.hidden = true;
    const base = slide.base && !slide.noBase ? deck.bases[slide.base] : undefined;
    for (const el of base?.els ?? []) await addEl(s, el, deck, `base-${el.id}`);
    for (const el of slide.els) await addEl(s, el, deck, el.id);
    if (slide.notes) s.addNotes(slide.notes);
  }

  const bytes = (await pres.write({ outputType: "uint8array" })) as Uint8Array;
  if (!deck.slides.some((s) => s.anims.length || s.transition || s.advance !== undefined)) return bytes;

  const zip = await JSZip.loadAsync(bytes);
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const file = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(file)?.async("text");
    if (!xml) continue;
    const idOf = new Map<string, number>();
    const textIds = new Set<number>();
    for (const m of xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)) idOf.set(m[2], Number(m[1]));
    for (const el of slide.els) if (el.text && idOf.has(el.id)) textIds.add(idOf.get(el.id)!);
    const sidMap = new Map<number, number>();
    for (const el of slide.els) if (el.sid !== undefined && idOf.has(el.id)) sidMap.set(el.sid, idOf.get(el.id)!);
    const extra = transitionXml(slide) + timingXml(slide, idOf, sidMap, textIds);
    if (!extra) continue;
    xml = xml.replace(/<p:sld\b([^>]*)>/, (_m, attrs: string) => {
      const add = Object.entries(EXTRA_NS)
        .filter(([k]) => !attrs.includes(`xmlns:${k}=`))
        .map(([k, v]) => ` xmlns:${k}="${v}"`)
        .join("");
      return `<p:sld${attrs}${add}>`;
    });
    xml = xml.includes("</p:clrMapOvr>") ? xml.replace("</p:clrMapOvr>", `</p:clrMapOvr>${extra}`) : xml.replace("</p:sld>", `${extra}</p:sld>`);
    zip.file(file, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}

