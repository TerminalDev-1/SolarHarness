import { icon } from "./icons.js";

/**
 * Renders Solar's Markdown replies with DOM APIs only (never innerHTML), so model text can't inject markup.
 * Covers what replies use: headings, lists, quotes, rules, tables, fenced code, and inline code/bold/italic/links.
 */
export function renderMarkdown(markdown) {
  const root = document.createElement("div");
  root.className = "markdown";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let list;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" "));
    root.append(p);
    paragraph = [];
  };
  const closeList = () => { list = undefined; };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const fence = raw.match(/^\s*(```|~~~)\s*([\w+#.-]*)/);
    if (fence) {
      flushParagraph(); closeList();
      const body = [];
      while (++index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index]);
      root.append(codeBlock(body.join("\n"), fence[2]));
      continue;
    }
    if (!raw.trim()) { flushParagraph(); closeList(); continue; }
    if (/^\s*\|.*\|\s*$/.test(raw) && /^\s*\|?\s*:?-{2,}/.test(lines[index + 1] ?? "")) {
      flushParagraph(); closeList();
      const rows = [raw];
      index++;
      while (index + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[index + 1])) rows.push(lines[++index]);
      root.append(table(rows));
      continue;
    }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushParagraph(); closeList();
      const h = document.createElement(`h${Math.min(heading[1].length + 1, 5)}`);
      appendInline(h, heading[2]);
      root.append(h);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) { flushParagraph(); closeList(); root.append(document.createElement("hr")); continue; }
    const item = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushParagraph();
      const ordered = /\d/.test(item[2]);
      const depth = Math.floor(item[1].replace(/\t/g, "  ").length / 2);
      if (!list || list.ordered !== ordered || depth === 0 && list.depth !== 0) {
        const element = document.createElement(ordered ? "ol" : "ul");
        if (ordered) element.start = Number.parseInt(item[2], 10);
        (depth > 0 && list ? list.element.lastElementChild ?? root : root).append(element);
        list = { element, ordered, depth };
      }
      const li = document.createElement("li");
      appendInline(li, item[3].replace(/^\[( |x)\]\s+/i, (_m, mark) => mark.trim() ? "✓ " : "○ "));
      list.element.append(li);
      continue;
    }
    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph(); closeList();
      const last = root.lastElementChild;
      const block = last?.tagName === "BLOCKQUOTE" ? last : root.appendChild(document.createElement("blockquote"));
      if (block.childNodes.length) block.append(document.createElement("br"));
      appendInline(block, quote[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { appendInline(list.element.lastElementChild, ` ${raw.trim()}`); continue; }
    closeList();
    paragraph.push(raw.trim());
  }
  flushParagraph();
  return root;
}

function codeBlock(code, language) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  const head = document.createElement("div");
  head.className = "code-head";
  const label = document.createElement("span");
  label.textContent = language || "code";
  const copy = document.createElement("button");
  copy.className = "code-copy";
  copy.append(icon("copy"), document.createTextNode("Copy"));
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(code);
    copy.lastChild.textContent = "Copied";
    setTimeout(() => { copy.lastChild.textContent = "Copy"; }, 1400);
  });
  head.append(label, copy);
  const pre = document.createElement("pre");
  const element = document.createElement("code");
  element.textContent = code;
  pre.append(element);
  wrapper.append(head, pre);
  return wrapper;
}

function table(rows) {
  const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
  const element = document.createElement("table");
  const head = element.createTHead().insertRow();
  for (const cell of cells(rows[0])) { const th = document.createElement("th"); appendInline(th, cell); head.append(th); }
  const body = element.createTBody();
  for (const row of rows.slice(1)) {
    const tr = body.insertRow();
    for (const cell of cells(row)) appendInline(tr.insertCell(), cell);
  }
  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  wrapper.append(element);
  return wrapper;
}

export function appendInline(parent, text) {
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(?<!\w)_(?!\s)([^_]+?)_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    if (match[1]) { const code = document.createElement("code"); code.textContent = match[1]; parent.append(code); }
    else if (match[2] ?? match[3]) { const strong = document.createElement("strong"); appendInline(strong, match[2] ?? match[3]); parent.append(strong); }
    else if (match[4]) parent.append(link(match[4], match[5]));
    else if (match[8]) parent.append(link(match[8], match[8]));
    else { const em = document.createElement("em"); appendInline(em, match[6] ?? match[7]); parent.append(em); }
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function link(label, href) {
  if (!/^https?:\/\//i.test(href)) {
    const code = document.createElement("code");
    code.textContent = label;
    code.title = href;
    return code;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  return anchor;
}
