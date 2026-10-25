import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleCheckBig, FileSignature, FileText, Folder, ListChecks, Loader2, Sheet, X } from "lucide-react";
import { APPS, go, type AppId } from "./lib/route";
import type { Meta } from "./lib/store";

/** Forma mark: a geometric F with a cyan full stop, on a charcoal tile. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ width: size, height: size, flex: "none" }} role="img" aria-label="Forma">
      <rect width="64" height="64" rx="14" fill="#1C2333" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" fill="none" stroke="#2E3850" strokeWidth="1.5" />
      <path d="M19 14h24v8H27v8h13v8H27v12h-8z" fill="#E7ECF5" />
      <rect x="38" y="42" width="8" height="8" rx="1.5" fill="#3CC8DC" />
    </svg>
  );
}

/** One quiet identity color per app, used for its icon only. */
export const APP_COLOR: Record<AppId, string> = {
  drive: "#8d97ab",
  docs: "#7c9dff",
  sheets: "#4fbf8b",
  forms: "#b195f5",
  pdf: "#f07a80",
  tracker: "#e2b25b",
};

const APP_GLYPH: Record<AppId, typeof FileText> = {
  drive: Folder,
  docs: FileText,
  sheets: Sheet,
  forms: ListChecks,
  pdf: FileSignature,
  tracker: CircleCheckBig,
};

export function AppIcon({ app, size = 24 }: { app: AppId; size?: number }) {
  const Glyph = APP_GLYPH[app] ?? Folder;
  return (
    <span className="app-icon" style={{ width: size, height: size, "--ac": APP_COLOR[app] } as React.CSSProperties} aria-hidden>
      <Glyph style={{ width: Math.round(size * 0.58), height: Math.round(size * 0.58) }} strokeWidth={1.9} />
    </span>
  );
}
