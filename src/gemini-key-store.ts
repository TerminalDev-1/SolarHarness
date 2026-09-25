import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { providerSettingsPath } from "./provider-settings.js";

export function geminiKeyPath(): string {
  return join(dirname(providerSettingsPath()), "gemini-key.dpapi");
}

function protect(value: string, decrypt: boolean): string {
  if (process.platform !== "win32") throw new Error("Saved Gemini keys require Windows; use GEMINI_API_KEY on this system.");
  const script = decrypt
    ? "$encrypted = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $encrypted; [Console]::Out.Write([System.Net.NetworkCredential]::new('', $secure).Password)"
    : "$plain = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $plain -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $secure))";
  const args = ["-NoProfile", "-NonInteractive", "-Command", script];
  const options = {
    input: value, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024
  } as const;
  const first = spawnSync("pwsh", args, options);
  const result = (first.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ? spawnSync("powershell.exe", args, options) : first;
  if (result.status !== 0 || result.error) throw new Error("Windows could not protect the Gemini key for this user.");
  return result.stdout;
}

export function saveGeminiApiKey(key: string, path = geminiKeyPath()): void {
  if (!key.trim()) throw new Error("Enter a Gemini API key.");
  const encrypted = protect(key.trim(), false);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encrypted, { mode: 0o600 });
}

export function loadGeminiApiKey(path = geminiKeyPath()): string | undefined {
  try {
    const encrypted = readFileSync(path, "utf8");
    return protect(encrypted, true) || undefined;
  } catch {
    return process.env.GEMINI_API_KEY?.trim() || undefined;
  }
}
