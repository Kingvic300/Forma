// The spreadsheet file format. Everything beyond `name` and `cells` is optional, so files saved by
// older versions of Forma still open unchanged.

export interface Borders {
  t?: Border;
  r?: Border;
  b?: Border;
  l?: Border;
}
export interface Border {
  color: string;
  /** "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" */
  style: string;
}

export interface CellFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  size?: number;
  color?: string;
  bg?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** Number format code, Excel style: "0.00", "#,##0", "$#,##0.00", "0%", "yyyy-mm-dd", "@"… */
  num?: string;
  border?: Borders;
  indent?: number;
  rotate?: number;
}

export interface Merge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** A conditional formatting rule applied to a range. */
export interface CondRule {
  id: string;
  range: string;
  type:
    | "gt" | "lt" | "between" | "eq" | "ne"
    | "contains" | "notContains" | "begins" | "ends" | "blank" | "notBlank"
    | "duplicate" | "unique" | "top" | "bottom" | "aboveAvg" | "belowAvg"
    | "formula" | "scale2" | "scale3" | "bar";
  /** Values or a formula, depending on the type. */
  a?: string;
  b?: string;
  /** For top/bottom: count, or percent when `percent`. */
  percent?: boolean;
  style?: { bg?: string; color?: string; bold?: boolean };
  /** Colour scale colours, low → (mid) → high; data bar colour. */
  colors?: string[];
  stop?: boolean;
}

export interface Validation {
  id: string;
  range: string;
  type: "list" | "whole" | "decimal" | "date" | "length" | "formula";
  /** For list: comma-separated values or a range such as $A$1:$A$9. */
  list?: string;
  op?: "between" | "notBetween" | "eq" | "ne" | "gt" | "lt" | "ge" | "le";
  min?: string;
  max?: string;
  /** Reject invalid entries (otherwise only warn). */
  strict?: boolean;
  message?: string;
}

export interface SheetChart {
  id: string;
  /** Data range, e.g. "A1:C8"; first row and column are labels. */
  range: string;
  kind: "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";
  stacked?: boolean;
  percent?: boolean;
  title?: string;
  legend?: boolean;
  labels?: boolean;
  /** Position and size in px, relative to the grid's top-left cell. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sheet {
  name: string;
  cells: string[][];
  /** Formats keyed "row,col" (0-based). */
  fmt?: Record<string, CellFmt>;
  /** Column widths and row heights in px, by index. */
  colW?: Record<number, number>;
  rowH?: Record<number, number>;
  hiddenRows?: number[];
  hiddenCols?: number[];
  /** Rows and columns kept on screen while scrolling. */
  freeze?: { r: number; c: number };
  merges?: Merge[];
  cond?: CondRule[];
  valid?: Validation[];
  charts?: SheetChart[];
  /** Notes keyed "row,col". */
  notes?: Record<string, string>;
  tabColor?: string;
  hidden?: boolean;
  showGrid?: boolean;
}

export interface SheetsData {
  sheets: Sheet[];
  /** Named ranges: NAME → "Sheet1!$A$1:$B$9". */
  names?: Record<string, string>;
}

export const key = (r: number, c: number) => `${r},${c}`;
