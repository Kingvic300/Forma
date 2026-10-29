export type AnnType = "text" | "image" | "highlight" | "whiteout" | "redact" | "rect" | "check" | "cross" | "line";
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
}

/** The two ends of a line annotation, in page points. */
export function lineEnds(a: Ann): [number, number, number, number] {
  return a.x2 !== undefined && a.y2 !== undefined ? [a.x, a.y, a.x2, a.y2] : [a.x, a.y + a.h / 2, a.x + a.w, a.y + a.h / 2];
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
