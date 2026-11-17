// The "Ask AI" side panel every app shares: Groq key setup, a short chat, and quick prompts.
// Each app supplies `onAsk`, which sends the request with that app's content and applies the
// answer, and returns the message to show.
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { errorText } from "./dialog";
import { getGroqKey, setGroqKey } from "./groq";

type Chat = { role: "user" | "assistant"; content: string; error?: boolean };
export type AiHistory = { role: "user" | "assistant"; content: string }[];

export function AiPanel({ intro, placeholder = "Ask AI…", quick = [], seed, onAsk, onClose }: {
  /** What the AI can do here, shown before the first message. */
  intro: string;
  placeholder?: string;
  /** One-click prompts shown before the first message. */
  quick?: string[];
  /** Send this request as soon as the panel is ready (for menu items that open the panel). */
  seed?: { text: string; n: number } | null;
  onAsk: (key: string, request: string, history: AiHistory) => Promise<string>;
  onClose: () => void;
}) {
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
      setChat((c) => [...c, { role: "assistant", content: reply || "Done." }]);
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

  return (
    <aside className="fields ai" aria-label="Ask AI">
      <div className="ai-head">
        <h3><Sparkles size={14} /> Ask AI</h3>
        <span className="grow" />
        {key && <button className="icon" title="Change Groq API key" onClick={() => { setDraftKey(""); setKey(null); }}>Key</button>}
        <button className="icon" title="Close" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      {key === undefined ? null : !key ? (
        <>
          <p className="muted">
            AI in Forma runs on Groq. Paste a free API key from <b>console.groq.com</b> to use it. The key stays on this computer, is sent only to Groq, and works in every app.
          </p>
          <input type="password" placeholder="gsk_…" aria-label="Groq API key" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveKey()} />
          <button className="primary" disabled={!draftKey.trim()} onClick={saveKey}>Save key</button>
        </>
      ) : (
        <>
          <div className="ai-chat">
            {!chat.length && (
              <>
                <p className="muted">{intro}</p>
                {quick.length > 0 && (
                  <div className="ai-quick">
                    {quick.map((q) => (
                      <button key={q} onMouseDown={(e) => e.preventDefault()} onClick={() => send(q)}>{q}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            {chat.map((m, i) => <div key={i} className={`ai-msg ${m.role}${m.error ? " error" : ""}`}>{m.content}</div>)}
            {busy && <div className="ai-msg assistant muted">Working…</div>}
            <div ref={end} />
          </div>
          <div className="ai-input">
            <textarea rows={3} placeholder={placeholder} aria-label="Message to AI" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => send()} title="Send (Enter)" aria-label="Send"><Send size={14} /></button>
          </div>
        </>
      )}
    </aside>
  );
}

/** Parse a JSON answer from the model, with a readable error when it isn't JSON. */
export function parseJson<T>(content: string): T {
  try {
    return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("The AI answered in a form I couldn't read. Try again.");
  }
}
