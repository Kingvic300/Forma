import { useState } from "react";
import { FolderOpen, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { askConfirm, askText, toast } from "./lib/dialog";
import { blank } from "./lib/importers";
import { APPS, go, type AppId } from "./lib/route";
import { createFile, deleteFile, saveMeta, useFiles, type Kind, type Meta } from "./lib/store";
import { AppIcon, Menu, timeAgo } from "./ui";

const NEW: Record<Kind, { label: string; name: string }> = {
  docs: { label: "New document", name: "Untitled document" },
  sheets: { label: "New spreadsheet", name: "Untitled spreadsheet" },
  forms: { label: "New form", name: "Untitled form" },
  tracker: { label: "New tracker", name: "My tracker" },
  pdf: { label: "Open a PDF", name: "" },
};
const KIND_NAME: Record<Kind, string> = { docs: "Document", sheets: "Spreadsheet", forms: "Form", pdf: "PDF", tracker: "Tracker" };
const EMPTY: Record<AppId, [string, string]> = {
  drive: ["Nothing here yet", "Create a document, spreadsheet or tracker, or open a file from your computer. PDF, CSV, Excel and Word files all work."],
  docs: ["No documents yet", "Start a blank document, or open a Word, HTML, text or Markdown file to keep editing it here."],
  sheets: ["No spreadsheets yet", "Start a blank spreadsheet, or open a CSV or Excel file. Formulas like =SUM(A1:A9) work as you’d expect."],
  forms: ["No forms yet", "Build a form, fill it in on this computer, and see the responses as charts or in a spreadsheet."],
  pdf: ["No PDFs yet", "Open a PDF to add text, fill its fields, sign it, or merge and reorder pages."],
  tracker: ["No trackers yet", "Keep a list of tasks, tick off daily habits, and write a short note about each day."],
};

export default function Home({ app, onOpenFile, onDropFiles }: { app: AppId; onOpenFile: () => void; onDropFiles: (files: File[]) => void }) {
  const kind = app === "drive" ? undefined : (app as Kind);
  const files = useFiles(kind);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const info = APPS.find((a) => a.id === app)!;

  async function create(k: Kind) {
    if (k === "pdf") return onOpenFile();
    go(`/${k}/${await createFile(k, NEW[k].name, blank(k))}`);
  }
  async function rename(f: Meta) {
    const n = await askText("Rename file", { value: f.name, confirmLabel: "Rename" });
    if (n?.trim()) await saveMeta({ ...f, name: n.trim() });
  }
  async function remove(f: Meta) {
    if (!(await askConfirm(`Delete “${f.name || "Untitled"}”?`, { body: "It’s removed from Forma for good. Files you opened from your computer are not affected.", danger: true, confirmLabel: "Delete" }))) return;
    await deleteFile(f.id);
    toast("File deleted");
  }

  const shown = (files ?? []).filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));
  const creatable: Kind[] = kind ? (kind === "pdf" ? [] : [kind]) : ["docs", "sheets", "tracker"];

  return (
    <div
      className="home"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onDropFiles(Array.from(e.dataTransfer.files)); }}
    >
      <header className="page-head">
        <h1>{info.name}</h1>
        {!!files?.length && <span className="count">{files.length}</span>}
        <span className="grow" />
        {!!files?.length && (
          <input className="filter" type="search" placeholder="Filter by name" aria-label="Filter files by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        <button onClick={onOpenFile}>
          <Upload /> {kind === "pdf" ? "Open a PDF" : "Open file"}
        </button>
        {creatable.length === 1 && (
          <button className="primary" onClick={() => create(creatable[0])}>
            <Plus /> {NEW[creatable[0]].label}
          </button>
        )}
        {creatable.length > 1 && (
          <Menu label={<><Plus /> New</>}>
            {creatable.map((k) => (
              <button key={k} role="menuitem" onClick={() => create(k)}>
                <AppIcon app={k} size={18} /> {NEW[k].label}
              </button>
            ))}
          </Menu>
        )}
      </header>

      {files === null ? (
        <div className="table" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="row skeleton">
              <span className="sk sk-icon" />
              <span className="sk" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
              <span className="grow" />
              <span className="sk" style={{ width: 80 }} />
            </div>
          ))}
        </div>
      ) : !files.length ? (
        <div className="empty-state">
          <AppIcon app={app} size={44} />
          <h2>{EMPTY[app][0]}</h2>
          <p>{EMPTY[app][1]}</p>
          {creatable.length > 1 ? (
            <div className="start-list">
              {creatable.map((k) => (
                <button key={k} onClick={() => create(k)}>
                  <AppIcon app={k} size={22} />
                  <span>{NEW[k].label}</span>
                  <Plus className="sl-go" />
                </button>
              ))}
              <button onClick={onOpenFile}>
                <span className="sl-open"><FolderOpen /></span>
                <span>Open from computer</span>
                <span className="key">Ctrl O</span>
              </button>
            </div>
          ) : (
            <div className="row-actions">
              {creatable.map((k) => (
                <button key={k} className="primary" onClick={() => create(k)}>
                  <Plus /> {NEW[k].label}
                </button>
              ))}
              <button onClick={onOpenFile} className={kind === "pdf" ? "primary" : ""}>
                <FolderOpen /> {kind === "pdf" ? "Open a PDF" : "Open from computer"}
              </button>
            </div>
          )}
          <p className="hint">You can also drop files anywhere in this window.</p>
        </div>
      ) : (
        <div className="table" role="table" aria-label={`${info.name} files`}>
          <div className="row thead" role="row">
            <span role="columnheader" className="c-name">Name</span>
            {app === "drive" && <span role="columnheader" className="c-kind">Type</span>}
            <span role="columnheader" className="c-when">Edited</span>
            <span className="c-act" />
          </div>
          {shown.map((f) => (
            <div key={f.id} className="row" role="row">
              <button className="c-name open" role="cell" onClick={() => go(`/${f.kind}/${f.id}`)}>
                <AppIcon app={f.kind} size={22} />
                <span className="fname">{f.name || "Untitled"}</span>
              </button>
              {app === "drive" && <span role="cell" className="c-kind">{KIND_NAME[f.kind]}</span>}
              <span role="cell" className="c-when">{timeAgo(f.updated)}</span>
              <span role="cell" className="c-act">
                <button className="icon" title="Rename" aria-label={`Rename ${f.name}`} onClick={() => rename(f)}><Pencil /></button>
                <button className="icon" title="Delete" aria-label={`Delete ${f.name}`} onClick={() => remove(f)}><Trash2 /></button>
              </span>
            </div>
          ))}
          {!shown.length && <div className="row muted none">No files match “{query}”.</div>}
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload />
            <strong>Drop to open in Forma</strong>
            <span>PDF, CSV, Excel, Word, HTML, text and form files</span>
          </div>
        </div>
      )}
    </div>
  );
}
