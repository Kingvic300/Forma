// Calls to Groq's chat API, shared by the apps that offer AI help. The key stays on this computer.
import { getSetting, setSetting } from "./store";

const URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "llama-3.3-70b-versatile";

export const getGroqKey = () => getSetting<string>("groq-key");
export const setGroqKey = (k: string) => setSetting("groq-key", k.trim());

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** One chat completion. With `json`, the model must answer with a single JSON object. */
export async function groqChat(key: string, messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: opts.temperature ?? 0.3,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try {
      msg = JSON.parse(body).error?.message ?? body;
    } catch {
      // keep raw body
    }
    throw new Error(res.status === 401 ? "Groq rejected the API key." : `Groq error ${res.status}: ${msg.slice(0, 200)}`);
  }
  const json = await res.json();
  return String(json.choices?.[0]?.message?.content ?? "");
}
