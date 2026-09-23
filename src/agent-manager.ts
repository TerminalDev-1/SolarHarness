import { randomUUID } from "node:crypto";
import { CodexCliProvider } from "./codex-provider.js";
import type { AgentRecord, AgentTask, CodexRunOptions, ReasoningEffort } from "./types.js";
import type { OrchestrateInput, SpawnSubAgentInput } from "./tool-registry.js";

const MAX_CONCURRENT_AGENTS = 8;
const MAX_SUB_DELEGATES_PER_AGENT = 8;

type SubDelegateRequest = { tasks: AgentTask[] };
type SubDelegateControl = {
  action: "cancel" | "inject_context" | "set_reasoning";
  agentId: string;
  context?: string;
  reasoning?: ReasoningEffort;
};

export class AgentManager {
  private readonly records = new Map<string, AgentRecord>();
  private readonly aborters = new Map<string, AbortController>();

  constructor(private readonly provider: CodexCliProvider, private readonly options: CodexRunOptions) {}

  async spawn(input: SpawnSubAgentInput): Promise<AgentRecord> {
    const parent = input.parentId ? this.records.get(input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error(`Unknown parent sub-agent: ${input.parentId}`);
    if (parent?.depth === 1) throw new Error("Sub-delegates cannot create another delegation level.");
    if (this.executingCount() >= MAX_CONCURRENT_AGENTS) {
      throw new Error(`Solar Harness allows no more than ${MAX_CONCURRENT_AGENTS} concurrent sub-agent processes.`);
    }

    const id = `${parent ? "delegate" : "agent"}-${randomUUID().slice(0, 6)}`;
    const record: AgentRecord = {
      ...input,
      name: this.uniqueName(input.name),
      id,
      parentId: parent?.id,
      depth: parent ? 1 : 0,
      reasoning: parent ? "light" : input.reasoning,
      reasoningPinned: Boolean(parent),
      childIds: [],
      status: "queued",
      latestActivity: "Queued",
      recentActivity: [],
      injectedContext: []
    };
    this.records.set(id, record);
    if (parent) parent.childIds.push(id);
    await this.runAgent(record);
    return record;
  }

  async orchestrate(input: OrchestrateInput, actorId: "main-agent" | string = "main-agent"): Promise<AgentRecord[]> {
    if (input.action === "list") return this.list();
    const record = input.agentId ? this.getRecord(input.agentId) : undefined;
    if (!record) throw new Error("A valid agentId is required.");
    this.assertControl(actorId, record);
    if (input.action === "cancel") {
      this.cancelTree(record);
      record.latestActivity = actorId === "main-agent" ? "Cancelled by Solar" : `Cancelled by ${this.records.get(actorId)?.name ?? actorId}`;
    }
    if (input.action === "inject_context" && input.context) {
      record.injectedContext.push(input.context);
      record.latestActivity = "New context queued for the next exchange";
      if (record.status === "completed" && record.sessionId) await this.continueAgent(record, input.context);
    }
    return this.list();
  }

  setReasoning(agentId: string, reasoning: ReasoningEffort, actorId: "main-agent" | string = "main-agent"): AgentRecord {
    const record = this.getRecord(agentId);
    if (!record) throw new Error(`Unknown sub-agent: ${agentId}`);
    this.assertControl(actorId, record);
    if (record.reasoningPinned && actorId !== "main-agent" && reasoning !== "light") {
      throw new Error(`${record.name} is pinned to Light. Only Solar can authorize a higher reasoning level.`);
    }
    record.reasoning = reasoning;
    if (record.depth === 1) record.reasoningPinned = reasoning === "light";
    record.latestActivity = actorId === "main-agent"
      ? `Solar authorized ${reasoning} reasoning for the next exchange`
      : `${reasoning} reasoning selected for the next exchange`;
    return record;
  }

  list(): AgentRecord[] { return [...this.records.values()]; }

  pruneFinished(): void {
    for (const [id, record] of this.records) {
      if (["completed", "failed", "cancelled"].includes(record.status)) this.records.delete(id);
    }
  }

  reset(): void {
    for (const controller of this.aborters.values()) controller.abort();
    this.aborters.clear();
    this.records.clear();
  }

  private async runAgent(record: AgentRecord): Promise<void> {
    const controller = new AbortController();
    this.aborters.set(record.id, controller);
    record.status = "running";
    record.startedAt = new Date();
    record.latestActivity = record.depth === 0 ? "Starting sub-agent session" : "Starting Light sub-delegate session";
    try {
      const result = await this.provider.run(this.agentPrompt(record), {
        ...this.options,
        role: record.depth === 0 ? "sub-agent" : "sub-delegate",
        reasoning: record.reasoning,
        signal: controller.signal,
        onEvent: event => this.recordActivity(record, event)
      });
      record.sessionId = result.sessionId;

      const request = record.depth === 0 ? extractSubDelegateRequest(result.text) : undefined;
      if (request) {
        record.status = "waiting";
        record.latestActivity = `Delegating ${request.tasks.length} sub-delegate${request.tasks.length === 1 ? "" : "s"}`;
        const childPromises = request.tasks.slice(0, MAX_SUB_DELEGATES_PER_AGENT).map(task => this.spawn({
          ...task,
          context: [record.context, task.context].filter(Boolean).join("\n"),
          reasoning: "light",
          parentId: record.id
        }));
        const childResults = await Promise.allSettled(childPromises);
        const reports = childResults.map((result, index) => {
          if (result.status === "rejected") return `${request.tasks[index].name}: failed to launch — ${String(result.reason)}`;
          const child = result.value;
          return `${child.name} (${child.id}, ${child.status}, ${child.reasoning}):\n${child.report ?? child.error ?? "No report"}`;
        }).join("\n\n");
        record.status = "running";
        record.latestActivity = "Reviewing sub-delegate reports";
        let resumed = record.sessionId
          ? await this.provider.resume(record.sessionId, [
              "Your requested sub-delegates have finished. You control their work product; inspect these reports, perform any necessary integration or validation yourself, and then report the complete outcome to Solar.",
              "If a direct sub-delegate needs a follow-up, emit exactly one line instead of a final report: SOLAR_SUBDELEGATE_TOOL: {\"action\":\"inject_context|cancel|set_reasoning\",\"agentId\":\"name-or-id\",\"context\":\"required for inject_context\",\"reasoning\":\"light\"}. You may control only your children and cannot raise them above Light.",
              "Do not request another delegation level.",
              `Sub-delegate reports:\n${reports}`
            ].join("\n\n"), { ...this.options, role: "sub-agent", reasoning: record.reasoning, signal: controller.signal, onEvent: event => this.recordActivity(record, event) })
          : await this.provider.run([this.agentPrompt(record), `Sub-delegate reports:\n${reports}`].join("\n\n"), { ...this.options, role: "sub-agent", reasoning: record.reasoning, signal: controller.signal, onEvent: event => this.recordActivity(record, event) });
        let controlRounds = 0;
        let control = extractSubDelegateControl(resumed.text);
        while (control && controlRounds < 4) {
          controlRounds += 1;
          let outcome: string;
          try {
            if (control.action === "set_reasoning") {
              if (!control.reasoning) throw new Error("set_reasoning requires a reasoning level.");
              const child = this.setReasoning(control.agentId, control.reasoning, record.id);
              outcome = `${child.name} remains at ${child.reasoning} reasoning.`;
            } else {
              const updated = await this.orchestrate({ action: control.action, agentId: control.agentId, context: control.context }, record.id);
              const child = updated.find(candidate => candidate.id === control!.agentId || candidate.name.toLowerCase() === control!.agentId.toLowerCase());
              outcome = child ? `${child.name} is ${child.status}. Latest report:\n${child.report ?? child.error ?? child.latestActivity}` : "Sub-delegate control completed.";
            }
          } catch (error) {
            outcome = `Control request rejected: ${error instanceof Error ? error.message : String(error)}`;
          }
          resumed = await this.provider.resume(resumed.sessionId ?? record.sessionId!, [
            `Sub-delegate control result:\n${outcome}`,
            "Continue integrating the work. You may emit another SOLAR_SUBDELEGATE_TOOL line if a direct child needs a follow-up; otherwise provide your final report to Solar."
          ].join("\n\n"), { ...this.options, role: "sub-agent", reasoning: record.reasoning, signal: controller.signal, onEvent: event => this.recordActivity(record, event) });
          control = extractSubDelegateControl(resumed.text);
        }
        record.report = stripControlLines(resumed.text);
        record.sessionId = resumed.sessionId ?? record.sessionId;
      } else {
        record.report = stripControlLines(result.text);
      }
      record.status = "completed";
      record.latestActivity = record.depth === 0 ? "Completed and reported to Solar" : `Completed and reported to ${this.records.get(record.parentId ?? "")?.name ?? "parent sub-agent"}`;
    } catch (error) {
      record.status = controller.signal.aborted ? "cancelled" : "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.latestActivity = record.error;
    } finally {
      record.finishedAt = new Date();
      this.aborters.delete(record.id);
    }
  }

  private agentPrompt(record: AgentRecord): string {
    const role = record.depth === 0 ? "implementation sub-agent" : "implementation sub-delegate";
    const delegation = record.depth === 0
      ? [
          "You may delegate genuinely independent parts of your assignment to named sub-delegates. They share your workspace and report back to you.",
          "To request them, stop before implementing those parts and emit exactly one line: SOLAR_SUBDELEGATE: {\"tasks\":[{\"name\":\"single-token-name\",\"title\":\"task\",\"instructions\":\"concrete instructions\",\"context\":\"useful context\"}]}",
          "Request no more than eight sub-delegates. Do not use sub-delegates for work you can efficiently complete yourself. All sub-delegates begin pinned to Light reasoning; only Solar may authorize an increase."
        ]
      : [
          "You cannot delegate further. Work directly on the assignment from your parent sub-agent.",
          "Your reasoning is pinned to Light unless Solar explicitly authorizes another level."
        ];
    return [
      `You are ${record.name}, a ${role} launched by Solar Harness. You are not the Solar Harness Agent.`,
      "Main agent-only constraints do not apply to you. Use your workspace tools to inspect, create, edit, and validate files inside the current workspace.",
      ...delegation,
      `Your writable working directory is: ${this.options.cwd}`,
      `Task: ${record.title}`,
      `Instructions: ${record.instructions}`,
      `Reference context: ${record.context}`,
      "Work only on this assignment. At the end, give your owner a concise report of changes, validation, and open risks."
    ].join("\n\n");
  }

  private async continueAgent(record: AgentRecord, context: string): Promise<void> {
    record.status = "running";
    record.latestActivity = `Resuming with ${record.reasoning} reasoning`;
    try {
      const result = await this.provider.resume(record.sessionId!, [
        `You are continuing as ${record.name}, an implementation ${record.depth === 0 ? "sub-agent" : "sub-delegate"}.`,
        `New context from Solar: ${context}`,
        "Apply this context to your previous task if action is needed, then send an updated report."
      ].join("\n\n"), { ...this.options, role: record.depth === 0 ? "sub-agent" : "sub-delegate", reasoning: record.reasoning, onEvent: event => this.recordActivity(record, event) });
      record.report = stripControlLines(result.text);
      record.sessionId = result.sessionId ?? record.sessionId;
      record.status = "completed";
      record.latestActivity = "Continuation completed and reported to Solar";
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.latestActivity = record.error;
    } finally { record.finishedAt = new Date(); }
  }

  private executingCount(): number {
    return [...this.records.values()].filter(agent => agent.status === "queued" || agent.status === "running").length;
  }

  private recordActivity(record: AgentRecord, event: string): void {
    record.latestActivity = event;
    record.recentActivity.push(event);
    if (record.recentActivity.length > 8) record.recentActivity.shift();
  }

  private getRecord(reference: string): AgentRecord | undefined {
    return this.records.get(reference) ?? [...this.records.values()].find(record => record.name.toLowerCase() === reference.toLowerCase());
  }

  private uniqueName(requested: string): string {
    const base = requested.trim().replace(/\s+/g, "-") || "Sub-agent";
    const used = new Set([...this.records.values()].map(record => record.name.toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    let suffix = 2;
    while (used.has(`${base}-${suffix}`.toLowerCase())) suffix += 1;
    return `${base}-${suffix}`;
  }

  private assertControl(actorId: "main-agent" | string, target: AgentRecord): void {
    if (actorId === "main-agent") return;
    if (target.parentId !== actorId) throw new Error("Sub-agents may control only their own direct sub-delegates.");
  }

  private cancelTree(record: AgentRecord): void {
    this.aborters.get(record.id)?.abort();
    record.status = "cancelled";
    for (const childId of record.childIds) {
      const child = this.records.get(childId);
      if (child) this.cancelTree(child);
    }
  }
}

function extractSubDelegateRequest(text: string): SubDelegateRequest | undefined {
  const match = text.match(/^SOLAR_SUBDELEGATE:\s*(\{[^\r\n]+\})\s*$/m);
  if (!match) return undefined;
  const parsed = JSON.parse(match[1]) as SubDelegateRequest;
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0 || parsed.tasks.length > MAX_SUB_DELEGATES_PER_AGENT) {
    throw new Error("Sub-agent requested an invalid sub-delegate plan (expected one to eight tasks).");
  }
  for (const task of parsed.tasks) {
    if (!task.name?.trim() || !task.title?.trim() || !task.instructions?.trim()) {
      throw new Error("Every sub-delegate request requires a name, title, and instructions.");
    }
  }
  return parsed;
}

function stripControlLines(text: string): string {
  return text
    .replace(/^SOLAR_SUBDELEGATE:\s*\{[^\r\n]+\}\s*$/gm, "")
    .replace(/^SOLAR_SUBDELEGATE_TOOL:\s*\{[^\r\n]+\}\s*$/gm, "")
    .trim();
}

function extractSubDelegateControl(text: string): SubDelegateControl | undefined {
  const match = text.match(/^SOLAR_SUBDELEGATE_TOOL:\s*(\{[^\r\n]+\})\s*$/m);
  if (!match) return undefined;
  const parsed = JSON.parse(match[1]) as SubDelegateControl;
  if (!parsed.agentId || !["cancel", "inject_context", "set_reasoning"].includes(parsed.action)) {
    throw new Error("Sub-agent emitted an invalid sub-delegate control request.");
  }
  if (parsed.action === "inject_context" && !parsed.context?.trim()) throw new Error("inject_context requires context.");
  return parsed;
}
