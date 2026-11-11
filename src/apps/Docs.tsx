import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, CheckSquare, ExternalLink, Highlighter, ImageIcon, IndentDecrease, IndentIncrease, Italic, Link2,
  List, ListOrdered, MessageSquarePlus, Minus, PaintRoller, Plus, Printer, Redo2, RemoveFormatting, Sparkles, SpellCheck, Strikethrough, Underline, Undo2, Unlink,
} from "lucide-react";
import { askText, errorText, toast } from "../lib/dialog";
import { getGroqKey } from "../lib/groq";
import { isSafeHref, linkifyElement, openLink } from "../lib/links";
import { useFile } from "../lib/useFile";
import { safeName, saveAs, toggleFullscreen } from "../lib/platform";
import { go } from "../lib/route";
import { createFile, uid } from "../lib/store";
import { Missing, TitleBar } from "../ui";
import * as ai from "./docs/ai";
import { caretElement, cellAt, changeCase, cleanHtml, counts, exec, htmlForAi, rangeIn, restoreCaret, saveCaret, selectedBlocks, selectRange, setFontSize, sizeAt, tableOp, type TableOp } from "./docs/editor";
import { toDocx, toMarkdown } from "./docs/exporters";
import { ContextMenu, flatten, MenuBar, ToolMenu, type MenuEntry, type MenuItem } from "./docs/menus";
import { AiPanel, CommentsPanel, FindBar, PageSetupModal, Shortcuts, SpecialChars, TableGrid, TableProps, WordCount, type DocComment } from "./docs/panels";
import { DEFAULT_SETUP, pageSize, type PageSetup } from "./docs/setup";

export interface DocsData {
  html: string;
  comments?: DocComment[];
  setup?: PageSetup;
}

const FONTS = ["Arial", "Calibri", "Cambria", "Comic Sans MS", "Courier New", "Garamond", "Georgia", "Impact", "Inter", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
const SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96];
const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
/** Paragraph styles: Title is h1 and Heading 1–4 are h2–h5, which keeps documents made before these styles existed looking the same. */
const STYLES: { key: string; label: string; tag: string; cls?: string; keys?: string }[] = [
  { key: "p", label: "Normal text", tag: "p", keys: "Ctrl+Alt+0" },
  { key: "title", label: "Title", tag: "h1" },
  { key: "subtitle", label: "Subtitle", tag: "p", cls: "subtitle" },
  { key: "h1", label: "Heading 1", tag: "h2", keys: "Ctrl+Alt+1" },
  { key: "h2", label: "Heading 2", tag: "h3", keys: "Ctrl+Alt+2" },
  { key: "h3", label: "Heading 3", tag: "h4", keys: "Ctrl+Alt+3" },
  { key: "h4", label: "Heading 4", tag: "h5", keys: "Ctrl+Alt+4" },
  { key: "quote", label: "Quote", tag: "blockquote" },
  { key: "code", label: "Code", tag: "pre" },
];
const SPACING: [string, string][] = [["Single", "1.15"], ["1.15", "1.3"], ["1.5", "1.75"], ["Double", "2.3"]];
const COMMENT_MARK = "rgb(254, 1, 2)"; // a colour nobody picks, used to find text just marked for a comment

const keep = (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest("input,select,textarea")) e.preventDefault();
};

type Snap = { html: string; caret: [number, number] | null };
type Paint = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; bg: string; font: string; size: number; sticky: boolean };
type ModalKind = "count" | "setup" | "chars" | "keys" | "table" | null;

