// Small spreadsheet formula engine: arithmetic, comparisons, & concatenation,
// cell refs (A1, $A$1), ranges (A1:B9) and common functions.

export type Val = number | string | boolean;
export class FErr {
  constructor(public code: string) {}
}

export function colName(i: number) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export function parseRef(ref: string) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i))!;
      if (!m) throw new FErr("#ERROR!");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') { s += '"'; i += 2; }
        else if (src[i] === '"') break;
        else s += src[i++];
      }
      if (src[i] !== '"') throw new FErr("#ERROR!");
      i++;
      out.push({ t: "str", v: s });
      continue;
    }
    const word = /^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      out.push(parseRef(w) ? { t: "ref", v: w.toUpperCase() } : { t: "id", v: w.toUpperCase() });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>(),:%".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new FErr("#ERROR!");
  }
  return out;
}
