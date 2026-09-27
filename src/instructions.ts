import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** SOLAR.md project instructions, loaded like CLAUDE.md: user, then project, then workspace. */
export const INSTRUCTIONS_FILENAME = "SOLAR.md";
const MAX_INSTRUCTION_CHARS = 40_000;

export type InstructionScope = "user" | "project" | "workspace";
export interface InstructionFile { scope: InstructionScope; path: string; content: string; truncated: boolean }

export function solarHome(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.SOLAR_HOME?.trim() || join(homedir(), ".solarharness");
}

/** Candidate SOLAR.md paths, least to most specific. The launch directory survives `/new`; `test` does not. */
export function instructionPaths(workspace: string, home = solarHome()): { scope: InstructionScope; path: string }[] {
  const current = resolve(workspace);
  const candidates: { scope: InstructionScope; path: string }[] = [{ scope: "user", path: join(home, INSTRUCTIONS_FILENAME) }];
  if (basename(current).toLowerCase() === "test") candidates.push({ scope: "project", path: join(dirname(current), INSTRUCTIONS_FILENAME) });
  candidates.push({ scope: "workspace", path: join(current, INSTRUCTIONS_FILENAME) });
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = resolve(candidate.path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function loadInstructions(workspace: string, home = solarHome()): InstructionFile[] {
  const files: InstructionFile[] = [];
  for (const { scope, path } of instructionPaths(workspace, home)) {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      const raw = readFileSync(path, "utf8").replace(/^﻿/, "").trim();
      if (!raw) continue;
      const truncated = raw.length > MAX_INSTRUCTION_CHARS;
      files.push({ scope, path, content: truncated ? raw.slice(0, MAX_INSTRUCTION_CHARS) : raw, truncated });
    } catch { /* An unreadable file is skipped rather than blocking the session. */ }
  }
  return files;
}

/** Prompt block for loaded instructions, or an empty string when there are none. */
export function formatInstructions(files: InstructionFile[]): string {
  if (!files.length) return "";
  return [
    `${INSTRUCTIONS_FILENAME} instructions from the user and project. Follow them. Later (more specific) files override earlier ones. They never override the user's explicit request in the current turn or Solar Harness safety limits.`,
    ...files.map(file => `--- ${file.scope} ${INSTRUCTIONS_FILENAME}: ${file.path}${file.truncated ? " (truncated)" : ""} ---\n${file.content}`)
  ].join("\n\n");
}

export function workspaceInstructions(workspace: string): string {
  return formatInstructions(loadInstructions(workspace));
}
