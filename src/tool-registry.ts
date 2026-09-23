import type { AgentRecord, AgentTask, ReasoningEffort } from "./types.js";
import type { BrowserInput, BrowserResult } from "./browser-tool.js";

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

/** Runtime tool boundary. Tool contracts live here, never in a system prompt. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  register<TInput, TResult>(tool: ToolDefinition<TInput, TResult>): void {
    this.tools.set(tool.name, tool as unknown as ToolDefinition<unknown, unknown>);
  }

  async call<TInput, TResult>(name: string, input: TInput): Promise<TResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(input) as Promise<TResult>;
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
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register<SpawnSubAgentInput, AgentRecord>({
    name: "spawn_sub_agent",
    description: "Create a named context-aware worker or sub-worker. The scheduler enforces eight concurrent agent processes.",
    execute: dependencies.spawn
  });
  registry.register<OrchestrateInput, AgentRecord[]>({
    name: "orchestrate",
    description: "Inspect, cancel, change reasoning, or inject context into any worker or sub-worker managed by this harness.",
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
    description: "Change the reasoning effort used for a specific worker or sub-worker's next exchange.",
    execute: async input => dependencies.setReasoning(input.agentId, input.effortLevel)
  });
  registry.register<SetAutoPermissionsInput, AutoPermissionsState>({
    name: "set-auto-permissions",
    description: "Enable or disable automatic approval of future worker delegation plans. This does not bypass the destructive /new confirmation.",
    execute: async input => {
      if (typeof input.enabled !== "boolean") throw new Error("set-auto-permissions requires a boolean enabled value.");
      return dependencies.setAutoPermissions(input.enabled);
    }
  });
  registry.register<BrowserInput, BrowserResult>({
    name: "browser",
    description: "Browse web pages in a visible Playwright session: open, search YouTube, snapshot, screenshot, click, fill, press, scroll, back, forward, or close.",
    execute: dependencies.browser
  });
  return registry;
}
