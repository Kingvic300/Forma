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

/** Close a popover on outside click or Escape. */
export function useDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const t = setTimeout(() => addEventListener("mousedown", click));
    addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      removeEventListener("mousedown", click);
      removeEventListener("keydown", esc);
    };
  }, [open, setOpen]);
  return ref;
}

/** Gmail-style app switcher: every app in a grid, opened from the box at the top of the sidebar. */
export function AppSwitcher({ current, open, setOpen, onPick }: { current: AppId; open: boolean; setOpen: (v: boolean) => void; onPick: (a: AppId) => void }) {
  const ref = useDismiss(open, setOpen);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="switcher pop" ref={ref} role="menu" aria-label="Apps">
      {APPS.map((a, i) => (
        <button
          key={a.id}
          ref={a.id === current ? first : undefined}
          role="menuitem"
          className={a.id === current ? "on" : ""}
          onClick={() => {
            onPick(a.id);
            setOpen(false);
          }}
        >
          <AppIcon app={a.id} size={36} />
          <span className="sw-name">{a.name}</span>
          <span className="sw-blurb">{a.blurb}</span>
          <span className="key">Ctrl {i + 1}</span>
        </button>
      ))}
    </div>
  );
}

export function Menu({ label, children, align = "right" }: { label: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  return (
    <div className="menu" ref={ref}>
      <button aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {label} <ChevronDown className="chev" />
      </button>
      {open && (
        <div className={"menu-pop pop " + align} role="menu" onClick={() => setOpen(false)} onMouseDown={(e) => e.preventDefault()}>
          {children}
        </div>
      )}
    </div>
  );
}

/** The header of every open file: App / file name, save state, and the app's actions. */
export function TitleBar({ meta, onRename, saved, app, children }: { meta: Meta; onRename: (n: string) => void; saved: boolean; app: AppId; children?: ReactNode }) {
  const name = APPS.find((a) => a.id === app)!.name;
  return (
    <div className="titlebar">
      <button className="crumb" title={`All ${name.toLowerCase()} files`} onClick={() => go(`/${app}`)}>
        <AppIcon app={app} size={20} />
        {name}
      </button>
      <span className="slash">/</span>
      <input className="title" value={meta.name} aria-label="File name" onChange={(e) => onRename(e.target.value)} spellCheck={false} size={Math.max(8, meta.name.length + 1)} />
      <span className={"saved" + (saved ? "" : " busy")}>
        {saved ? <Check /> : <Loader2 className="spin" />}
        {saved ? "Saved" : "Saving"}
      </span>
      <span className="grow" />
      {children}
    </div>
  );
}

export function Missing({ app }: { app: AppId }) {
  return (
    <div className="empty-state">
      <h2>This file is gone</h2>
      <p>It was deleted, or it was never saved on this computer.</p>
      <button className="primary" onClick={() => go(`/${app}`)}>Back to {APPS.find((a) => a.id === app)!.name}</button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <Loader2 className="spin" aria-label="Loading" />;
}

export const timeAgo = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
