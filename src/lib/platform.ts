// Bridges browser APIs to native ones when running inside the Tauri shell.
import { toast } from "./dialog";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  html: "text/html",
  txt: "text/plain",
  json: "application/json",
};

/** Save bytes to disk: a native "Save as" dialog on desktop, a download in a browser. */
export async function saveAs(filename: string, content: Uint8Array | string): Promise<boolean> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const ext = filename.split(".").pop()!.toLowerCase();
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeFile(path, bytes);
    toast(`Saved ${path.split(/[\\/]/).pop()}`, "success");
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Downloaded ${filename}`, "success");
  return true;
}

export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Untitled";

/** Open a web page or email address in the user's default app. Callers check the scheme. */
export async function openExternal(href: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else window.open(href, "_blank", "noopener,noreferrer");
}

/** Files passed on the command line or via "Open with Forma" from the OS. */
export async function takeLaunchFiles(): Promise<File[]> {
  if (!isTauri) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const list = await invoke<{ name: string; bytes: number[] }[]>("take_opened_files");
  return list.map((f) => new File([new Uint8Array(f.bytes)], f.name));
}

export async function onFilesOpened(cb: () => void) {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("files-opened", cb);
}
