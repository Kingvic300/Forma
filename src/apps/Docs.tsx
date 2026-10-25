import { askText, toast } from "../lib/dialog";
import { useEffect, useRef, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Highlighter, IndentDecrease, IndentIncrease, List, ListOrdered, Minus, Redo2, RemoveFormatting, Undo2 } from "lucide-react";
import { useFile } from "../lib/useFile";
import { safeName, saveAs } from "../lib/platform";
import { Menu, Missing, TitleBar } from "../ui";

export interface DocsData {
  html: string;
}

const FONTS = ["Inter", "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS"];
const SIZES: [string, string][] = [["1", "8"], ["2", "10"], ["3", "12"], ["4", "14"], ["5", "18"], ["6", "24"], ["7", "36"]];

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);
const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the text selection when clicking toolbar buttons

export default function Docs({ id }: { id: string }) {
  const f = useFile<DocsData>(id);
  const page = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const [words, setWords] = useState(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!f.data || loaded.current || !page.current) return;
    page.current.innerHTML = f.data.html;
    loaded.current = true;
    countWords();
    exec("styleWithCSS", "true");
  }, [f.data]);

  useEffect(() => {
    const update = () => force((n) => n + 1);
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  if (f.missing) return <Missing app="docs" />;

  function countWords() {
    const text = page.current?.innerText ?? "";
    setWords(text.trim() ? text.trim().split(/\s+/).length : 0);
  }
  const changed = () => {
    if (!page.current) return;
    f.setData({ html: page.current.innerHTML });
    countWords();
  };
  const run = (cmd: string, value?: string) => {
    page.current?.focus();
    exec(cmd, value);
    changed();
  };
  const state = (cmd: string) => {
    try { return document.queryCommandState(cmd); } catch { return false; }
  };
  const block = (() => {
    try { return String(document.queryCommandValue("formatBlock")).toLowerCase() || "p"; } catch { return "p"; }
  })();

  const name = safeName(f.meta?.name ?? "Untitled");
  const html = () => page.current?.innerHTML ?? "";
  const docHtml = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>body{font-family:Inter,Arial,sans-serif;line-height:1.5;max-width:780px;margin:40px auto;padding:0 24px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px}img{max-width:100%}</style></head><body>${body}</body></html>`;

  function printPdf() {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const d = frame.contentDocument!;
    d.open();
    d.write(docHtml(html()).replace("margin:40px auto", "margin:0 auto"));
    d.close();
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  }

  function insertImage(file: File) {
    const r = new FileReader();
    r.onload = () => run("insertImage", String(r.result));
    r.readAsDataURL(file);
  }

  // Dialogs move focus away from the page, so remember the caret and put it back afterwards.
  function keepSelection() {
    const sel = getSelection();
    const range = sel && sel.rangeCount && page.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    return () => {
      page.current?.focus();
      if (range) {
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      }
    };
  }

  async function insertLink() {
    const restore = keepSelection();
    const url = await askText("Insert link", { label: "Web address", value: "https://", confirmLabel: "Insert" });
    restore();
    if (url) run("createLink", url.trim());
  }

  async function insertTable() {
    const restore = keepSelection();
    const spec = await askText("Insert table", { label: "Columns × rows, for example 3x4", value: "3x3", confirmLabel: "Insert" });
    restore();
    const m = spec && /^(\d+)\s*[x×]\s*(\d+)$/i.exec(spec.trim());
    if (!m) return void (spec && toast("Use the form 3x4 (columns × rows)", "error"));
    const [cols, rows] = [Math.min(+m[1], 20), Math.min(+m[2], 100)];
    const row = `<tr>${"<td><br></td>".repeat(cols)}</tr>`;
    run("insertHTML", `<table class="doc-table"><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
  }

  async function findReplace() {
    const find = await askText("Find and replace", { label: "Find", confirmLabel: "Next" });
    if (!find || !page.current) return;
    const repl = await askText(`Replace “${find}” with`, { label: "Replace with", confirmLabel: "Replace all" });
    if (repl === null) return;
    const walker = document.createTreeWalker(page.current, NodeFilter.SHOW_TEXT);
    let n = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node.nodeValue ?? "";
      if (t.includes(find)) {
        n += t.split(find).length - 1;
        node.nodeValue = t.split(find).join(repl);
      }
    }
    changed();
    toast(n ? `Replaced ${n} match${n === 1 ? "" : "es"}` : `No matches for “${find}”`, n ? "success" : "info");
  }

  const B = ({ cmd, label, title, value }: { cmd: string; label: React.ReactNode; title: string; value?: string }) => (
    <button className={state(cmd) ? "on" : ""} title={title} onMouseDown={keep} onClick={() => run(cmd, value)}>
      {label}
    </button>
  );

  return (
    <div className="app-page docs">
      {f.meta && (
        <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="docs">
          <button onClick={findReplace}>Find & replace</button>
          <Menu label="Export">
            <button onClick={printPdf}>Print / Save as PDF</button>
            <button onClick={() => saveAs(`${name}.doc`, docHtml(html()))}>Word document (.doc)</button>
            <button onClick={() => saveAs(`${name}.html`, docHtml(html()))}>Web page (.html)</button>
            <button onClick={() => saveAs(`${name}.txt`, page.current?.innerText ?? "")}>Plain text (.txt)</button>
          </Menu>
        </TitleBar>
      )}
      <div className="toolbar" onMouseDown={(e) => (e.target as HTMLElement).tagName === "BUTTON" && e.preventDefault()}>
        <B cmd="undo" label={<Undo2 />} title="Undo (Ctrl+Z)" />
        <B cmd="redo" label={<Redo2 />} title="Redo (Ctrl+Y)" />
        <span className="sep" />
        <select value={["h1", "h2", "h3", "blockquote", "pre"].includes(block) ? block : "p"} onChange={(e) => run("formatBlock", e.target.value)}>
          <option value="p">Normal text</option>
          <option value="h1">Title</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code</option>
        </select>
        <select defaultValue="" onChange={(e) => { run("fontName", e.target.value); e.target.value = ""; }}>
          <option value="" disabled>Font</option>
          {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select defaultValue="" onChange={(e) => { run("fontSize", e.target.value); e.target.value = ""; }}>
          <option value="" disabled>Size</option>
          {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="sep" />
        <B cmd="bold" label={<b>B</b>} title="Bold (Ctrl+B)" />
        <B cmd="italic" label={<i>I</i>} title="Italic (Ctrl+I)" />
        <B cmd="underline" label={<u>U</u>} title="Underline (Ctrl+U)" />
        <B cmd="strikeThrough" label={<s>S</s>} title="Strikethrough" />
        <label className="color" title="Text color"><Baseline size={15} /><input type="color" onChange={(e) => run("foreColor", e.target.value)} /></label>
        <label className="color hl" title="Highlight"><Highlighter size={15} /><input type="color" defaultValue="#fff59d" onChange={(e) => run("hiliteColor", e.target.value)} /></label>
        <span className="sep" />
        <B cmd="justifyLeft" label={<AlignLeft />} title="Align left" />
        <B cmd="justifyCenter" label={<AlignCenter />} title="Center" />
        <B cmd="justifyRight" label={<AlignRight />} title="Align right" />
        <B cmd="justifyFull" label={<AlignJustify />} title="Justify" />
        <span className="sep" />
        <B cmd="insertUnorderedList" label={<List />} title="Bulleted list" />
        <B cmd="insertOrderedList" label={<ListOrdered />} title="Numbered list" />
        <B cmd="outdent" label={<IndentDecrease />} title="Decrease indent" />
        <B cmd="indent" label={<IndentIncrease />} title="Increase indent" />
        <span className="sep" />
        <button title="Insert link" onMouseDown={keep} onClick={insertLink}>Link</button>
        <button title="Insert image" onMouseDown={keep} onClick={() => imgRef.current?.click()}>Image</button>
        <button title="Insert table" onMouseDown={keep} onClick={insertTable}>Table</button>
        <B cmd="insertHorizontalRule" label={<Minus />} title="Horizontal line" />
        <B cmd="removeFormat" label={<RemoveFormatting />} title="Clear formatting" />
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) insertImage(file); e.target.value = ""; }} />
      </div>
      <div className="doc-scroll">
        <div ref={page} className="doc-page" contentEditable suppressContentEditableWarning spellCheck onInput={changed} />
      </div>
      <div className="docbar">{words} {words === 1 ? "word" : "words"}</div>
    </div>
  );
}
