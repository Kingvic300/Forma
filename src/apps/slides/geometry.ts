// PowerPoint preset shapes as SVG paths. Covers the shapes people use in real decks; anything
// rarer falls back to a rectangle so its text and fill still show.
import type { CustomPath } from "./types";

type Adj = Record<string, number> | undefined;
const a = (adj: Adj, k: string, def: number) => (adj?.[k] ?? def) / 100000;
const poly = (pts: [number, number][]) => "M" + pts.map((p) => `${r(p[0])},${r(p[1])}`).join(" L") + " Z";
const r = (n: number) => Math.round(n * 100) / 100;

function ellipseD(x: number, y: number, w: number, h: number) {
  const rx = w / 2,
    ry = h / 2;
  return `M${r(x)},${r(y + ry)} A${r(rx)},${r(ry)} 0 1 1 ${r(x + w)},${r(y + ry)} A${r(rx)},${r(ry)} 0 1 1 ${r(x)},${r(y + ry)} Z`;
}
function roundRectD(w: number, h: number, rad: number) {
  const k = Math.min(rad, w / 2, h / 2);
  return `M${r(k)},0 H${r(w - k)} A${r(k)},${r(k)} 0 0 1 ${r(w)},${r(k)} V${r(h - k)} A${r(k)},${r(k)} 0 0 1 ${r(w - k)},${r(h)} H${r(k)} A${r(k)},${r(k)} 0 0 1 0,${r(h - k)} V${r(k)} A${r(k)},${r(k)} 0 0 1 ${r(k)},0 Z`;
}
function star(n: number, inner: number, w: number, h: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 ? inner : 1;
    pts.push([w / 2 + (Math.cos(ang) * k * w) / 2, h / 2 + (Math.sin(ang) * k * h) / 2]);
  }
  return poly(pts);
}
/** A point on the ellipse inscribed in w × h at PowerPoint angle (60000ths of a degree, clockwise from 3 o'clock). */
function onEllipse(w: number, h: number, ang: number): [number, number] {
  const t = (ang / 60000) * (Math.PI / 180);
  return [w / 2 + (w / 2) * Math.cos(t), h / 2 + (h / 2) * Math.sin(t)];
}
function arcD(w: number, h: number, st: number, en: number, close: "" | "pie" | "chord") {
  const [x1, y1] = onEllipse(w, h, st);
  const [x2, y2] = onEllipse(w, h, en);
  let sweep = (en - st) / 60000;
  while (sweep <= 0) sweep += 360;
  const large = sweep > 180 ? 1 : 0;
  const arc = `M${r(x1)},${r(y1)} A${r(w / 2)},${r(h / 2)} 0 ${large} 1 ${r(x2)},${r(y2)}`;
  return close === "pie" ? `${arc} L${r(w / 2)},${r(h / 2)} Z` : close === "chord" ? `${arc} Z` : arc;
}

