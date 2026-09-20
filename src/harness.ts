import { AgentManager } from "./agent-manager.js";
import { CodexCliProvider } from "./codex-provider.js";
import { SOLAR_SYSTEM_PROMPT } from "./system-prompt.js";
import { registerHarnessTools, type ToolRegistry } from "./tool-registry.js";
import type { AgentRecord, DelegationPlan, HarnessOptions, ReasoningEffort } from "./types.js";

export class SolarHarness {
  readonly provider = new CodexCliProvider();
  readonly manager: AgentManager;
  readonly tools: ToolRegistry;

  constructor(private readonly options: HarnessOptions) {
    this.manager = new AgentManager(this.provider, options);
    this.tools = registerHarnessTools({
      spawn: input => this.manager.spawn(input),
      orchestrate: input => this.manager.orchestrate(input),
      setReasoning: (agentId, reasoning) => this.manager.setReasoning(agentId, reasoning)
    });
  }

  async converse(messages: string[], onActivity?: (message: string) => void): Promise<{ reply: string; readyToDelegate: boolean }> {
    const response = await this.provider.run([
      SOLAR_SYSTEM_PROMPT,
      "Continue the conversation in a useful, detailed way. If the request is actionable, do not ask for ceremony or a delegation command: explain your understanding and mark it ready immediately. Ask a clarifying question only when a missing answer would materially change the work. Do not implement the request yourself. Do not discuss whether this Codex session has worker or delegation tools; Solar Harness handles planning outside this call. Finish with exactly one control line: SOLAR_STATE: READY when the scope is sufficiently clear to delegate, otherwise SOLAR_STATE: DISCOVER.",
      ...messages.map(message => `User: ${message}`)
    ].join("\n\n"), { ...this.options, role: "coordinator", onEvent: onActivity });
    const readyToDelegate = /SOLAR_STATE:\s*READY\s*$/m.test(response.text);
    return { reply: response.text.replace(/\s*SOLAR_STATE:\s*(READY|DISCOVER)\s*$/m, "").trim(), readyToDelegate };
  }

  async plan(request: string, context: string, onActivity?: (message: string) => void): Promise<DelegationPlan> {
    onActivity?.("Designing a parallel delegation plan");
    const plan = await this.provider.createPlan(request, context, { ...this.options, role: "coordinator", onEvent: onActivity });
    onActivity?.(`Plan ready: ${plan.tasks.map(task => task.title).join(" · ")}`);
    return plan;
  }

  async executePlan(plan: DelegationPlan, request: string, context: string, onProgress: (agents: AgentRecord[]) => void, onActivity?: (message: string) => void): Promise<string> {
    const workers = plan.tasks.map(task => this.tools.call("spawn_sub_agent", {
      ...task, context: [context, task.context].filter(Boolean).join("\n"), reasoning: this.options.reasoning
    }));
    const watcher = setInterval(() => onProgress(this.manager.list()), 1_000);
    await Promise.all(workers);
    clearInterval(watcher);
    onProgress(this.manager.list());

    const reports = this.manager.list().map(agent => [
      `Worker ${agent.id} (${agent.title}) — ${agent.status}`,
      agent.report ?? agent.error ?? "No report"
    ].join("\n")).join("\n\n");
    onActivity?.("Synthesizing worker reports");
    const synthesis = await this.provider.run([
      SOLAR_SYSTEM_PROMPT,
      "You have received worker reports. Do not perform new implementation work. Give the user a detailed orchestration update: what was delegated, each outcome, remaining risks, and a suggested next step.",
      `Original request: ${request}`,
      `Coordinator plan: ${plan.summary}`,
      `Worker reports:\n${reports}`
    ].join("\n\n"), { ...this.options, role: "coordinator", onEvent: onActivity });
    return synthesis.text;
  }

  async delegate(request: string, context: string, onProgress: (agents: AgentRecord[]) => void, onActivity?: (message: string) => void): Promise<string> {
    const plan = await this.plan(request, context, onActivity);
    return this.executePlan(plan, request, context, onProgress, onActivity);
  }

}
