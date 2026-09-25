import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderChoice = "codex" | "gemini";

export function providerSettingsPath(): string {
  return process.env.SOLAR_SETTINGS_PATH || join(homedir(), ".solarharness", "settings.json");
}

export function loadProviderChoice(path = providerSettingsPath()): ProviderChoice | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { provider?: unknown };
    return value.provider === "codex" || value.provider === "gemini" ? value.provider : undefined;
  } catch { return undefined; }
}

export function saveProviderChoice(provider: ProviderChoice, path = providerSettingsPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ provider }, null, 2), { mode: 0o600 });
}
