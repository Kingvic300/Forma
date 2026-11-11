export type AnnType = "text" | "image" | "highlight" | "whiteout" | "redact" | "rect" | "check" | "cross" | "line" | "table";
export type Font = "helv" | "times" | "courier" | "carlito";

/** A piece of a line with one weight. */
export interface Span {
  t: string;
  b?: boolean;
}

/** An annotation placed on a page. Coordinates are PDF points from the page's top-left. */
export interface Ann {
  id: string;
  page: number;
  type: AnnType;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  size?: number;
  font?: Font;
  color?: string;
  bold?: boolean;
  src?: string; // PNG data URL for images and signatures
  /** For text that replaces words already in the PDF: the white patch hiding the original. */
  cover?: string;
  /** Distance from the box top to the first baseline, and between baselines, in points. */
  bl?: number;
  lead?: number;
  /** Lines of text with bold parts kept, for text edited from the PDF. Overrides `text` for drawing. */
  spans?: Span[][];
  /** Lines run from (x, y) to (x2, y2). Older lines without these are horizontal across the box. */
  x2?: number;
  y2?: number;
  /** Stroke width in points for lines and boxes. */
  thick?: number;
  /** Clockwise turn in degrees about the centre, for boxes, images and marks. */
  rot?: number;
  /** Table cell text, row by row. */
  cells?: string[][];
  /** Column widths and row heights as fractions of the table's width and height. */
  colW?: number[];
  rowH?: number[];
  /** Draw the first row as a bold, shaded header. */
  head?: boolean;
}

/** The two ends of a line annotation, in page points. */
export function lineEnds(a: Ann): [number, number, number, number] {
  return a.x2 !== undefined && a.y2 !== undefined ? [a.x, a.y, a.x2, a.y2] : [a.x, a.y + a.h / 2, a.x + a.w, a.y + a.h / 2];
}

/** Inner padding of a table cell, and where its first baseline sits, in points. */
export const CELL_PAD = 3;
export const cellBaseline = (size: number) => CELL_PAD + size * 0.95;
export const HEAD_FILL = "#eeeeee";

const even = (n: number) => Array.from({ length: n }, () => 1 / n);
export const colsOf = (a: Ann) => (a.colW?.length === a.cells?.[0]?.length ? a.colW! : even(a.cells?.[0]?.length ?? 1));
export const rowsOf = (a: Ann) => (a.rowH?.length === a.cells?.length ? a.rowH! : even(a.cells?.length ?? 1));

export function newTable(rows: number, cols: number): Pick<Ann, "cells" | "colW" | "rowH"> {
  return { cells: Array.from({ length: rows }, () => Array<string>(cols).fill("")), colW: even(cols), rowH: even(rows) };
}

/** Add a row after `at` (same height as it) or remove row `at`. The other rows keep their size; the table grows or shrinks. */
export function tableRow(a: Ann, at: number, op: "add" | "remove"): Partial<Ann> {
  const cells = [...(a.cells ?? [[""]])];
  const abs = rowsOf(a).map((f) => f * a.h);
  if (op === "add") {
    abs.splice(at + 1, 0, abs[at]);
    cells.splice(at + 1, 0, Array<string>(cells[0].length).fill(""));
  } else {
    if (cells.length < 2) return {};
    abs.splice(at, 1);
    cells.splice(at, 1);
  }
  const h = abs.reduce((s, v) => s + v, 0);
  return { cells, rowH: abs.map((v) => v / h), h };
}

/** Same as tableRow, for a column; the table grows or shrinks on the right. */
export function tableCol(a: Ann, at: number, op: "add" | "remove"): Partial<Ann> {
  const abs = colsOf(a).map((f) => f * a.w);
  if (op === "remove" && abs.length < 2) return {};
  const cells = (a.cells ?? [[""]]).map((row) => {
    const r = [...row];
    if (op === "add") r.splice(at + 1, 0, "");
    else r.splice(at, 1);
    return r;
  });
  if (op === "add") abs.splice(at + 1, 0, abs[at]);
  else abs.splice(at, 1);
  const w = abs.reduce((s, v) => s + v, 0);
  return { cells, colW: abs.map((v) => v / w), w };
}

export interface PdfData {
  bytes: Uint8Array;
  anns: Ann[];
  fields: Record<string, string | boolean>;
}

/** The same fonts that get embedded in the PDF (see fonts.ts and @font-face in styles.css). */
export const CSS_FONT: Record<Font, string> = {
  helv: "'Forma Sans', Arial, sans-serif",
  times: "'Forma Serif', 'Times New Roman', serif",
  courier: "'Forma Mono', 'Courier New', monospace",
  carlito: "'Forma Carlito', Calibri, sans-serif",
};

export const FONT_LABEL: Record<Font, string> = {
  carlito: "Calibri style",
  helv: "Arial / Helvetica",
  times: "Times",
  courier: "Courier",
};
