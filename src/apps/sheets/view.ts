// How a cell's value is shown: its number format (set, implied by typing, or by a date function),
// colour from the format, and default alignment (numbers right, text left, TRUE/FALSE centred).
import { FErr, type Val } from "./formula";
import { formatValue, parseInput } from "./format";
import type { CellFmt } from "./types";

const DATE_FN = /^=\s*(TODAY|DATE|EDATE|EOMONTH|WORKDAY(\.INTL)?|DATEVALUE)\s*\(/i;
const NOW_FN = /^=\s*NOW\s*\(/i;

export function formatOf(raw: string, f?: CellFmt): string | undefined {
  if (f?.num) return f.num;
  if (!raw) return undefined;
  if (raw.startsWith("=")) return NOW_FN.test(raw) ? "yyyy-mm-dd h:mm" : DATE_FN.test(raw) ? "yyyy-mm-dd" : undefined;
  return parseInput(raw).fmt;
}

export function cellText(v: Val | FErr, raw: string, f?: CellFmt): { text: string; color?: string; align: "left" | "center" | "right"; isNum: boolean } {
  if (v instanceof FErr) return { text: v.code, align: "center", isNum: false };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center", isNum: false };
  const code = formatOf(raw, f);
  const out = formatValue(v, code);
  return { text: out.text, color: out.color, align: typeof v === "number" ? "right" : "left", isNum: typeof v === "number" };
}
