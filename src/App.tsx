import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Download, FolderOpen, Search, Settings, X } from "lucide-react";
import Home from "./Home";
import { CommandPalette } from "./CommandPalette";
import { DialogHost, errorText, toast } from "./lib/dialog";
import { ACCEPT, blank, blankPdf, importFile } from "./lib/importers";
import { isTauri, onFilesOpened, takeLaunchFiles, toggleFullscreen } from "./lib/platform";
import { APPS, go, NAV_APPS, switchTo, useRoute, type AppId } from "./lib/route";
import { getOnlineConfig, type OnlineConfig } from "./lib/online";
import { createFile, getSetting, setSetting, useFiles, type Meta } from "./lib/store";
import { OnlineSetup } from "./OnlineSetup";
import { AppIcon, AppSwitcher, CLOSE_FILE, closeOpenFile, Logo, Modal, PaneContext, Spinner, timeAgo } from "./ui";
import { UpdateBanner, useUpdater } from "./Updater";
import { FormView } from "./apps/forms/FormFill";
import pkg from "../package.json";

const Docs = lazy(() => import("./apps/Docs"));
const Sheets = lazy(() => import("./apps/sheets/Sheets"));
const Forms = lazy(() => import("./apps/forms/Forms"));
const Pdf = lazy(() => import("./apps/pdf/Pdf"));
const Tracker = lazy(() => import("./apps/Tracker"));

