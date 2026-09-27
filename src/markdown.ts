/** A small line-based Markdown parser for terminal rendering; styling is applied per span, never per character. */
export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type MarkdownLine =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "bullet" | "numbered"; marker: string; indent: number; inline: Inline[] }
  | { kind: "quote" | "text"; inline: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "rule" | "blank" };

export function parseMarkdown(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let inFence = false;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) { lines.push({ kind: "code", text: raw }); continue; }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    const numbered = raw.match(/^(\s*)(\d+[.)])\s+(.*)$/);
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (!raw.trim()) lines.push({ kind: "blank" });
    else if (heading) lines.push({ kind: "heading", level: heading[1].length, inline: parseInline(heading[2]) });
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) lines.push({ kind: "rule" });
    else if (bullet) lines.push({ kind: "bullet", marker: "•", indent: Math.floor(bullet[1].replace(/\t/g, "  ").length / 2), inline: parseInline(bullet[2]) });
    else if (numbered) lines.push({ kind: "numbered", marker: numbered[2], indent: Math.floor(numbered[1].replace(/\t/g, "  ").length / 2), inline: parseInline(numbered[3]) });
    else if (quote) lines.push({ kind: "quote", inline: parseInline(quote[1]) });
    else lines.push({ kind: "text", inline: parseInline(raw.trimEnd()) });
  }
  // Collapse runs of blank lines so model output stays compact.
  return lines.filter((line, index) => line.kind !== "blank" || (index > 0 && lines[index - 1].kind !== "blank"));
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(?<!\w)_(?!\s)([^_]+?)_(?!\w)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    if (match[1] ?? match[2]) parts.push({ text: (match[1] ?? match[2])!, bold: true });
    else if (match[3]) parts.push({ text: match[3], code: true });
    else if (match[4]) parts.push({ text: match[4] }, { text: ` (${match[5]})`, italic: true });
    else parts.push({ text: (match[6] ?? match[7])!, italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length ? parts : [{ text: "" }];
}

/** Plain one-line text from Markdown, e.g. a reasoning summary title `**Checking files**`. */
export function plainText(markdown: string): string {
  return parseInline(markdown.replace(/^\s*#+\s*/, "")).map(part => part.text).join("").replace(/\s+/g, " ").trim();
}
