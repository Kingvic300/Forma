export type AnnType = "text" | "image" | "highlight" | "whiteout" | "rect" | "check" | "cross" | "line";
export type Font = "helv" | "times" | "courier";

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
}

export interface PdfData {
  bytes: Uint8Array;
  anns: Ann[];
  fields: Record<string, string | boolean>;
}

export const CSS_FONT: Record<Font, string> = {
  helv: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
};
