import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { errorText } from "../../lib/dialog";
import { getGroqKey, setGroqKey } from "../../lib/groq";
import { Modal } from "../../ui";
import { counts, selectRange } from "./editor";
import { PAPER, type PageSetup } from "./setup";

/* ---------- Insert › Table: pick a size by hovering a grid ---------- */

export function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [at, setAt] = useState({ r: 1, c: 1 });
  return (
    <div className="tgrid-wrap">
      <div className="tgrid" onMouseLeave={() => setAt({ r: 1, c: 1 })}>
        {Array.from({ length: 10 }, (_, r) =>
          Array.from({ length: 10 }, (_, c) => (
            <span key={`${r}-${c}`} className={r < at.r && c < at.c ? "on" : ""} onMouseEnter={() => setAt({ r: r + 1, c: c + 1 })} onClick={() => onPick(r + 1, c + 1)} />
          )),
        )}
      </div>
      <div className="muted tgrid-label">{at.c} × {at.r}</div>
    </div>
  );
}

/* ---------- Find and replace ---------- */

function matches(root: HTMLElement, find: string, matchCase: boolean) {
  const out: Range[] = [];
  if (!find) return out;
  const needle = matchCase ? find : find.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const hay = matchCase ? n.data : n.data.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

export function FindBar({ root, initial, replaceOpen, onChanged, onClose }: { root: HTMLElement; initial: string; replaceOpen: boolean; onChanged: () => void; onClose: () => void }) {
  const [find, setFind] = useState(initial);
  const [repl, setRepl] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [showRepl, setShowRepl] = useState(replaceOpen);
  const [i, setI] = useState(-1);
  const [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => matches(root, find, matchCase), [root, find, matchCase, tick]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => setI(-1), [find, matchCase]);
  // Show every match with the CSS highlight API where the webview has it.
  useEffect(() => {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !H) return;
    reg.set("doc-find", new H(...list));
    return () => void reg.delete("doc-find");
  }, [list]);

  const go = (step: number) => {
    if (!list.length) return;
    const n = (i + step + list.length) % list.length;
    setI(n);
    selectRange(list[n]);
    (list[n].startContainer.parentElement as HTMLElement)?.scrollIntoView({ block: "center" });
  };
  const replaceOne = () => {
    if (i < 0 || !list[i]) return go(1);
    selectRange(list[i]);
    root.focus();
    document.execCommand("insertText", false, repl);
    onChanged();
    setTick(tick + 1);
    setTimeout(() => go(0), 0);
  };
  const replaceAll = () => {
    // Back to front so earlier ranges stay valid.
    for (const r of [...list].reverse()) {
      r.deleteContents();
      r.insertNode(document.createTextNode(repl));
    }
    root.normalize();
    onChanged();
    setTick(tick + 1);
  };
  return (
    <div className="findbar pop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="row">
        <input ref={input} placeholder="Find in document" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(e.shiftKey ? -1 : 1)} />
        <span className="muted count">{list.length ? `${i >= 0 ? i + 1 : 0} of ${list.length}` : find ? "0 results" : ""}</span>
        <button className="icon" title="Previous (Shift+Enter)" onClick={() => go(-1)}><ChevronUp /></button>
        <button className="icon" title="Next (Enter)" onClick={() => go(1)}><ChevronDown /></button>
        <button className="icon" title="Close (Esc)" onClick={onClose}><X /></button>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <span className="grow" />
        <button onClick={() => setShowRepl(!showRepl)}>{showRepl ? "Hide replace" : "Replace…"}</button>
      </div>
      {showRepl && (
        <div className="row">
          <input placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && replaceOne()} />
          <button onClick={replaceOne} disabled={!list.length}>Replace</button>
          <button onClick={replaceAll} disabled={!list.length}>Replace all</button>
        </div>
      )}
    </div>
  );
}

/* ---------- Tools › Word count ---------- */

export function WordCount({ root, selection, pageHeight, show, setShow, onClose }: { root: HTMLElement; selection: string; pageHeight: number; show: boolean; setShow: (v: boolean) => void; onClose: () => void }) {
  const all = counts(root.innerText);
  const sel = selection.trim() ? counts(selection) : null;
  const pages = Math.max(1, Math.ceil(root.scrollHeight / pageHeight));
  const row = (label: string, a: number | string, b?: number) => (
    <tr><td>{label}</td><td className="num">{sel && b !== undefined ? `${b.toLocaleString()} of ${a.toLocaleString()}` : a.toLocaleString()}</td></tr>
  );
  return (
    <Modal title="Word count" onClose={onClose}>
      <table className="wc">
        <tbody>
          {row("Pages", pages)}
          {row("Words", all.words, sel?.words)}
          {row("Characters", all.chars, sel?.chars)}
          {row("Characters excluding spaces", all.noSpaces, sel?.noSpaces)}
        </tbody>
      </table>
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Display word count while typing</label>
      <div className="modal-foot"><span className="grow" /><button className="primary" onClick={onClose}>OK</button></div>
    </Modal>
  );
}

