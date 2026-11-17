// Number formats, dates and typed input, following Excel's conventions so formats survive a trip
// through .xlsx: dates are serial numbers (1 = 1900-01-01), and formats use Excel's codes.

// ---- Dates ------------------------------------------------------------------------------------

const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86400000;

/** Excel serial number for a calendar date (and optional time). */
export const toSerial = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => (Date.UTC(y, m - 1, d, h, mi, s) - EPOCH) / DAY;
/** The UTC date for a serial number. */
export const fromSerial = (n: number) => new Date(EPOCH + Math.round(n * DAY));
export const todaySerial = () => {
  const d = new Date();
  return toSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
};
export const nowSerial = () => {
  const d = new Date();
  return toSerial(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.toLowerCase().startsWith(s.toLowerCase().slice(0, 3)));

/** Parse common date and time spellings to a serial number. */
export function parseDate(s: string): { serial: number; fmt: string } | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { serial: toSerial(y, mo, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)), fmt: m[4] ? "yyyy-mm-dd h:mm" : "yyyy-mm-dd" };
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) {
    let [mo, d, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += y < 30 ? 2000 : 1900;
    // Day-first when the first number can't be a month.
    if (mo > 12 && d <= 12) [mo, d] = [d, mo];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { serial: toSerial(y, mo, d), fmt: "m/d/yyyy" };
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]*(\d{4})$/.exec(t);
  if (m && monthIndex(m[2]) >= 0) return { serial: toSerial(+m[3], monthIndex(m[2]) + 1, +m[1]), fmt: "d mmm yyyy" };
  m = /^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{4})$/.exec(t);
  if (m && monthIndex(m[1]) >= 0) return { serial: toSerial(+m[3], monthIndex(m[1]) + 1, +m[2]), fmt: "mmm d, yyyy" };
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (m) {
    let h = +m[1];
    if (m[4]) h = (h % 12) + (m[4].toLowerCase() === "pm" ? 12 : 0);
    if (h > 23 || +m[2] > 59) return null;
    return { serial: (h * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400, fmt: m[4] ? "h:mm AM/PM" : m[3] ? "h:mm:ss" : "h:mm" };
  }
  return null;
}

// ---- Typed input ---------------------------------------------------------------------------------

export type Typed = { value: number | string | boolean; fmt?: string };

const CURRENCY = "$€£¥₦₹₩₽₺₱";

/** What a typed cell holds: "12%", "$1,200", "2024-05-01" and "TRUE" become numbers or booleans with a format. */
export function parseInput(raw: string): Typed {
  if (raw === "") return { value: "" };
  if (raw[0] === "'") return { value: raw.slice(1) };
  const t = raw.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return { value: Number(t) };
  let m = /^([+-]?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(t);
  if (m) return { value: Number(m[1] + m[2].replace(/,/g, "") + (m[3] ?? "")), fmt: m[3] ? "#,##0.00" : "#,##0" };
  m = /^([+-]?[\d,]*\.?\d+)\s*%$/.exec(t);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!isNaN(n)) return { value: n / 100, fmt: m[1].includes(".") ? "0.00%" : "0%" };
  }
  m = new RegExp(`^(-?)([${CURRENCY}])\\s?([\\d,]*\\.?\\d+)$`).exec(t);
  if (m) {
    const n = Number(m[3].replace(/,/g, ""));
    if (!isNaN(n)) return { value: m[1] ? -n : n, fmt: `${m[2]}#,##0${m[3].includes(".") ? ".00" : ""}` };
  }
  const up = t.toUpperCase();
  if (up === "TRUE" || up === "FALSE") return { value: up === "TRUE" };
  const d = parseDate(t);
  if (d) return { value: d.serial, fmt: d.fmt };
  return { value: raw };
}

// ---- Formatting ------------------------------------------------------------------------------------

export function general(v: number) {
  if (!isFinite(v)) return "#NUM!";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e11 || a < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, "E").replace("E+", "E+").replace(/e/, "E");
  return String(Number(v.toPrecision(11)));
}

