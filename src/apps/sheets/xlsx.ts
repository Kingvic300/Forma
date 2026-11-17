// Excel files with their formatting, through ExcelJS: fonts, fills, borders, alignment, number
// formats, column widths and row heights, merged cells, frozen panes, hidden rows and columns,
// data validation, conditional formatting, notes, tab colours and named ranges.
import type ExcelJSType from "exceljs";
import { Book, display, parseRange, rangeText } from "./formula";
import { moveFormula } from "./refs";
import { parseInput, toSerial } from "./format";
import type { Border, CellFmt, CondRule, Sheet, SheetsData, Validation } from "./types";
import { key } from "./types";

type ExcelJS = typeof ExcelJSType;
const load = async (): Promise<ExcelJS> => {
  const m = (await import("exceljs")) as unknown as { default?: ExcelJS } & ExcelJS;
  return m.default ?? m;
};
const uid = () => Math.random().toString(36).slice(2, 10);

// Office's default theme colours, for colours stored as a theme index.
const THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
type XColor = { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined;
const INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080"];
function color(c: XColor): string | undefined {
  if (!c) return undefined;
  let hex: string | undefined;
  if (c.argb) hex = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
  else if (c.theme !== undefined) hex = THEME[c.theme];
  else if (c.indexed !== undefined) hex = INDEXED[c.indexed];
  if (!hex) return undefined;
  if (c.tint) {
    const t = c.tint;
    hex = [0, 2, 4]
      .map((i) => {
        const v = parseInt(hex!.slice(i, i + 2), 16);
        const n = t < 0 ? v * (1 + t) : v + (255 - v) * t;
        return Math.round(n).toString(16).padStart(2, "0");
      })
      .join("");
  }
  return "#" + hex.toLowerCase();
}
const argb = (c?: string) => (c ? { argb: "FF" + c.replace("#", "").toUpperCase().slice(0, 6) } : undefined);

const BORDER_STYLES: Record<string, string> = { thin: "thin", hair: "thin", medium: "medium", thick: "thick", dashed: "dashed", dotted: "dotted", double: "double", mediumDashed: "dashed", dashDot: "dashed", mediumDashDot: "dashed", dashDotDot: "dotted", slantDashDot: "dashed" };

// ---- Import --------------------------------------------------------------------------------------

function excelDateToSerial(d: Date) {
  return toSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

export async function readXlsx(buf: ArrayBuffer): Promise<SheetsData> {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets: Sheet[] = [];
  wb.worksheets.forEach((ws) => {
    const s: Sheet = { name: ws.name, cells: [] };
    const fmt: Record<string, CellFmt> = {};
    const notes: Record<string, string> = {};
    const shared = new Map<string, { formula: string; r: number; c: number }>();
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const r = rn - 1;
      if (row.height) (s.rowH ??= {})[r] = Math.round((row.height * 4) / 3);
      if (row.hidden) (s.hiddenRows ??= []).push(r);
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const c = cn - 1;
        const v = cell.value as unknown;
        let raw = "";
        const obj = v && typeof v === "object" && !(v instanceof Date) ? (v as Record<string, unknown>) : null;
        if (obj && ("formula" in obj || "sharedFormula" in obj)) {
          let f = (cell.formula || (obj.formula as string) || "") as string;
          if (obj.formula) shared.set(cell.address, { formula: obj.formula as string, r, c });
          if (!f && obj.sharedFormula) {
            const master = shared.get(obj.sharedFormula as string);
            if (master) f = moveFormula("=" + master.formula, r - master.r, c - master.c).slice(1);
          }
          raw = f ? "=" + f.replace(/^_xlfn\./i, "").replace(/_xlfn\.|_xlws\./gi, "") : String(obj.result ?? "");
        } else if (v instanceof Date) raw = String(excelDateToSerial(v));
        else if (obj && "richText" in obj) raw = (obj.richText as { text: string }[]).map((t) => t.text).join("");
        else if (obj && "text" in obj) raw = String(obj.text);
        else if (obj && "error" in obj) raw = String(obj.error);
        else if (typeof v === "boolean") raw = v ? "TRUE" : "FALSE";
        else if (v !== null && v !== undefined) raw = String(v);
        // Text that looks like a number or date stays text.
        if (typeof v === "string" && raw !== "" && (!isNaN(Number(raw)) || /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(raw))) raw = "'" + raw;
        (s.cells[r] ??= [])[c] = raw;

        const f: CellFmt = {};
        const font = cell.font;
        if (font) {
          if (font.bold) f.bold = true;
          if (font.italic) f.italic = true;
          if (font.underline) f.underline = true;
          if (font.strike) f.strike = true;
          if (font.name && font.name !== "Calibri") f.font = font.name;
          if (font.size && font.size !== 11) f.size = font.size;
          const col = color(font.color as XColor);
          if (col && col !== "#000000") f.color = col;
        }
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: XColor } | undefined;
        if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") {
          const bg = color(fill.fgColor);
          if (bg) f.bg = bg;
        }
        const al = cell.alignment;
        if (al) {
          if (al.horizontal === "left" || al.horizontal === "center" || al.horizontal === "right") f.align = al.horizontal;
          if (al.vertical === "top" || al.vertical === "bottom") f.valign = al.vertical;
          else if (al.vertical === "middle") f.valign = "middle";
          if (al.wrapText) f.wrap = true;
          if (al.indent) f.indent = al.indent;
          if (typeof al.textRotation === "number" && al.textRotation) f.rotate = al.textRotation;
        }
        const b = cell.border;
        if (b) {
          const side = (x?: { style?: string; color?: XColor }): Border | undefined => (x?.style ? { style: BORDER_STYLES[x.style] ?? "thin", color: color(x.color) ?? "#000000" } : undefined);
          const border = { t: side(b.top), r: side(b.right), b: side(b.bottom), l: side(b.left) };
          if (border.t || border.r || border.b || border.l) f.border = border;
        }
        if (cell.numFmt && cell.numFmt !== "General") f.num = cell.numFmt;
        if (Object.keys(f).length) fmt[key(r, c)] = f;
        const note = cell.note as string | { texts?: { text: string }[] } | undefined;
        if (note) notes[key(r, c)] = typeof note === "string" ? note : (note.texts ?? []).map((t) => t.text).join("");
      });
    });
    s.cells = Array.from(s.cells, (r) => Array.from(r ?? [], (v) => v ?? ""));
    if (Object.keys(fmt).length) s.fmt = fmt;
    if (Object.keys(notes).length) s.notes = notes;
    (ws.columns ?? []).forEach((col, i) => {
      if (col.width) (s.colW ??= {})[i] = Math.round(col.width * 7 + 5);
      if (col.hidden) (s.hiddenCols ??= []).push(i);
    });
    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number; showGridLines?: boolean } | undefined;
    if (view?.state === "frozen" && (view.xSplit || view.ySplit)) s.freeze = { r: view.ySplit ?? 0, c: view.xSplit ?? 0 };
    if (view?.showGridLines === false) s.showGrid = false;
    const merges = (ws.model as { merges?: string[] }).merges ?? [];
    if (merges.length) s.merges = merges.map((m) => parseRange(m)).filter((m): m is NonNullable<typeof m> => !!m);
    const tab = color((ws.properties as { tabColor?: XColor }).tabColor);
    if (tab) s.tabColor = tab;
    if (ws.state && ws.state !== "visible") s.hidden = true;

    // Data validation.
    const dv = (ws as unknown as { dataValidations?: { model: Record<string, Record<string, unknown>> } }).dataValidations?.model ?? {};
    for (const [ref, rule] of Object.entries(dv)) {
      const type = String(rule.type);
      const formulae = (rule.formulae as unknown[] | undefined)?.map(String) ?? [];
      const range = ref.replace(/^range:/, "").split(" ")[0];
      const v: Validation = { id: uid(), range, type: "list", strict: rule.errorStyle !== "warning" && rule.errorStyle !== "information" };
      if (type === "list") v.list = formulae[0]?.replace(/^"|"$/g, "") ?? "";
      else if (type === "whole" || type === "decimal" || type === "date") {
        v.type = type;
        v.op = (({ between: "between", notBetween: "notBetween", equal: "eq", notEqual: "ne", greaterThan: "gt", lessThan: "lt", greaterThanOrEqual: "ge", lessThanOrEqual: "le" }) as Record<string, Validation["op"]>)[String(rule.operator ?? "between")] ?? "between";
        v.min = formulae[0];
        v.max = formulae[1];
      } else if (type === "textLength") {
        v.type = "length";
        v.op = "between";
        v.min = formulae[0];
        v.max = formulae[1];
      } else if (type === "custom") {
        v.type = "formula";
        v.min = formulae[0];
      } else continue;
      if (rule.error) v.message = String(rule.error);
      (s.valid ??= []).push(v);
    }

    // Conditional formatting.
    const cfs = (ws as unknown as { conditionalFormattings?: { ref: string; rules: Record<string, unknown>[] }[] }).conditionalFormattings ?? [];
    for (const cf of cfs) {
      for (const rule of cf.rules) {
        const style = rule.style as { fill?: { bgColor?: XColor; fgColor?: XColor }; font?: { color?: XColor; bold?: boolean } } | undefined;
        const st = style ? { bg: color(style.fill?.bgColor ?? style.fill?.fgColor), color: color(style.font?.color), bold: style.font?.bold || undefined } : undefined;
        const formulae = (rule.formulae as unknown[] | undefined)?.map(String) ?? [];
        const base = { id: uid(), range: cf.ref.split(" ")[0], style: st };
        let out: CondRule | null = null;
        switch (rule.type) {
          case "cellIs": {
            const op = ({ greaterThan: "gt", lessThan: "lt", between: "between", equal: "eq", notEqual: "ne" } as Record<string, CondRule["type"]>)[String(rule.operator)];
            if (op) out = { ...base, type: op, a: formulae[0], b: formulae[1] };
            break;
          }
          case "containsText":
            out = { ...base, type: rule.operator === "notContains" ? "notContains" : rule.operator === "beginsWith" ? "begins" : rule.operator === "endsWith" ? "ends" : "contains", a: String(rule.text ?? "") };
            break;
          case "expression":
            out = { ...base, type: "formula", a: "=" + (formulae[0] ?? "") };
            break;
          case "top10":
            out = { ...base, type: rule.bottom ? "bottom" : "top", a: String(rule.rank ?? 10), percent: !!rule.percent };
            break;
          case "aboveAverage":
            out = { ...base, type: rule.aboveAverage === false ? "belowAvg" : "aboveAvg" };
            break;
          case "colorScale": {
            const cols = ((rule.color as XColor[]) ?? []).map((c) => color(c) ?? "#ffffff");
            out = { ...base, type: cols.length === 3 ? "scale3" : "scale2", colors: cols, style: undefined };
            break;
          }
          case "dataBar":
            out = { ...base, type: "bar", colors: [color(rule.color as XColor) ?? "#638ec6"], style: undefined };
            break;
          case "duplicateValues":
            out = { ...base, type: "duplicate" };
            break;
          case "uniqueValues":
            out = { ...base, type: "unique" };
            break;
        }
        if (out) {
          if (rule.stopIfTrue) out.stop = true;
          (s.cond ??= []).push(out);
        }
      }
    }
    sheets.push(s);
  });

  const names: Record<string, string> = {};
  for (const n of ((wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? [])) {
    if (n.ranges?.[0] && !n.name.startsWith("_xlnm")) names[n.name] = n.ranges[0];
  }
  return { sheets: sheets.length ? sheets : [{ name: "Sheet1", cells: [] }], ...(Object.keys(names).length ? { names } : {}) };
}

