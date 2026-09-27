import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { diffWordsWithSpace, structuredPatch } from "diff";

const SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "out", ".next", ".solarharness", "__pycache__", ".venv"]);
const MAX_FILES = 4000;
const MAX_BYTES = 1_000_000;

/**
 * Codex reports only which files changed, so the desktop app keeps its own copy of the
 * workspace's text files. When Solar reports `File: Edited x`, the copy is diffed against
 * disk to get real red/green lines, then refreshed. `original` keeps each file as it was
 * before Solar first touched it, for the session-wide Changes view.
 */
export class ChangeTracker {
  constructor(workspace) {
    this.workspace = workspace;
    this.cache = new Map();
    this.original = new Map();
    this.ready = Promise.resolve();
  }

  setWorkspace(workspace) {
    this.workspace = workspace;
    this.cache.clear();
    this.original.clear();
  }

  reset() {
    this.original.clear();
  }

  /** Refreshes the copy before a turn so diffs start from what is on disk now. */
  snapshot() {
    this.ready = this.walk(this.workspace, 0, { count: 0 }).catch(() => {});
    return this.ready;
  }

  async walk(directory, depth, budget) {
    if (depth > 8 || budget.count >= MAX_FILES) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (budget.count >= MAX_FILES) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await this.walk(path, depth + 1, budget);
      } else if (entry.isFile()) {
        budget.count++;
        const text = await readText(path);
        if (text !== undefined) this.cache.set(path, text);
      }
    }
  }

  /** Turns a `File: ...` activity line into a diff, or undefined for any other line. */
  async fromEvent(event) {
    const match = event.match(/^File: (Created|Edited|Deleted|Failed to change) (.+?)(?: \((?:\d+ lines?|lines? [\d-]+|removed lines? [\d-]+)\))?$/);
    if (!match) return undefined;
    await this.ready;
    const verb = match[1];
    const path = isAbsolute(match[2]) ? match[2] : resolve(this.workspace, match[2]);
    const name = displayName(this.workspace, path);
    if (verb === "Failed to change") return { path, name, kind: "failed", hunks: [], added: 0, removed: 0 };
    const before = verb === "Created" ? "" : this.cache.get(path) ?? "";
    const after = verb === "Deleted" ? "" : await readText(path) ?? "";
    if (!this.original.has(path)) this.original.set(path, verb === "Created" ? null : before);
    if (verb === "Deleted") this.cache.delete(path); else this.cache.set(path, after);
    const kind = verb === "Created" ? "added" : verb === "Deleted" ? "deleted" : "modified";
    return { path, name, kind, ...lineDiff(before, after) };
  }

  /** Every file Solar changed this session, diffed from before its first change to now. */
  async sessionChanges() {
    const files = [];
    for (const [path, original] of this.original) {
      const current = await readText(path);
      const kind = original === null ? (current === undefined ? undefined : "added") : current === undefined ? "deleted" : "modified";
      if (!kind) continue;
      const diff = lineDiff(original ?? "", current ?? "");
      if (kind === "modified" && !diff.added && !diff.removed) continue;
      files.push({ path, name: displayName(this.workspace, path), kind, ...diff });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
}

/**
 * Hunks of `{ type: " " | "+" | "-", text, old?, new?, parts? }` lines. A removed line followed by
 * its replacement gets `parts` marking the changed words, so small edits stand out inside a line.
 */
export function lineDiff(before, after, context = 3) {
  const patch = structuredPatch("a", "b", normalize(before), normalize(after), "", "", { context });
  let added = 0;
  let removed = 0;
  const hunks = patch.hunks.map(hunk => {
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    const lines = [];
    for (const raw of hunk.lines) {
      const type = raw[0];
      if (type === "\\") continue;
      const text = raw.slice(1);
      if (type === "+") { added++; lines.push({ type, text, new: newLine++ }); }
      else if (type === "-") { removed++; lines.push({ type, text, old: oldLine++ }); }
      else lines.push({ type: " ", text, old: oldLine++, new: newLine++ });
    }
    markWordChanges(lines);
    return { oldStart: hunk.oldStart, newStart: hunk.newStart, lines };
  });
  return { hunks, added, removed };
}

function markWordChanges(lines) {
  for (let index = 0; index < lines.length;) {
    if (lines[index].type !== "-") { index++; continue; }
    let removedEnd = index;
    while (removedEnd < lines.length && lines[removedEnd].type === "-") removedEnd++;
    let addedEnd = removedEnd;
    while (addedEnd < lines.length && lines[addedEnd].type === "+") addedEnd++;
    const pairs = Math.min(removedEnd - index, addedEnd - removedEnd);
    for (let offset = 0; offset < pairs; offset++) {
      const oldLine = lines[index + offset];
      const newLine = lines[removedEnd + offset];
      if (oldLine.text.length + newLine.text.length > 2000) continue;
      const words = diffWordsWithSpace(oldLine.text, newLine.text);
      const unchanged = words.filter(part => !part.added && !part.removed).reduce((sum, part) => sum + part.value.length, 0);
      // Mostly rewritten lines read better whole than as confetti.
      if (unchanged < Math.max(oldLine.text.length, newLine.text.length) * 0.35) continue;
      oldLine.parts = words.filter(part => !part.added).map(part => ({ text: part.value, changed: Boolean(part.removed) }));
      newLine.parts = words.filter(part => !part.removed).map(part => ({ text: part.value, changed: Boolean(part.added) }));
    }
    index = addedEnd;
  }
}

function normalize(text) {
  const unix = text.replace(/\r\n/g, "\n");
  return unix && !unix.endsWith("\n") ? `${unix}\n` : unix;
}

export function displayName(workspace, path) {
  const name = relative(workspace, path);
  return !name || name.startsWith("..") || isAbsolute(name) ? path : name.replace(/\\/g, "/");
}

async function readText(path) {
  try {
    if ((await stat(path)).size > MAX_BYTES) return undefined;
    const text = await readFile(path, "utf8");
    return text.includes("\0") ? undefined : text;
  } catch { return undefined; }
}
