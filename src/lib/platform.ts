// Bridges browser APIs to native ones when running inside the Tauri shell.
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
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Untitled";