export default function Docs({ id }: { id: string }) {
  const f = useFile<DocsData>(id);
  const page = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const replaceImg = useRef<HTMLImageElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const hist = useRef({ past: [] as Snap[], future: [] as Snap[], cur: null as Snap | null, at: 0 });
  const [words, setWords] = useState(0);
  const [linkCard, setLinkCard] = useState<{ a: HTMLAnchorElement; top: number; left: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [spell, setSpell] = useState(true);
  const [viewing, setViewing] = useState(false);
  const [showCount, setShowCount] = useState(true);
  const [panel, setPanel] = useState<"ai" | "comments" | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [find, setFind] = useState<{ text: string; replace: boolean; n: number } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; target: HTMLElement } | null>(null);
  const [paint, setPaint] = useState<Paint | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [activeCmt, setActiveCmt] = useState<string | null>(null);
  const [aiSeed, setAiSeed] = useState<{ text: string; n: number } | null>(null);
  const [aiBusy, setAiBusy] = useState("");
  const [search, setSearch] = useState("");
  const [, force] = useState(0);

  const setup = f.data?.setup ?? DEFAULT_SETUP;
  const comments = f.data?.comments ?? [];

  useEffect(() => {
    if (!f.data || loaded.current || !page.current) return;
    page.current.innerHTML = f.data.html;
    loaded.current = true;
    hist.current.cur = { html: page.current.innerHTML, caret: null };
    countWords();
    exec("styleWithCSS", "true");
    exec("defaultParagraphSeparator", "p");
  }, [f.data]);

  useEffect(() => {
    const update = () => {
      const r = rangeIn(page.current);
      if (r) lastRange.current = r.cloneRange();
      force((n) => n + 1);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  // Shortcuts that work anywhere in the window, not only while typing in the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "f" && !e.shiftKey) { e.preventDefault(); openFind(false); }
      else if (k === "h") { e.preventDefault(); openFind(true); }
      else if (k === "p") { e.preventDefault(); printDoc(); }
      else if (k === "/") { e.preventDefault(); setModal("keys"); }
      else if (e.shiftKey && k === "c") { e.preventDefault(); setModal("count"); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // Paint format: Esc puts the brush down.
  useEffect(() => {
    if (!paint) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPaint(null);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [paint]);

  const cmtOrder = useMemo(() => {
    const ids: string[] = [];
    page.current?.querySelectorAll<HTMLElement>("[data-cid]").forEach((e) => !ids.includes(e.dataset.cid!) && ids.push(e.dataset.cid!));
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, panel, words]);

  if (f.missing) return <Missing app="docs" />;

  const root = () => page.current!;
  function countWords() {
    setWords(counts(page.current?.innerText ?? "").words);
  }

  /* ---------- Changes and undo ---------- */

  /** Save the page and record an undo step. Typing (group) joins quick keystrokes into one step. */
  const changed = (group = false) => {
    if (!page.current) return;
    const html = page.current.innerHTML;
    f.setData((d) => ({ ...d, html }));
    countWords();
    const h = hist.current;
    const now = Date.now();
    const next = { html, caret: saveCaret(page.current) };
    if (h.cur && h.cur.html === html) return;
    if (h.cur && !(group && now - h.at < 800)) {
      h.past.push(h.cur);
      if (h.past.length > 150) h.past.shift();
    }
    h.cur = next;
    h.at = group ? now : 0;
    h.future = [];
  };
  const restore = (s: Snap) => {
    root().innerHTML = s.html;
    root().focus();
    restoreCaret(root(), s.caret);
    f.setData((d) => ({ ...d, html: s.html }));
    countWords();
    setLinkCard(null);
  };
  const undo = () => {
    const h = hist.current;
    if (!h.past.length || !h.cur) return;
    h.future.push(h.cur);
    h.cur = h.past.pop()!;
    h.at = 0;
    restore(h.cur);
  };
  const redo = () => {
    const h = hist.current;
    if (!h.future.length || !h.cur) return;
    h.past.push(h.cur);
    h.cur = h.future.pop()!;
    h.at = 0;
    restore(h.cur);
  };

  const focusPage = () => {
    const p = root();
    if (document.activeElement !== p) {
      p.focus();
      if (lastRange.current) selectRange(lastRange.current);
    }
  };
  const run = (cmd: string, value?: string) => {
    focusPage();
    exec(cmd, value);
    changed();
  };
  const state = (cmd: string) => {
    try { return document.queryCommandState(cmd); } catch { return false; }
  };

  /* ---------- What the caret is in ---------- */

  const el = page.current ? caretElement(page.current) : null;
  const block = el?.closest("p,h1,h2,h3,h4,h5,h6,blockquote,pre");
  const styleKey = !block ? "p" : block.tagName === "P" ? (block.classList.contains("subtitle") ? "subtitle" : "p") : STYLES.find((s) => s.tag === block.tagName.toLowerCase())?.key ?? "p";
  const curSize = page.current && el ? sizeAt(page.current) : 11;
  const curFont = el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim() : "";
  const inTable = page.current ? cellAt(page.current) : null;
  const curLink = el?.closest("a");
  const sel = getSelection();
  const hasSel = !!lastRange.current && !lastRange.current.collapsed;
  const listAt = el?.closest("ul,ol");
  const align = state("justifyCenter") ? "center" : state("justifyRight") ? "right" : state("justifyFull") ? "justify" : "left";

  /* ---------- Formatting ---------- */

  function setStyle(key: string) {
    const s = STYLES.find((x) => x.key === key)!;
    focusPage();
    exec("formatBlock", s.tag);
    for (const b of selectedBlocks(root())) {
      if (s.cls) b.classList.add(s.cls);
      else b.classList.remove("subtitle");
      if (!b.classList.length) b.removeAttribute("class");
    }
    changed();
  }
  function fontSize(pt: number) {
    focusPage();
    setFontSize(root(), Math.max(1, Math.min(400, pt)));
    changed();
  }
  const bump = (dir: 1 | -1) => {
    const now = sizeAt(root());
    const next = dir > 0 ? SIZES.find((s) => s > now) ?? now + 12 : [...SIZES].reverse().find((s) => s < now) ?? Math.max(1, now - 1);
    fontSize(next);
  };
  function blockStyle(fn: (b: HTMLElement) => void) {
    focusPage();
    selectedBlocks(root()).forEach(fn);
    changed();
  }
  const lineSpacing = (v: string) => blockStyle((b) => (b.style.lineHeight = v));
  function toggleChecklist() {
    focusPage();
    const list = caretElement(root())?.closest("ul");
    if (list?.classList.contains("checklist")) exec("insertUnorderedList");
    else {
      if (!list) exec("insertUnorderedList");
      caretElement(root())?.closest("ul")?.classList.add("checklist");
    }
    changed();
  }
  function listStyle(kind: "ul" | "ol", type: string) {
    focusPage();
    let list = caretElement(root())?.closest("ul,ol");
    if (!list || list.tagName.toLowerCase() !== kind) {
      exec(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
      list = caretElement(root())?.closest("ul,ol");
    }
    if (list) {
      list.classList.remove("checklist");
      (list as HTMLElement).style.listStyleType = type;
    }
    changed();
  }
  function caseTo(mode: "lower" | "upper" | "title") {
    focusPage();
    if (changeCase(root(), mode)) changed();
  }
  function pickPaint(sticky: boolean) {
    if (paint) return setPaint(null);
    const e = caretElement(root());
    if (!e) return toast("Click in text whose formatting you want to copy", "info");
    const cs = getComputedStyle(e);
    let underline = false;
    let strike = false;
    let bg = "";
    for (let x: HTMLElement | null = e; x && x !== root(); x = x.parentElement) {
      const d = getComputedStyle(x).textDecorationLine;
      underline ||= d.includes("underline");
      strike ||= d.includes("line-through");
      const b = getComputedStyle(x).backgroundColor;
      if (!bg && b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") bg = b;
    }
    setPaint({ bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic", underline, strike, color: cs.color, bg, font: cs.fontFamily, size: sizeAt(root()), sticky });
  }
  function applyPaint(p: Paint) {
    const r = rangeIn(root());
    if (!r || r.collapsed) return;
    exec("removeFormat");
    for (const [on, cmd] of [[p.bold, "bold"], [p.italic, "italic"], [p.underline, "underline"], [p.strike, "strikeThrough"]] as const) if (on !== state(cmd)) exec(cmd);
    exec("foreColor", p.color);
    if (p.bg) exec("hiliteColor", p.bg);
    exec("fontName", p.font);
    setFontSize(root(), p.size);
    changed();
    if (!p.sticky) setPaint(null);
  }

  /* ---------- Insert ---------- */

  // Dialogs move focus away from the page, so remember the caret and put it back afterwards.
  function keepSelection() {
    const range = lastRange.current?.cloneRange() ?? null;
    return () => {
      root().focus();
      if (range) selectRange(range);
    };
  }
  async function insertLink() {
    const restoreSel = keepSelection();
    const url = await askText(curLink ? "Edit link" : "Insert link", { label: "Web address", value: curLink?.getAttribute("href") ?? "https://", confirmLabel: curLink ? "Apply" : "Insert" });
    restoreSel();
    if (!url?.trim()) return;
    if (curLink) {
      curLink.setAttribute("href", url.trim());
      return changed();
    }
    if (rangeIn(root())?.collapsed) run("insertHTML", `<a href="${url.trim().replace(/"/g, "&quot;")}">${url.trim().replace(/</g, "&lt;")}</a>`);
    else run("createLink", url.trim());
  }
  function insertTable(rows: number, cols: number) {
    const row = `<tr>${"<td><br></td>".repeat(cols)}</tr>`;
    focusPage();
    exec("insertHTML", `<table class="doc-table" data-new="1"><tbody>${row.repeat(rows)}</tbody></table><p><br></p>`);
    // Start typing in the first cell, as in Google Docs.
    const t = root().querySelector<HTMLTableElement>("table[data-new]");
    if (t) {
      t.removeAttribute("data-new");
      const r = document.createRange();
      r.selectNodeContents(t.rows[0].cells[0]);
      r.collapse(true);
      selectRange(r);
    }
    changed();
  }
  function insertImageFile(file: File) {
    const r = new FileReader();
    r.onload = () => {
      if (replaceImg.current) {
        replaceImg.current.src = String(r.result);
        replaceImg.current = null;
        changed();
      } else run("insertImage", String(r.result));
    };
    r.readAsDataURL(file);
  }
  async function insertImageUrl() {
    const restoreSel = keepSelection();
    const url = await askText("Insert image by URL", { label: "Image address (https://…)", value: "https://", confirmLabel: "Insert" });
    restoreSel();
    if (url && /^https?:\/\//i.test(url.trim())) run("insertImage", url.trim());
    else if (url) toast("Use a web address starting with https://", "error");
  }
  const insertDate = () => run("insertText", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
  const pageBreak = () => run("insertHTML", '<div class="page-break" contenteditable="false"></div><p><br></p>');
  function insertToc() {
    const heads = [...root().querySelectorAll<HTMLElement>("h2,h3,h4,h5")];
    if (!heads.length) return toast("Add some headings first (Format › Paragraph styles)", "info");
    heads.forEach((h) => (h.id ||= `h-${uid()}`));
    const items = heads.map((h) => `<p class="toc-l${Number(h.tagName[1]) - 1}"><a href="#${h.id}">${h.textContent?.replace(/</g, "&lt;") || "Untitled"}</a></p>`).join("");
    run("insertHTML", `<div class="toc"><p><b>Contents</b></p>${items}</div><p><br></p>`);
  }
  function addComment() {
    focusPage();
    const r = rangeIn(root());
    if (!r || r.collapsed) return toast("Select the text you want to comment on", "info");
    const quote = r.toString();
    const cid = uid();
    exec("styleWithCSS", "true");
    exec("hiliteColor", COMMENT_MARK);
    root().querySelectorAll<HTMLElement>("[style]").forEach((e) => {
      if (e.style.backgroundColor !== COMMENT_MARK) return;
      e.style.backgroundColor = "";
      e.classList.add("cmt");
      e.dataset.cid = cid;
      if (!e.getAttribute("style")) e.removeAttribute("style");
    });
    changed();
    f.setData((d) => ({ ...d, comments: [...(d.comments ?? []), { id: cid, text: "", quote, at: Date.now(), replies: [] }] }));
    setDraft(cid);
    setActiveCmt(cid);
    setPanel("comments");
  }
  function dropComment(cid: string) {
    root().querySelectorAll<HTMLElement>(`[data-cid="${cid}"]`).forEach((e) => {
      if (e.tagName === "SPAN" && !e.getAttribute("style")) e.replaceWith(...e.childNodes);
      else {
        e.classList.remove("cmt");
        delete e.dataset.cid;
        if (!e.classList.length) e.removeAttribute("class");
      }
    });
    root().normalize();
    changed();
    f.setData((d) => ({ ...d, comments: (d.comments ?? []).filter((c) => c.id !== cid) }));
    if (draft === cid) setDraft(null);
  }

  /* ---------- Clipboard ---------- */

  async function paste(plain: boolean) {
    const restoreSel = keepSelection();
    try {
      if (!plain && navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes("text/html")) {
            const html = await (await item.getType("text/html")).text();
            restoreSel();
            return run("insertHTML", cleanHtml(html));
          }
        }
      }
      const text = await navigator.clipboard.readText();
      restoreSel();
      run("insertText", text);
    } catch {
      restoreSel();
      toast(`Use ${plain ? "Ctrl+Shift+V" : "Ctrl+V"} to paste here`, "info");
    }
  }
  const clip = (cmd: "cut" | "copy") => {
    focusPage();
    if (!exec(cmd)) toast(`Use Ctrl+${cmd === "cut" ? "X" : "C"} to ${cmd}`, "info");
    else if (cmd === "cut") changed();
  };

  /* ---------- Files ---------- */

  const name = safeName(f.meta?.name ?? "Untitled");
  const html = () => page.current?.innerHTML ?? "";
  const size = pageSize(setup);
  const docHtml = (body: string, print = false) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>` +
    `@page{size:${size.w}in ${size.h}in;margin:${setup.margins.top}in ${setup.margins.right}in ${setup.margins.bottom}in ${setup.margins.left}in}` +
    `body{font:11pt/1.5 Arial,sans-serif;${print ? "margin:0" : "max-width:780px;margin:40px auto;padding:0 24px"};${setup.columns > 1 ? `column-count:${setup.columns};column-gap:.5in;` : ""}background:${setup.color}}` +
    `h1{font-size:26pt;margin:0 0 10px}h2{font-size:20pt}h3{font-size:16pt}h4{font-size:14pt}h5{font-size:12pt}.subtitle{font-size:15pt;color:#666}` +
    `table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;vertical-align:top}img{max-width:100%}blockquote{border-left:3px solid #ccc;margin:10px 0;padding:2px 16px;color:#555}` +
    `pre{background:#f0f1f3;padding:12px;white-space:pre-wrap}.page-break{break-after:page;height:0}.cmt{background:none}ul.checklist{list-style:none;padding-left:4px}ul.checklist li::before{content:"☐ "}ul.checklist li.checked::before{content:"☑ "}ul.checklist li.checked{text-decoration:line-through;color:#777}` +
    `</style></head><body>${body}</body></html>`;

  function printDoc() {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const d = frame.contentDocument!;
    d.open();
    d.write(docHtml(html(), true));
    d.close();
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      setTimeout(() => frame.remove(), 1000);
    }, 200);
  }
  async function download(kind: "docx" | "html" | "txt" | "md") {
    try {
      if (kind === "docx") {
        setAiBusy("Building Word file…");
        await saveAs(`${name}.docx`, await toDocx(root(), setup));
      } else if (kind === "html") await saveAs(`${name}.html`, docHtml(html()));
      else if (kind === "txt") await saveAs(`${name}.txt`, root().innerText);
      else await saveAs(`${name}.md`, toMarkdown(root()));
    } catch (e) {
      toast(`Couldn’t export: ${errorText(e)}`, "error");
    } finally {
      setAiBusy("");
    }
  }
  async function newDoc(copy: boolean) {
    const nid = await createFile<DocsData>("docs", copy ? `Copy of ${f.meta?.name ?? "document"}` : "Untitled document", copy ? { ...f.data!, html: html() } : { html: "<p><br></p>" });
    go(`/docs/${nid}`);
  }
  async function rename() {
    const n = await askText("Rename", { label: "Name", value: f.meta?.name ?? "", confirmLabel: "Rename" });
    if (n?.trim()) f.rename(n.trim());
  }

  /* ---------- AI (Groq) ---------- */

  async function needKey() {
    const key = await getGroqKey();
    if (!key) {
      setPanel("ai");
      toast("Add a Groq API key in the AI panel first", "info");
    }
    return key || null;
  }
  const selectionHtml = (r: Range | null) => {
    if (!r || r.collapsed) return "";
    const d = document.createElement("div");
    d.append(r.cloneContents());
    return d.innerHTML;
  };
  async function aiRewrite(instruction: string) {
    const r = lastRange.current?.cloneRange();
    if (!r || r.collapsed) return toast("Select the text you want AI to rewrite", "info");
    const key = await needKey();
    if (!key) return;
    const { html: src, images } = htmlForAi(selectionHtml(r));
    setAiBusy("AI is rewriting…");
    try {
      const out = cleanHtml(await ai.rewrite(key, src, instruction), images);
      root().focus();
      selectRange(r);
      exec("insertHTML", out);
      changed();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setAiBusy("");
    }
  }
  async function aiTranslate() {
    const lang = await askText("Translate selection", { label: "Into which language?", value: "French", confirmLabel: "Translate" });
    if (lang?.trim()) aiRewrite(`Translate it into ${lang.trim()}. Keep formatting.`);
  }
  async function aiWrite() {
    const key = await needKey();
    if (!key) return;
    const r = lastRange.current?.cloneRange() ?? null;
    const prompt = await askText("Help me write", { label: "What should AI write? e.g. “a short intro about our product launch”", confirmLabel: "Write" });
    if (!prompt?.trim()) return;
    setAiBusy("AI is writing…");
    try {
      const out = cleanHtml(await ai.write(key, prompt.trim(), root().innerText));
      root().focus();
      if (r) selectRange(r);
      exec("insertHTML", out);
      changed();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setAiBusy("");
    }
  }
  const askAi = (text: string) => {
    setPanel("ai");
    setAiSeed({ text, n: Date.now() });
  };
  async function runChat(key: string, request: string, history: { role: "user" | "assistant"; content: string }[]) {
    const r = lastRange.current?.cloneRange() ?? null;
    const doc = htmlForAi(html());
    const part = htmlForAi(selectionHtml(r));
    const out = await ai.chat(key, doc.html, part.html, history, request);
    const images = new Map([...doc.images, ...part.images]);
    // Selection tokens are numbered separately; map them back through the selection's own table.
    const clean = cleanHtml(out.html, out.action === "replace_selection" ? part.images : images);
    if (out.action !== "none" && clean.trim()) {
      root().focus();
      if (out.action === "replace_document") exec("selectAll");
      else if (r) selectRange(r);
      if (out.action === "replace_selection" && (!r || r.collapsed)) return `${out.reply} (Select text first so I know what to replace.)`;
      exec("insertHTML", clean);
      changed();
      return `${out.reply || "Done."} (Ctrl+Z undoes it)`;
    }
    return out.reply || "Done.";
  }

  /* ---------- Tables, images, links ---------- */

  function onTable(op: TableOp) {
    const c = cellAt(root()) ?? (ctx?.target.closest("td,th") as HTMLTableCellElement | null);
    if (!c) return;
    const next = tableOp(c, op);
    if (next) {
      const r = document.createRange();
      r.selectNodeContents(next);
      r.collapse(true);
      selectRange(r);
    }
    changed();
  }
  function imageOp(img: HTMLImageElement, op: string) {
    if (op === "delete") img.remove();
    else if (op.endsWith("%")) {
      img.style.width = op;
      img.style.height = "auto";
    } else if (op === "inline") img.style.cssText = img.style.width ? `width:${img.style.width}` : "";
    else if (op === "left" || op === "right") Object.assign(img.style, { float: op, display: "", margin: op === "left" ? "4px 14px 8px 0" : "4px 0 8px 14px" });
    else if (op === "center") Object.assign(img.style, { float: "none", display: "block", margin: "8px auto" });
    changed();
  }
  async function altText(img: HTMLImageElement) {
    const t = await askText("Alt text", { label: "Describe the image for screen readers", value: img.alt, confirmLabel: "Save" });
    if (t !== null) {
      img.alt = t.trim();
      changed();
    }
  }
  function removeLink(a: HTMLAnchorElement) {
    a.replaceWith(...Array.from(a.childNodes));
    setLinkCard(null);
    changed();
  }
  function openFind(replace: boolean) {
    const r = lastRange.current;
    setFind({ text: r && !r.collapsed ? r.toString().slice(0, 100) : find?.text ?? "", replace, n: Date.now() });
  }

  /* ---------- Menus ---------- */

  const can = !viewing;
  const textItems: MenuEntry[] = [
    { label: "Bold", keys: "Ctrl+B", checked: state("bold"), run: () => run("bold") },
    { label: "Italic", keys: "Ctrl+I", checked: state("italic"), run: () => run("italic") },
    { label: "Underline", keys: "Ctrl+U", checked: state("underline"), run: () => run("underline") },
    { label: "Strikethrough", keys: "Alt+Shift+5", checked: state("strikeThrough"), run: () => run("strikeThrough") },
    { label: "Superscript", keys: "Ctrl+.", checked: state("superscript"), run: () => run("superscript") },
    { label: "Subscript", keys: "Ctrl+,", checked: state("subscript"), run: () => run("subscript") },
    "-",
    { label: "Size", sub: [{ label: "Increase font size", keys: "Ctrl+Shift+>", run: () => bump(1) }, { label: "Decrease font size", keys: "Ctrl+Shift+<", run: () => bump(-1) }] },
    { label: "Capitalization", sub: [{ label: "lowercase", run: () => caseTo("lower") }, { label: "UPPERCASE", run: () => caseTo("upper") }, { label: "Title Case", run: () => caseTo("title") }] },
  ];
  const alignItems: MenuEntry[] = [
    { label: "Left", keys: "Ctrl+Shift+L", icon: <AlignLeft size={14} />, checked: align === "left", run: () => run("justifyLeft") },
    { label: "Center", keys: "Ctrl+Shift+E", icon: <AlignCenter size={14} />, checked: align === "center", run: () => run("justifyCenter") },
    { label: "Right", keys: "Ctrl+Shift+R", icon: <AlignRight size={14} />, checked: align === "right", run: () => run("justifyRight") },
    { label: "Justified", keys: "Ctrl+Shift+J", icon: <AlignJustify size={14} />, checked: align === "justify", run: () => run("justifyFull") },
  ];
  const indentItems: MenuEntry[] = [
    { label: "Increase indent", keys: "Ctrl+]", run: () => run("indent") },
    { label: "Decrease indent", keys: "Ctrl+[", run: () => run("outdent") },
  ];
  const spacingItems: MenuEntry[] = [
    ...SPACING.map(([label, v]): MenuItem => ({ label, checked: block instanceof HTMLElement && block.style.lineHeight === v, run: () => lineSpacing(v) })),
    "-",
    { label: "Add space before paragraph", run: () => blockStyle((b) => (b.style.marginTop = "12pt")) },
    { label: "Add space after paragraph", run: () => blockStyle((b) => (b.style.marginBottom = "12pt")) },
    { label: "Remove space before paragraph", run: () => blockStyle((b) => (b.style.marginTop = "0")) },
    { label: "Remove space after paragraph", run: () => blockStyle((b) => (b.style.marginBottom = "0")) },
    "-",
    {
      label: "Custom spacing…",
      run: async () => {
        const restoreSel = keepSelection();
        const v = await askText("Custom line spacing", { label: "Line spacing (e.g. 1.15, 1.5, 2)", value: "1.5", confirmLabel: "Apply" });
        restoreSel();
        if (v && Number(v) > 0) lineSpacing(String(Number(v) * 1.15));
      },
    },
  ];
  const bulletItems: MenuEntry[] = [
    { label: "● Disc", run: () => listStyle("ul", "disc") },
    { label: "○ Circle", run: () => listStyle("ul", "circle") },
    { label: "■ Square", run: () => listStyle("ul", "square") },
    { label: "➔ Arrow", run: () => listStyle("ul", '"➔  "') },
    { label: "★ Star", run: () => listStyle("ul", '"★  "') },
    { label: "– Dash", run: () => listStyle("ul", '"–  "') },
  ];
  const numberItems: MenuEntry[] = [
    { label: "1. 2. 3.", run: () => listStyle("ol", "decimal") },
    { label: "01. 02. 03.", run: () => listStyle("ol", "decimal-leading-zero") },
    { label: "a. b. c.", run: () => listStyle("ol", "lower-alpha") },
    { label: "A. B. C.", run: () => listStyle("ol", "upper-alpha") },
    { label: "i. ii. iii.", run: () => listStyle("ol", "lower-roman") },
    { label: "I. II. III.", run: () => listStyle("ol", "upper-roman") },
  ];
  const listItems: MenuEntry[] = [
    { label: "Checklist", keys: "Ctrl+Shift+9", checked: !!listAt?.classList.contains("checklist"), run: toggleChecklist },
    { label: "Bulleted list", keys: "Ctrl+Shift+8", checked: listAt?.tagName === "UL" && !listAt.classList.contains("checklist"), sub: [{ label: "Bulleted list", run: () => run("insertUnorderedList") }, "-", ...bulletItems] },
    { label: "Numbered list", keys: "Ctrl+Shift+7", checked: listAt?.tagName === "OL", sub: [{ label: "Numbered list", run: () => run("insertOrderedList") }, "-", ...numberItems] },
  ];
  const tableItems = (cell: Element | null): MenuEntry[] => [
    { label: "Insert row above", disabled: !cell, run: () => onTable("rowAbove") },
    { label: "Insert row below", disabled: !cell, run: () => onTable("rowBelow") },
    { label: "Insert column left", disabled: !cell, run: () => onTable("colLeft") },
    { label: "Insert column right", disabled: !cell, run: () => onTable("colRight") },
    "-",
    { label: "Delete row", disabled: !cell, run: () => onTable("delRow") },
    { label: "Delete column", disabled: !cell, run: () => onTable("delCol") },
    { label: "Delete table", disabled: !cell, run: () => onTable("delTable") },
    "-",
    { label: "Distribute columns", disabled: !cell, run: () => onTable("distribute") },
    { label: "Pin header row", disabled: !cell, checked: cell?.closest("table")?.rows[0]?.cells[0]?.tagName === "TH", run: () => onTable("headerRow") },
    { label: "Table properties…", disabled: !cell, run: () => setModal("table") },
  ];
  const aiItems: MenuEntry[] = [
    { label: "Ask AI…", icon: <Sparkles size={14} />, run: () => setPanel("ai") },
    { label: "Help me write…", run: aiWrite },
    "-",
    ...ai.REWRITES.map(([label, instr]): MenuItem => ({ label, disabled: !hasSel, run: () => aiRewrite(instr) })),
    { label: "Translate…", disabled: !hasSel, run: aiTranslate },
    { label: "Custom rewrite…", disabled: !hasSel, run: async () => { const t = await askText("Rewrite selection", { label: "How should AI change it?", confirmLabel: "Rewrite" }); if (t?.trim()) aiRewrite(t.trim()); } },
    "-",
    { label: "Summarize document", run: () => askAi("Summarize this document in a few bullet points.") },
    { label: "Suggest a title", run: () => askAi("Suggest three good titles for this document.") },
    { label: "Proofread whole document", run: () => askAi("Fix spelling and grammar in the whole document. Change nothing else.") },
  ];

  const menus: { label: string; items: MenuEntry[] }[] = [
    {
      label: "File",
      items: [
        { label: "New document", run: () => newDoc(false) },
        { label: "Open…", keys: "Ctrl+O", run: () => go("/docs") },
        { label: "Make a copy", run: () => newDoc(true) },
        "-",
        {
          label: "Download",
          sub: [
            { label: "Microsoft Word (.docx)", run: () => download("docx") },
            { label: "PDF document (.pdf)", run: printDoc },
            { label: "Web page (.html)", run: () => download("html") },
            { label: "Markdown (.md)", run: () => download("md") },
            { label: "Plain text (.txt)", run: () => download("txt") },
          ],
        },
        { label: "Rename", run: rename },
        "-",
        { label: "Page setup…", run: () => setModal("setup") },
        { label: "Print", keys: "Ctrl+P", icon: <Printer size={14} />, run: printDoc },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", keys: "Ctrl+Z", icon: <Undo2 size={14} />, disabled: !hist.current.past.length, run: undo },
        { label: "Redo", keys: "Ctrl+Y", icon: <Redo2 size={14} />, disabled: !hist.current.future.length, run: redo },
        "-",
        { label: "Cut", keys: "Ctrl+X", disabled: !can, run: () => clip("cut") },
        { label: "Copy", keys: "Ctrl+C", run: () => clip("copy") },
        { label: "Paste", keys: "Ctrl+V", disabled: !can, run: () => paste(false) },
        { label: "Paste without formatting", keys: "Ctrl+Shift+V", disabled: !can, run: () => paste(true) },
        "-",
        { label: "Select all", keys: "Ctrl+A", run: () => run("selectAll") },
        { label: "Delete", disabled: !can || !hasSel, run: () => run("delete") },
        "-",
        { label: "Find and replace", keys: "Ctrl+H", run: () => openFind(true) },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Mode", sub: [{ label: "Editing", checked: !viewing, run: () => setViewing(false) }, { label: "Viewing", checked: viewing, run: () => setViewing(true) }] },
        "-",
        { label: "Show print layout", checked: !setup.pageless, run: () => f.setData((d) => ({ ...d, setup: { ...setup, pageless: !setup.pageless } })) },
        { label: "Show word count", checked: showCount, run: () => setShowCount(!showCount) },
        { label: "Show comments", checked: panel === "comments", run: () => setPanel(panel === "comments" ? null : "comments") },
        "-",
        { label: "Zoom", sub: [...ZOOMS.map((z): MenuItem => ({ label: `${z}%`, checked: zoom === z, run: () => setZoom(z) })), "-", { label: "Zoom in", keys: "Ctrl++", run: () => setZoom(Math.min(300, zoom + 10)) }, { label: "Zoom out", keys: "Ctrl+-", run: () => setZoom(Math.max(25, zoom - 10)) }] },
        { label: "Full screen", run: toggleFullscreen },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Image", icon: <ImageIcon size={14} />, disabled: !can, sub: [{ label: "Upload from computer", run: () => { replaceImg.current = null; imgRef.current?.click(); } }, { label: "By URL…", run: insertImageUrl }] },
        { label: "Table", disabled: !can, render: (close) => <TableGrid onPick={(r, c) => { close(); insertTable(r, c); }} /> },
        "-",
        { label: "Link", keys: "Ctrl+K", icon: <Link2 size={14} />, disabled: !can, run: insertLink },
        { label: "Comment", keys: "Ctrl+Alt+M", icon: <MessageSquarePlus size={14} />, run: addComment },
        "-",
        { label: "Special characters", disabled: !can, run: () => setModal("chars") },
        { label: "Horizontal line", disabled: !can, run: () => run("insertHorizontalRule") },
        { label: "Date", disabled: !can, run: insertDate },
        { label: "Checkbox", disabled: !can, run: toggleChecklist },
        { label: "Break", disabled: !can, sub: [{ label: "Page break", keys: "Ctrl+Enter", run: pageBreak }, { label: "Line break", keys: "Shift+Enter", run: () => run("insertLineBreak") }] },
        "-",
        { label: "Table of contents", disabled: !can, run: insertToc },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Text", disabled: !can, sub: textItems },
        { label: "Paragraph styles", disabled: !can, sub: STYLES.map((s): MenuItem => ({ label: s.label, keys: s.keys, checked: styleKey === s.key, run: () => setStyle(s.key) })) },
        { label: "Align & indent", disabled: !can, sub: [...alignItems, "-", ...indentItems] },
        { label: "Line & paragraph spacing", disabled: !can, sub: spacingItems },
        { label: "Columns", disabled: !can, sub: [1, 2, 3].map((n): MenuItem => ({ label: `${n} column${n > 1 ? "s" : ""}`, checked: setup.columns === n, run: () => f.setData((d) => ({ ...d, setup: { ...setup, columns: n } })) })) },
        { label: "Bullets & numbering", disabled: !can, sub: listItems },
        "-",
        { label: "Table", disabled: !can, sub: tableItems(inTable) },
        "-",
        { label: "Clear formatting", keys: "Ctrl+\\", disabled: !can, run: () => run("removeFormat") },
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "Spelling", sub: [{ label: "Show spelling suggestions", checked: spell, run: () => setSpell(!spell) }] },
        { label: "Word count", keys: "Ctrl+Shift+C", run: () => setModal("count") },
        "-",
        { label: "Groq API key…", run: () => setPanel("ai") },
      ],
    },
    { label: "AI", items: aiItems.map((i) => (i !== "-" && i.label !== "Ask AI…" && i.label !== "Summarize document" && i.label !== "Suggest a title" ? { ...i, disabled: i.disabled || !can } : i)) },
    {
      label: "Help",
      items: [
        { label: "Keyboard shortcuts", keys: "Ctrl+/", run: () => setModal("keys") },
        { label: "About Forma Docs", run: () => toast("Forma Docs — offline documents with Groq AI. Your files stay on this computer.", "info") },
      ],
    },
  ];

  function ctxItems(target: HTMLElement): MenuEntry[] {
    const img = target.tagName === "IMG" ? (target as HTMLImageElement) : null;
    const cell = target.closest("td,th");
    const link = target.closest("a");
    const li = target.closest("ul.checklist > li");
    const textSel = hasSel;
    if (viewing) return [{ label: "Copy", keys: "Ctrl+C", disabled: !textSel, run: () => clip("copy") }, { label: "Select all", keys: "Ctrl+A", run: () => run("selectAll") }];
    return [
      { label: "Cut", keys: "Ctrl+X", disabled: !textSel, run: () => clip("cut") },
      { label: "Copy", keys: "Ctrl+C", disabled: !textSel, run: () => clip("copy") },
      { label: "Paste", keys: "Ctrl+V", run: () => paste(false) },
      { label: "Paste without formatting", keys: "Ctrl+Shift+V", run: () => paste(true) },
      { label: "Delete", disabled: !textSel, run: () => run("delete") },
      "-",
      { label: "AI", icon: <Sparkles size={14} />, sub: aiItems },
      "-",
      { label: "Comment", keys: "Ctrl+Alt+M", icon: <MessageSquarePlus size={14} />, disabled: !textSel, run: addComment },
      "-",
      ...(link
        ? ([
            { label: "Open link", icon: <ExternalLink size={14} />, run: () => openLink(link.getAttribute("href") ?? "") },
            { label: "Edit link", keys: "Ctrl+K", run: insertLink },
            { label: "Remove link", icon: <Unlink size={14} />, run: () => removeLink(link) },
          ] as MenuEntry[])
        : [{ label: "Insert link", keys: "Ctrl+K", icon: <Link2 size={14} />, run: insertLink } as MenuEntry]),
      "-",
      { label: "Increase font size", keys: "Ctrl+Shift+>", icon: <Plus size={14} />, run: () => bump(1) },
      { label: "Decrease font size", keys: "Ctrl+Shift+<", icon: <Minus size={14} />, run: () => bump(-1) },
      {
        label: "Format options",
        sub: [
          ...textItems,
          "-",
          { label: "Align", sub: alignItems },
          { label: "Line & paragraph spacing", sub: spacingItems },
          { label: "Paragraph style", sub: STYLES.map((s): MenuItem => ({ label: s.label, checked: styleKey === s.key, run: () => setStyle(s.key) })) },
        ],
      },
      { label: "Clear formatting", keys: "Ctrl+\\", icon: <RemoveFormatting size={14} />, run: () => run("removeFormat") },
      { label: "Select all matching text", disabled: !textSel, run: () => openFind(false) },
      ...(li ? (["-", { label: li.classList.contains("checked") ? "Mark as not done" : "Mark as done", run: () => { li.classList.toggle("checked"); changed(); } }] as MenuEntry[]) : []),
      ...(cell ? (["-", ...tableItems(cell)] as MenuEntry[]) : []),
      ...(img
        ? ([
            "-",
            { label: "Image size", sub: ["25%", "50%", "75%", "100%"].map((p): MenuItem => ({ label: p, run: () => imageOp(img, p) })) },
            { label: "Image position", sub: [{ label: "In line with text", run: () => imageOp(img, "inline") }, { label: "Centered", run: () => imageOp(img, "center") }, { label: "Wrap text, left", run: () => imageOp(img, "left") }, { label: "Wrap text, right", run: () => imageOp(img, "right") }] },
            { label: "Alt text…", run: () => altText(img) },
            { label: "Replace image…", run: () => { replaceImg.current = img; imgRef.current?.click(); } },
            { label: "Delete image", run: () => imageOp(img, "delete") },
          ] as MenuEntry[])
        : []),
    ];
  }

  /* ---------- Page events ---------- */

  function onKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const stop = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (mod && !e.altKey && (k === "z" || k === "y")) return stop(k === "y" || e.shiftKey ? redo : undo);
    if (viewing) return;
    if (mod && e.key === "Enter") return stop(pageBreak);
    if (mod && k === "k") return stop(insertLink);
    if (mod && e.altKey && k === "m") return stop(addComment);
    if (mod && e.shiftKey && (e.key === ">" || e.key === ".")) return stop(() => bump(1));
    if (mod && e.shiftKey && (e.key === "<" || e.key === ",")) return stop(() => bump(-1));
    if (mod && !e.shiftKey && e.key === ".") return stop(() => run("superscript"));
    if (mod && !e.shiftKey && e.key === ",") return stop(() => run("subscript"));
    if (mod && e.key === "\\") return stop(() => run("removeFormat"));
    if (e.altKey && e.shiftKey && (e.key === "5" || e.code === "Digit5")) return stop(() => run("strikeThrough"));
    if (mod && e.altKey && /^[0-4]$/.test(e.code.replace("Digit", ""))) return stop(() => setStyle(["p", "h1", "h2", "h3", "h4"][Number(e.code.replace("Digit", ""))]));
    if (mod && e.shiftKey) {
      const map: Record<string, () => void> = { KeyL: () => run("justifyLeft"), KeyE: () => run("justifyCenter"), KeyR: () => run("justifyRight"), KeyJ: () => run("justifyFull"), Digit7: () => run("insertOrderedList"), Digit8: () => run("insertUnorderedList"), Digit9: toggleChecklist };
      if (map[e.code]) return stop(map[e.code]);
    }
    if (mod && e.key === "]") return stop(() => run("indent"));
    if (mod && e.key === "[") return stop(() => run("outdent"));
    // Tab in a table moves between cells; in the last cell it adds a row.
    if (e.key === "Tab") {
      const c = cellAt(root());
      if (c) {
        e.preventDefault();
        const cells = [...c.closest("table")!.querySelectorAll<HTMLTableCellElement>("td,th")];
        let next = cells[cells.indexOf(c) + (e.shiftKey ? -1 : 1)];
        if (!next && !e.shiftKey) next = tableOp(cells[cells.length - 1], "rowBelow")!;
        if (next) {
          const r = document.createRange();
          r.selectNodeContents(next);
          selectRange(r);
          changed();
        }
      } else if (selectedBlocks(root()).some((b) => b.tagName === "LI")) stop(() => run(e.shiftKey ? "outdent" : "indent"));
      else stop(() => run("insertText", "\t"));
    }
  }

  // Clicking a link shows a small card (open / remove); Ctrl+click opens it directly.
  function onPageClick(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    const li = t.closest<HTMLElement>("ul.checklist > li");
    if (li && e.clientX < li.getBoundingClientRect().left) {
      li.classList.toggle("checked");
      changed();
    }
    const cm = t.closest<HTMLElement>("[data-cid]");
    if (cm) {
      setActiveCmt(cm.dataset.cid!);
      if (!panel) setPanel("comments");
    }
    const a = t.closest("a");
    if (!a || !page.current?.contains(a)) return setLinkCard(null);
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      e.preventDefault();
      root().querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setLinkCard(null);
      return isSafeHref(href) ? openLink(href) : toast("Only web and email links can be opened", "error");
    }
    const box = a.getBoundingClientRect();
    const outer = scroller.current!.getBoundingClientRect();
    setLinkCard({ a, top: box.bottom - outer.top + scroller.current!.scrollTop + 6, left: box.left - outer.left + scroller.current!.scrollLeft });
  }

  // Plain-text paste: keep line breaks and turn addresses into links. Rich paste is cleaned of scripts and styles from elsewhere.
  function onPaste(e: React.ClipboardEvent) {
    const types = e.clipboardData.types;
    if (types.includes("Files")) {
      const file = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        return insertImageFile(file);
      }
    }
    if (types.includes("text/html")) {
      e.preventDefault();
      exec("insertHTML", cleanHtml(e.clipboardData.getData("text/html")));
      return changed();
    }
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const holder = document.createElement("div");
    text.split(/\r?\n/).forEach((line, i) => {
      if (i) holder.append(document.createElement("br"));
      holder.append(line);
    });
    linkifyElement(holder);
    exec("insertHTML", holder.innerHTML);
    changed();
  }

  /* ---------- Render ---------- */

  const B = ({ cmd, icon, title }: { cmd: string; icon: React.ReactNode; title: string }) => (
    <button className={state(cmd) ? "on" : ""} title={title} disabled={!can} onClick={() => run(cmd)}>{icon}</button>
  );
  const found = search.trim() ? flatten(menus).filter((x) => x.path.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 10) : [];
  const pw = setup.pageless ? undefined : size.w * 96;
  const cellForProps = inTable ?? (ctx?.target.closest("td,th") as HTMLTableCellElement | null);
  const selText = sel && rangeIn(page.current) ? sel.toString() : "";

  return (
    <div className={"app-page docs" + (paint ? " painting" : "")}>
      {f.meta && (
        <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="docs">
          {aiBusy && <span className="muted">{aiBusy}</span>}
          <button className={panel === "comments" ? "on" : ""} title="Comments" onClick={() => setPanel(panel === "comments" ? null : "comments")}>Comments{comments.length ? ` (${comments.length})` : ""}</button>
          <button className={panel === "ai" ? "on" : ""} title="Ask AI (Groq)" onClick={() => setPanel(panel === "ai" ? null : "ai")}><Sparkles size={14} /> AI</button>
        </TitleBar>
      )}
      <MenuBar menus={menus} />
      <div className="toolbar docs-tools" onMouseDown={keep}>
        <div className="menu-search">
          <input placeholder="Menus" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && found[0]) { found[0].item.run?.(); setSearch(""); } if (e.key === "Escape") setSearch(""); }} />
          {found.length > 0 && (
            <div className="dmenu pop search-results">
              {found.map((x) => <button key={x.path} className="ditem" onClick={() => { setSearch(""); x.item.run?.(); }}><span className="dlabel">{x.path}</span>{x.item.keys && <span className="dkeys">{x.item.keys}</span>}</button>)}
            </div>
          )}
        </div>
        <button title="Undo (Ctrl+Z)" disabled={!hist.current.past.length} onClick={undo}><Undo2 /></button>
        <button title="Redo (Ctrl+Y)" disabled={!hist.current.future.length} onClick={redo}><Redo2 /></button>
        <button title="Print (Ctrl+P)" onClick={printDoc}><Printer /></button>
        <button className={spell ? "on" : ""} title="Spelling suggestions (Shift+right-click a word)" onClick={() => setSpell(!spell)}><SpellCheck /></button>
        <button className={paint ? "on" : ""} title="Paint format: click to copy formatting, then select text. Double-click to keep painting." disabled={!can} onClick={() => pickPaint(false)} onDoubleClick={() => { setPaint(null); setTimeout(() => pickPaint(true)); }}><PaintRoller /></button>
        <select title="Zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[...new Set([...ZOOMS, zoom])].sort((a, b) => a - b).map((z) => <option key={z} value={z}>{z}%</option>)}
        </select>
        <span className="sep" />
        <select title="Styles" value={styleKey} disabled={!can} onChange={(e) => setStyle(e.target.value)}>
          {STYLES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="sep" />
        <select title="Font" value={FONTS.includes(curFont) ? curFont : ""} disabled={!can} onChange={(e) => run("fontName", e.target.value)}>
          <option value="" disabled>{curFont || "Font"}</option>
          {FONTS.map((x) => <option key={x} value={x} style={{ fontFamily: x }}>{x}</option>)}
        </select>
        <span className="sep" />
        <button title="Decrease font size (Ctrl+Shift+<)" disabled={!can} onClick={() => bump(-1)}><Minus /></button>
        <input
          key={curSize}
          className="size-box"
          title="Font size"
          defaultValue={curSize}
          disabled={!can}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = Number((e.target as HTMLInputElement).value);
            if (v > 0) fontSize(v);
          }}
          onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== curSize && lastRange.current && !lastRange.current.collapsed) fontSize(v); }}
        />
        <button title="Increase font size (Ctrl+Shift+>)" disabled={!can} onClick={() => bump(1)}><Plus /></button>
        <span className="sep" />
        <B cmd="bold" icon={<Bold />} title="Bold (Ctrl+B)" />
        <B cmd="italic" icon={<Italic />} title="Italic (Ctrl+I)" />
        <B cmd="underline" icon={<Underline />} title="Underline (Ctrl+U)" />
        <B cmd="strikeThrough" icon={<Strikethrough />} title="Strikethrough (Alt+Shift+5)" />
        <label className="color" title="Text color"><Baseline size={15} /><input type="color" disabled={!can} onChange={(e) => run("foreColor", e.target.value)} /></label>
        <label className="color hl" title="Highlight color"><Highlighter size={15} /><input type="color" disabled={!can} defaultValue="#fff59d" onChange={(e) => run("hiliteColor", e.target.value)} /></label>
        <span className="sep" />
        <button title="Insert link (Ctrl+K)" disabled={!can} onClick={insertLink}><Link2 /></button>
        <button title="Add comment (Ctrl+Alt+M)" onClick={addComment}><MessageSquarePlus /></button>
        <button title="Insert image" disabled={!can} onClick={() => { replaceImg.current = null; imgRef.current?.click(); }}><ImageIcon /></button>
        <span className="sep" />
        <ToolMenu title="Align & indent" label={align === "center" ? <AlignCenter /> : align === "right" ? <AlignRight /> : align === "justify" ? <AlignJustify /> : <AlignLeft />} items={alignItems} />
        <ToolMenu title="Line & paragraph spacing" label={<span className="ls-icon">↕≡</span>} items={spacingItems} />
        <button className={listAt?.classList.contains("checklist") ? "on" : ""} title="Checklist (Ctrl+Shift+9)" disabled={!can} onClick={toggleChecklist}><CheckSquare /></button>
        <ToolMenu title="Bulleted list (Ctrl+Shift+8)" className={listAt?.tagName === "UL" && !listAt.classList.contains("checklist") ? "on" : ""} label={<List />} items={[{ label: "Bulleted list", run: () => run("insertUnorderedList") }, "-", ...bulletItems]} />
        <ToolMenu title="Numbered list (Ctrl+Shift+7)" className={listAt?.tagName === "OL" ? "on" : ""} label={<ListOrdered />} items={[{ label: "Numbered list", run: () => run("insertOrderedList") }, "-", ...numberItems]} />
        <button title="Decrease indent (Ctrl+[)" disabled={!can} onClick={() => run("outdent")}><IndentDecrease /></button>
        <button title="Increase indent (Ctrl+])" disabled={!can} onClick={() => run("indent")}><IndentIncrease /></button>
        <button title="Clear formatting (Ctrl+\)" disabled={!can} onClick={() => run("removeFormat")}><RemoveFormatting /></button>
        {inTable && can && (
          <>
            <span className="sep" />
            <ToolMenu title="Table options" label={<span className="tl">Table options</span>} items={tableItems(inTable)} />
          </>
        )}
        <span className="grow" />
        <select className="mode" title="Mode" value={viewing ? "view" : "edit"} onChange={(e) => setViewing(e.target.value === "view")}>
          <option value="edit">✎ Editing</option>
          <option value="view">👁 Viewing</option>
        </select>
        <input ref={imgRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) insertImageFile(file); else replaceImg.current = null; e.target.value = ""; }} />
      </div>
      <div className="docs-body">
        <div className="doc-scroll" ref={scroller} onScroll={() => linkCard && setLinkCard(null)}>
          <div
            ref={page}
            className={"doc-page" + (setup.pageless ? " pageless" : "")}
            contentEditable={!viewing}
            suppressContentEditableWarning
            spellCheck={spell}
            style={{
              zoom: zoom / 100,
              width: pw,
              minHeight: setup.pageless ? 600 : size.h * 96,
              padding: setup.pageless ? "48px 64px" : `${setup.margins.top * 96}px ${setup.margins.right * 96}px ${setup.margins.bottom * 96}px ${setup.margins.left * 96}px`,
              background: setup.color,
              columnCount: setup.columns > 1 ? setup.columns : undefined,
              columnGap: setup.columns > 1 ? 48 : undefined,
            }}
            onInput={() => { setLinkCard(null); changed(true); }}
            onKeyDown={onKeyDown}
            onClick={onPageClick}
            onPaste={onPaste}
            onCut={() => setTimeout(() => changed())}
            onDrop={() => setTimeout(() => changed())}
            onMouseUp={() => paint && setTimeout(() => applyPaint(paint))}
            onBeforeInput={(e) => {
              const t = (e.nativeEvent as InputEvent).inputType;
              if (t === "historyUndo" || t === "historyRedo") {
                e.preventDefault();
                (t === "historyUndo" ? undo : redo)();
              }
            }}
            onContextMenu={(e) => {
              if (e.shiftKey) return; // the system menu, with spelling suggestions
              e.preventDefault();
              const t = e.target as HTMLElement;
              if (t.tagName === "IMG") {
                const r = document.createRange();
                r.selectNode(t);
                selectRange(r);
              }
              setLinkCard(null);
              setCtx({ x: e.clientX, y: e.clientY, target: t });
            }}
          />
          {linkCard && (
            <div className="doc-link-card pop" style={{ top: linkCard.top, left: linkCard.left }} onMouseDown={(e) => e.preventDefault()}>
              <span className="dl-href" title={linkCard.a.href}>{(linkCard.a.getAttribute("href") ?? "").replace(/^mailto:/, "")}</span>
              <button className="icon" title="Open link (Ctrl+click)" onClick={() => { openLink(linkCard.a.getAttribute("href") ?? ""); setLinkCard(null); }}><ExternalLink /></button>
              <button className="icon" title="Remove link" onClick={() => removeLink(linkCard.a)}><Unlink /></button>
            </div>
          )}
        </div>
        {find && page.current && <FindBar key={find.n} root={page.current} initial={find.text} replaceOpen={find.replace} onChanged={() => changed()} onClose={() => setFind(null)} />}
        {panel === "ai" && <AiPanel seed={aiSeed} hasSelection={hasSel} onAsk={runChat} onClose={() => setPanel(null)} />}
        {panel === "comments" && (
          <CommentsPanel
            comments={comments.filter((c) => c.text || c.id === draft)}
            order={cmtOrder}
            active={activeCmt}
            draft={draft}
            onSelect={(cid) => {
              setActiveCmt(cid);
              root().querySelector(`[data-cid="${cid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
            onSave={(cid, text) => { f.setData((d) => ({ ...d, comments: (d.comments ?? []).map((c) => (c.id === cid ? { ...c, text, at: Date.now() } : c)) })); setDraft(null); }}
            onReply={(cid, text) => f.setData((d) => ({ ...d, comments: (d.comments ?? []).map((c) => (c.id === cid ? { ...c, replies: [...c.replies, { text, at: Date.now() }] } : c)) }))}
            onResolve={dropComment}
            onCancelDraft={() => draft && dropComment(draft)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
      {showCount && <div className="docbar">{words} {words === 1 ? "word" : "words"}{selText.trim() ? ` · ${counts(selText).words} selected` : ""}{paint ? " · Paint format on: select text to apply (Esc to stop)" : ""}{viewing ? " · Viewing (read only)" : ""}</div>}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.target)} onClose={() => setCtx(null)} />}
      {modal === "count" && page.current && <WordCount root={page.current} selection={lastRange.current?.toString() ?? ""} pageHeight={size.h * 96} show={showCount} setShow={setShowCount} onClose={() => setModal(null)} />}
      {modal === "setup" && <PageSetupModal value={setup} onSave={(s) => f.setData((d) => ({ ...d, setup: s }))} onClose={() => setModal(null)} />}
      {modal === "chars" && <SpecialChars onPick={(ch) => { focusPage(); exec("insertText", ch); changed(); }} onClose={() => setModal(null)} />}
      {modal === "keys" && <Shortcuts onClose={() => setModal(null)} />}
      {modal === "table" && cellForProps && <TableProps table={cellForProps.closest("table")!} cell={cellForProps} onDone={() => changed()} onClose={() => setModal(null)} />}
    </div>
  );
}
