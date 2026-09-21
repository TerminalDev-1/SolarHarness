import { AgentManager } from "./agent-manager.js";
import { CodexCliProvider } from "./codex-provider.js";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { SOLAR_SYSTEM_PROMPT } from "./system-prompt.js";
import { registerHarnessTools, type AdjustSubEffortLevelInput, type SpawnSubAgentInput, type ToolRegistry } from "./tool-registry.js";
import { REASONING_EFFORTS, type AgentRecord, type DelegationPlan, type HarnessOptions, type ReasoningEffort } from "./types.js";

export class SolarHarness {
  readonly provider = new CodexCliProvider();
  readonly manager: AgentManager;
  readonly tools: ToolRegistry;
  private coordinatorSessionId?: string;
  private readonly coordinatorTranscript: string[] = [];

  constructor(private readonly options: HarnessOptions) {
    this.manager = new AgentManager(this.provider, options);
    this.tools = registerHarnessTools({
      spawn: input => this.manager.spawn(input),
      orchestrate: input => this.manager.orchestrate(input),
      setReasoning: (agentId, reasoning) => this.manager.setReasoning(agentId, reasoning)
    });
  }

  async converse(message: string, onActivity?: (message: string) => void): Promise<{ reply: string; readyToDelegate: boolean }> {
    const agentRoster = this.manager.list().map(agent => `${agent.id}: ${agent.title} (${agent.status}, ${agent.reasoning})`).join("\n") || "No sub-agents exist yet.";
    const turnPrompt = [
      "Continue the conversation in a useful, detailed way. If the request is actionable, do not ask for ceremony or a delegation command: explain your understanding and mark it ready immediately. Ask a clarifying question only when a missing answer would materially change the work. Never implement the request yourself. Do not discuss whether this Codex session has worker or delegation tools; Solar Harness handles planning outside this call.",
      "You have a registered coordinator tool named adjust-sub-effort-level. When the user naturally asks to change a specific existing sub-agent's effort, emit exactly one tool line in this form: SOLAR_TOOL: adjust-sub-effort-level {\"agentId\":\"worker-id\",\"effortLevel\":\"light|medium|high|xhigh|max\"}. Do not mark an effort adjustment as ready for new delegation.",
      `Current sub-agents:\n${agentRoster}`,
      "Finish with exactly one control line: SOLAR_STATE: READY when the scope is sufficiently clear to delegate, otherwise SOLAR_STATE: DISCOVER.",
      `User: ${message}`
    ].join("\n\n");
    const runOptions = { ...this.options, role: "coordinator" as const, onEvent: onActivity };
    const response = this.coordinatorSessionId
      ? await this.provider.resume(this.coordinatorSessionId, turnPrompt, runOptions)
      : await this.provider.run([SOLAR_SYSTEM_PROMPT, turnPrompt].join("\n\n"), runOptions);
    this.coordinatorSessionId = response.sessionId ?? this.coordinatorSessionId;
    const toolMatch = response.text.match(/^SOLAR_TOOL:\s*adjust-sub-effort-level\s+(\{[^\r\n]+\})\s*$/m);
    let toolNotice = "";
    if (toolMatch) {
      try {
        const input = JSON.parse(toolMatch[1]) as AdjustSubEffortLevelInput;
        if (!input.agentId || !REASONING_EFFORTS.includes(input.effortLevel)) throw new Error("Invalid agent id or effort level.");
        await this.tools.call<AdjustSubEffortLevelInput, AgentRecord>("adjust-sub-effort-level", input);
        toolNotice = `\n\nAdjusted ${input.agentId} to ${input.effortLevel} effort.`;
      } catch (error) {
        toolNotice = `\n\nCould not adjust the sub-agent: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const readyToDelegate = !toolMatch && /SOLAR_STATE:\s*READY\s*$/m.test(response.text);
    const reply = response.text
      .replace(/^SOLAR_TOOL:\s*adjust-sub-effort-level\s+\{[^\r\n]+\}\s*$/m, "")
      .replace(/\s*SOLAR_STATE:\s*(READY|DISCOVER)\s*$/m, "")
      .trim() + toolNotice;
    this.coordinatorTranscript.push(`User: ${message}`, `Solar: ${reply}`);
    return { reply, readyToDelegate };
  }

  setReasoning(reasoning: ReasoningEffort): void {
    this.options.reasoning = reasoning;
  }

  resetConversation(): void {
    this.coordinatorSessionId = undefined;
    this.coordinatorTranscript.length = 0;
    this.manager.reset();
  }

  getWorkspace(): string {
    return this.options.cwd;
  }

  getTestWorkspace(): string {
    const current = resolve(this.options.cwd);
    return basename(current).toLowerCase() === "test" ? current : join(current, "test");
  }

  async resetIntoTestWorkspace(): Promise<string> {
    const workspace = this.getTestWorkspace();
    await mkdir(workspace, { recursive: true });
    this.options.cwd = workspace;
    this.resetConversation();
    return workspace;
  }

  async plan(request: string, context: string, onActivity?: (message: string) => void): Promise<DelegationPlan> {
    onActivity?.("Designing a parallel delegation plan");
    const retainedContext = [this.coordinatorTranscript.join("\n\n"), context].filter(Boolean).join("\n\n");
    const plan = await this.provider.createPlan(request, retainedContext, { ...this.options, role: "coordinator", onEvent: onActivity });
    onActivity?.(`Plan ready: ${plan.tasks.map(task => task.title).join(" · ")}`);
    return plan;
  }

  async executePlan(plan: DelegationPlan, request: string, context: string, onProgress: (agents: AgentRecord[]) => void, onActivity?: (message: string) => void): Promise<string> {
    const workers = plan.tasks.map(task => this.tools.call<SpawnSubAgentInput, AgentRecord>("spawn_sub_agent", {
      ...task, context: [context, task.context].filter(Boolean).join("\n"), reasoning: this.options.reasoning
    }));
    const watcher = setInterval(() => onProgress(this.manager.list()), 1_000);
    const completedWorkers = await Promise.all(workers);
    clearInterval(watcher);
    onProgress(this.manager.list());

    const reports = completedWorkers.map(agent => [
      `Worker ${agent.id} (${agent.title}) — ${agent.status}`,
      agent.report ?? agent.error ?? "No report"
    ].join("\n")).join("\n\n");
    onActivity?.("Synthesizing worker reports");
    const synthesisPrompt = [
      "You have received worker reports. Do not perform new implementation work. Give the user a detailed orchestration update: what was delegated, each outcome, remaining risks, and a suggested next step.",
      `Original request: ${request}`,
      `Coordinator plan: ${plan.summary}`,
      `Worker reports:\n${reports}`
    ].join("\n\n");
    const runOptions = { ...this.options, role: "coordinator" as const, onEvent: onActivity };
    const synthesis = this.coordinatorSessionId
      ? await this.provider.resume(this.coordinatorSessionId, synthesisPrompt, runOptions)
      : await this.provider.run([SOLAR_SYSTEM_PROMPT, synthesisPrompt].join("\n\n"), runOptions);
    this.coordinatorSessionId = synthesis.sessionId ?? this.coordinatorSessionId;
    this.coordinatorTranscript.push(`Solar: ${synthesis.text}`);
    return synthesis.text;
  }

  async delegate(request: string, context: string, onProgress: (agents: AgentRecord[]) => void, onActivity?: (message: string) => void): Promise<string> {
    const plan = await this.plan(request, context, onActivity);
    return this.executePlan(plan, request, context, onProgress, onActivity);
  }

}
