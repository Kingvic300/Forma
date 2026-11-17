// Calls to Groq's chat API, shared by the apps that offer AI help. The key stays on this computer.
import { getSetting, setSetting } from "./store";

const API = "https://api.groq.com/openai/v1";
/** Preferred models, best first. Groq retires models over time, so the first one this key can use wins. */
const MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];
let model = MODELS[0];

export const getGroqKey = () => getSetting<string>("groq-key");
export const setGroqKey = (k: string) => setSetting("groq-key", k.trim());

/** Where the Donate buttons send people. */
export const DONATE_URL = "https://buymeacoffee.com/kingvic300";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** If Groq no longer has our model, switch to the best one this key can use. */
async function pickModel(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return false;
    const ids = new Set(((await res.json()).data ?? []).map((m: { id: string }) => m.id));
    const next = MODELS.find((m) => ids.has(m) && m !== model);
    if (!next) return false;
    model = next;
    return true;
  } catch {
    return false;
  }
}

/** One chat completion. With `json`, the model must answer with a single JSON object. */
export async function groqChat(key: string, messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });
    if (res.ok) {
      const json = await res.json();
      return String(json.choices?.[0]?.message?.content ?? "");
    }
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      msg = JSON.parse(body).error?.message ?? body;
    } catch {
      // keep raw body
    }
    if (res.status === 404 && /model/i.test(msg) && attempt === 0 && (await pickModel(key))) continue;
    throw new Error(res.status === 401 ? "Groq rejected the API key." : res.status === 429 ? "Groq’s rate limit was reached. Wait a moment and try again." : `Groq error ${res.status}: ${msg.slice(0, 200)}`);
  }
}