export default function App() {
  const { app, id, mode } = useRoute();
  const [switcher, setSwitcher] = useState(false);
  const [palette, setPalette] = useState(false);
  const [about, setAbout] = useState(false);
  const updater = useUpdater();
  const fileInput = useRef<HTMLInputElement>(null);
  const info = APPS.find((a) => a.id === app)!;
  const tabs = useOpenFiles(id, app);
  const split = useSplit(id, tabs.all);

  const openFiles = useCallback(async (list: File[]) => {
    let last: { kind: string; id: string } | null = null;
    for (const file of list) {
      try {
        last = await importFile(file);
      } catch (e) {
        toast(`Couldn’t open ${file.name}: ${errorText(e)}`, "error");
      }
    }
    if (last) go(`/${last.kind}/${last.id}`);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        return void toggleFullscreen();
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && new RegExp(`^[1-${NAV_APPS.length}]$`).test(k)) {
        e.preventDefault();
        switchTo(NAV_APPS[Number(k) - 1].id, app);
      } else if (k === "k" || (e.shiftKey && k === "p")) {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        fileInput.current?.click();
      } else if (k === ",") {
        e.preventDefault();
        setAbout(true);
      } else if (k === "w" && !e.shiftKey && id) {
        e.preventDefault();
        if (split.meta && split.active === "side") split.close();
        else tabs.close(id);
      } else if (e.key === "\\" && id) {
        e.preventDefault();
        split.toggle();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const close = () => id && tabs.close(id);
    addEventListener(CLOSE_FILE, close);
    return () => removeEventListener(CLOSE_FILE, close);
  });

  // Files opened from the OS ("Open with Forma", double-click, command line).
  useEffect(() => {
    const openLaunched = async () => openFiles(await takeLaunchFiles());
    openLaunched();
    const off = onFilesOpened(openLaunched);
    return () => {
      off.then((f) => f());
    };
  }, [openFiles]);

  useEffect(() => {
    document.title = `${info.name} — Forma`;
  }, [info.name]);

  if (app === "forms" && id && mode === "fill")
    return (
      <div className="standalone">
        <FormView id={id} />
        <DialogHost />
      </div>
    );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sb-top">
          <button className="app-box" onClick={() => setSwitcher(!switcher)} aria-haspopup="menu" aria-expanded={switcher} title="Switch app">
            <Logo size={28} />
            <span className="ab-text">
              <span className="ab-name">{info.name}</span>
              <span className="ab-sub">Forma</span>
            </span>
            <ChevronsUpDown className="ab-chev" />
          </button>
          <AppSwitcher current={app} open={switcher} setOpen={setSwitcher} onPick={(a) => switchTo(a, app)} />
        </div>
        <button className="sb-search" onClick={() => setPalette(true)}>
          <Search />
          <span>Search</span>
          <span className="key">Ctrl K</span>
        </button>
        <nav className="sb-nav" aria-label="Apps">
          {NAV_APPS.map((a, i) => (
            <button key={a.id} className={"sb-item" + (a.id === app ? " on" : "")} aria-current={a.id === app ? "page" : undefined} onClick={() => switchTo(a.id, app)}>
              <AppIcon app={a.id} size={20} />
              <span className="sb-label">{a.name}</span>
              <span className="sb-key">{i + 1}</span>
            </button>
          ))}
        </nav>
        <OpenFiles files={tabs.open} current={id} onClose={tabs.close} />
        <div className="sb-foot">
          <button className="sb-item" onClick={() => fileInput.current?.click()}>
            <FolderOpen />
            <span className="sb-label">Open from computer</span>
            <span className="sb-key">O</span>
          </button>
          <button className="sb-item" onClick={() => setAbout(true)}>
            <Settings />
            <span className="sb-label">Settings</span>
            {updater.state.kind === "ready" && <span className="sb-dot" title="Update ready" />}
          </button>
        </div>
      </aside>
      <div className="content">
        <main>
          {!id || app === "drive" ? (
            <Suspense fallback={<div className="loading"><Spinner /></div>}>
              <Home app={app} onOpenFile={() => fileInput.current?.click()} onDropFiles={openFiles} />
            </Suspense>
          ) : (
            <div className={"split" + (split.meta ? " on" : "")}>
              <PaneContext.Provider value={{ side: false, split: !!split.meta, active: !split.meta || split.active === "main", close: closeOpenFile, toggleSplit: split.toggle }}>
                <div
                  className={"pane" + (split.meta && split.active === "main" ? " active" : "")}
                  style={split.meta ? { flexBasis: `${split.ratio * 100}%` } : undefined}
                  onPointerDownCapture={() => split.setActive("main")}
                  onFocusCapture={() => split.setActive("main")}
                >
                  <Suspense fallback={<div className="loading"><Spinner /></div>}>
                    <Editor app={app} id={id} />
                  </Suspense>
                </div>
              </PaneContext.Provider>
              {split.meta && (
                <>
                  <Divider ratio={split.ratio} setRatio={split.setRatio} />
                  <PaneContext.Provider value={{ side: true, split: true, active: split.active === "side", close: split.close }}>
                    <div className="pane side" onPointerDownCapture={() => split.setActive("side")} onFocusCapture={() => split.setActive("side")}>
                      <Suspense fallback={<div className="loading"><Spinner /></div>}>
                        <Editor app={split.meta.kind} id={split.meta.id} />
                      </Suspense>
                    </div>
                  </PaneContext.Provider>
                </>
              )}
            </div>
          )}
        </main>
        <footer className="statusbar-app">
          <span>Saved on this computer</span>
          {updater.state.kind === "downloading" && (
            <span className="sb-progress">
              <Download /> Downloading Forma {updater.state.version}
              {updater.state.progress !== null && <span className="bar-mini"><span style={{ width: `${updater.state.progress}%` }} /></span>}
            </span>
          )}
          <span className="grow" />
          <span title="Forma only goes online to check for updates, and for forms you share as a link.">Offline</span>
          <span>v{pkg.version}</span>
        </footer>
      </div>
      <input ref={fileInput} type="file" multiple hidden accept={ACCEPT.all} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; openFiles(list); }} />
      <CommandPalette
        open={palette}
        setOpen={setPalette}
        current={app}
        onOpenFile={() => fileInput.current?.click()}
        onSettings={() => setAbout(true)}
        onCheckUpdates={isTauri ? () => { setAbout(true); updater.check(true); } : undefined}
      />
      {split.picking && id && <SidePicker current={id} files={tabs.all} onPick={split.open} onClose={() => split.setPicking(false)} />}
      <UpdateBanner updater={updater} />
      {about && <About onClose={() => setAbout(false)} updater={updater} />}
      <DialogHost />
    </div>
  );
}

function Editor({ app, id }: { app: AppId; id: string }) {
  switch (app) {
    case "docs":
      return <Docs key={id} id={id} />;
    case "sheets":
      return <Sheets key={id} id={id} />;
    case "forms":
      return <Forms key={id} id={id} />;
    case "pdf":
      return <Pdf key={id} id={id} />;
    case "tracker":
      return <Tracker key={id} id={id} />;
    default:
      return null;
  }
}