const DATE_TOKENS = /(yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|A\/P|\.0+)/g;
export const isDateFormat = (code: string) => /[dyhs]|m(?!.*%)/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "")) && !/[#0?]/.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]|\.0+/g, ""));

function formatDate(v: number, code: string) {
  const d = fromSerial(v);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes(), s = d.getUTCSeconds();
  const ampm = /AM\/PM|A\/P/i.test(code);
  const tokens = code.match(DATE_TOKENS) ?? [];
  let out = "";
  let i = 0;
  let lastWasHour = false;
  const pad = (n: number) => String(n).padStart(2, "0");
  // Walk the code, copying literals and replacing tokens.
  while (i < code.length) {
    if (code[i] === '"') {
      const j = code.indexOf('"', i + 1);
      out += code.slice(i + 1, j < 0 ? undefined : j);
      i = j < 0 ? code.length : j + 1;
      continue;
    }
    if (code[i] === "\\") {
      out += code[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (code[i] === "[") {
      const j = code.indexOf("]", i);
      const inner = code.slice(i + 1, j);
      // Elapsed time: [h], [mm].
      if (/^h+$/i.test(inner)) out += Math.floor(v * 24);
      else if (/^m+$/i.test(inner)) out += Math.floor(v * 1440);
      i = j + 1;
      continue;
    }
    const rest = code.slice(i);
    const tok = tokens.find((t) => rest.startsWith(t));
    if (!tok) {
      out += code[i++];
      continue;
    }
    i += tok.length;
    const next = code.slice(i).replace(/[^a-z]/gi, "");
    const minute = (lastWasHour || /^s/i.test(next)) && /^m{1,2}$/.test(tok);
    switch (tok) {
      case "yyyy": out += Y; break;
      case "yy": out += pad(Y % 100); break;
      case "mmmmm": out += MONTHS[M][0]; break;
      case "mmmm": out += MONTHS[M]; break;
      case "mmm": out += MONTHS[M].slice(0, 3); break;
      case "mm": out += minute ? pad(mi) : pad(M + 1); break;
      case "m": out += minute ? mi : M + 1; break;
      case "dddd": out += DAYS[d.getUTCDay()]; break;
      case "ddd": out += DAYS[d.getUTCDay()].slice(0, 3); break;
      case "dd": out += pad(D); break;
      case "d": out += D; break;
      case "hh": out += pad(ampm ? h % 12 || 12 : h); break;
      case "h": out += ampm ? h % 12 || 12 : h; break;
      case "ss": out += pad(s); break;
      case "s": out += s; break;
      case "AM/PM": case "am/pm": out += h < 12 ? "AM" : "PM"; break;
      case "A/P": out += h < 12 ? "A" : "P"; break;
      default: out += tok;
    }
    lastWasHour = tok === "h" || tok === "hh";
  }
  return out;
}

function groupThousands(int: string) {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumberSection(v: number, code: string): string {
  // Fractions: "# ?/?" or "?/?" (or a fixed denominator like "# ?/8").
  const frac = /([#0]*)\s*(\?+)\/(\?+|\d+)/.exec(code);
  if (frac) {
    const whole = frac[1] ? Math.trunc(v) : 0;
    const rest = Math.abs(v - whole);
    const fixed = /^\d+$/.test(frac[3]);
    const maxDen = fixed ? Number(frac[3]) : 10 ** frac[3].length - 1;
    let best = [Math.round(rest), 1];
    for (let den = fixed ? maxDen : 1; den <= maxDen; den++) {
      const n = Math.round(rest * den);
      if (Math.abs(rest - n / den) < Math.abs(rest - best[0] / best[1]) - 1e-12) best = [n, den];
    }
    const [n, den] = best;
    const fracText = n && n !== den ? `${n}/${den}` : "";
    const w = whole + (n === den ? Math.sign(v) || 1 : 0);
    return (v < 0 && !w ? "-" : "") + (frac[1] ? `${w || (fracText ? "" : "0")}${w && fracText ? " " : ""}` : "") + fracText;
  }
  // Literal text: quoted strings, escaped characters and currency markers like [$€-407].
  let prefix = "", suffix = "";
  const cleaned = code
    .replace(/\[\$([^\]-]*)[^\]]*\]/g, (_, sym) => `"${sym}"`)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/_./g, " ")
    .replace(/\*./g, "");
  // Split into the numeric core and the literals around it.
  const numMatch = /[#0?,.]+(?:E[+-]0+)?%*|%/i.exec(cleaned.replace(/"[^"]*"|\\./g, (m) => " ".repeat(m.length)));
  if (!numMatch) return cleaned.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  const lit = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  prefix = lit(cleaned.slice(0, numMatch.index));
  suffix = lit(cleaned.slice(numMatch.index + numMatch[0].length));
  const core = numMatch[0];

  let n = v;
  const pct = (core.match(/%/g) ?? []).length;
  n *= 100 ** pct;
  const sci = /E([+-])(0+)/i.exec(core);
  const [intPart, decPart = ""] = core.replace(/%|E[+-]0+/gi, "").split(".");
  const decimals = (decPart.match(/[0#?]/g) ?? []).length;
  const minDecimals = (decPart.match(/0/g) ?? []).length;
  const thousands = /,/.test(intPart.replace(/,+$/, ""));
  const scaleCommas = (/,+$/.exec(intPart)?.[0].length ?? 0);
  n /= 1000 ** scaleCommas;
  const minInt = (intPart.match(/0/g) ?? []).length;

  let text: string;
  if (sci) {
    const exp = n === 0 ? 0 : Math.floor(Math.log10(Math.abs(n)));
    const mant = n / 10 ** exp;
    text = mant.toFixed(decimals) + "E" + (exp < 0 ? "-" : sci[1] === "+" ? "+" : "") + String(Math.abs(exp)).padStart(sci[2].length, "0");
  } else {
    let fixed = Math.abs(n).toFixed(decimals);
    if (decimals > minDecimals) fixed = fixed.replace(new RegExp(`(\\.\\d{${minDecimals}}\\d*?)0+$`), "$1").replace(/\.$/, "");
    let [i, d] = fixed.split(".");
    if (i === "0" && minInt === 0) i = "";
    i = i.padStart(minInt, "0");
    if (thousands) i = groupThousands(i);
    text = (n < 0 ? "-" : "") + i + (d !== undefined ? "." + d : "");
  }
  return prefix + text + "%".repeat(pct) + suffix;
}

/** Format a value with an Excel number format code. Returns the text and an optional colour. */
export function formatValue(v: number | string | boolean, code?: string): { text: string; color?: string } {
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE" };
  if (!code || /^general$/i.test(code)) return { text: typeof v === "number" ? general(v) : v };
  const sections = splitSections(code);
  if (typeof v === "string") {
    const textSection = sections[3] ?? (sections.find((s) => s.includes("@")) ?? null);
    return { text: textSection ? textSection.replace(/"([^"]*)"/g, "$1").replace("@", v) : v };
  }
  let section = sections[0];
  let value = v;
  // Conditions like [>=100] pick a section; otherwise positive;negative;zero.
  const cond = (s: string) => /\[(<=|>=|<>|<|>|=)(-?[\d.]+)\]/.exec(s);
  if (sections.some((s) => cond(s))) {
    const hit = sections.find((s) => {
      const c = cond(s);
      if (!c) return true;
      const x = Number(c[2]);
      return c[1] === "<" ? v < x : c[1] === ">" ? v > x : c[1] === "<=" ? v <= x : c[1] === ">=" ? v >= x : c[1] === "<>" ? v !== x : v === x;
    });
    section = hit ?? sections[0];
  } else if (v < 0 && sections[1] !== undefined) {
    section = sections[1];
    value = -v;
  } else if (v === 0 && sections[2] !== undefined) section = sections[2];
  const colorMatch = /\[(Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color\d+)\]/i.exec(section);
  const color = colorMatch ? { black: "#000000", blue: "#2563eb", cyan: "#0891b2", green: "#16a34a", magenta: "#c026d3", red: "#dc2626", white: "#ffffff", yellow: "#ca8a04" }[colorMatch[1].toLowerCase()] : undefined;
  if (section.includes("@")) return { text: String(v), color };
  if (isDateFormat(section)) {
    if (value < 0 || value > 2958465) return { text: "#".repeat(8), color };
    return { text: formatDate(value, section.replace(/\[(Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color\d+)\]/gi, "")), color };
  }
  return { text: formatNumberSection(value, section), color };
}

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') q = !q;
    if (ch === "\\" && !q) {
      cur += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === ";" && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Number format presets shown in the toolbar. */
export const NUMBER_FORMATS: { label: string; code: string; sample?: string }[] = [
  { label: "General", code: "General" },
  { label: "Number", code: "#,##0.00" },
  { label: "Currency", code: "$#,##0.00" },
  { label: "Accounting", code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)' },
  { label: "Percent", code: "0.00%" },
  { label: "Scientific", code: "0.00E+00" },
  { label: "Fraction", code: "# ?/?" },
  { label: "Date", code: "yyyy-mm-dd" },
  { label: "Long date", code: "dddd, mmmm d, yyyy" },
  { label: "Time", code: "h:mm:ss AM/PM" },
  { label: "Date and time", code: "yyyy-mm-dd h:mm" },
  { label: "Text", code: "@" },
];

export const CURRENCIES = ["$", "€", "£", "¥", "₦", "₹"];

/** Change the number of decimals in a format code, for the toolbar's +/– buttons. */
export function adjustDecimals(code: string | undefined, delta: number, sample: number): string {
  let c = !code || /^general$/i.test(code) ? (() => {
    const s = general(sample);
    const d = s.includes(".") ? s.split(".")[1].length : 0;
    return d ? "0." + "0".repeat(d) : "0";
  })() : code;
  return splitSections(c)
    .map((s) => {
      if (isDateFormat(s) || s.includes("@")) return s;
      return s.replace(/([#0,]*0)(\.0*)?(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/, (_m, int: string, dec: string | undefined) => {
        const n = Math.max(0, (dec ? dec.length - 1 : 0) + delta);
        return int + (n ? "." + "0".repeat(n) : "");
      });
    })
    .join(";");
}