// ---- Export -------------------------------------------------------------------------------------------

export async function writeXlsx(data: SheetsData): Promise<Uint8Array> {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Forma";
  const book = new Book(data);
  data.sheets.forEach((s, si) => {
    const ws = wb.addWorksheet(s.name.slice(0, 31), {
      properties: s.tabColor ? { tabColor: argb(s.tabColor) } : undefined,
      state: s.hidden ? "hidden" : "visible",
      views: [{ state: s.freeze && (s.freeze.r || s.freeze.c) ? "frozen" : "normal", xSplit: s.freeze?.c ?? 0, ySplit: s.freeze?.r ?? 0, showGridLines: s.showGrid !== false }],
    });
    for (const [c, w] of Object.entries(s.colW ?? {})) ws.getColumn(Number(c) + 1).width = Math.max(1, (w - 5) / 7);
    for (const c of s.hiddenCols ?? []) ws.getColumn(c + 1).hidden = true;
    for (const [r, h] of Object.entries(s.rowH ?? {})) ws.getRow(Number(r) + 1).height = (h * 3) / 4;
    for (const r of s.hiddenRows ?? []) ws.getRow(r + 1).hidden = true;

    const fmtKeys = new Set(Object.keys(s.fmt ?? {}));
    const write = (r: number, c: number) => {
      const raw = s.cells[r]?.[c] ?? "";
      const f = s.fmt?.[key(r, c)];
      if (!raw && !f && !s.notes?.[key(r, c)]) return;
      const cell = ws.getCell(r + 1, c + 1);
      if (raw.startsWith("=")) {
        const result = book.value(si, r, c);
        const res = typeof result === "object" ? { error: display(result) } : result;
        cell.value = { formula: raw.slice(1), result: res } as never;
      } else if (raw) {
        if (raw[0] === "'") cell.value = raw.slice(1);
        else {
          const v = book.value(si, r, c);
          cell.value = typeof v === "object" ? display(v) : v;
          // Typed formats ("12%", "$5", dates) are kept even without an explicit format.
          if (!f?.num) {
            const auto = autoFormat(raw);
            if (auto) cell.numFmt = auto;
          }
        }
      }
      if (f) {
        const font: Record<string, unknown> = {};
        if (f.bold) font.bold = true;
        if (f.italic) font.italic = true;
        if (f.underline) font.underline = true;
        if (f.strike) font.strike = true;
        if (f.font) font.name = f.font;
        if (f.size) font.size = f.size;
        if (f.color) font.color = argb(f.color);
        if (Object.keys(font).length) cell.font = font as never;
        if (f.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: argb(f.bg) } as never;
        const al: Record<string, unknown> = {};
        if (f.align) al.horizontal = f.align;
        if (f.valign) al.vertical = f.valign;
        if (f.wrap) al.wrapText = true;
        if (f.indent) al.indent = f.indent;
        if (f.rotate) al.textRotation = f.rotate;
        if (Object.keys(al).length) cell.alignment = al as never;
        if (f.border) {
          const side = (b?: Border) => (b ? { style: b.style === "dashed" ? "dashed" : b.style === "dotted" ? "dotted" : b.style === "double" ? "double" : b.style === "thick" ? "thick" : b.style === "medium" ? "medium" : "thin", color: argb(b.color) } : undefined);
          cell.border = { top: side(f.border.t), right: side(f.border.r), bottom: side(f.border.b), left: side(f.border.l) } as never;
        }
        if (f.num) cell.numFmt = f.num;
      }
      const note = s.notes?.[key(r, c)];
      if (note) cell.note = note;
    };
    s.cells.forEach((row, r) => row?.forEach((_, c) => write(r, c)));
    for (const k of fmtKeys) {
      const [r, c] = k.split(",").map(Number);
      if (!(s.cells[r]?.[c])) write(r, c);
    }
    for (const k of Object.keys(s.notes ?? {})) {
      const [r, c] = k.split(",").map(Number);
      if (!s.cells[r]?.[c] && !fmtKeys.has(k)) write(r, c);
    }
    for (const m of s.merges ?? []) {
      try {
        ws.mergeCells(m.r1 + 1, m.c1 + 1, m.r2 + 1, m.c2 + 1);
      } catch {
        // Overlapping merges in the source: skip the later one.
      }
    }
    for (const v of s.valid ?? []) {
      const opMap: Record<string, string> = { between: "between", notBetween: "notBetween", eq: "equal", ne: "notEqual", gt: "greaterThan", lt: "lessThan", ge: "greaterThanOrEqual", le: "lessThanOrEqual" };
      const rule: Record<string, unknown> = { allowBlank: true, showErrorMessage: true, errorStyle: v.strict === false ? "warning" : "stop", error: v.message };
      if (v.type === "list") Object.assign(rule, { type: "list", formulae: [/^\$?[A-Z]+\$?\d+:/i.test(v.list ?? "") || (v.list ?? "").startsWith("=") ? (v.list ?? "").replace(/^=/, "") : `"${v.list ?? ""}"`] });
      else if (v.type === "formula") Object.assign(rule, { type: "custom", formulae: [(v.min ?? "").replace(/^=/, "")] });
      else Object.assign(rule, { type: v.type === "length" ? "textLength" : v.type, operator: opMap[v.op ?? "between"], formulae: [v.min, v.max].filter((x) => x !== undefined && x !== "") });
      const b = parseRange(v.range);
      if (!b) continue;
      for (let r = b.r1; r <= Math.min(b.r2, b.r1 + 2000); r++) for (let c = b.c1; c <= b.c2; c++) ws.getCell(r + 1, c + 1).dataValidation = rule as never;
    }
    for (const rule of s.cond ?? []) {
      const b = parseRange(rule.range);
      if (!b) continue;
      const tl = rangeText(b.r1, b.c1, b.r1, b.c1);
      const abs = `$${rangeText(b.r1, b.c1, b.r2, b.c2).replace(/([A-Z]+)(\d+)/g, "$1$$$2").replace(/:/, ":$")}`;
      const style = rule.style ? { fill: rule.style.bg ? { type: "pattern", pattern: "solid", bgColor: argb(rule.style.bg) } : undefined, font: rule.style.color || rule.style.bold ? { color: argb(rule.style.color), bold: rule.style.bold } : undefined } : undefined;
      let x: Record<string, unknown> | null = null;
      switch (rule.type) {
        case "gt": case "lt": case "between": case "eq": case "ne":
          x = { type: "cellIs", operator: { gt: "greaterThan", lt: "lessThan", between: "between", eq: "equal", ne: "notEqual" }[rule.type], formulae: [rule.a, rule.b].filter((y) => y !== undefined && y !== "").map((y) => (isNaN(Number(y)) && !String(y).startsWith("=") ? `"${y}"` : String(y).replace(/^=/, ""))) };
          break;
        case "contains": x = { type: "containsText", operator: "containsText", text: rule.a }; break;
        case "notContains": x = { type: "containsText", operator: "notContains", text: rule.a }; break;
        case "begins": x = { type: "containsText", operator: "beginsWith", text: rule.a }; break;
        case "ends": x = { type: "containsText", operator: "endsWith", text: rule.a }; break;
        case "blank": x = { type: "expression", formulae: [`LEN(TRIM(${tl}))=0`] }; break;
        case "notBlank": x = { type: "expression", formulae: [`LEN(TRIM(${tl}))>0`] }; break;
        case "duplicate": x = { type: "expression", formulae: [`COUNTIF(${abs},${tl})>1`] }; break;
        case "unique": x = { type: "expression", formulae: [`COUNTIF(${abs},${tl})=1`] }; break;
        case "top": case "bottom": x = { type: "top10", rank: Number(rule.a ?? 10), percent: !!rule.percent, bottom: rule.type === "bottom" }; break;
        case "aboveAvg": case "belowAvg": x = { type: "aboveAverage", aboveAverage: rule.type === "aboveAvg" }; break;
        case "formula": x = { type: "expression", formulae: [(rule.a ?? "").replace(/^=/, "")] }; break;
        case "scale2": case "scale3":
          x = { type: "colorScale", cfvo: rule.type === "scale3" ? [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }] : [{ type: "min" }, { type: "max" }], color: (rule.colors ?? []).map((c) => argb(c)) };
          break;
        case "bar": x = { type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: argb(rule.colors?.[0] ?? "#638ec6") }; break;
      }
      if (x) ws.addConditionalFormatting({ ref: rangeText(b.r1, b.c1, b.r2, b.c2), rules: [{ ...x, ...(style && !["scale2", "scale3", "bar"].includes(rule.type) ? { style } : {}), ...(rule.stop ? { stopIfTrue: true } : {}), priority: 1 } as never] });
    }
  });
  for (const [name, ref] of Object.entries(data.names ?? {})) {
    try {
      wb.definedNames.add(ref.replace(/^=/, ""), name);
    } catch {
      // A name Excel won't accept; skip it.
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

/** The format implied by how a value was typed ("12%", "$1,200", "2024-05-01"). */
export const autoFormat = (raw: string) => parseInput(raw).fmt;
