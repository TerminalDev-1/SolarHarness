import { icon } from "./icons.js";

/**
 * A unified diff: old and new line numbers, a +/- gutter, green and red rows, and brighter
 * highlights on the exact words that changed. `limit` caps the rows for inline previews.
 */
export function renderDiff(file, { limit = Infinity } = {}) {
  const view = document.createElement("div");
  view.className = "diff";
  if (file.kind === "failed") { view.append(notice("Solar tried to change this file, but the change failed.")); return view; }
  if (!file.hunks.length) { view.append(notice(file.kind === "deleted" ? "File deleted." : "No line changes (empty or binary file).")); return view; }

  let shown = 0;
  let total = 0;
  for (const hunk of file.hunks) total += hunk.lines.length;
  for (const [index, hunk] of file.hunks.entries()) {
    if (shown >= limit) break;
    if (index > 0 || hunk.oldStart > 1 || hunk.newStart > 1) {
      const separator = document.createElement("div");
      separator.className = "diff-hunk";
      separator.append(icon("dot"), document.createTextNode(`@@ -${hunk.oldStart} +${hunk.newStart} @@`));
      view.append(separator);
    }
    for (const line of hunk.lines) {
      if (shown++ >= limit) break;
      view.append(row(line));
    }
  }
  if (total > limit) {
    const more = document.createElement("div");
    more.className = "diff-more";
    more.textContent = `${total - limit} more line${total - limit === 1 ? "" : "s"}`;
    view.append(more);
  }
  return view;
}

function row(line) {
  const element = document.createElement("div");
  element.className = `diff-row ${line.type === "+" ? "add" : line.type === "-" ? "del" : "ctx"}`;
  const oldNumber = document.createElement("span");
  oldNumber.className = "ln";
  oldNumber.textContent = line.old ?? "";
  const newNumber = document.createElement("span");
  newNumber.className = "ln";
  newNumber.textContent = line.new ?? "";
  const sign = document.createElement("span");
  sign.className = "sign";
  sign.textContent = line.type === " " ? "" : line.type === "-" ? "−" : "+";
  const code = document.createElement("span");
  code.className = "code";
  if (line.parts) {
    for (const part of line.parts) {
      if (!part.changed) { code.append(document.createTextNode(part.text)); continue; }
      const mark = document.createElement("mark");
      mark.textContent = part.text;
      code.append(mark);
    }
  } else code.textContent = line.text || " ";
  element.append(oldNumber, newNumber, sign, code);
  return element;
}

function notice(text) {
  const element = document.createElement("div");
  element.className = "diff-notice";
  element.textContent = text;
  return element;
}

/** "+12 −3" as two colored spans, plus a five-block bar like GitHub's. */
export function diffStat(added, removed, { bar = false } = {}) {
  const wrapper = document.createElement("span");
  wrapper.className = "diffstat";
  const plus = document.createElement("span");
  plus.className = "plus";
  plus.textContent = `+${added}`;
  const minus = document.createElement("span");
  minus.className = "minus";
  minus.textContent = `−${removed}`;
  wrapper.append(plus, minus);
  if (bar) {
    const blocks = document.createElement("span");
    blocks.className = "blocks";
    const total = added + removed;
    const green = total ? Math.round((added / total) * 5) : 0;
    const red = total ? Math.min(5 - green, Math.max(removed ? 1 : 0, Math.round((removed / total) * 5))) : 0;
    for (let index = 0; index < 5; index++) {
      const block = document.createElement("i");
      block.className = index < green ? "g" : index < green + red ? "r" : "";
      blocks.append(block);
    }
    wrapper.append(blocks);
  }
  return wrapper;
}

export function fileIcon(kind) {
  return icon(kind === "added" ? "file-plus" : kind === "deleted" ? "file-minus" : kind === "failed" ? "alert" : "file", `file-kind ${kind}`);
}

export function splitName(name) {
  const slash = name.lastIndexOf("/");
  return slash < 0 ? { dir: "", base: name } : { dir: name.slice(0, slash + 1), base: name.slice(slash + 1) };
}
