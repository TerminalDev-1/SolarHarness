import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const MAX_IMAGES = 8;

/**
 * Image files a message refers to: quoted or bare paths (what Windows Terminal pastes when a file is
 * dragged in), optionally prefixed with @, absolute or relative to the workspace. Only existing files count.
 */
export function findImagePaths(message: string, cwd: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").replace(/^@/, "").replace(/[),;:!?]+$/, "").replace(/\.$/, "");
    if (!IMAGE_EXTENSIONS.test(token)) continue;
    const path = isAbsolute(token) ? token : resolve(cwd, token);
    try {
      if (statSync(path).isFile() && !found.includes(path)) found.push(path);
    } catch { /* Not a file on disk; leave it as plain text. */ }
    if (found.length === MAX_IMAGES) break;
  }
  return found;
}

/** Codex CLI flags that attach images. `--image=` keeps a greedy multi-value flag from swallowing the prompt. */
export function imageArgs(paths: readonly string[]): string[] {
  return paths.map(path => `--image=${path}`);
}