/* ---------- File › Page setup ---------- */

export function PageSetupModal({ value, onSave, onClose }: { value: PageSetup; onSave: (s: PageSetup) => void; onClose: () => void }) {
  const [s, setS] = useState(value);
  const margin = (k: keyof PageSetup["margins"]) => (
    <label className="field">
      <span>{k[0].toUpperCase() + k.slice(1)} (inches)</span>
      <input type="number" step={0.1} min={0} max={4} value={s.margins[k]} onChange={(e) => setS({ ...s, margins: { ...s.margins, [k]: Math.max(0, Math.min(4, Number(e.target.value) || 0)) } })} />
    </label>
  );
  return (
    <Modal title="Page setup" onClose={onClose}>
      <div className="seg">
        <button className={!s.pageless ? "on" : ""} onClick={() => setS({ ...s, pageless: false })}>Pages</button>
        <button className={s.pageless ? "on" : ""} onClick={() => setS({ ...s, pageless: true })}>Pageless</button>
      </div>
      <div className="setup-grid">
        <label className="field">
          <span>Orientation</span>
          <select value={s.orientation} onChange={(e) => setS({ ...s, orientation: e.target.value as PageSetup["orientation"] })}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="field">
          <span>Paper size</span>
          <select value={s.paper} onChange={(e) => setS({ ...s, paper: e.target.value as PageSetup["paper"] })}>
            {Object.entries(PAPER).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Page color</span>
          <input type="color" value={s.color} onChange={(e) => setS({ ...s, color: e.target.value })} />
        </label>
        <label className="field">
          <span>Columns</span>
          <select value={s.columns} onChange={(e) => setS({ ...s, columns: Number(e.target.value) })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {margin("top")}
        {margin("bottom")}
        {margin("left")}
        {margin("right")}
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { onSave(s); onClose(); }}>OK</button>
      </div>
    </Modal>
  );
}

/* ---------- Insert › Special characters ---------- */

const CHARS: Record<string, string> = {
  Symbols: "©®™§¶†‡•…‰′″°±×÷≈≠≤≥∞√∑∏∫∂∆∇∈∉∩∪⊂⊃∀∃¬∧∨⊕⊗",
  Arrows: "←↑→↓↔↕⇐⇑⇒⇓⇔↩↪↺↻➔➜➤▲▼◀▶",
  Currency: "$€£¥₹₽₩₦₱₺₫₴¢₿",
  Punctuation: "–—‘’“”‚„«»‹›¡¿·",
  Greek: "αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ",
  Fractions: "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉",
  Shapes: "■□▪▫●○◆◇★☆✓✔✗✘☐☑☒♠♣♥♦",
  Emoji: "😀😂😊😍🤔😎😢😡👍👎👏🙏💪🎉🔥⭐💡📌📎📅✅❌⚠️❤️",
};

export function SpecialChars({ onPick, onClose }: { onPick: (ch: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState("Symbols");
  return (
    <Modal title="Insert special characters" onClose={onClose} wide>
      <div className="seg chars-tabs">
        {Object.keys(CHARS).map((k) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{k}</button>)}
      </div>
      <div className="chars">
        {[...new Intl.Segmenter().segment(CHARS[cat])].map(({ segment }, i) => (
          <button key={i} title={`U+${segment.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(segment)}>{segment}</button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Help › Keyboard shortcuts ---------- */

const KEYS: [string, string][] = [
  ["Undo / Redo", "Ctrl+Z / Ctrl+Y"], ["Bold / Italic / Underline", "Ctrl+B / Ctrl+I / Ctrl+U"], ["Strikethrough", "Alt+Shift+5"],
  ["Superscript / Subscript", "Ctrl+. / Ctrl+,"], ["Increase / decrease font size", "Ctrl+Shift+> / Ctrl+Shift+<"], ["Clear formatting", "Ctrl+\\"],
  ["Insert link", "Ctrl+K"], ["Insert comment", "Ctrl+Alt+M"], ["Page break", "Ctrl+Enter"],
  ["Normal text", "Ctrl+Alt+0"], ["Heading 1–4", "Ctrl+Alt+1 … 4"], ["Align left / center / right / justify", "Ctrl+Shift+L / E / R / J"],
  ["Numbered / bulleted / checklist", "Ctrl+Shift+7 / 8 / 9"], ["Find / Find and replace", "Ctrl+F / Ctrl+H"], ["Paste without formatting", "Ctrl+Shift+V"],
  ["Word count", "Ctrl+Shift+C"], ["Print", "Ctrl+P"], ["Copy / paste formatting", "Paint format button"], ["Spelling suggestions", "Shift+right-click a word"],
  ["Keyboard shortcuts", "Ctrl+/"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} wide>
      <table className="wc keys">
        <tbody>{KEYS.map(([a, b]) => <tr key={a}><td>{a}</td><td className="num"><kbd>{b}</kbd></td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

/* ---------- Format › Table › Table properties ---------- */

export function TableProps({ table, cell, onDone, onClose }: { table: HTMLTableElement; cell: HTMLTableCellElement; onDone: () => void; onClose: () => void }) {
  const cs = getComputedStyle(cell);
  const toHex = (c: string) => {
    const m = c.match(/\d+/g);
    return m && !(m.length > 3 && m[3] === "0") ? "#" + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("") : "#ffffff";
  };
  const [border, setBorder] = useState(toHex(cs.borderTopColor));
  const [width, setWidth] = useState(parseFloat(cs.borderTopWidth) || 1);
  const [bg, setBg] = useState(toHex(cs.backgroundColor));
  const [pad, setPad] = useState(parseFloat(cs.paddingTop) || 6);
  const [scope, setScope] = useState<"cell" | "table">("table");
  const [align, setAlign] = useState(cs.verticalAlign === "middle" ? "middle" : cs.verticalAlign === "bottom" ? "bottom" : "top");
  const apply = () => {
    for (const c of table.querySelectorAll<HTMLTableCellElement>("td,th")) {
      c.style.borderColor = border;
      c.style.borderWidth = `${width}px`;
      c.style.borderStyle = width ? "solid" : "none";
      c.style.padding = `${pad}px ${pad + 2}px`;
      c.style.verticalAlign = align;
      if (scope === "table") c.style.backgroundColor = bg === "#ffffff" ? "" : bg;
    }
    if (scope === "cell") cell.style.backgroundColor = bg === "#ffffff" ? "" : bg;
    onDone();
    onClose();
  };
  return (
    <Modal title="Table properties" onClose={onClose}>
      <div className="setup-grid">
        <label className="field"><span>Border color</span><input type="color" value={border} onChange={(e) => setBorder(e.target.value)} /></label>
        <label className="field">
          <span>Border width</span>
          <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {[0, 0.5, 1, 1.5, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n ? `${n} px` : "None"}</option>)}
          </select>
        </label>
        <label className="field"><span>Cell background</span><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
        <label className="field">
          <span>Background applies to</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as "cell" | "table")}>
            <option value="table">Whole table</option>
            <option value="cell">This cell</option>
          </select>
        </label>
        <label className="field"><span>Cell padding (px)</span><input type="number" min={0} max={40} value={pad} onChange={(e) => setPad(Math.max(0, Math.min(40, Number(e.target.value) || 0)))} /></label>
        <label className="field">
          <span>Vertical align</span>
          <select value={align} onChange={(e) => setAlign(e.target.value)}>
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
      </div>
      <div className="modal-foot">
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>OK</button>
      </div>
    </Modal>
  );
}

/* ---------- Comments ---------- */

export interface DocComment {
  id: string;
  text: string;
  quote: string;
  at: number;
  replies: { text: string; at: number }[];
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function CommentsPanel({ comments, order, active, draft, onSelect, onSave, onReply, onResolve, onCancelDraft, onClose }: {
  comments: DocComment[];
  order: string[];
  active: string | null;
  draft: string | null;
  onSelect: (id: string) => void;
  onSave: (id: string, text: string) => void;
  onReply: (id: string, text: string) => void;
  onResolve: (id: string) => void;
  onCancelDraft: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  const sorted = [...comments].sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9));
  const box = (id: string, label: string, done: (t: string) => void, autoFocus = false) => (
    <div className="cm-input">
      <textarea
        rows={2}
        autoFocus={autoFocus}
        placeholder={label}
        value={text[id] ?? ""}
        onChange={(e) => setText({ ...text, [id]: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (text[id] ?? "").trim()) {
            done(text[id].trim());
            setText({ ...text, [id]: "" });
          }
        }}
      />
      <button className="primary" disabled={!(text[id] ?? "").trim()} onClick={() => { done(text[id].trim()); setText({ ...text, [id]: "" }); }}>{draft === id ? "Comment" : "Reply"}</button>
    </div>
  );
  return (
    <aside className="fields comments">
      <div className="ai-head">
        <h3><MessageSquare size={14} /> Comments</h3>
        <span className="grow" />
        <button className="icon" title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      {!sorted.length && !draft && <p className="muted">Select text and choose Insert › Comment (Ctrl+Alt+M) to start a discussion.</p>}
      {sorted.map((c) => (
        <div key={c.id} className={"cm" + (active === c.id || draft === c.id ? " on" : "")} onClick={() => onSelect(c.id)}>
          <div className="cm-quote">“{c.quote.slice(0, 120)}{c.quote.length > 120 ? "…" : ""}”</div>
          {draft === c.id ? (
            <>
              {box(c.id, "Add a comment… (Ctrl+Enter)", (t) => onSave(c.id, t), true)}
              <button className="link" onClick={(e) => { e.stopPropagation(); onCancelDraft(); }}>Cancel</button>
            </>
          ) : (
            <>
              <div className="cm-head"><b>You</b><span className="muted">{when(c.at)}</span><span className="grow" /><button className="resolve" title="Resolve (removes the comment)" onClick={(e) => { e.stopPropagation(); onResolve(c.id); }}>Resolve</button></div>
              <div className="cm-text">{c.text}</div>
              {c.replies.map((r, i) => (
                <div key={i} className="cm-reply"><div className="cm-head"><b>You</b><span className="muted">{when(r.at)}</span></div><div className="cm-text">{r.text}</div></div>
              ))}
              {active === c.id && box(c.id, "Reply… (Ctrl+Enter)", (t) => onReply(c.id, t))}
            </>
          )}
        </div>
      ))}
    </aside>
  );
}

/* ---------- AI (Groq) ---------- */

type Chat = { role: "user" | "assistant"; content: string; error?: boolean };

export function AiPanel({ seed, hasSelection, onAsk, onClose }: { seed: { text: string; n: number } | null; hasSelection: boolean; onAsk: (key: string, request: string, history: { role: "user" | "assistant"; content: string }[]) => Promise<string>; onClose: () => void }) {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [draftKey, setDraftKey] = useState("");
  const [chat, setChat] = useState<Chat[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void getGroqKey().then((k) => setKey(k || null)), []);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [chat, busy]);
  useEffect(() => {
    if (seed && key) send(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n, key]);

  async function send(request = text.trim()) {
    if (!request || busy || !key) return;
    const history = chat.filter((m) => !m.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: "user", content: request }]);
    setText("");
    setBusy(true);
    try {
      const reply = await onAsk(key, request, history);
      setChat((c) => [...c, { role: "assistant", content: reply }]);
    } catch (e) {
      setChat((c) => [...c, { role: "assistant", content: errorText(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }
  const saveKey = () => {
    if (!draftKey.trim()) return;
    setGroqKey(draftKey);
    setKey(draftKey.trim());
  };
  const QUICK = hasSelection ? ["Improve the selected text", "Fix grammar in the selection", "Summarize the selection", "Translate the selection to French"] : ["Summarize this document", "Suggest a better title", "Fix spelling and grammar in the whole document", "Write a conclusion paragraph at the cursor"];
  return (
    <aside className="fields ai">
      <div className="ai-head">
        <h3><Sparkles size={14} /> AI (Groq)</h3>
        <span className="grow" />
        {key && <button className="icon" title="Change Groq API key" onClick={() => { setDraftKey(""); setKey(null); }}>Key</button>}
        <button className="icon" title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      {key === undefined ? null : !key ? (
        <>
          <p className="muted">Paste a Groq API key to use AI. It stays on this computer and is sent only to Groq. The same key works in the PDF editor.</p>
          <input type="password" placeholder="gsk_…" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveKey()} />
          <button className="primary" disabled={!draftKey.trim()} onClick={saveKey}>Save key</button>
        </>
      ) : (
        <>
          <div className="ai-chat">
            {!chat.length && (
              <>
                <p className="muted">Ask about this document or tell me what to change. {hasSelection ? "I’ll work on the selected text." : "Select text first to change just that part."} Ctrl+Z undoes any edit.</p>
                <div className="ai-quick">{QUICK.map((q) => <button key={q} onMouseDown={(e) => e.preventDefault()} onClick={() => send(q)}>{q}</button>)}</div>
              </>
            )}
            {chat.map((m, i) => <div key={i} className={`ai-msg ${m.role}${m.error ? " error" : ""}`}>{m.content}</div>)}
            {busy && <div className="ai-msg assistant muted">Working…</div>}
            <div ref={end} />
          </div>
          <div className="ai-input">
            <textarea rows={3} placeholder="Ask AI…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => send()} title="Send (Enter)"><Send size={14} /></button>
          </div>
        </>
      )}
    </aside>
  );
}
