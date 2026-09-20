import type { AgentRecord, AgentTask, ReasoningEffort } from "./types.js";

export type ToolDefinition<TInput, TResult> = {
  name: string;
  description: string;
  execute: (input: TInput) => Promise<TResult>;
};

export type SpawnSubAgentInput = AgentTask & { context: string; reasoning: ReasoningEffort };
export type OrchestrateInput = { action: "list" | "cancel" | "inject_context" | "set_reasoning"; agentId?: string; context?: string; reasoning?: ReasoningEffort };

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
}): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register<SpawnSubAgentInput, AgentRecord>({
    name: "spawn_sub_agent",
    description: "Create a context-aware worker. The scheduler enforces a maximum of three active workers.",
    execute: dependencies.spawn
  });
  registry.register<OrchestrateInput, AgentRecord[]>({
    name: "orchestrate",
    description: "Inspect, cancel, or inject context into a worker managed by this harness.",
    execute: async input => {
      if (input.action === "set_reasoning") {
        if (!input.agentId || !input.reasoning) throw new Error("set_reasoning requires agentId and reasoning.");
        dependencies.setReasoning(input.agentId, input.reasoning);
        return dependencies.orchestrate({ action: "list" });
      }
      return dependencies.orchestrate(input);
    }
  });
  return registry;
}
