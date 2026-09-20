export type AgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ReasoningEffort = "low" | "medium" | "high";

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
