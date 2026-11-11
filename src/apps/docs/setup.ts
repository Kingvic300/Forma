/** File › Page setup. Sizes and margins in inches. */
export interface PageSetup {
  paper: keyof typeof PAPER;
  orientation: "portrait" | "landscape";
  margins: { top: number; bottom: number; left: number; right: number };
  color: string;
  columns: number;
  pageless: boolean;
}

export const PAPER = {
  letter: { label: "Letter (8.5\" × 11\")", w: 8.5, h: 11 },
  a4: { label: "A4 (8.27\" × 11.69\")", w: 8.27, h: 11.69 },
  legal: { label: "Legal (8.5\" × 14\")", w: 8.5, h: 14 },
  a5: { label: "A5 (5.83\" × 8.27\")", w: 5.83, h: 8.27 },
  tabloid: { label: "Tabloid (11\" × 17\")", w: 11, h: 17 },
};

export const DEFAULT_SETUP: PageSetup = { paper: "letter", orientation: "portrait", margins: { top: 1, bottom: 1, left: 1, right: 1 }, color: "#ffffff", columns: 1, pageless: false };

export const pageSize = (s: PageSetup) => {
  const p = PAPER[s.paper];
  return s.orientation === "landscape" ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
};
