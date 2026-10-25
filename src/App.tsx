import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Download, FolderOpen, Search, Settings } from "lucide-react";
import Home from "./Home";
import { CommandPalette } from "./CommandPalette";
import { DialogHost, errorText, toast } from "./lib/dialog";
import { ACCEPT, importFile } from "./lib/importers";
import { isTauri, onFilesOpened, takeLaunchFiles } from "./lib/platform";
import { APPS, go, switchTo, useRoute, type AppId } from "./lib/route";
import { getSetting, setSetting, useFiles } from "./lib/store";
import { AppIcon, AppSwitcher, Logo, Modal, Spinner } from "./ui";
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
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && /^[1-6]$/.test(k)) {
        e.preventDefault();
        switchTo(APPS[Number(k) - 1].id, app);
      } else if (k === "k" || (e.shiftKey && k === "p")) {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        fileInput.current?.click();
      } else if (k === ",") {
        e.preventDefault();
        setAbout(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [app]);

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
          {APPS.map((a, i) => (
            <button key={a.id} className={"sb-item" + (a.id === app ? " on" : "")} aria-current={a.id === app ? "page" : undefined} onClick={() => switchTo(a.id, app)}>
              <AppIcon app={a.id} size={20} />
              <span className="sb-label">{a.name}</span>
              <span className="sb-key">{i + 1}</span>
            </button>
          ))}
        </nav>
        <Recent current={id} />
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
          <span title="The only network request is the update check against GitHub Releases.">Offline</span>
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

function Recent({ current }: { current?: string }) {
  const files = useFiles();
  if (!files?.length) return null;
  return (
    <div className="sb-recent">
      <div className="sb-heading">Recent</div>
      {files.slice(0, 8).map((f) => (
        <button key={f.id} className={"sb-file" + (f.id === current ? " on" : "")} onClick={() => go(`/${f.kind}/${f.id}`)} title={f.name}>
          <AppIcon app={f.kind as AppId} size={16} />
          <span>{f.name || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}

function About({ onClose, updater }: { onClose: () => void; updater: ReturnType<typeof useUpdater> }) {
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    getSetting<boolean>("autoUpdate").then((v) => setAuto(v !== false));
  }, []);
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
