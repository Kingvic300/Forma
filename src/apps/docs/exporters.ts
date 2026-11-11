// Turn the live Docs page into a Word file or Markdown. Styles are read with getComputedStyle,
// so whatever the page shows (headings, sizes, colours, highlights) carries over.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type ParagraphChild,
} from "docx";
import type { PageSetup } from "./setup";
import { PAPER } from "./setup";

const twip = (px: number) => Math.round(px * 15); // CSS px (1/96 in) to 1/20 pt
const toHex = (rgb: string) => {
  const m = rgb.match(/\d+(\.\d+)?/g);
  if (!m || (m.length > 3 && Number(m[3]) === 0)) return undefined;
  return m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
};
const isBlock = (el: Element) => /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|UL|OL|LI|TABLE|HR)$/.test(el.tagName);

type ImgData = { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; w: number; h: number };

async function imageData(img: HTMLImageElement, maxW: number): Promise<ImgData | null> {
  try {
    if (!img.complete) await img.decode();
    const src = img.currentSrc || img.src;
    let w = img.offsetWidth || img.naturalWidth;
    let h = img.offsetHeight || img.naturalHeight;
    if (w > maxW) [w, h] = [maxW, (h * maxW) / w];
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,/.exec(src);
    if (m) {
      const bytes = Uint8Array.from(atob(src.slice(src.indexOf(",") + 1)), (c) => c.charCodeAt(0));
      return { data: bytes, type: m[1].startsWith("jp") ? "jpg" : (m[1] as "png"), w, h };
    }
    // Other formats (and linked images) go through a canvas as PNG.
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"));
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), type: "png", w, h } : null;
  } catch {
    return null; // an image that can't be read (e.g. blocked by its server) is left out
  }
}