/** Shapes drawn as a stroke only, never filled. */
export const OPEN_GEOMS = new Set(["line", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4", "curvedConnector2", "curvedConnector3", "curvedConnector4", "arc", "leftBracket", "rightBracket", "leftBrace", "rightBrace", "bracketPair", "bracePair"]);

export function presetPath(geom: string, w: number, h: number, adj?: Adj): string {
  const ss = Math.min(w, h);
  switch (geom) {
    case "line":
    case "straightConnector1":
      return `M0,0 L${r(w)},${r(h)}`;
    case "bentConnector2":
      return `M0,0 H${r(w)} V${r(h)}`;
    case "bentConnector3":
    case "bentConnector4": {
      const x = w * a(adj, "adj1", 50000);
      return `M0,0 H${r(x)} V${r(h)} H${r(w)}`;
    }
    case "curvedConnector2":
    case "curvedConnector3":
    case "curvedConnector4":
      return `M0,0 C${r(w / 2)},0 ${r(w / 2)},${r(h)} ${r(w)},${r(h)}`;
    case "ellipse":
    case "flowChartConnector":
    case "cloud":
    case "cloudCallout":
    case "flowChartSummingJunction":
    case "flowChartOr":
      return ellipseD(0, 0, w, h);
    case "roundRect":
    case "flowChartAlternateProcess":
      return roundRectD(w, h, ss * a(adj, "adj", 16667));
    case "flowChartTerminator":
      return roundRectD(w, h, Math.min(w, h) / 2);
    case "round2SameRect": {
      const k = Math.min(ss * a(adj, "adj1", 16667), w / 2, h / 2);
      return `M${r(k)},0 H${r(w - k)} A${r(k)},${r(k)} 0 0 1 ${r(w)},${r(k)} V${r(h)} H0 V${r(k)} A${r(k)},${r(k)} 0 0 1 ${r(k)},0 Z`;
    }
    case "round1Rect": {
      const k = Math.min(ss * a(adj, "adj", 16667), w / 2, h / 2);
      return `M0,0 H${r(w - k)} A${r(k)},${r(k)} 0 0 1 ${r(w)},${r(k)} V${r(h)} H0 Z`;
    }
    case "snip1Rect": {
      const k = ss * a(adj, "adj", 16667);
      return poly([[0, 0], [w - k, 0], [w, k], [w, h], [0, h]]);
    }
    case "snip2SameRect": {
      const k = ss * a(adj, "adj1", 16667);
      return poly([[k, 0], [w - k, 0], [w, k], [w, h], [0, h], [0, k]]);
    }
    case "triangle":
    case "flowChartExtract": {
      const x = w * a(adj, "adj", 50000);
      return poly([[x, 0], [w, h], [0, h]]);
    }
    case "flowChartMerge":
      return poly([[0, 0], [w, 0], [w / 2, h]]);
    case "rtTriangle":
      return poly([[0, 0], [w, h], [0, h]]);
    case "diamond":
    case "flowChartDecision":
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case "parallelogram":
    case "flowChartInputOutput": {
      const o = ss * a(adj, "adj", 25000);
      return poly([[o, 0], [w, 0], [w - o, h], [0, h]]);
    }
    case "trapezoid": {
      const o = ss * a(adj, "adj", 25000);
      return poly([[o, 0], [w - o, 0], [w, h], [0, h]]);
    }
    case "flowChartManualOperation":
      return poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]);
    case "pentagon":
      return poly([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]);
    case "hexagon":
    case "flowChartPreparation": {
      const o = ss * a(adj, "adj", 25000);
      return poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]);
    }
    case "heptagon":
      return poly(Array.from({ length: 7 }, (_, i) => [w / 2 + (w / 2) * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 7), h / 2 + (h / 2) * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 7)] as [number, number]));
    case "octagon": {
      const o = ss * a(adj, "adj", 29289);
      return poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]);
    }
    case "decagon":
    case "dodecagon": {
      const n = geom === "decagon" ? 10 : 12;
      return poly(Array.from({ length: n }, (_, i) => [w / 2 + (w / 2) * Math.cos((i * 2 * Math.PI) / n), h / 2 + (h / 2) * Math.sin((i * 2 * Math.PI) / n)] as [number, number]));
    }
    case "star4": return star(4, 2 * a(adj, "adj", 12500), w, h);
    case "star5": return star(5, 2 * a(adj, "adj", 19098), w, h);
    case "star6": return star(6, 2 * a(adj, "adj", 28868), w, h);
    case "star7": return star(7, 2 * a(adj, "adj", 34601), w, h);
    case "star8": return star(8, 2 * a(adj, "adj", 37500), w, h);
    case "star10": return star(10, 2 * a(adj, "adj", 42533), w, h);
    case "star12": return star(12, 2 * a(adj, "adj", 37500), w, h);
    case "star16": return star(16, 2 * a(adj, "adj", 37500), w, h);
    case "star24": return star(24, 2 * a(adj, "adj", 37500), w, h);
    case "star32": return star(32, 2 * a(adj, "adj", 37500), w, h);
    case "irregularSeal1":
    case "irregularSeal2":
      return star(12, 0.65, w, h);
    case "rightArrow":
    case "notchedRightArrow":
    case "stripedRightArrow": {
      const t = (h * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), w);
      return poly([[0, h / 2 - t], [w - hl, h / 2 - t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h / 2 + t], [0, h / 2 + t]]);
    }
    case "leftArrow": {
      const t = (h * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), w);
      return poly([[w, h / 2 - t], [hl, h / 2 - t], [hl, 0], [0, h / 2], [hl, h], [hl, h / 2 + t], [w, h / 2 + t]]);
    }
    case "upArrow": {
      const t = (w * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), h);
      return poly([[w / 2 - t, h], [w / 2 - t, hl], [0, hl], [w / 2, 0], [w, hl], [w / 2 + t, hl], [w / 2 + t, h]]);
    }
    case "downArrow": {
      const t = (w * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), h);
      return poly([[w / 2 - t, 0], [w / 2 + t, 0], [w / 2 + t, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [w / 2 - t, h - hl]]);
    }
    case "leftRightArrow": {
      const t = (h * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), w / 2);
      return poly([[0, h / 2], [hl, 0], [hl, h / 2 - t], [w - hl, h / 2 - t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h / 2 + t], [hl, h / 2 + t], [hl, h]]);
    }
    case "upDownArrow": {
      const t = (w * a(adj, "adj1", 50000)) / 2;
      const hl = Math.min(ss * a(adj, "adj2", 50000), h / 2);
      return poly([[w / 2, 0], [w, hl], [w / 2 + t, hl], [w / 2 + t, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [w / 2 - t, h - hl], [w / 2 - t, hl], [0, hl]]);
    }
    case "chevron": {
      const o = Math.min(ss * a(adj, "adj", 50000), w);
      return poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]);
    }
    case "homePlate":
    case "flowChartOffpageConnector": {
      const o = Math.min(ss * a(adj, "adj", 50000), w);
      return geom === "homePlate" ? poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) : poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]);
    }
    case "plus":
    case "mathPlus":
    case "flowChartPunchedCard": {
      if (geom === "flowChartPunchedCard") return poly([[w * 0.2, 0], [w, 0], [w, h], [0, h], [0, h * 0.2]]);
      const o = ss * a(adj, "adj", geom === "plus" ? 25000 : 23520);
      return poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]].map(([x, y]) => (geom === "plus" ? [x, y] : [x, y])) as [number, number][]);
    }
    case "mathMinus":
      return poly([[0, h * 0.38], [w, h * 0.38], [w, h * 0.62], [0, h * 0.62]]);
    case "mathMultiply": {
      const d = ss * 0.12;
      return poly([[d, 0], [w / 2, h / 2 - d], [w - d, 0], [w, d], [w / 2 + d, h / 2], [w, h - d], [w - d, h], [w / 2, h / 2 + d], [d, h], [0, h - d], [w / 2 - d, h / 2], [0, d]]);
    }
    case "donut": {
      const t = ss * a(adj, "adj", 25000);
      return ellipseD(0, 0, w, h) + " " + ellipseD(t, t, w - 2 * t, h - 2 * t);
    }
    case "frame": {
      const t = ss * a(adj, "adj1", 12500);
      return `M0,0 H${r(w)} V${r(h)} H0 Z M${r(t)},${r(t)} V${r(h - t)} H${r(w - t)} V${r(t)} Z`;
    }
    case "can":
    case "flowChartMagneticDisk": {
      const e = Math.min(h * 0.25, ss * a(adj, "adj", 25000));
      return `M0,${r(e / 2)} A${r(w / 2)},${r(e / 2)} 0 0 1 ${r(w)},${r(e / 2)} V${r(h - e / 2)} A${r(w / 2)},${r(e / 2)} 0 0 1 0,${r(h - e / 2)} Z M0,${r(e / 2)} A${r(w / 2)},${r(e / 2)} 0 0 0 ${r(w)},${r(e / 2)}`;
    }
    case "cube": {
      const o = ss * a(adj, "adj", 25000);
      return `${poly([[0, o], [o, 0], [w, 0], [w, h - o], [w - o, h], [0, h]])} M0,${r(o)} H${r(w - o)} L${r(w)},0 M${r(w - o)},${r(o)} V${r(h)}`;
    }
    case "heart":
      return `M${r(w / 2)},${r(h * 0.25)} C${r(w / 2)},0 0,0 0,${r(h * 0.3)} C0,${r(h * 0.6)} ${r(w / 2)},${r(h * 0.8)} ${r(w / 2)},${r(h)} C${r(w / 2)},${r(h * 0.8)} ${r(w)},${r(h * 0.6)} ${r(w)},${r(h * 0.3)} C${r(w)},0 ${r(w / 2)},0 ${r(w / 2)},${r(h * 0.25)} Z`;
    case "flowChartDocument":
      return `M0,0 H${r(w)} V${r(h * 0.83)} C${r(w * 0.75)},${r(h * 0.66)} ${r(w * 0.5)},${r(h * 1.1)} 0,${r(h * 0.9)} Z`;
    case "flowChartDelay":
      return `M0,0 H${r(w / 2)} A${r(w / 2)},${r(h / 2)} 0 0 1 ${r(w / 2)},${r(h)} H0 Z`;
    case "flowChartManualInput":
      return poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]);
    case "arc":
      return arcD(w, h, adj?.adj1 ?? 16200000, adj?.adj2 ?? 0, "");
    case "pie":
      return arcD(w, h, adj?.adj1 ?? 0, adj?.adj2 ?? 16200000, "pie");
    case "chord":
      return arcD(w, h, adj?.adj1 ?? 2700000, adj?.adj2 ?? 16200000, "chord");
    case "blockArc": {
      const st = adj?.adj1 ?? 10800000,
        en = adj?.adj2 ?? 0;
      const t = ss * a(adj, "adj3", 25000);
      const [x1, y1] = onEllipse(w, h, st);
      const [x2, y2] = onEllipse(w, h, en);
      const [ix2, iy2] = onEllipse(w - 2 * t, h - 2 * t, en);
      const [ix1, iy1] = onEllipse(w - 2 * t, h - 2 * t, st);
      let sweep = (en - st) / 60000;
      while (sweep <= 0) sweep += 360;
      const lg = sweep > 180 ? 1 : 0;
      return `M${r(x1)},${r(y1)} A${r(w / 2)},${r(h / 2)} 0 ${lg} 1 ${r(x2)},${r(y2)} L${r(ix2 + t)},${r(iy2 + t)} A${r((w - 2 * t) / 2)},${r((h - 2 * t) / 2)} 0 ${lg} 0 ${r(ix1 + t)},${r(iy1 + t)} Z`;
    }
    case "wedgeRectCallout":
    case "wedgeRoundRectCallout":
    case "wedgeEllipseCallout": {
      const px = w / 2 + w * a(adj, "adj1", -20833);
      const py = h / 2 + h * a(adj, "adj2", 62500);
      const body = geom === "wedgeEllipseCallout" ? ellipseD(0, 0, w, h) : geom === "wedgeRoundRectCallout" ? roundRectD(w, h, ss * 0.16667) : `M0,0 H${r(w)} V${r(h)} H0 Z`;
      const bx = Math.min(Math.max(px, w * 0.2), w * 0.8);
      const by = Math.min(Math.max(py, h * 0.2), h * 0.8);
      const horizontal = Math.abs(py - h / 2) / h < Math.abs(px - w / 2) / w;
      const tri = horizontal
        ? poly([[px < w / 2 ? 1 : w - 1, by - h * 0.08], [px, py], [px < w / 2 ? 1 : w - 1, by + h * 0.08]])
        : poly([[bx - w * 0.08, py < h / 2 ? 1 : h - 1], [px, py], [bx + w * 0.08, py < h / 2 ? 1 : h - 1]]);
      return body + " " + tri;
    }
    case "leftBracket":
      return `M${r(w)},0 Q0,0 0,${r(h * 0.1)} V${r(h * 0.9)} Q0,${r(h)} ${r(w)},${r(h)}`;
    case "rightBracket":
      return `M0,0 Q${r(w)},0 ${r(w)},${r(h * 0.1)} V${r(h * 0.9)} Q${r(w)},${r(h)} 0,${r(h)}`;
    case "leftBrace":
      return `M${r(w)},0 Q${r(w / 2)},0 ${r(w / 2)},${r(h * 0.1)} V${r(h * 0.4)} Q${r(w / 2)},${r(h / 2)} 0,${r(h / 2)} Q${r(w / 2)},${r(h / 2)} ${r(w / 2)},${r(h * 0.6)} V${r(h * 0.9)} Q${r(w / 2)},${r(h)} ${r(w)},${r(h)}`;
    case "rightBrace":
      return `M0,0 Q${r(w / 2)},0 ${r(w / 2)},${r(h * 0.1)} V${r(h * 0.4)} Q${r(w / 2)},${r(h / 2)} ${r(w)},${r(h / 2)} Q${r(w / 2)},${r(h / 2)} ${r(w / 2)},${r(h * 0.6)} V${r(h * 0.9)} Q${r(w / 2)},${r(h)} 0,${r(h)}`;
    case "bracketPair": {
      const k = ss * 0.12;
      return `M${r(k)},0 Q0,0 0,${r(k)} V${r(h - k)} Q0,${r(h)} ${r(k)},${r(h)} M${r(w - k)},0 Q${r(w)},0 ${r(w)},${r(k)} V${r(h - k)} Q${r(w)},${r(h)} ${r(w - k)},${r(h)}`;
    }
    case "bracePair": {
      const k = ss * 0.1;
      return `M${r(k * 2)},0 Q${r(k)},0 ${r(k)},${r(k)} V${r(h / 2 - k)} L0,${r(h / 2)} L${r(k)},${r(h / 2 + k)} V${r(h - k)} Q${r(k)},${r(h)} ${r(k * 2)},${r(h)} M${r(w - 2 * k)},0 Q${r(w - k)},0 ${r(w - k)},${r(k)} V${r(h / 2 - k)} L${r(w)},${r(h / 2)} L${r(w - k)},${r(h / 2 + k)} V${r(h - k)} Q${r(w - k)},${r(h)} ${r(w - 2 * k)},${r(h)}`;
    }
    case "teardrop":
      return `M${r(w / 2)},${r(h)} A${r(w / 2)},${r(h / 2)} 0 1 1 ${r(w)},${r(h / 2)} V0 H${r(w / 2)} A${r(w / 2)},${r(h / 2)} 0 0 0 ${r(w / 2)},${r(h)} Z`;
    case "lightningBolt":
      return poly([[0.39, 0], [0.62, 0.3], [0.54, 0.34], [0.78, 0.6], [0.7, 0.64], [1, 1], [0.48, 0.7], [0.56, 0.66], [0.2, 0.43], [0.31, 0.38], [0, 0.18]].map(([x, y]) => [x * w, y * h]) as [number, number][]);
    case "moon":
      return `M${r(w)},0 A${r(w)},${r(h / 2)} 0 0 0 ${r(w)},${r(h)} A${r(w * 0.5)},${r(h / 2)} 0 0 1 ${r(w)},0 Z`;
    case "wave":
    case "doubleWave":
      return `M0,${r(h * 0.1)} C${r(w / 3)},${r(-h * 0.1)} ${r((2 * w) / 3)},${r(h * 0.3)} ${r(w)},${r(h * 0.1)} V${r(h * 0.9)} C${r((2 * w) / 3)},${r(h * 1.1)} ${r(w / 3)},${r(h * 0.7)} 0,${r(h * 0.9)} Z`;
    case "smileyFace":
      return ellipseD(0, 0, w, h) + " " + ellipseD(w * 0.3, h * 0.3, w * 0.1, h * 0.1) + " " + ellipseD(w * 0.6, h * 0.3, w * 0.1, h * 0.1);
    default:
      return `M0,0 H${r(w)} V${r(h)} H0 Z`;
  }
}

/** A custom shape's sub-path, scaled from its own coordinate box onto w × h. */
export function customPathD(p: CustomPath, w: number, h: number) {
  const sx = p.w ? w / p.w : 1;
  const sy = p.h ? h / p.h : 1;
  return p.cmds
    .map((c) => {
      if (c.c === "Z") return "Z";
      const pts = c.p.map((v, i) => r(v * (i % 2 ? sy : sx)));
      return c.c + pts.join(",");
    })
    .join(" ");
}

export const FILL_RULE: Record<string, "evenodd" | "nonzero"> = { donut: "evenodd", frame: "evenodd" };
