// Ask Groq to work on a spreadsheet. The model answers with cell operations (fill a range, write
// formulas, add a sheet, sort…) that are applied as one change, so Ctrl+Z takes it all back.
import { groqChat } from "../../lib/groq";
import { parseJson, type AiHistory } from "../../lib/AiPanel";
import { colName, display, makeEvaluator, parseRef } from "./formula";
import type { Sheet, SheetsData } from "./types";

export type SheetOp =
  | { op: "set"; sheet?: string; start: string; values: (string | number | boolean | null)[][] }
  | { op: "clear"; sheet?: string; range: string }
  | { op: "add_sheet"; name: string; values?: (string | number | boolean | null)[][] }
  | { op: "rename_sheet"; sheet?: string; name: string }
  | { op: "delete_sheet"; sheet: string }
  | { op: "insert_rows"; sheet?: string; at: number; count?: number }
  | { op: "delete_rows"; sheet?: string; at: number; count?: number }
  | { op: "insert_cols"; sheet?: string; at: string; count?: number }
  | { op: "delete_cols"; sheet?: string; at: string; count?: number }
  | { op: "sort"; sheet?: string; column: string; descending?: boolean; header?: boolean };

const FUNCTIONS = "SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT IF IFERROR AND OR NOT ROUND FLOOR CEILING ABS SQRT POWER MOD CONCAT CONCATENATE LEN UPPER LOWER TRIM LEFT RIGHT MID TODAY NOW COUNTIF SUMIF";

const SYSTEM = `You are the AI assistant inside a spreadsheet app. You can answer questions about the data and change it.
Reply with JSON only: {"reply": "<short message to the user>", "ops": [ ... ]}.
Cells use A1 references (column letters, rows from 1). Formulas start with "=" and may use + - * / ^ & comparisons, ranges like A1:B9, references to other cells, and only these functions: ${FUNCTIONS}. Other functions don't exist here.
"sheet" is a sheet name; leave it out to use the sheet the user is looking at.
Each op is one of:
 {"op":"set","sheet":"Sheet1","start":"A1","values":[["Name","Total"],["Ann","=B2*2"]]}   (writes a block starting at "start"; null leaves a cell unchanged, "" empties it)
 {"op":"clear","range":"A1:C10"}
 {"op":"add_sheet","name":"Summary","values":[["..."]]}
 {"op":"rename_sheet","sheet":"Sheet1","name":"Budget"}   {"op":"delete_sheet","sheet":"Old"}
 {"op":"insert_rows","at":5,"count":2}   {"op":"delete_rows","at":5,"count":2}   (row numbers)
 {"op":"insert_cols","at":"C","count":1}   {"op":"delete_cols","at":"C","count":1}
 {"op":"sort","column":"B","descending":false,"header":true}
Rules: change only what the user asked for. Cells have no number formats: for a percentage write a formula such as =ROUND(B2/B$6*100,1)&"%", and for money round with ROUND. Prefer formulas over typed results when the answer depends on other cells, so it stays up to date. Put new results next to the data, not on top of it, unless asked. For questions, compute the answer from the values you are given and return "ops": []. Never output anything outside the JSON object.`;

const MAX_CELLS = 4000;

function sheetText(s: Sheet, full: boolean) {
  const ev = makeEvaluator(s.cells);
  const rows = s.cells.length;
  const cols = Math.max(0, ...s.cells.map((r) => r?.length ?? 0));
  const out: string[] = [`Sheet "${s.name}": ${rows} rows x ${cols} columns used.`];
  let n = 0;
  const limit = full ? MAX_CELLS : 120;
  for (let r = 0; r < rows && n < limit; r++) {
    const cells: string[] = [];
    (s.cells[r] ?? []).forEach((raw, c) => {
      if (!raw || n >= limit) return;
      n++;
      const ref = `${colName(c)}${r + 1}`;
      cells.push(raw.startsWith("=") ? `${ref}: ${raw} → ${display(ev(r, c))}` : `${ref}: ${JSON.stringify(raw)}`);
    });
    if (cells.length) out.push(cells.join(" | "));
  }
  if (n >= limit) out.push("(…more cells not shown)");
  return out.join("\n");
}

export function describe(data: SheetsData, active: number, selection: string) {
  return [
    `Sheets: ${data.sheets.map((s) => s.name).join(", ")}. The user is looking at "${data.sheets[active]?.name}" with ${selection} selected.`,
    ...data.sheets.map((s, i) => sheetText(s, i === active)),
  ].join("\n\n");
}