export async function toDocx(page: HTMLElement, setup: PageSetup): Promise<Uint8Array> {
  const paper = PAPER[setup.paper];
  const landscape = setup.orientation === "landscape";
  const contentW = (landscape ? paper.h : paper.w) * 96 - (setup.margins.left + setup.margins.right) * 96;
  const images = new Map<HTMLImageElement, ImgData | null>();
  for (const img of page.querySelectorAll("img")) images.set(img, await imageData(img, contentW));

  /** Text runs (and pictures, links, line breaks) for the inline content of an element. */
  function inline(nodes: Node[], block: HTMLElement, extra: { prefix?: string } = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    if (extra.prefix) out.push(new TextRun({ text: extra.prefix }));
    const runOf = (text: string, el: HTMLElement) => {
      const cs = getComputedStyle(el);
      let underline = false;
      let strike = false;
      let shade: string | undefined;
      for (let e: HTMLElement | null = el; e && e !== block.parentElement; e = e.parentElement) {
        const d = getComputedStyle(e).textDecorationLine;
        underline ||= d.includes("underline");
        strike ||= d.includes("line-through");
        if (!shade && e !== block && !/^(TD|TH)$/.test(e.tagName)) shade = toHex(getComputedStyle(e).backgroundColor);
      }
      const color = toHex(cs.color);
      return new TextRun({
        text,
        bold: Number(cs.fontWeight) >= 600,
        italics: cs.fontStyle === "italic",
        underline: underline ? {} : undefined,
        strike,
        color: color && color !== "000000" ? color : undefined,
        size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2),
        font: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim() || undefined,
        superScript: !!el.closest("sup"),
        subScript: !!el.closest("sub"),
        shading: shade ? { type: ShadingType.CLEAR, color: "auto", fill: shade } : undefined,
      });
    };
    const walk = (n: Node, sink: ParagraphChild[]) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = (n.nodeValue ?? "").replace(/\s+/g, block.tagName === "PRE" ? "$&" : " ");
        if (t) sink.push(runOf(t, n.parentElement!));
        return;
      }
      if (!(n instanceof HTMLElement)) return;
      if (n.tagName === "BR") return void sink.push(new TextRun({ text: "", break: 1 }));
      if (n.tagName === "IMG") {
        const d = images.get(n as HTMLImageElement);
        if (d) sink.push(new ImageRun({ type: d.type, data: d.data, transformation: { width: d.w, height: d.h } } as ConstructorParameters<typeof ImageRun>[0]));
        return;
      }
      if (n.tagName === "A" && /^(https?:|mailto:)/i.test(n.getAttribute("href") ?? "")) {
        const kids: ParagraphChild[] = [];
        n.childNodes.forEach((c) => walk(c, kids));
        sink.push(new ExternalHyperlink({ link: n.getAttribute("href")!, children: kids as TextRun[] }));
        return;
      }
      n.childNodes.forEach((c) => walk(c, sink));
    };
    nodes.forEach((n) => walk(n, out));
    return out;
  }

  function paraProps(el: HTMLElement, root: HTMLElement) {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 14.67;
    const lh = cs.lineHeight === "normal" ? 1.15 : parseFloat(cs.lineHeight) / size;
    const align = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, end: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]>;
    let left = 0;
    for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
      if (e.tagName === "UL" || e.tagName === "OL" || e.tagName === "LI") continue;
      const s = getComputedStyle(e);
      left += parseFloat(s.marginLeft) + parseFloat(s.paddingLeft);
    }
    return {
      alignment: align[cs.textAlign] ?? AlignmentType.LEFT,
      spacing: { before: twip(parseFloat(cs.marginTop) || 0), after: twip(parseFloat(cs.marginBottom) || 0), line: Math.round(lh * 240) },
      indent: left > 1 ? { left: twip(left) } : undefined,
    };
  }

  const HEADING: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = { H1: HeadingLevel.TITLE, H2: HeadingLevel.HEADING_1, H3: HeadingLevel.HEADING_2, H4: HeadingLevel.HEADING_3, H5: HeadingLevel.HEADING_4, H6: HeadingLevel.HEADING_5 };

  function blocks(el: HTMLElement, root: HTMLElement, level = 0): FileChild[] {
    const out: FileChild[] = [];
    let loose: Node[] = [];
    const flush = () => {
      if (loose.some((n) => (n.textContent ?? "").trim() || (n as HTMLElement).tagName === "IMG")) out.push(new Paragraph({ ...paraProps(el, root), children: inline(loose, el) }));
      loose = [];
    };
    el.childNodes.forEach((n) => {
      if (!(n instanceof HTMLElement) || !isBlock(n)) {
        if (!(n instanceof HTMLElement && n.classList.contains("page-break"))) return void loose.push(n);
      }
      flush();
      const b = n as HTMLElement;
      if (b.classList.contains("page-break")) return void out.push(new Paragraph({ children: [new PageBreak()] }));
      if (b.tagName === "HR") return void out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 4 } }, children: [] }));
      if (b.tagName === "UL" || b.tagName === "OL") return void out.push(...list(b, root, level));
      if (b.tagName === "TABLE") return void out.push(table(b as HTMLTableElement, root));
      const hasBlocks = [...b.children].some((c) => isBlock(c));
      if (hasBlocks) return void out.push(...blocks(b, root, level));
      out.push(new Paragraph({ ...paraProps(b, root), heading: b.classList.contains("subtitle") ? undefined : HEADING[b.tagName], children: inline([...b.childNodes], b) }));
    });
    flush();
    return out;
  }
  function list(b: HTMLElement, root: HTMLElement, level: number): FileChild[] {
    const out: FileChild[] = [];
    const check = b.classList.contains("checklist");
    for (const li of b.children) {
      if (!(li instanceof HTMLElement)) continue;
      const nested = [...li.children].filter((c) => c.tagName === "UL" || c.tagName === "OL") as HTMLElement[];
      const own = [...li.childNodes].filter((c) => !nested.includes(c as HTMLElement));
      out.push(
        new Paragraph({
          ...paraProps(li, root),
          indent: undefined,
          numbering: check ? undefined : { reference: b.tagName === "OL" ? "numbers" : "bullets", level: Math.min(level, 8) },
          children: inline(own, li, check ? { prefix: li.classList.contains("checked") ? "☑ " : "☐ " } : {}),
        }),
      );
      for (const sub of nested) out.push(...list(sub, root, level + 1));
    }
    return out;
  }

  function table(t: HTMLTableElement, root: HTMLElement) {
    const rows = [...t.rows];
    const total = t.offsetWidth || contentW;
    const widths = [...(rows[0]?.cells ?? [])].map((c) => twip((c.offsetWidth / total) * Math.min(total, contentW)));
    return new Table({
      width: { size: twip(Math.min(total, contentW)), type: WidthType.DXA },
      columnWidths: widths,
      rows: rows.map(
        (r) =>
          new TableRow({
            tableHeader: [...r.cells].every((c) => c.tagName === "TH"),
            children: [...r.cells].map((c) => {
              const cs = getComputedStyle(c);
              const border = { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(parseFloat(cs.borderTopWidth) * 6)), color: toHex(cs.borderTopColor) ?? "999999" };
              const fill = toHex(cs.backgroundColor);
              const inner = blocks(c, root);
              return new TableCell({
                columnSpan: c.colSpan > 1 ? c.colSpan : undefined,
                rowSpan: c.rowSpan > 1 ? c.rowSpan : undefined,
                width: { size: twip((c.offsetWidth / total) * Math.min(total, contentW)), type: WidthType.DXA },
                shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
                borders: { top: border, bottom: border, left: border, right: border },
                margins: { top: twip(4), bottom: twip(4), left: twip(6), right: twip(6) },
                children: inner.length ? inner : [new Paragraph({ children: [] })],
              });
            }),
          }),
      ),
    });
  }

  const children = blocks(page, page);
  const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (i: number) => string) =>
    Array.from({ length: 9 }, (_, i) => ({ level: i, format, text: text(i), alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } }));
  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    numbering: {
      config: [
        { reference: "bullets", levels: levels(LevelFormat.BULLET, (i) => ["●", "○", "■"][i % 3]) },
        { reference: "numbers", levels: levels(LevelFormat.DECIMAL, (i) => `%${i + 1}.`) },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twip(paper.w * 96), height: twip(paper.h * 96), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: twip(setup.margins.top * 96), bottom: twip(setup.margins.bottom * 96), left: twip(setup.margins.left * 96), right: twip(setup.margins.right * 96) },
          },
          column: setup.columns > 1 ? { count: setup.columns, space: 720 } : undefined,
        },
        children: children.length ? children : [new Paragraph({ children: [] })],
      },
    ],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

