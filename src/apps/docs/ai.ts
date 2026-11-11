// Groq help for Docs: write, rewrite, translate, summarise, and a chat that can edit the document.
// Answers come back as HTML, cleaned before they touch the page, and go in as one undo step.
import { groqChat, type ChatMessage } from "../../lib/groq";

const HTML_RULES = `Answer with HTML only, no markdown and no code fences. Use only these tags: p, h1 (title), h2-h5 (headings), ul, ol, li, b, i, u, s, a, br, blockquote, pre, table, tr, th, td, hr, sub, sup, span with a style attribute. Keep any <img src="img:N"> tags you are given exactly as they are.`;

const unfence = (s: string) => s.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();

export const REWRITES: [string, string][] = [
  ["Improve writing", "Improve the writing: clearer and more fluent, same meaning and length."],
  ["Fix spelling & grammar", "Fix spelling, grammar and punctuation only. Change nothing else."],
  ["Make shorter", "Make it noticeably shorter, keeping the key points."],
  ["Make longer", "Expand it with more detail, same tone."],
  ["More formal", "Rewrite it in a more formal, professional tone."],
  ["More casual", "Rewrite it in a more casual, friendly tone."],
  ["Simplify", "Rewrite it in simpler words a 12-year-old would follow."],
  ["Turn into bullet points", "Turn it into a bulleted list of the key points."],
  ["Turn into a table", "Organise the information as an HTML table with a header row."],
];

/** Rewrite the selected HTML following an instruction; returns HTML to put in its place. */
export async function rewrite(key: string, html: string, instruction: string) {
  const out = await groqChat(key, [
    { role: "system", content: `You edit part of a document. ${instruction} Keep inline formatting where it still fits. ${HTML_RULES} Return only the rewritten passage.` },
    { role: "user", content: html },
  ]);
  return unfence(out);
}

/** "Help me write": new content from a prompt, with the document around it as context. */
export async function write(key: string, prompt: string, context: string) {
  const out = await groqChat(key, [
    { role: "system", content: `You write content for the user's document. ${HTML_RULES} Return only the new content.` },
    { role: "user", content: `Document so far (for context, may be empty):\n${context.slice(0, 8000)}\n\nWrite: ${prompt}` },
  ], { temperature: 0.7 });
  return unfence(out);
}

export type DocAction = "none" | "insert" | "replace_selection" | "replace_document";
export interface DocReply {
  reply: string;
  action: DocAction;
  html: string;
}

const CHAT_SYSTEM = `You are the AI assistant inside a document editor. You get the document's HTML, the user's selection (if any) and their request.
Reply with one JSON object: {"reply": "<short message to the user>", "action": "none" | "insert" | "replace_selection" | "replace_document", "html": "<html for the action, or empty>"}.
- Answer questions about the document with action "none".
- To add new content at the cursor use "insert".
- To change only the selected text use "replace_selection" (only when there is a selection).
- To change the document as a whole use "replace_document" and return the complete new document HTML, keeping everything the user did not ask to change.
${HTML_RULES}
Never output anything outside the JSON object.`;

export async function chat(key: string, doc: string, selection: string, history: ChatMessage[], request: string): Promise<DocReply> {
  const content = await groqChat(
    key,
    [
      { role: "system", content: CHAT_SYSTEM },
      ...history,
      { role: "user", content: `Document HTML:\n${doc.slice(0, 24000)}\n\nSelection:\n${selection || "(none)"}\n\nRequest: ${request}` },
    ],
    { json: true, temperature: 0.2 },
  );
  let p: Partial<DocReply>;
  try {
    p = JSON.parse(content);
  } catch {
    throw new Error("The AI answered in a form I couldn't read. Try again.");
  }
  const action: DocAction = ["insert", "replace_selection", "replace_document"].includes(String(p.action)) ? (p.action as DocAction) : "none";
  return { reply: String(p.reply ?? ""), action, html: unfence(String(p.html ?? "")) };
}