export async function askSheets(key: string, data: SheetsData, active: number, selection: string, history: AiHistory, request: string) {
  const content = await groqChat(
    key,
    [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: `Workbook:\n${describe(data, active, selection).slice(0, 60000)}\n\nRequest: ${request}` }],
    { json: true, temperature: 0.1 },
  );
  const parsed = parseJson<{ reply?: string; ops?: SheetOp[] }>(content);
  return { reply: String(parsed.reply ?? ""), ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
}

const colIndex = (letters: string) => parseRef(`${letters}1`)?.c ?? -1;

function trimCells(cs: string[][]) {
  const out = cs.map((r) => {
    const x = Array.from(r ?? [], (v) => v ?? "");
    while (x.length && x[x.length - 1] === "") x.pop();
    return x;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

export function applySheetOps(start: SheetsData, active: number, ops: SheetOp[]): { data: SheetsData; applied: number; focus: number } {
  const sheets: Sheet[] = start.sheets.map((s) => ({ ...s, cells: s.cells.map((r) => (r ? r.slice() : [])) }));
  let focus = active;
  let applied = 0;
  const pick = (name?: string) => {
    const i = name ? sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase()) : Math.min(focus, sheets.length - 1);
    return i;
  };
  const write = (cells: string[][], r0: number, c0: number, values: unknown[][]) =>
    values.forEach((row, i) =>
      (Array.isArray(row) ? row : [row]).forEach((v, j) => {
        if (v === null || v === undefined) return;
        while (cells.length <= r0 + i) cells.push([]);
        const line = cells[r0 + i];
        while (line.length <= c0 + j) line.push("");
        line[c0 + j] = typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
      }),
    );

  for (const op of ops) {
    try {
      if (op.op === "add_sheet") {
        let name = String(op.name || `Sheet${sheets.length + 1}`).slice(0, 60);
        while (sheets.some((s) => s.name === name)) name += " 2";
        const cells: string[][] = [];
        if (Array.isArray(op.values)) write(cells, 0, 0, op.values);
        sheets.push({ name, cells });
        focus = sheets.length - 1;
        applied++;
        continue;
      }
      const i = pick((op as { sheet?: string }).sheet);
      if (i < 0) continue;
      const s = sheets[i];
      switch (op.op) {
        case "set": {
          const at = parseRef(String(op.start ?? "A1"));
          if (!at || !Array.isArray(op.values)) continue;
          write(s.cells, at.r, at.c, op.values);
          break;
        }
        case "clear": {
          const [a, b = a] = String(op.range).split(":");
          const p = parseRef(a), q = parseRef(b);
          if (!p || !q) continue;
          for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) if (s.cells[r]?.[c] !== undefined) s.cells[r][c] = "";
          break;
        }
        case "rename_sheet":
          if (!op.name) continue;
          s.name = String(op.name).slice(0, 60);
          break;
        case "delete_sheet":
          if (sheets.length === 1) continue;
          sheets.splice(i, 1);
          focus = Math.min(focus, sheets.length - 1);
          break;
        case "insert_rows":
        case "delete_rows": {
          const at = Math.max(0, Number(op.at) - 1), count = Math.max(1, Number(op.count) || 1);
          if (op.op === "insert_rows") s.cells.splice(at, 0, ...Array.from({ length: count }, () => [] as string[]));
          else s.cells.splice(at, count);
          break;
        }
        case "insert_cols":
        case "delete_cols": {
          const at = colIndex(String(op.at)), count = Math.max(1, Number(op.count) || 1);
          if (at < 0) continue;
          s.cells = s.cells.map((r) => {
            const x = r.slice();
            if (op.op === "insert_cols") {
              while (x.length < at) x.push("");
              x.splice(at, 0, ...Array(count).fill(""));
            } else x.splice(at, count);
            return x;
          });
          break;
        }
        case "sort": {
          const c = colIndex(String(op.column));
          if (c < 0) continue;
          const head = op.header !== false ? s.cells.slice(0, 1) : [];
          const body = s.cells.slice(head.length).filter((r) => r && r.some((v) => v));
          const dir = op.descending ? -1 : 1;
          body.sort((a, b) => {
            const x = a[c] ?? "", y = b[c] ?? "";
            if (x === "" || y === "") return x === "" ? 1 : -1;
            const nx = Number(x), ny = Number(y);
            return (!isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true })) * dir;
          });
          s.cells = [...head, ...body];
          break;
        }
        default:
          continue;
      }
      s.cells = trimCells(s.cells);
      focus = sheets.indexOf(s) >= 0 ? sheets.indexOf(s) : focus;
      applied++;
    } catch {
      // Skip an operation the model got wrong; apply the rest.
    }
  }
  return { data: { ...start, sheets }, applied, focus };
}