/** Markdown with headings, emphasis, links, lists, tables, quotes and code blocks. */
export function toMarkdown(page: HTMLElement): string {
  const inl = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.nodeValue ?? "").replace(/\s+/g, " ").replace(/([*_`[\]])/g, "\\$1");
    if (!(n instanceof HTMLElement)) return "";
    const kids = [...n.childNodes].map(inl).join("");
    const cs = n.style;
    switch (n.tagName) {
      case "BR": return "  \n";
      case "B": case "STRONG": return kids.trim() ? `**${kids}**` : kids;
      case "I": case "EM": return kids.trim() ? `*${kids}*` : kids;
      case "S": case "STRIKE": case "DEL": return kids.trim() ? `~~${kids}~~` : kids;
      case "CODE": return `\`${n.textContent}\``;
      case "A": return `[${kids}](${n.getAttribute("href") ?? ""})`;
      case "IMG": return `![${n.getAttribute("alt") ?? ""}](${(n as HTMLImageElement).src.startsWith("data:") ? "image" : (n as HTMLImageElement).src})`;
    }
    if (Number(cs.fontWeight) >= 600 || cs.fontWeight === "bold") return kids.trim() ? `**${kids}**` : kids;
    if (cs.fontStyle === "italic") return kids.trim() ? `*${kids}*` : kids;
    return kids;
  };
  const block = (el: HTMLElement, depth = 0): string[] => {
    const out: string[] = [];
    let loose = "";
    const flush = () => {
      if (loose.trim()) out.push(loose.trim());
      loose = "";
    };
    el.childNodes.forEach((n) => {
      if (!(n instanceof HTMLElement) || !isBlock(n)) return void (loose += inl(n));
      flush();
      const t = n.tagName;
      if (n.classList.contains("page-break")) return void out.push("---");
      if (/^H[1-6]$/.test(t)) return void out.push(`${"#".repeat(Number(t[1]))} ${inl(n).trim()}`);
      if (t === "HR") return void out.push("---");
      if (t === "PRE") return void out.push("```\n" + n.innerText.replace(/\n$/, "") + "\n```");
      if (t === "BLOCKQUOTE") return void out.push(block(n).join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
      if (t === "UL" || t === "OL") {
        const lines: string[] = [];
        [...n.children].forEach((li, i) => {
          const nested = [...li.children].filter((c) => c.tagName === "UL" || c.tagName === "OL") as HTMLElement[];
          const own = [...li.childNodes].filter((c) => !nested.includes(c as HTMLElement)).map(inl).join("").trim();
          const mark = n.classList.contains("checklist") ? `- [${li.classList.contains("checked") ? "x" : " "}]` : t === "OL" ? `${i + 1}.` : "-";
          lines.push(`${"  ".repeat(depth)}${mark} ${own}`);
          for (const sub of nested) {
            const holder = document.createElement("div");
            holder.append(sub.cloneNode(true));
            lines.push(...block(holder, depth + 1));
          }
        });
        return void out.push(lines.join("\n"));
      }
      if (t === "TABLE") {
        const rows = [...(n as HTMLTableElement).rows].map((r) => [...r.cells].map((c) => inl(c).trim().replace(/\|/g, "\\|") || " "));
        if (!rows.length) return;
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${[...r, ...Array(cols - r.length).fill(" ")].join(" | ")} |`;
        return void out.push([line(rows[0]), `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n"));
      }
      if ([...n.children].some(isBlock)) return void out.push(...block(n, depth));
      const text = inl(n).trim();
      if (text) out.push(text);
    });
    flush();
    return out;
  };
  return block(page).join("\n\n") + "\n";
}
