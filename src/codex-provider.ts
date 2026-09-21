import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodexRunOptions, CodexRunResult, DelegationPlan, ReasoningEffort } from "./types.js";
import { SOLAR_SYSTEM_PROMPT } from "./system-prompt.js";

type CodexEvent = {
  type?: string;
  item?: { type?: string; text?: string; command?: string; status?: string };
  error?: { message?: string; code?: string; type?: string } | string;
};

export class CodexCliProvider {
  private readonly codexExecutable = resolveCodexExecutable();

  async createPlan(task: string, context: string | undefined, options: CodexRunOptions): Promise<DelegationPlan> {
    const schemaPath = await this.writePlanSchema(options.cwd);
    const prompt = [
      SOLAR_SYSTEM_PROMPT,
      "Act strictly as the Solar Harness Preview coordinator. Do not implement the request.",
      "Return only the requested delegation plan. Do not inspect the workspace, invoke tools, create subagents, or claim that any task has already been completed.",
      "Break the request into independent, implementation-ready worker tasks. Use no more than eight tasks.",
      "Every task runs concurrently. Never make one task depend on another task's output; combine sequential create-and-verify steps into the same worker task.",
      "Every task must be concrete, scoped, and useful to another coding agent.",
      `User request: ${task}`,
      context ? `Shared context: ${context}` : ""
    ].filter(Boolean).join("\n\n");
    const output = await this.run(prompt, options, ["--output-schema", schemaPath]);
    const parsed = JSON.parse(output.text) as DelegationPlan;
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0 || parsed.tasks.length > 8) {
      throw new Error("Codex returned an invalid delegation plan (expected one to eight tasks).");
    }
    return parsed;
  }

  async run(prompt: string, options: CodexRunOptions, extraArgs: string[] = []): Promise<CodexRunResult> {
    const sandbox = options.role === "worker" ? "workspace-write" : "read-only";
    const args = [
      "exec", "--json", "--sandbox", sandbox,
      "--model", options.model,
      "-c", `model_reasoning_effort=\"${cliReasoning(options.reasoning)}\"`,
      "-c", "agents.enabled=false",
      ...extraArgs,
      prompt
    ];
    // Never use a shell here: Windows cmd.exe splits a multi-word prompt into CLI arguments.
    // Codex also reads piped stdin in addition to the prompt argument. Close the default
    // child stdin pipe immediately or it will wait forever for more input.
    const child = spawn(this.codexExecutable, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const finalMessages: string[] = [];
    const eventErrors: string[] = [];
    let sessionId: string | undefined;
    let stderr = "";
    let stdoutRemainder = "";

    const consume = (chunk: string) => {
      const lines = (stdoutRemainder + chunk).split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CodexEvent;
          if (event.type === "thread.started") sessionId = (event as CodexEvent & { thread_id?: string }).thread_id;
          if (event.type === "error") {
            const message = typeof event.error === "string" ? event.error : event.error?.message;
            if (message) eventErrors.push(message);
          }
          const item = event.item;
          if (item?.type === "agent_message" && item.text) finalMessages.push(item.text);
          const activity = item?.command ?? (item?.type === "agent_message" ? undefined : item?.text) ?? (typeof event.error === "string" ? event.error : event.error?.message);
          if (activity) options.onEvent?.(activity.slice(0, 180));
        } catch {
          options.onEvent?.(line.slice(0, 180));
        }
      }
    };
    child.stdout.on("data", (data: Buffer) => consume(data.toString()));
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    options.signal?.addEventListener("abort", () => child.kill(), { once: true });

    return await new Promise<CodexRunResult>((resolve, reject) => {
      child.on("error", (error) => reject(codexStartError(error, this.codexExecutable)));
      child.on("close", (code) => {
        if (stdoutRemainder) consume("\n");
        if (code !== 0) return reject(new Error(eventErrors.at(-1) ?? cleanStderr(stderr) ?? `Codex CLI exited with code ${code}.`));
        const output = finalMessages.at(-1);
        if (!output) return reject(new Error("Codex CLI completed without an agent message."));
        resolve({ text: output, sessionId });
      });
    });
  }

  async resume(sessionId: string, prompt: string, options: CodexRunOptions): Promise<CodexRunResult> {
    const args = ["exec", "resume", "--json", "--model", options.model,
      "-c", `model_reasoning_effort=\"${cliReasoning(options.reasoning)}\"`, "-c", "agents.enabled=false", sessionId, prompt];
    return this.runWithArgs(args, options);
  }

  private async writePlanSchema(cwd: string): Promise<string> {
    const directory = join(cwd, ".solarharness", "schemas");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "delegation-plan.json");
    await writeFile(path, JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["summary", "tasks"],
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array", minItems: 1, maxItems: 8,
          items: { type: "object", additionalProperties: false, required: ["title", "instructions", "context"], properties: {
            title: { type: "string" }, instructions: { type: "string" }, context: { type: "string" }
          }}
        }
      }
    }, null, 2));
    return path;
  }

  private async runWithArgs(args: string[], options: CodexRunOptions): Promise<CodexRunResult> {
    const child = spawn(this.codexExecutable, args, { cwd: options.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const messages: string[] = [];
    const eventErrors: string[] = [];
    let stderr = "";
    let sessionId: string | undefined;
    let remaining = "";
    const consume = (chunk: string) => {
      const lines = (remaining + chunk).split(/\r?\n/);
      remaining = lines.pop() ?? "";
      for (const line of lines) try {
        const event = JSON.parse(line) as CodexEvent & { thread_id?: string };
        if (event.type === "thread.started") sessionId = event.thread_id;
        if (event.type === "error") {
          const message = typeof event.error === "string" ? event.error : event.error?.message;
          if (message) eventErrors.push(message);
        }
        if (event.item?.type === "agent_message" && event.item.text) messages.push(event.item.text);
        const activity = event.item?.command ?? (event.item?.type === "agent_message" ? undefined : event.item?.text);
        if (activity) options.onEvent?.(activity.slice(0, 180));
      } catch { if (line) options.onEvent?.(line.slice(0, 180)); }
    };
    child.stdout.on("data", (data: Buffer) => consume(data.toString()));
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    options.signal?.addEventListener("abort", () => child.kill(), { once: true });
    return new Promise((resolve, reject) => {
      child.on("error", error => reject(codexStartError(error, this.codexExecutable)));
      child.on("close", code => {
        if (remaining) consume("\n");
        if (code !== 0) return reject(new Error(eventErrors.at(-1) ?? cleanStderr(stderr) ?? `Codex CLI exited with code ${code}.`));
        const text = messages.at(-1);
        if (!text) return reject(new Error("Codex CLI completed without an agent message."));
        resolve({ text, sessionId });
      });
    });
  }
}

/** Resolve the native CLI even when the Codex desktop app has not amended PATH. */
export function resolveCodexExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.SOLAR_CODEX_PATH?.trim();
  if (configured) return configured;

  if (process.platform === "win32") {
    const pathMatch = findOnPath("codex.exe", environment.PATH);
    if (pathMatch) return pathMatch;

    const localAppData = environment.LOCALAPPDATA;
    if (localAppData) {
      const desktopBin = join(localAppData, "OpenAI", "Codex", "bin");
      const desktopCandidates = childExecutables(desktopBin, "codex.exe");
      if (desktopCandidates.length) return desktopCandidates[0];
    }

    const appData = environment.APPDATA;
    if (appData) {
      const npmBinary = join(appData, "npm", "node_modules", "@openai", "codex", "vendor", "x86_64-pc-windows-msvc", "codex", "codex.exe");
      if (existsSync(npmBinary)) return npmBinary;
    }
  }

  return findOnPath(process.platform === "win32" ? "codex.exe" : "codex", environment.PATH) ?? "codex";
}

function findOnPath(filename: string, pathValue: string | undefined): string | undefined {
  for (const directory of pathValue?.split(process.platform === "win32" ? ";" : ":") ?? []) {
    if (!directory) continue;
    const candidate = join(directory.replace(/^"|"$/g, ""), filename);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function childExecutables(parent: string, filename: string): string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(parent, entry.name, filename))
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

function codexStartError(error: Error, executable: string): Error {
  return new Error([
    `Unable to start Codex CLI at ${executable}: ${error.message}`,
    "Install the Codex CLI or set SOLAR_CODEX_PATH to the full path of codex.exe."
  ].join(" "));
}

function cliReasoning(reasoning: ReasoningEffort): Exclude<ReasoningEffort, "light"> | "low" {
  return reasoning === "light" ? "low" : reasoning;
}

function cleanStderr(stderr: string): string | undefined {
  const useful = stderr.split(/\r?\n/).filter(line =>
    line.trim() &&
    !line.includes(" WARN ") &&
    !line.startsWith("Reading additional input from stdin")
  );
  return useful.length ? useful.join("\n") : undefined;
}
