import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, Download, FilePlus2, FolderOpen, Search, Settings } from "lucide-react";
import { blank } from "./lib/importers";
import { APPS, go, switchTo, type AppId } from "./lib/route";
import { createFile, useFiles, type Kind } from "./lib/store";
import { AppIcon, timeAgo } from "./ui";

type Item = { id: string; group: string; title: string; hint?: string; icon: React.ReactNode; run: () => void; keys?: string };

const NEW: [Kind, string, string][] = [
  ["docs", "New document", "Untitled document"],
  ["sheets", "New spreadsheet", "Untitled spreadsheet"],
  ["forms", "New form", "Untitled form"],
  ["tracker", "New tracker", "My tracker"],
];

/** Ctrl+K: open any file, create a file, jump to an app or run a command. */
export function CommandPalette({ open, setOpen, current, onOpenFile, onSettings, onCheckUpdates }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  current: AppId;
  onOpenFile: () => void;
  onSettings: () => void;
  onCheckUpdates?: () => void;
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const match = (s: string) => !t || s.toLowerCase().includes(t);
    const out: Item[] = [];
    (files ?? [])
      .filter((f) => match(f.name))
      .slice(0, t ? 8 : 5)
      .forEach((f) =>
        out.push({ id: f.id, group: t ? "Files" : "Recent files", title: f.name || "Untitled", hint: timeAgo(f.updated), icon: <AppIcon app={f.kind} size={22} />, run: () => go(`/${f.kind}/${f.id}`) }),
      );
    NEW.filter(([, label]) => match(label)).forEach(([kind, label, name]) =>
      out.push({ id: "new-" + kind, group: "Create", title: label, icon: <FilePlus2 />, run: async () => go(`/${kind}/${await createFile(kind, name, blank(kind))}`) }),
    );
    if (match("Open a file from your computer pdf csv excel word")) out.push({ id: "open", group: "Create", title: "Open a file from your computer…", hint: "PDF, CSV, Excel, Word", icon: <FolderOpen />, run: onOpenFile });
    APPS.filter((a) => match(a.name) || match("go to " + a.name)).forEach((a) =>
      out.push({ id: "go-" + a.id, group: "Go to", title: a.name, hint: a.blurb, icon: <AppIcon app={a.id} size={22} />, keys: `Ctrl ${APPS.indexOf(a) + 1}`, run: () => switchTo(a.id, current) }),
    );
    if (match("Settings preferences")) out.push({ id: "settings", group: "Forma", title: "Settings", icon: <Settings />, keys: "Ctrl ,", run: onSettings });
    if (onCheckUpdates && match("Check for updates")) out.push({ id: "update", group: "Forma", title: "Check for updates", icon: <Download />, run: onCheckUpdates });
    return out;
  }, [q, files, current, onOpenFile, onSettings, onCheckUpdates]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const run = (it: Item) => {
    setOpen(false);
    it.run();
  };

  let lastGroup = "";
  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Search />
          <input
            ref={input}
            value={q}
            placeholder="Search files, apps and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[cursor] ? `pi-${cursor}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === "Enter" && items[cursor]) { e.preventDefault(); run(items[cursor]); }
            }}
          />
          <span className="key">Esc</span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {!items.length && <p className="palette-empty">No files or commands match “{q}”.</p>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  id={`pi-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === cursor}
                  className={"palette-item" + (i === cursor ? " cur" : "")}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => run(it)}
                >
                  <span className="pi-icon">{it.icon}</span>
                  <span className="pi-title">{it.title}</span>
                  {it.hint && <span className="pi-hint">{it.hint}</span>}
                  {it.keys && <span className="key">{it.keys}</span>}
                  {i === cursor && !it.keys && <ArrowRight className="pi-go" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><span className="key">↑</span><span className="key">↓</span> to move</span>
          <span><span className="key"><CornerDownLeft /></span> to open</span>
        </div>
      </div>
    </div>
  );
}
