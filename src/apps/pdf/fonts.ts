// Fonts for text added to PDFs. Each is metric-compatible with a common document font, so
// edited lines keep their original width: Carlito = Calibri, Liberation Sans = Arial and
// Helvetica, Liberation Serif = Times New Roman, Liberation Mono = Courier New. (SIL OFL 1.1)
import carlitoBold from "../../assets/fonts/Carlito-Bold.ttf?url";
import carlito from "../../assets/fonts/Carlito-Regular.ttf?url";
import monoBold from "../../assets/fonts/LiberationMono-Bold.ttf?url";
import mono from "../../assets/fonts/LiberationMono-Regular.ttf?url";
import sansBold from "../../assets/fonts/LiberationSans-Bold.ttf?url";
import sans from "../../assets/fonts/LiberationSans-Regular.ttf?url";
import serifBold from "../../assets/fonts/LiberationSerif-Bold.ttf?url";
import serif from "../../assets/fonts/LiberationSerif-Regular.ttf?url";
import type { Font } from "./types";

const FILES: Record<Font, [string, string]> = {
  helv: [sans, sansBold],
  times: [serif, serifBold],
  courier: [mono, monoBold],
  carlito: [carlito, carlitoBold],
};

const cache = new Map<string, Promise<ArrayBuffer>>();

export function fontBytes(font: Font, bold: boolean) {
  const url = FILES[font][bold ? 1 : 0];
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => r.arrayBuffer()));
  return cache.get(url)!;
}

/** Guess the closest bundled font from a PDF font's name and pdf.js's generic family. */
export function matchFont(name: string, family: string): Font {
  const n = name.toLowerCase().replace(/^[a-z]{6}\+/, "");
  if (/carlito|calibri/.test(n)) return "carlito";
  if (/courier|mono|cousine|consol/.test(n) || /mono/i.test(family)) return "courier";
  if (/times|liberationserif|tinos|nimbusrom|serif|georgia|garamond|cambria|caladea/.test(n.replace(/sans/g, ""))) return "times";
  if (/serif/i.test(family) && !/sans/i.test(family)) return "times";
  return "helv";
}

export const isBoldName = (name: string) => /bold|black|heavy|semibold|demi/i.test(name);
