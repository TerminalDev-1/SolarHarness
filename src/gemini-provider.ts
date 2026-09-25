import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseHostToolCall } from "./host-tool-call.js";
import { requestedSubAgentCount } from "./codex-provider.js";
import { SolarWorkspaceTool, type WorkspaceCommandInput } from "./workspace-tool.js";
import type { CodexRunOptions, CodexRunResult, DelegationPlan, SolarModelProvider } from "./types.js";

type Content = { role: "user" | "model"; parts: Record<string, unknown>[] };
type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean; thoughtSignature?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
};

const endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
const maxAgentActions = 30;

/** Gemini API-backed Solar sessions. API keys stay in the process environment. */
export class GeminiApiProvider implements SolarModelProvider {
  private readonly sessions = new Map<string, Content[]>();
  private readonly workspaces = new Map<string, SolarWorkspaceTool>();

  constructor(private readonly apiKey = process.env.GEMINI_API_KEY ?? "", private readonly request: typeof fetch = fetch) {}

  async createPlan(task: string, context: string | undefined, options: CodexRunOptions): Promise<DelegationPlan> {
    const count = requestedSubAgentCount(task);
    const instructions = [
      "Prepare a delegation plan. Do not implement or use tools during planning.",
      count ? `Return exactly ${count} distinct tasks.` : "Choose the smallest useful number of independent tasks, up to eight.",
      "Return a JSON object with summary (string) and tasks (array). Each task needs name, title, instructions, and context strings. Names must be distinct single tokens.",
      `Request: ${task}`,
      context ? `Context: ${context}` : ""
    ].filter(Boolean).join("\n\n");
    const response = await this.run(instructions, { ...options, role: "planner" });
    if (response.sessionId) this.sessions.delete(response.sessionId);
    let plan: DelegationPlan;
    try { plan = JSON.parse(response.text) as DelegationPlan; }
    catch { throw new Error("Gemini returned an invalid delegation plan JSON object."); }
    if (!plan || typeof plan.summary !== "string" || !Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 8 || (count && plan.tasks.length !== count)
      || plan.tasks.some(task => !task || [task.name, task.title, task.instructions, task.context].some(value => typeof value !== "string"))) {
      throw new Error("Gemini returned an invalid delegation plan.");
    }
    return plan;
  }

  async run(prompt: string, options: CodexRunOptions, extraArgs: string[] = []): Promise<CodexRunResult> {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, []);
    return this.turn(sessionId, prompt, options, extraArgs);
  }

  async resume(sessionId: string, prompt: string, options: CodexRunOptions, extraArgs: string[] = []): Promise<CodexRunResult> {
    if (!this.sessions.has(sessionId)) throw new Error("Gemini session is no longer available. Start a new Solar session.");
    return this.turn(sessionId, prompt, options, extraArgs);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    await Promise.all([...this.workspaces.values()].map(workspace => workspace.close()));
    this.workspaces.clear();
  }

  private async turn(sessionId: string, prompt: string, options: CodexRunOptions, extraArgs: string[]): Promise<CodexRunResult> {
    if (!this.apiKey.trim()) throw new Error("Gemini needs GEMINI_API_KEY in the environment. Set it and restart Solar Harness.");
    const schemaIndex = extraArgs.indexOf("--output-schema");
    const schema = schemaIndex >= 0 && extraArgs[schemaIndex + 1]
      ? await readFile(extraArgs[schemaIndex + 1], "utf8") : undefined;
    const agent = options.role === "sub-agent" || options.role === "sub-delegate";
    const format = schema ? `Return only a JSON object matching this schema: ${schema}`
      : options.role === "planner" ? "Return only valid JSON. No markdown fences." : "";
    const toolGuide = agent ? [
      "You can act on the workspace through this tool. When an action is needed, output only one line: SOLAR_TOOL: workspace_command {\"action\":\"run\",\"command\":\"your command\"}.",
      "The host executes the command and returns its real output. Continue until the assignment is done, then give a final report. Never claim a command ran unless you received its result."
    ].join("\n") : "";
    let input = [format, toolGuide, prompt].filter(Boolean).join("\n\n");
    for (let attempt = 0; attempt <= (agent ? maxAgentActions : 0); attempt++) {
      const text = await this.generate(sessionId, input, options, Boolean(schema || options.role === "planner"));
      if (!agent) return { text, sessionId };
      const tool = parseHostToolCall(text);
      if (!tool) return { text, sessionId };
      if (attempt === maxAgentActions) throw new Error("Gemini sub-agent reached the workspace action limit.");
      if (tool.name !== "workspace_command") throw new Error(`Gemini sub-agent requested unsupported tool ${tool.name}.`);
      let workspace = this.workspaces.get(sessionId);
      if (!workspace) {
        workspace = new SolarWorkspaceTool(options.cwd);
        this.workspaces.set(sessionId, workspace);
      }
      try {
        const result = await workspace.execute(tool.input as WorkspaceCommandInput);
        options.onEvent?.(`Gemini workspace action: ${(tool.input as WorkspaceCommandInput).action}`);
        input = `Workspace tool result: ${JSON.stringify(result)}\nContinue the task or provide your final report.`;
      } catch (error) {
        input = `Workspace tool failed: ${error instanceof Error ? error.message : String(error)}\nCorrect the action or report the failure.`;
      }
    }
    throw new Error("Gemini sub-agent did not finish.");
  }

  private async generate(sessionId: string, input: string, options: CodexRunOptions, json: boolean): Promise<string> {
    if (options.signal?.aborted) throw new Error("Gemini request cancelled.");
    const history = this.sessions.get(sessionId)!;
    const contents: Content[] = [...history, { role: "user", parts: [{ text: input }] }];
    const response = await this.request(`${endpoint}/${encodeURIComponent(options.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents, generationConfig: {
        ...(json ? { responseMimeType: "application/json" } : {}),
        ...geminiThinking(options.model, options.reasoning)
      } }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000)
    });
    let body: GeminiReply;
    try { body = await response.json() as GeminiReply; }
    catch { throw new Error(`Gemini returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`Gemini API request failed (HTTP ${response.status}): ${redact(body.error?.message ?? "Unknown error", this.apiKey)}`);
    const modelContent = body.candidates?.[0]?.content;
    const text = modelContent?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("").trim();
    if (!text) throw new Error(`Gemini returned no text${body.candidates?.[0]?.finishReason ? ` (${body.candidates[0].finishReason})` : ""}.`);
    history.push({ role: "user", parts: [{ text: input }] }, { role: "model", parts: modelContent!.parts! });
    options.onUsage?.(body.usageMetadata?.promptTokenCount ?? 0, (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0));
    return text;
  }
}

function geminiThinking(model: string, effort: CodexRunOptions["reasoning"]): object {
  if (/^gemini-3/i.test(model)) return { thinkingConfig: { thinkingLevel: effort === "light" ? "low" : effort === "medium" ? "medium" : "high" } };
  if (/^gemini-2\.5/i.test(model)) return { thinkingConfig: { thinkingBudget: ({ light: 1024, medium: 8192, high: 24576, xhigh: model.includes("pro") ? 32768 : 24576, max: model.includes("pro") ? 32768 : 24576 })[effort] } };
  return {};
}

function redact(message: string, secret: string): string {
  return secret ? message.replaceAll(secret, "[redacted]") : message;
}
