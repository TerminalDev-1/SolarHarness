import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { solarDirectory } from "./solar-dir.js";
import { join } from "node:path";
import type { CodexRunOptions, CodexRunResult, DelegationPlan, ReasoningEffort } from "./types.js";
import { SOLAR_SYSTEM_PROMPT } from "./system-prompt.js";
import { plainText } from "./markdown.js";
import { FileChangeTracker, unwrapShellCommand, type FileChange } from "./file-changes.js";

type CodexEvent = {
  type?: string;
  item?: { type?: string; text?: string; command?: string; status?: string; changes?: FileChange[] };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string; type?: string } | string;
};

export class CodexCliProvider {
  private readonly codexExecutable = resolveCodexExecutable();

  async createPlan(task: string, context: string | undefined, options: CodexRunOptions): Promise<DelegationPlan> {
    const requestedCount = requestedSubAgentCount(task);
    const schemaPath = await this.writePlanSchema(options.cwd, requestedCount);
    const prompt = [
      SOLAR_SYSTEM_PROMPT,
      "Act as Solar preparing a delegation plan. Do not implement the request during planning.",
      "Return only the requested delegation plan. Do not inspect the workspace, invoke tools, create subagents, or claim that any task has already been completed.",
      "Break the request into the smallest useful set of independent, implementation-ready sub-agent tasks. Choose the sub-agent count dynamically: use one when sufficient, add more only for genuinely parallel scopes, and never treat eight as a target. Use no more than eight tasks.",
      requestedCount ? `The user explicitly requested ${requestedCount} agents. Return exactly ${requestedCount} distinct sub-agent tasks and give each a useful, non-overlapping assignment.` : "",
      "Every task runs concurrently. Never make one task depend on another task's output; combine sequential create-and-verify steps into the same sub-agent task.",
      "Every task must be concrete, scoped, and useful to another coding agent.",
      "Give every sub-agent a short, distinctive, single-token human name. Names must be unique within the plan and should be easy to type and recognize.",
      `User request: ${task}`,
      context ? `Shared context: ${context}` : ""
    ].filter(Boolean).join("\n\n");
    const output = await this.run(prompt, { ...options, role: "planner" }, ["--output-schema", schemaPath]);
    const parsed = JSON.parse(output.text) as DelegationPlan;
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0 || parsed.tasks.length > 8 || (requestedCount && parsed.tasks.length !== requestedCount)) {
      throw new Error("Codex returned an invalid delegation plan (expected one to eight tasks).");
    }
    return parsed;
  }

  async run(prompt: string, options: CodexRunOptions, extraArgs: string[] = []): Promise<CodexRunResult> {
    const child = spawnCodex(this.codexExecutable, buildCodexRunArgs(prompt, options, extraArgs), options.cwd);
    const finalMessages: string[] = [];
    const eventErrors: string[] = [];
    const fileChanges = new FileChangeTracker(options.cwd);
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
          if (event.type === "turn.completed" && event.usage) options.onUsage?.(event.usage.input_tokens ?? 0, event.usage.output_tokens ?? 0);
          if (event.type === "error") {
            const message = typeof event.error === "string" ? event.error : event.error?.message;
            if (message) eventErrors.push(message);
          }
          const item = event.item;
          for (const step of fileChangeSteps(event, fileChanges)) options.onEvent?.(`File: ${step}`);
          if (item?.type === "agent_message" && item.text) {
            finalMessages.push(item.text);
            const note = narration(item.text);
            if (note) options.onEvent?.(`Note: ${note}`);
          }
          const activity = commandActivity(item) ?? itemActivity(item) ?? (typeof event.error === "string" ? event.error : event.error?.message);
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

  async resume(sessionId: string, prompt: string, options: CodexRunOptions, extraArgs: string[] = []): Promise<CodexRunResult> {
    const args = buildCodexResumeArgs(sessionId, prompt, options, extraArgs);
    return this.runWithArgs(args, options);
  }

  private async writePlanSchema(cwd: string, requestedCount?: number): Promise<string> {
    const directory = await solarDirectory(cwd, "schemas");
    const path = join(directory, "delegation-plan.json");
    await writeFile(path, JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["summary", "tasks"],
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array", minItems: requestedCount ?? 1, maxItems: requestedCount ?? 8,
          items: { type: "object", additionalProperties: false, required: ["name", "title", "instructions", "context"], properties: {
            name: { type: "string" }, title: { type: "string" }, instructions: { type: "string" }, context: { type: "string" }
          }}
        }
      }
    }, null, 2));
    return path;
  }

  private async runWithArgs(args: string[], options: CodexRunOptions): Promise<CodexRunResult> {
    const child = spawnCodex(this.codexExecutable, args, options.cwd);
    const messages: string[] = [];
    const eventErrors: string[] = [];
    const fileChanges = new FileChangeTracker(options.cwd);
    let stderr = "";
    let sessionId: string | undefined;
    let remaining = "";
    const consume = (chunk: string) => {
      const lines = (remaining + chunk).split(/\r?\n/);
      remaining = lines.pop() ?? "";
      for (const line of lines) try {
        const event = JSON.parse(line) as CodexEvent & { thread_id?: string };
        if (event.type === "thread.started") sessionId = event.thread_id;
        if (event.type === "turn.completed" && event.usage) options.onUsage?.(event.usage.input_tokens ?? 0, event.usage.output_tokens ?? 0);
        if (event.type === "error") {
          const message = typeof event.error === "string" ? event.error : event.error?.message;
          if (message) eventErrors.push(message);
        }
        for (const step of fileChangeSteps(event, fileChanges)) options.onEvent?.(`File: ${step}`);
        if (event.item?.type === "agent_message" && event.item.text) {
          messages.push(event.item.text);
          const note = narration(event.item.text);
          if (note) options.onEvent?.(`Note: ${note}`);
        }
        const activity = commandActivity(event.item) ?? itemActivity(event.item);
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

/**
 * Starts Codex with the prompt (the last argument) sent on stdin as `-`. A prompt carrying tool
 * results or file contents can pass Windows' 32K command-line limit (spawn ENAMETOOLONG).
 * Never use a shell here: Windows cmd.exe splits a multi-word prompt into CLI arguments.
 */
function spawnCodex(executable: string, args: string[], cwd: string) {
  const child = spawn(executable, [...args.slice(0, -1), "-"], { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => { /* Codex exited early; its close event reports why. */ });
  child.stdin.end(args.at(-1));
  return child;
}

export function buildCodexRunArgs(prompt: string, options: CodexRunOptions, extraArgs: string[] = []): string[] {
  const sandbox = options.role === "planner" ? "read-only" : "workspace-write";
  return [
    "exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox,
    "--model", options.model,
    "-c", `model_reasoning_effort=\"${cliReasoning(options.reasoning)}\"`,
    "-c", `service_tier=\"${options.fast ? "fast" : "default"}\"`,
    ...(options.fast ? ["-c", "features.fast_mode=true"] : []),
    "-c", "agents.enabled=false", "-c", 'model_reasoning_summary="detailed"',
    ...extraArgs,
    prompt
  ];
}

export function buildCodexResumeArgs(sessionId: string, prompt: string, options: CodexRunOptions, extraArgs: string[] = []): string[] {
  return ["exec", "resume", "--json", "--skip-git-repo-check", "--model", options.model,
    "-c", `sandbox_mode="${options.role === "planner" ? "read-only" : "workspace-write"}"`,
    "-c", `model_reasoning_effort=\"${cliReasoning(options.reasoning)}\"`, "-c", `service_tier=\"${options.fast ? "fast" : "default"}\"`,
    ...(options.fast ? ["-c", "features.fast_mode=true"] : []),
    "-c", "agents.enabled=false", "-c", 'model_reasoning_summary="detailed"', ...extraArgs, sessionId, prompt];
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

function commandActivity(item: CodexEvent["item"]): string | undefined {
  if (!item?.command) return undefined;
  const command = unwrapShellCommand(item.command);
  if (!command) return undefined;
  return item.status === "completed" ? `Command completed: ${command}` : `Running command: ${command}`;
}

/**
 * First paragraph of a plain-text agent message, e.g. "I'll inspect the workspace, then edit index.html."
 * Structured JSON turns are not narration. The final message is also emitted; the UI drops it when it repeats the reply.
 */
export function narration(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || /^[{[]/.test(trimmed)) return undefined;
  const paragraph = plainText(trimmed.split(/\r?\n\s*\r?\n/)[0]);
  return paragraph.length > 160 ? `${paragraph.slice(0, 157)}...` : paragraph || undefined;
}

/** Reasoning summaries become `Thinking: <title>`; agent messages are replies, not activity. */
function itemActivity(item: CodexEvent["item"]): string | undefined {
  if (!item?.text || item.type === "agent_message") return undefined;
  if (item.type !== "reasoning") return item.text;
  const title = plainText(item.text.split(/\r?\n/).find(line => line.trim()) ?? "");
  return title ? `Thinking: ${title}` : undefined;
}

function fileChangeSteps(event: CodexEvent, tracker: FileChangeTracker): string[] {
  const item = event.item;
  if (item?.type !== "file_change" || !item.changes?.length) return [];
  if (event.type === "item.started") { tracker.started(item.changes); return []; }
  return event.type === "item.completed" ? tracker.completed(item.changes, item.status === "failed") : [];
}

export function requestedSubAgentCount(request: string): number | undefined {
  const match = request.match(/\b(?:assign|use|launch|spawn|want|like|to)\s+([1-8])\s+(?:agents|sub-agents|workers)\b/i);
  return match ? Number(match[1]) : undefined;
}
