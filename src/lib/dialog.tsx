// In-app replacements for window.prompt / confirm / alert. Native browser dialogs look
// foreign in a desktop app and aren't reliable in every OS webview.
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type Ask =
  | { kind: "text"; title: string; label?: string; value: string; confirmLabel: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; body?: string; danger: boolean; confirmLabel: string; resolve: (v: boolean) => void };

type Toast = { id: number; tone: "info" | "success" | "error"; text: string };

let pushAsk: ((a: Ask) => void) | null = null;
let pushToast: ((t: Toast) => void) | null = null;
let toastId = 0;

/** Ask for a line of text. Resolves to null when cancelled. */
export function askText(title: string, opts: { label?: string; value?: string; confirmLabel?: string } = {}) {
  return new Promise<string | null>((resolve) =>
    pushAsk?.({ kind: "text", title, label: opts.label, value: opts.value ?? "", confirmLabel: opts.confirmLabel ?? "Save", resolve }),
  );
}

/** Ask a yes/no question. Destructive actions pass danger: true. */
export function askConfirm(title: string, opts: { body?: string; danger?: boolean; confirmLabel?: string } = {}) {
  return new Promise<boolean>((resolve) =>
    pushAsk?.({ kind: "confirm", title, body: opts.body, danger: !!opts.danger, confirmLabel: opts.confirmLabel ?? "Confirm", resolve }),
  );
}

export function toast(text: string, tone: Toast["tone"] = "info") {
  pushToast?.({ id: ++toastId, tone, text });
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function DialogHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    pushAsk = (a) => {
      setAsk(a);
      if (a.kind === "text") setText(a.value);
    };
    pushToast = (t) => {
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.tone === "error" ? 7000 : 3500);
    };
    return () => {
      pushAsk = null;
      pushToast = null;
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    requestAnimationFrame(() => {
      if (ask.kind === "text") {
        input.current?.focus();
        input.current?.select();
      } else confirmBtn.current?.focus();
    });
  }, [ask]);

  function close(ok: boolean) {
    if (!ask) return;
    if (ask.kind === "text") ask.resolve(ok ? text : null);
    else ask.resolve(ok);
    setAsk(null);
  }

  return (
    <>
      {ask && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close(false)} onKeyDown={(e) => e.key === "Escape" && close(false)}>
          <form
            className="modal dialog"
            role="dialog"
            aria-modal="true"
            aria-label={ask.title}
            onSubmit={(e) => {
              e.preventDefault();
              if (ask.kind === "text" && !text.trim()) return;
              close(true);
            }}
          >
            <h2>{ask.title}</h2>
            {ask.kind === "confirm" && ask.body && <p className="muted">{ask.body}</p>}
            {ask.kind === "text" && (
              <label className="field">
                {ask.label && <span>{ask.label}</span>}
                <input ref={input} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            <div className="modal-foot">
              <span className="grow" />
              <button type="button" onClick={() => close(false)}>Cancel</button>
              <button ref={confirmBtn} type="submit" className={ask.kind === "confirm" && ask.danger ? "danger" : "primary"} disabled={ask.kind === "text" && !text.trim()}>
                {ask.confirmLabel}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.tone}>
            {t.tone === "error" ? <AlertCircle /> : t.tone === "success" ? <CheckCircle2 /> : <Info />}
            <span>{t.text}</span>
            <button className="icon" aria-label="Dismiss" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}><X /></button>
          </div>
        ))}
      </div>
    </>
  );
}
