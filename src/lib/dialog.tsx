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