const SIDE_KEY = "forma:side-file";
const RATIO_KEY = "forma:side-ratio";

const remember = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the split then lasts until the window closes.
  }
};
const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** The side-by-side view: a second file open next to the main one, each with its own editor. */
function useSplit(current: string | undefined, files: Meta[] | null) {
  const [side, setSide] = useState<string | null>(() => recall(SIDE_KEY));
  const [ratio, setRatio] = useState(() => Number(recall(RATIO_KEY)) || 0.5);
  const [active, setActive] = useState<"main" | "side">("main");
  const [picking, setPicking] = useState(false);
  const meta = side && current && side !== current ? files?.find((f) => f.id === side) : undefined;
  // A new file reaches the list a moment after it is made, so only a file seen before can be "deleted".
  const seen = useRef<string | null>(null);
  if (side && files?.some((f) => f.id === side)) seen.current = side;

  useEffect(() => remember(SIDE_KEY, side), [side]);
  useEffect(() => remember(RATIO_KEY, String(ratio)), [ratio]);
  // The side file was deleted, or opened in the main pane: one editor per file.
  useEffect(() => {
    if (side && (side === current || (files && seen.current === side && !files.some((f) => f.id === side)))) setSide(null);
  }, [side, current, files]);

  const close = () => {
    setSide(null);
    setActive("main");
  };
  const open = (fid: string) => {
    setSide(fid);
    setActive("side");
    setPicking(false);
  };
  const toggle = () => (meta ? close() : setPicking(true));
  return { meta, ratio, setRatio, active, setActive, picking, setPicking, open, close, toggle };
}

function Divider({ ratio, setRatio }: { ratio: number; setRatio: (r: number) => void }) {
  const clamp = (r: number) => Math.min(0.8, Math.max(0.2, r));
  function drag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setRatio(clamp((ev.clientX - box.left) / box.width));
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }
  return (
    <div
      className="split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the two sides"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      title="Drag to resize. Double-click to make both sides equal."
      onPointerDown={drag}
      onDoubleClick={() => setRatio(0.5)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setRatio(clamp(ratio + (e.key === "ArrowLeft" ? -0.05 : 0.05)));
        }
      }}
    />
  );
}

/** Choose what opens next to the current file: a new blank PDF or document, or any saved file. */
function SidePicker({ current, files, onPick, onClose }: { current: string; files: Meta[] | null; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = (files ?? []).filter((f) => f.id !== current && f.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30);

  async function start(make: () => Promise<string>) {
    setBusy(true);
    try {
      onPick(await make());
    } catch (e) {
      toast(errorText(e), "error");
      setBusy(false);
    }
  }
  return (
    <Modal title="Open side by side" onClose={onClose} wide>
      <p className="muted small">Work on two files at once, for example edit one PDF while you write a new one.</p>
      <div className="side-new">
        <button disabled={busy} onClick={() => start(() => blankPdf())}>
          <AppIcon app="pdf" size={22} /> New blank PDF
        </button>
        <button disabled={busy} onClick={() => start(() => createFile("docs", "Untitled document", blank("docs")))}>
          <AppIcon app="docs" size={22} /> New document
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          <FolderOpen /> Open from computer…
        </button>
      </div>
      {!!files?.some((f) => f.id !== current) && (
        <>
          <input type="search" placeholder="Or find a file you already have" aria-label="Find a file" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="side-files">
            {shown.map((f) => (
              <button key={f.id} disabled={busy} onClick={() => onPick(f.id)}>
                <AppIcon app={f.kind} size={18} />
                <span className="fname">{f.name || "Untitled"}</span>
                <span className="muted small">{timeAgo(f.updated)}</span>
              </button>
            ))}
            {!shown.length && <p className="muted small">No files match “{query}”.</p>}
          </div>
        </>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT.all}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) start(async () => (await importFile(file)).id);
        }}
      />
    </Modal>
  );
}

const OPEN_KEY = "forma:open-files";

