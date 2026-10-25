/**
 * Background updates: check GitHub Releases quietly, download the signed update in the
 * background, then offer a one-click restart. Updates are verified against the public key
 * built into the app, so only releases signed with the project's private key can install.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { isTauri } from "./lib/platform";
import { getSetting } from "./lib/store";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000; // GitHub can be unreachable on patchy connections

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "ready"; version: string; notes?: string }
  | { kind: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const busy = useRef(false);
  const pending = useRef<{ install: () => Promise<void> } | null>(null);

  // Set when someone clicks "Check for updates" while a background check is still running,
  // so the result of that check is shown to them instead of nothing.
  const report = useRef(false);

  /** Returns false when the check couldn't complete, so the caller can retry sooner. */
  const check = useCallback(async (manual = false) => {
    if (!isTauri || pending.current) return true;
    if (busy.current) {
      if (manual) {
        report.current = true;
        setState((s) => (s.kind === "downloading" ? s : { kind: "checking" }));
      }
      return true;
    }
    busy.current = true;
    report.current = manual;
    if (manual) setState({ kind: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      // Time limits: on a patchy connection a request can hang forever instead of failing.
      const update = await check({ timeout: 30_000 });
      if (!update) {
        if (report.current) setState({ kind: "latest" });
        return true;
      }
      let total = 0;
      let done = 0;
      setState({ kind: "downloading", version: update.version, progress: null });
      await update.download(
        (e) => {
          if (e.event === "Started") total = e.data.contentLength ?? 0;
          if (e.event === "Progress") {
            done += e.data.chunkLength;
            setState({ kind: "downloading", version: update.version, progress: total ? Math.round((100 * done) / total) : null });
          }
        },
        { timeout: 15 * 60_000 },
      );
      pending.current = update;
      setState({ kind: "ready", version: update.version, notes: update.body });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState(report.current ? { kind: "error", message: /timed? ?out|connect|dns|network/i.test(message) ? "Couldn’t reach GitHub. Check your internet connection and try again." : message } : { kind: "idle" });
      return false;
    } finally {
      busy.current = false;
      report.current = false;
    }
  }, []);

  const restart = useCallback(async () => {
    if (!pending.current) return;
    await pending.current.install();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let timer: number | undefined;
    const run = async () => {
      if ((await getSetting<boolean>("autoUpdate")) === false) return;
      const ok = await check();
      timer = window.setTimeout(run, ok ? CHECK_EVERY_MS : RETRY_AFTER_FAILURE_MS);
    };
    timer = window.setTimeout(run, 15_000); // let the app settle first
    return () => clearTimeout(timer);
  }, [check]);

  return { state, setState, check, restart };
}

/** Banner shown once an update has been downloaded. */
export function UpdateBanner({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const { state, setState, restart } = updater;
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  if (state.kind !== "ready" || dismissed) return null;
  return (
    <div role="status" className="update-banner">
      <Download />
      <span>
        Forma {state.version} is ready. <span className="muted">Restart to finish updating.</span>
      </span>
      <button
        className="primary"
        disabled={installing}
        onClick={async () => {
          setInstalling(true);
          try {
            await restart();
          } catch (e) {
            setInstalling(false);
            setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
          }
        }}
      >
        <RefreshCw /> {installing ? "Installing…" : "Restart now"}
      </button>
      <button className="icon" aria-label="Later" onClick={() => setDismissed(true)}><X /></button>
    </div>
  );
}
