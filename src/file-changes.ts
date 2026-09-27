import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export type FileChange = { path: string; kind?: string };
const MAX_TRACKED_BYTES = 2_000_000;

/**
 * Turns Codex `file_change` items into readable steps. Codex reports only the path and kind,
 * so edited line numbers come from a snapshot taken when the change starts. If the patch had
 * already landed by then, the step omits line numbers rather than guessing.
 */
export class FileChangeTracker {
  private readonly before = new Map<string, string | undefined>();

  constructor(private readonly cwd: string) {}

  started(changes: FileChange[]): void {
    for (const change of changes) {
      const path = resolve(this.cwd, change.path);
      if (!this.before.has(path)) this.before.set(path, readText(path));
    }
  }

  completed(changes: FileChange[], failed = false): string[] {
    return changes.map(change => {
      const path = resolve(this.cwd, change.path);
      const name = displayPath(this.cwd, path);
      const before = this.before.get(path);
      this.before.delete(path);
      if (failed) return `Failed to change ${name}`;
      if (change.kind === "delete") return `Deleted ${name}`;
      const after = readText(path);
      if (change.kind === "add") return after === undefined ? `Created ${name}` : `Created ${name} (${lineCount(after)} line${lineCount(after) === 1 ? "" : "s"})`;
      const range = before !== undefined && after !== undefined ? changedLines(before, after) : undefined;
      return range ? `Edited ${name} (${range})` : `Edited ${name}`;
    });
  }
}

/** One span covering every changed line, e.g. "line 3", "lines 3-9", or "removed lines 4-5". */
export function changedLines(before: string, after: string): string | undefined {
  if (before === after) return undefined;
  const a = splitLines(before);
  const b = splitLines(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const start = prefix + 1;
  const end = b.length - suffix;
  if (end >= start) return end === start ? `line ${start}` : `lines ${start}-${end}`;
  const removedEnd = a.length - suffix;
  return removedEnd === start ? `removed line ${start}` : `removed lines ${start}-${removedEnd}`;
}

export function displayPath(cwd: string, path: string): string {
  const relativePath = relative(cwd, path);
  return !relativePath || relativePath.startsWith("..") || isAbsolute(relativePath) ? path : relativePath.replace(/\\/g, "/");
}

/** Strips the shell wrapper Codex adds, e.g. `"...powershell.exe" -Command 'npm test'` becomes `npm test`. */
export function unwrapShellCommand(command: string): string {
  const match = command.match(/^\s*"?[^"]*?(?:powershell|pwsh|bash|zsh|sh|cmd)(?:\.exe)?"?\s+(?:-NoProfile\s+|-lc?\s+)?(?:-Command\s+|-c\s+|\/c\s+)?([\s\S]+)$/i);
  const inner = (match?.[1] ?? command).trim();
  return inner.replace(/^'([\s\S]*)'$/, "$1").replace(/^"([\s\S]*)"$/, "$1").replace(/\s+/g, " ").trim();
}

function readText(path: string): string | undefined {
  try {
    if (statSync(path).size > MAX_TRACKED_BYTES) return undefined;
    const text = readFileSync(path, "utf8");
    return text.includes("\0") ? undefined : text;
  } catch { return undefined; }
}

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineCount(text: string): number {
  return splitLines(text).length;
}
