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
