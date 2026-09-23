import type { AgentRecord, AgentTask, ReasoningEffort } from "./types.js";
import type { BrowserInput, BrowserResult } from "./browser-tool.js";
import type { WebSearchHeadlessInput, WebSearchHeadlessResult } from "./web-search-headless.js";
import type { WorkspaceCommandInput, WorkspaceCommandResult } from "./workspace-tool.js";

export type ToolDefinition<TInput, TResult> = {
  name: string;
  description: string;
  execute: (input: TInput) => Promise<TResult>;
};

export type SpawnSubAgentInput = AgentTask & { context: string; reasoning: ReasoningEffort; parentId?: string };
export type OrchestrateInput = { action: "list" | "cancel" | "inject_context" | "set_reasoning"; agentId?: string; context?: string; reasoning?: ReasoningEffort };
export type AdjustSubEffortLevelInput = { agentId: string; effortLevel: ReasoningEffort };
export type SetAutoPermissionsInput = { enabled: boolean };
export type AutoPermissionsState = { enabled: boolean };
export type RuntimeOperation = {
  id: number;
  at: string;
  finishedAt?: string;
  tool: string;
  input: unknown;
  status: "succeeded" | "failed";
  result?: unknown;
  error?: string;
};
export type RuntimeOperationsInput = { tool?: string; limit?: number };

/** Runtime tool boundary. Tool contracts live here, never in a system prompt. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();
  private readonly operations: RuntimeOperation[] = [];
  private nextOperationId = 1;

  register<TInput, TResult>(tool: ToolDefinition<TInput, TResult>): void {
    this.tools.set(tool.name, tool as unknown as ToolDefinition<unknown, unknown>);
  }

  async call<TInput, TResult>(name: string, input: TInput): Promise<TResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (name === "runtime_operations") return tool.execute(input) as Promise<TResult>;
    const operation: RuntimeOperation = { id: this.nextOperationId++, at: new Date().toISOString(), tool: name, input: structuredClone(input), status: "succeeded" };
    try {
      const result = await tool.execute(input);
      operation.result = structuredClone(result);
      if (name === "workspace_command" && result && typeof result === "object" && "exitCode" in result && result.exitCode !== 0) {
        operation.status = "failed";
      }
      return result as TResult;
    } catch (error) {
      operation.status = "failed";
      operation.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      operation.finishedAt = new Date().toISOString();
      this.operations.push(operation);
    }
  }

  getOperations(input: RuntimeOperationsInput = {}): RuntimeOperation[] {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("runtime_operations requires an input object.");
    if (input.tool !== undefined && typeof input.tool !== "string") throw new Error("runtime_operations tool must be a string.");
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new Error("runtime_operations limit must be between 1 and 100.");
    return this.operations.filter(operation => !input.tool || operation.tool === input.tool).sort((left, right) => left.id - right.id).slice(-(input.limit ?? 50)).map(operation => structuredClone(operation));
  }

  resetOperations(): void {
    this.operations.length = 0;
    this.nextOperationId = 1;
  }

  list(): Array<Pick<ToolDefinition<unknown, unknown>, "name" | "description">> {
    return [...this.tools.values()].map(({ name, description }) => ({ name, description }));
  }
}

export function registerHarnessTools(dependencies: {
  spawn: (input: SpawnSubAgentInput) => Promise<AgentRecord>;
  orchestrate: (input: OrchestrateInput) => Promise<AgentRecord[]>;
  setReasoning: (agentId: string, reasoning: ReasoningEffort) => AgentRecord;
  setAutoPermissions: (enabled: boolean) => AutoPermissionsState;
  browser: (input: BrowserInput) => Promise<BrowserResult>;
  webSearchHeadless: (input: WebSearchHeadlessInput) => Promise<WebSearchHeadlessResult>;
  workspaceCommand: (input: WorkspaceCommandInput) => Promise<WorkspaceCommandResult>;
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register<RuntimeOperationsInput, RuntimeOperation[]>({
    name: "runtime_operations",
    description: "Read recorded host tool calls, inputs, outcomes, results, and failures from the current Solar session. Use to verify what actually happened earlier.",
    execute: async input => registry.getOperations(input)
  });
  registry.register<SpawnSubAgentInput, AgentRecord>({
    name: "spawn_sub_agent",
    description: "Create a named sub-agent or sub-delegate. The scheduler enforces eight concurrent agent processes.",
    execute: dependencies.spawn
  });
  registry.register<OrchestrateInput, AgentRecord[]>({
    name: "orchestrate",
    description: "Inspect, cancel, change reasoning, or inject context into any sub-agent or sub-delegate managed by this harness.",
    execute: async input => {
      if (input.action === "set_reasoning") {
        if (!input.agentId || !input.reasoning) throw new Error("set_reasoning requires agentId and reasoning.");
        dependencies.setReasoning(input.agentId, input.reasoning);
        return dependencies.orchestrate({ action: "list" });
      }
      return dependencies.orchestrate(input);
    }
  });
  registry.register<AdjustSubEffortLevelInput, AgentRecord>({
    name: "adjust-sub-effort-level",
    description: "Change the reasoning effort used for a specific sub-agent or sub-delegate's next exchange.",
    execute: async input => dependencies.setReasoning(input.agentId, input.effortLevel)
  });
  registry.register<SetAutoPermissionsInput, AutoPermissionsState>({
    name: "set-auto-permissions",
    description: "Enable or disable automatic approval of future sub-agent plans. This does not bypass the destructive /new confirmation.",
    execute: async input => {
      if (typeof input.enabled !== "boolean") throw new Error("set-auto-permissions requires a boolean enabled value.");
      return dependencies.setAutoPermissions(input.enabled);
    }
  });
  registry.register<BrowserInput, BrowserResult>({
    name: "browser",
    description: "Interact with a visible Playwright browser: open, search Google or Bing, snapshot, screenshot, move Solar's visible cursor, click a selector, named button or link, or viewport coordinates, fill, press keys, scroll, navigate, search YouTube, or close.",
    execute: dependencies.browser
  });
  registry.register<WebSearchHeadlessInput, WebSearchHeadlessResult>({
    name: "web_search_headless",
    description: "Search Google headlessly with Bing fallback, returning source titles, URLs, and snippets; read source pages headlessly by URL.",
    execute: dependencies.webSearchHeadless
  });
  registry.register<WorkspaceCommandInput, WorkspaceCommandResult>({
    name: "workspace_command",
    description: "Run a command, start a long-running process, or serve static files from the active workspace on localhost. The serve action returns its listening URL. Use to inspect, create, run, and verify local projects.",
    execute: dependencies.workspaceCommand
  });
  return registry;
}
