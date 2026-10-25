import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Download, FolderOpen, Search, Settings, X } from "lucide-react";
import Home from "./Home";
import { CommandPalette } from "./CommandPalette";
import { DialogHost, errorText, toast } from "./lib/dialog";
import { ACCEPT, importFile } from "./lib/importers";
import { isTauri, onFilesOpened, takeLaunchFiles, toggleFullscreen } from "./lib/platform";
import { APPS, go, NAV_APPS, switchTo, useRoute, type AppId } from "./lib/route";
import { getOnlineConfig, type OnlineConfig } from "./lib/online";
import { getSetting, setSetting, useFiles, type Meta } from "./lib/store";
import { OnlineSetup } from "./OnlineSetup";
import { AppIcon, AppSwitcher, CLOSE_FILE, Logo, Modal, Spinner } from "./ui";
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
        tabs.close(id);
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
          <Suspense fallback={<div className="loading"><Spinner /></div>}>
            {!id ? (
              <Home app={app} onOpenFile={() => fileInput.current?.click()} onDropFiles={openFiles} />
            ) : app === "docs" ? (
              <Docs key={id} id={id} />
            ) : app === "sheets" ? (
              <Sheets key={id} id={id} />
            ) : app === "forms" ? (
              <Forms key={id} id={id} />
            ) : app === "pdf" ? (
              <Pdf key={id} id={id} />
            ) : app === "tracker" ? (
              <Tracker key={id} id={id} />
            ) : (
              <Home app={app} onOpenFile={() => fileInput.current?.click()} onDropFiles={openFiles} />
            )}
          </Suspense>
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
      <UpdateBanner updater={updater} />
      {about && <About onClose={() => setAbout(false)} updater={updater} />}
      <DialogHost />
    </div>
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
  return { open, close };
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
          <div className="muted small">Download new versions in the background, then ask before restarting.</div>
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
            {s.kind === "ready" && `Version ${s.version} is downloaded.`}
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
