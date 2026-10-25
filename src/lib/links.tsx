// Finding web addresses and emails in plain text, and opening them safely.
import { Fragment } from "react";
import { openExternal } from "./platform";

const LINK = /\b(?:https?:\/\/[^\s<>"'`]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'`]*|[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi;

export interface Link {
  text: string;
  href: string;
  index: number;
}

/** Sentence punctuation after a URL is not part of it; a closing bracket only is when it has an opener. */
function trimEnd(s: string) {
  while (/[.,;:!?'"’”)\]}]$/.test(s)) {
    const last = s[s.length - 1];
    const open = { ")": "(", "]": "[", "}": "{" }[last];
    if (open && s.split(open).length > s.split(last).length - 1) break;
    s = s.slice(0, -1);
  }
  return s;
}

export function hrefFor(text: string) {
  if (/^https?:\/\//i.test(text)) return text;
  if (/^www\./i.test(text)) return "https://" + text;
  if (text.includes("@")) return "mailto:" + text;
  return null;
}

/** Only web pages and email are opened; anything else (file:, javascript:, custom schemes) is refused. */
export const isSafeHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

export function findLinks(text: string): Link[] {
  if (!text || !/[.@]/.test(text)) return [];
  const out: Link[] = [];
  for (const m of text.matchAll(LINK)) {
    const t = trimEnd(m[0]);
    const href = hrefFor(t);
    if (href) out.push({ text: t, href, index: m.index! });
  }
  return out;
}

export function openLink(href: string) {
  if (isSafeHref(href)) openExternal(href);
}

/** Plain text with any addresses in it rendered as links that open in the browser. */
export function Linkify({ text }: { text: string }) {
  const links = findLinks(text);
  if (!links.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  links.forEach((l, i) => {
    parts.push(<Fragment key={"t" + i}>{text.slice(at, l.index)}</Fragment>);
    parts.push(
      <a
        key={"a" + i}
        href={l.href}
        className="ext-link"
        title={l.href.replace(/^mailto:/, "")}
        onClick={(e) => {
          e.preventDefault();
          openLink(l.href);
        }}
      >
        {l.text}
      </a>,
    );
    at = l.index + l.text.length;
  });
  parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

/** Wrap bare addresses in an HTML tree with <a> tags. Existing links are left alone. */
export function linkifyElement(root: HTMLElement) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("a,script,style,code,pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const links = findLinks(text);
    if (!links.length) continue;
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const l of links) {
      frag.append(text.slice(at, l.index));
      const a = doc.createElement("a");
      a.href = l.href;
      a.textContent = l.text;
      frag.append(a);
      at = l.index + l.text.length;
      count++;
    }
    frag.append(text.slice(at));
    node.replaceWith(frag);
  }
  return count;
}

export function linkifyHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  linkifyElement(doc.body);
  return doc.body.innerHTML;
}