/** Files opened in this window, like editor tabs. Remembered per computer; closing never deletes. */
function useOpenFiles(current: string | undefined, app: AppId) {
  const files = useFiles();
  const [ids, setIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const byId = new Map((files ?? []).map((f) => [f.id, f]));

  useEffect(() => {
    if (current) setIds((l) => (l.includes(current) ? l : [...l, current]));
  }, [current]);
  // Forget files that were deleted.
  useEffect(() => {
    if (files) setIds((l) => (l.every((i) => byId.has(i)) ? l : l.filter((i) => byId.has(i))));
  }, [files]);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(ids));
    } catch {
      // Storage can be unavailable; the list then lasts until the window closes.
    }
  }, [ids]);

  const open = ids.map((i) => byId.get(i)).filter((f): f is Meta => !!f);
  const close = (fid: string) => {
    const at = open.findIndex((f) => f.id === fid);
    const rest = open.filter((f) => f.id !== fid);
    setIds(rest.map((f) => f.id));
    if (fid === current) {
      const next = rest[Math.min(at, rest.length - 1)];
      go(next ? `/${next.kind}/${next.id}` : `/${app}`);
    }
  };
  return { open, close, all: files };
}

function OpenFiles({ files, current, onClose }: { files: Meta[]; current?: string; onClose: (id: string) => void }) {
  return (
    <div className="sb-recent">
      <div className="sb-heading">Open</div>
      {!files.length && <p className="sb-empty">Files you open appear here.</p>}
      {files.map((f) => (
        <div key={f.id} className={"sb-file" + (f.id === current ? " on" : "")}>
          <button className="sb-file-open" onClick={() => go(`/${f.kind}/${f.id}`)} title={f.name}>
            <AppIcon app={f.kind as AppId} size={16} />
            <span>{f.name || "Untitled"}</span>
          </button>
          <button className="sb-close" title={f.id === current ? "Close (Ctrl+W)" : "Close"} aria-label={`Close ${f.name || "Untitled"}`} onClick={() => onClose(f.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

function About({ onClose, updater }: { onClose: () => void; updater: ReturnType<typeof useUpdater> }) {
  const [auto, setAuto] = useState(true);
  const [online, setOnline] = useState<OnlineConfig | null>(null);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    getSetting<boolean>("autoUpdate").then((v) => setAuto(v !== false));
  }, []);
  useEffect(() => {
    if (!setup) getOnlineConfig().then((c) => setOnline(c ?? null));
  }, [setup]);
  if (setup) return <OnlineSetup onClose={() => setSetup(false)} />;
  const s = updater.state;
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="about">
        <Logo size={40} />
        <div>
          <div className="about-name">Forma {pkg.version}</div>
          <div className="muted">Docs, Sheets, Forms, PDF and Tracker. Your files never leave this computer.</div>
        </div>
      </div>
      <section className="setting">
        <div>
          <div className="setting-title">Automatic updates</div>
          <div className="muted small">Download new versions in the background, then restart to install them.</div>
        </div>
        <label className="switch">
          <input type="checkbox" role="switch" checked={auto} disabled={!isTauri} onChange={(e) => { setAuto(e.target.checked); setSetting("autoUpdate", e.target.checked); }} />
          <span />
        </label>
      </section>
      <section className="setting">
        <div>
          <div className="setting-title">Online forms</div>
          <div className="muted small">{online ? `Connected to ${new URL(online.url).hostname}` : "Share forms as a link anyone can fill in. Off until you set it up."}</div>
        </div>
        <button onClick={() => setSetup(true)}>{online ? "Change" : "Set up"}</button>
      </section>
      {isTauri ? (
        <div className="modal-foot">
          <span className="muted small" role="status">
            {s.kind === "checking" && "Checking for updates…"}
            {s.kind === "latest" && "You’re on the latest version."}
            {s.kind === "downloading" && `Downloading ${s.version}${s.progress !== null ? `, ${s.progress}%` : ""}…`}
            {s.kind === "ready" && `Version ${s.version} is downloaded. Restarting…`}
            {s.kind === "error" && `Update failed: ${s.message}`}
          </span>
          <span className="grow" />
          {s.kind === "ready" ? (
            <button className="primary" onClick={() => updater.restart()}>Restart to update</button>
          ) : (
            <button disabled={s.kind === "checking" || s.kind === "downloading"} onClick={() => updater.check(true)}>
              {s.kind === "checking" ? <Spinner /> : <Download />} Check for updates
            </button>
          )}
        </div>
      ) : (
        <p className="muted small">Updates work in the installed desktop app.</p>
      )}
    </Modal>
  );
}
