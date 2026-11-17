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

export type ChartKind =
  | "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "bubble" | "radar"
  | "histogram" | "pareto" | "box" | "waterfall" | "funnel" | "treemap" | "combo";
export type Trendline = "linear" | "exp" | "log" | "power" | "poly2" | "poly3" | "movingAvg";

export interface SheetChart {
  id: string;
  /** Data range, e.g. "A1:C8"; first row and column are labels. */
  range: string;
  kind: ChartKind;
  stacked?: boolean;
  percent?: boolean;
  title?: string;
  /** Legend shown (old files); `legendPos` says where. */
  legend?: boolean;
  legendPos?: "b" | "t" | "r" | "l";
  labels?: boolean;
  /** Series run along rows instead of down columns. */
  byRow?: boolean;
  xTitle?: string;
  yTitle?: string;
  y2Title?: string;
  /** Horizontal gridlines (default on). */
  gridlines?: boolean;
  /** Line and area: smooth curves; markers on points. */
  smooth?: boolean;
  markers?: boolean;
  /** Value axis bounds and log scale. */
  min?: number;
  max?: number;
  log?: boolean;
  trendline?: Trendline;
  /** Polynomial order or moving-average period. */
  trendOrder?: number;
  trendEquation?: boolean;
  trendR2?: boolean;
  errorBars?: { type: "fixed" | "percent" | "stdev" | "stderr"; value: number };
  /** Colour palette name (see PALETTES). */
  palette?: string;
  /** Combo charts: how each series is drawn, and which go on the secondary axis. */
  seriesKinds?: Record<number, "column" | "line" | "area">;
  secondary?: number[];
  /** Histogram: number of bins (automatic when unset). */
  bins?: number;
  /** Position and size in px, relative to the grid's top-left cell. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tiny chart drawn inside one cell, from a row or column of numbers. */
export interface Sparkline {
  range: string;
  kind: "line" | "column" | "winloss";
  color?: string;
  /** Mark the highest and lowest points. */
  highLow?: boolean;
}

/** An Excel table: a named range with a header row, optional total row and a style. */
export interface SheetTable {
  /** Name used in formulas: =SUM(Sales[Amount]). */
  name: string;
  /** Whole table, header and total rows included (0-based, inclusive). */
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** Excel style name, e.g. "TableStyleMedium2"; "" for no style. */
  style?: string;
  /** False when the table has no header row. */
  header?: boolean;
  /** The last row is a total row. */
  totals?: boolean;
  /** Banded rows default on; the rest default off. */
  bandRows?: boolean;
  bandCols?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  /** Filter buttons in the header row (default on). */
  filter?: boolean;
}

export type PivotFn = "sum" | "count" | "countNums" | "average" | "min" | "max" | "distinct" | "product" | "stdev" | "var";
export type PivotShow = "none" | "pctTotal" | "pctRow" | "pctCol" | "running";
export type PivotGroup = "year" | "quarter" | "month" | "day" | number;

/** A pivot table: its definition, and where its output is written on the sheet that holds it. */
export interface Pivot {
  id: string;
  name: string;
  /** A table name, or a range such as "Sheet1!$A$1:$D$40" whose first row names the fields. */
  source: string;
  /** Top-left cell of the output. */
  r: number;
  c: number;
  rows: string[];
  cols: string[];
  values: { field: string; fn: PivotFn; show?: PivotShow }[];
  filters: { field: string; hidden: string[] }[];
  /** Dates grouped by period, numbers into bins of this size. */
  group?: Record<string, PivotGroup>;
  /** Subtotal rows for outer row fields (default on). */
  subtotals?: boolean;
  grandRows?: boolean;
  grandCols?: boolean;
  sort?: "asc" | "desc" | "valueDesc" | "valueAsc";
  /** Size of the output last written, so a refresh can clear it. */
  size?: { rows: number; cols: number };
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
  tables?: SheetTable[];
  pivots?: Pivot[];
  /** Sparklines keyed "row,col". */
  sparklines?: Record<string, Sparkline>;
}

export interface SheetsData {
  sheets: Sheet[];
  /** Named ranges: NAME → "Sheet1!$A$1:$B$9". */
  names?: Record<string, string>;
}

export const key = (r: number, c: number) => `${r},${c}`;
