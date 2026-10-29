// Ask Groq to edit the open PDF. The model never touches the file: it answers with a short list of
// operations (change a block of text, add a shape, move or delete something) that Pdf.tsx applies
// as ordinary annotations, so one Ctrl+Z takes the whole answer back.
import { getSetting, setSetting } from "../../lib/store";

const URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "llama-3.3-70b-versatile";

export const getGroqKey = () => getSetting<string>("groq-key");
export const setGroqKey = (k: string) => setSetting("groq-key", k.trim());

export type AiOp =
  | { op: "edit_text"; block: string; text: string }
  | { op: "add_text"; page: number; x: number; y: number; text: string; size?: number; color?: string; bold?: boolean }
  | { op: "add_shape"; type: "rect" | "line" | "highlight" | "whiteout" | "redact"; page: number; x: number; y: number; w?: number; h?: number; x2?: number; y2?: number; color?: string; thick?: number }
  | { op: "update"; id: string; text?: string; x?: number; y?: number; w?: number; h?: number; x2?: number; y2?: number; size?: number; color?: string; bold?: boolean; thick?: number }
  | { op: "delete"; id: string };

export interface AiReply {
  reply: string;
  ops: AiOp[];
}

const SYSTEM = `You edit a PDF for the user by answering with JSON only.
Coordinates are PDF points from the page's top-left (x right, y down). Page numbers start at 0.
You get: page sizes, "blocks" (text already printed on the page, each with an id, page, x, y and text) and "annotations" (things the user or you already added, each with an id).
Reply with one JSON object: {"reply": "<short message to the user>", "ops": [ ... ]}.
Each op is one of:
 {"op":"edit_text","block":"<block id>","text":"<full new text of that block, \\n between lines>"}
 {"op":"add_text","page":0,"x":72,"y":100,"text":"...","size":14,"color":"#000000","bold":false}
 {"op":"add_shape","type":"rect|line|highlight|whiteout|redact","page":0,"x":0,"y":0,"w":100,"h":20,"color":"#e53935","thick":2}   (for "line" use x2,y2 for the far end instead of w,h)
 {"op":"update","id":"<annotation id>", ...only the fields to change: text,x,y,w,h,x2,y2,size,color,bold,thick}
 {"op":"delete","id":"<annotation id>"}
Rules: only edit what the user asked for. Keep the rest of a block's text unchanged when editing part of it. Use block ids exactly as given. If the request is a question or can't be done, return "ops": [] and explain in "reply". Never output anything outside the JSON object.`;

export async function askAi(key: string, context: string, history: { role: "user" | "assistant"; content: string }[], request: string): Promise<AiReply> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        ...history,
        { role: "user", content: `Current PDF:\n${context}\n\nRequest: ${request}` },
      ],
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
  const content: string = json.choices?.[0]?.message?.content ?? "";
  let parsed: Partial<AiReply>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("The AI answered in a form I couldn't read. Try again.");
  }
  return { reply: String(parsed.reply ?? ""), ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
}
