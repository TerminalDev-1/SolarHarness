import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { solarHome } from "./instructions.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./types.js";

/** The effort every new Solar session starts with until /default-effort changes it. */
export const FALLBACK_DEFAULT_EFFORT: ReasoningEffort = "max";

export function settingsPath(home = solarHome()): string {
  return join(home, "settings.json");
}

function readSettings(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function loadDefaultEffort(home = solarHome()): ReasoningEffort {
  const value = readSettings(settingsPath(home)).defaultEffort;
  return REASONING_EFFORTS.includes(value as ReasoningEffort) ? value as ReasoningEffort : FALLBACK_DEFAULT_EFFORT;
}

/** Saves the default effort, keeping any other keys already in settings.json. */
export function saveDefaultEffort(effort: ReasoningEffort, home = solarHome()): void {
  if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
  const path = settingsPath(home);
  mkdirSync(home, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...readSettings(path), defaultEffort: effort }, null, 2)}\n`);
  renameSync(temporary, path);
}
