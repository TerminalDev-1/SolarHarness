export type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** User-facing effort levels. "light" maps to Codex's low reasoning setting. */
export type ReasoningEffort = "light" | "medium" | "high" | "xhigh" | "max";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["light", "medium", "high", "xhigh", "max"];

export interface AgentTask {
  title: string;
  instructions: string;
  context?: string;
}

export interface AgentRecord extends AgentTask {
  id: string;
  status: AgentStatus;
  reasoning: ReasoningEffort;
  startedAt?: Date;
  finishedAt?: Date;
  latestActivity: string;
  report?: string;
  error?: string;
  sessionId?: string;
  injectedContext: string[];
}

export interface DelegationPlan {
  summary: string;
  tasks: AgentTask[];
}

export interface CodexRunOptions {
  model: string;
  reasoning: ReasoningEffort;
  cwd: string;
  role?: "coordinator" | "worker";
  onEvent?: (message: string) => void;
  signal?: AbortSignal;
}

export interface CodexRunResult {
  text: string;
  sessionId?: string;
}

export interface HarnessOptions {
  task: string;
  context?: string;
  model: string;
  reasoning: ReasoningEffort;
  cwd: string;
}
