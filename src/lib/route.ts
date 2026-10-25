import { useEffect, useState } from "react";

export type AppId = "drive" | "docs" | "sheets" | "forms" | "pdf" | "tracker";

export const APPS: { id: AppId; name: string; blurb: string }[] = [
  { id: "drive", name: "Files", blurb: "Everything you’ve made or opened" },
  { id: "docs", name: "Docs", blurb: "Documents and letters" },
  { id: "sheets", name: "Sheets", blurb: "Spreadsheets, CSV and Excel" },
  { id: "forms", name: "Forms", blurb: "Questions and responses" },
  { id: "pdf", name: "PDF", blurb: "Fill, sign and edit PDFs" },
  { id: "tracker", name: "Tracker", blurb: "Tasks, habits and notes" },
];

// Last route visited in each app, so switching apps returns to the open file (like Gmail's switcher).
const last: Partial<Record<AppId, string>> = {};

function parse(hash: string) {
  const [, app = "drive", id, mode] = hash.replace(/^#/, "").split("/");
  const valid = APPS.some((a) => a.id === app);
  return { app: (valid ? app : "drive") as AppId, id: valid ? id : undefined, mode };
}

export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  const r = parse(hash);
  last[r.app] = hash.replace(/^#/, "") || "/drive";
  return r;
}

export const go = (path: string) => {
  location.hash = path;
};

export const switchTo = (app: AppId, current: AppId) => go(app === current ? `/${app}` : last[app] ?? `/${app}`);
