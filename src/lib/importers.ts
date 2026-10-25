import Papa from "papaparse";
import { createFile, type Kind } from "./store";
import type { SheetsData } from "../apps/sheets/types";
import type { DocsData } from "../apps/Docs";
import type { FormData } from "../apps/forms/types";
import type { PdfData } from "../apps/pdf/types";

export const ACCEPT: Record<Kind | "all", string> = {
  docs: ".docx,.html,.htm,.txt,.md",
  sheets: ".csv,.tsv,.xlsx,.xls,.ods",
  forms: ".json",
  pdf: ".pdf",
  tracker: ".json",
  all: ".pdf,.csv,.tsv,.xlsx,.xls,.ods,.docx,.html,.htm,.txt,.md,.json",
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const base = (name: string) => name.replace(/\.[^.]+$/, "");

export function blank(kind: Kind): unknown {
  switch (kind) {
    case "docs":
      return { html: "<p><br></p>" } satisfies DocsData;
    case "sheets":
      return { sheets: [{ name: "Sheet1", cells: [] }] } satisfies SheetsData;
    case "forms":
      return {
        title: "Untitled form",
        description: "",
        questions: [{ id: Math.random().toString(36).slice(2), type: "short", label: "", required: false, options: [] }],
        responses: [],
      } satisfies FormData;
    case "tracker":
      return { tasks: [], habits: [], notes: {} };
    case "pdf":
      throw new Error("Open a PDF file to start");
  }
}

export const csvToCells = (text: string) =>
  Papa.parse<string[]>(text, { skipEmptyLines: false }).data.map((r) => r.map((v) => String(v ?? "")));

/** Turn a file from disk into a Forma file. Returns the new file's kind and id. */
export async function importFile(file: File): Promise<{ kind: Kind; id: string }> {
  const ext = file.name.split(".").pop()!.toLowerCase();
  const name = base(file.name);

  if (ext === "pdf") {
    const data: PdfData = { bytes: new Uint8Array(await file.arrayBuffer()), anns: [], fields: {} };
    return { kind: "pdf", id: await createFile("pdf", name, data) };
  }
  if (ext === "csv" || ext === "tsv") {
    const data: SheetsData = { sheets: [{ name, cells: csvToCells(await file.text()) }] };
    return { kind: "sheets", id: await createFile("sheets", name, data) };
  }
  if (ext === "xlsx" || ext === "xls" || ext === "ods") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer());
    const sheets = wb.SheetNames.map((sn) => {
      const ws = wb.Sheets[sn];
      const cells: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: true });
      for (const addr of Object.keys(ws)) {
        if (addr[0] === "!" || !ws[addr].f) continue;
        const { r, c } = XLSX.utils.decode_cell(addr);
        (cells[r] ??= [])[c] = "=" + ws[addr].f;
      }
      return { name: sn, cells: cells.map((row) => Array.from(row ?? [], (v) => String(v ?? ""))) };
    });
    return { kind: "sheets", id: await createFile("sheets", name, { sheets } satisfies SheetsData) };
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { kind: "docs", id: await createFile("docs", name, { html: res.value || "<p><br></p>" }) };
  }
  if (ext === "html" || ext === "htm") {
    const doc = new DOMParser().parseFromString(await file.text(), "text/html");
    doc.querySelectorAll("script,style,iframe,object").forEach((n) => n.remove());
    return { kind: "docs", id: await createFile("docs", name, { html: doc.body.innerHTML }) };
  }
  if (ext === "txt" || ext === "md") {
    const html = (await file.text()).split(/\r?\n/).map((l) => `<p>${escapeHtml(l) || "<br>"}</p>`).join("");
    return { kind: "docs", id: await createFile("docs", name, { html }) };
  }
  throw new Error(`Unsupported file type: .${ext}`);
}
