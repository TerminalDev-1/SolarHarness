import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import path from "node:path";
import { SolarHarness } from "./harness.js";
import type { AgentRecord, DelegationPlan, ReasoningEffort } from "./types.js";

type UiPhase = "idle" | "thinking" | "planning" | "delegating" | "working" | "synthesizing" | "updating";
type ChatMessage = { role: "user" | "solar" | "error"; text: string };
type PendingPlan = { plan: DelegationPlan; request: string; context: string; selected: boolean[]; cursor: number };

const theme = {
  accent: "#8ab4f8",
  accentStrong: "#c4b5fd",
  primary: "#e8eaed",
  secondary: "#9aa0a6",
  subtle: "#5f6368",
  success: "#81c995",
  warning: "#fdd663",
  error: "#f28b82",
  prompt: "#a8c7fa"
};

const icon = ["▝▜▄  ", "  ▝▜▄", " ▗▟▀ ", "▝▀   "];
const spinnerFrames = ["✦", "✧", "·", "✧"];

interface SolarAppProps {
  harness: SolarHarness;
  model: string;
  reasoning: ReasoningEffort;
}

function SolarApp({ harness, model, reasoning }: SolarAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [brief, setBrief] = useState<string[]>([]);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [spinner, setSpinner] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const spinnerTimer = setInterval(() => setSpinner(value => (value + 1) % spinnerFrames.length), 120);
    const elapsedTimer = setInterval(() => setElapsed(value => value + 1), 1_000);
    return () => { clearInterval(spinnerTimer); clearInterval(elapsedTimer); };
  }, [busy]);

  const activeWorkers = agents.filter(agent => agent.status === "running").length;
  const phaseInfo = phaseCopy(phase, activeWorkers);

  const updateWorkers = (nextAgents: AgentRecord[]): void => {
    setAgents(nextAgents);
    setPhase(nextAgents.some(agent => agent.status === "running") ? "working" : "synthesizing");
  };

  const addMessage = (message: ChatMessage): void => setConversation(current => [...current, message]);
  const reportActivity = (message: string): void => {
    const clean = message.replace(/\s+/g, " ").trim();
    if (clean) setActivityLog(current => [...current.slice(-4), clean]);
  };

  const preparePlan = async (request: string, context: string): Promise<void> => {
    setPhase("planning");
    const plan = await harness.plan(request, context, reportActivity);
    setPendingPlan({ plan, request, context, selected: plan.tasks.map(() => true), cursor: 0 });
  };

  const rejectPlan = (): void => {
    setPendingPlan(null);
    addMessage({ role: "solar", text: "Delegation rejected. No workers were launched and no workspace changes were made." });
  };

  const approvePlan = async (): Promise<void> => {
    if (!pendingPlan) return;
    const tasks = pendingPlan.plan.tasks.filter((_, index) => pendingPlan.selected[index]);
    if (!tasks.length) { rejectPlan(); return; }
    const approved = { ...pendingPlan.plan, tasks };
    const { request, context } = pendingPlan;
    setPendingPlan(null);
    setBusy(true);
    setPhase("delegating");
    setActivityLog([`Approved ${tasks.length} worker task${tasks.length === 1 ? "" : "s"}`]);
    try {
      const result = await harness.executePlan(approved, request, context, updateWorkers, reportActivity);
      addMessage({ role: "solar", text: result });
    } catch (error) {
      addMessage({ role: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  };

  const controlAgent = async (line: string): Promise<void> => {
    const [, id, action, ...rest] = line.split(" ");
    if (action === "reasoning" && ["low", "medium", "high"].includes(rest[0])) {
      const next = await harness.tools.call("orchestrate", { action: "set_reasoning", agentId: id, reasoning: rest[0] as ReasoningEffort }) as AgentRecord[];
      setAgents(next);
      addMessage({ role: "solar", text: `Changed ${id}'s reasoning effort to ${rest[0]}.` });
    } else if (action === "context" && rest.length) {
      const next = await harness.tools.call("orchestrate", { action: "inject_context", agentId: id, context: rest.join(" ") }) as AgentRecord[];
      setAgents(next);
      addMessage({ role: "solar", text: `Passed the new context to ${id}.` });
    } else {
      addMessage({ role: "error", text: "Usage: /agent <id> reasoning <low|medium|high> | context <message>" });
    }
  };

  const submit = async (): Promise<void> => {
    const line = input.trim();
    if (!line || busy) return;
    setInput("");
    setHistoryIndex(-1);
    setInputHistory(current => [...current, line]);
    if (line === "/quit" || line === "/exit") { exit(); return; }

    addMessage({ role: "user", text: line });
    setActivityLog(["Sending your request to the coordinator"]);
    setBusy(true);
    setPhase(line === "/delegate" ? "planning" : line.startsWith("/agent ") ? "updating" : "thinking");

    try {
      if (line === "/help") {
        addMessage({ role: "solar", text: "Describe the outcome naturally. Solar will clarify only when necessary, propose worker tasks, and wait for your approval. Controls: /agents · /agent <id> reasoning <level> · /agent <id> context <message> · /quit" });
      } else if (line === "/agents") {
        addMessage({ role: "solar", text: agents.length ? "Worker activity is shown below." : "No workers are assigned. Describe an actionable goal and Solar will propose them automatically." });
      } else if (line.startsWith("/agent ")) {
        await controlAgent(line);
      } else if (line === "/delegate") {
        if (!brief.length) {
          addMessage({ role: "solar", text: "First tell me what the team should accomplish." });
        } else {
          await preparePlan(brief.join("\n"), brief.join("\n"));
        }
      } else {
        const nextBrief = [...brief, line];
        setBrief(nextBrief);
        const response = await harness.converse(nextBrief, reportActivity);
        addMessage({ role: "solar", text: response.reply });
        if (response.readyToDelegate) {
          await preparePlan(nextBrief.join("\n"), nextBrief.join("\n"));
        }
      }
    } catch (error) {
      addMessage({ role: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  };

  useInput((character, key) => {
    if (key.ctrl && character === "c") { exit(); return; }
    if (busy) return;
    if (pendingPlan) {
      if (key.escape || character.toLowerCase() === "r") { rejectPlan(); return; }
      if (key.upArrow) { setPendingPlan(plan => plan && ({ ...plan, cursor: Math.max(0, plan.cursor - 1) })); return; }
      if (key.downArrow) { setPendingPlan(plan => plan && ({ ...plan, cursor: Math.min(plan.plan.tasks.length - 1, plan.cursor + 1) })); return; }
      if (character === " ") {
        setPendingPlan(plan => {
          if (!plan) return plan;
          const selected = [...plan.selected];
          selected[plan.cursor] = !selected[plan.cursor];
          return { ...plan, selected };
        });
        return;
      }
      if (character.toLowerCase() === "a") { setPendingPlan(plan => plan && ({ ...plan, selected: plan.selected.map(() => true) })); return; }
      if (key.return) { void approvePlan(); return; }
      return;
    }
    if (key.return) { void submit(); return; }
    if (key.backspace || key.delete) { setInput(value => value.slice(0, -1)); return; }
    if (key.upArrow && inputHistory.length) {
      const nextIndex = Math.min(inputHistory.length - 1, historyIndex + 1);
      setHistoryIndex(nextIndex);
      setInput(inputHistory[inputHistory.length - 1 - nextIndex] ?? "");
      return;
    }
    if (key.downArrow && historyIndex >= 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setInput(nextIndex < 0 ? "" : inputHistory[inputHistory.length - 1 - nextIndex] ?? "");
      return;
    }
    if (!key.ctrl && !key.meta && character) setInput(value => value + character);
  });

  const terminalWidth = stdout.columns || 80;
  const compact = terminalWidth < 62;
  const cwd = useMemo(() => path.basename(process.cwd()) || process.cwd(), []);

  return (
    <Box flexDirection="column" paddingX={compact ? 0 : 1}>
      <Header compact={compact} status={busy ? phaseInfo.activity : pendingPlan ? "review required" : "ready"} statusColor={busy ? phaseInfo.color : pendingPlan ? theme.warning : theme.success} />

      {conversation.length === 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.primary}>Welcome to Solar Harness Preview.</Text>
          <Text color={theme.secondary}>Describe a goal. Solar will clarify only when needed, then propose specialist work for approval.</Text>
          <Text color={theme.subtle}>Worker file access is restricted to this workspace.</Text>
        </Box>
      )}

      <Box flexDirection="column">
        {conversation.map((message, index) => <Message key={index} message={message} />)}
      </Box>

      {agents.length > 0 && <Workers agents={agents} />}

      {pendingPlan && <PlanApproval pending={pendingPlan} />}

      {busy && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={phaseInfo.color}>{spinnerFrames[spinner]} </Text>
            <Text color={theme.secondary}>{phaseInfo.activity} <Text color={theme.subtle}>· {elapsed}s</Text></Text>
          </Box>
          {activityLog.slice(-3).map((activity, index) => (
            <Text key={`${activity}-${index}`} color={theme.subtle}>  │ {activity}</Text>
          ))}
        </Box>
      )}

      <Box borderStyle="round" borderColor={busy ? theme.subtle : pendingPlan ? theme.warning : theme.prompt} paddingX={1} marginTop={1}>
        <Text color={busy ? theme.subtle : pendingPlan ? theme.warning : theme.prompt}>{busy ? "· " : pendingPlan ? "? " : "> "}</Text>
        <Text color={input && !pendingPlan ? theme.primary : theme.secondary}>
          {pendingPlan ? "Review the proposed workers above" : input || (busy ? "Working…" : "Describe what you want to accomplish")}
        </Text>
        {!busy && !pendingPlan && <Text inverse> </Text>}
      </Box>

      <Footer cwd={cwd} model={model} reasoning={reasoning} agents={agents} />
    </Box>
  );
}

function Header({ compact, status, statusColor }: { compact: boolean; status: string; statusColor: string }): React.JSX.Element {
  return (
    <Box marginTop={1} marginBottom={1} paddingLeft={1} flexDirection={compact ? "column" : "row"}>
      <Box flexDirection="column" marginRight={compact ? 0 : 2}>
        {icon.map((line, index) => <Text key={line} color={index < 2 ? theme.accentStrong : theme.accent}>{line}</Text>)}
      </Box>
      <Box flexDirection="column" marginTop={compact ? 1 : 0}>
        <Text bold color={theme.primary}>Solar Harness Preview</Text>
        <Text> </Text>
        <Text color={theme.secondary}>Multi-agent coding workspace</Text>
        <Text color={statusColor}>{status === "ready" ? "●" : "✦"} {status}</Text>
      </Box>
    </Box>
  );
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === "user") {
    return <Box marginY={1}><Text color={theme.accent}>&gt; </Text><Text color={theme.primary}>{message.text}</Text></Box>;
  }
  if (message.role === "error") {
    return <Box><Text color={theme.error}>! </Text><Text color={theme.error}>{message.text}</Text></Box>;
  }
  return <Box><Text color={theme.accentStrong}>✦ </Text><Text color={theme.primary}>{message.text}</Text></Box>;
}

function PlanApproval({ pending }: { pending: PendingPlan }): React.JSX.Element {
  const accepted = pending.selected.filter(Boolean).length;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Text bold color={theme.warning}>Review delegation</Text>
      <Text color={theme.secondary}>{pending.plan.summary}</Text>
      <Box flexDirection="column" marginTop={1}>
        {pending.plan.tasks.map((task, index) => {
          const focused = index === pending.cursor;
          const selected = pending.selected[index];
          return (
            <Box key={`${task.title}-${index}`} flexDirection="column" marginBottom={index === pending.plan.tasks.length - 1 ? 0 : 1}>
              <Text color={focused ? theme.primary : theme.secondary}>
                <Text color={focused ? theme.warning : theme.subtle}>{focused ? "›" : " "} </Text>
                <Text color={selected ? theme.success : theme.error}>{selected ? "[accept]" : "[reject]"}</Text>
                <Text bold={focused}> {task.title}</Text>
              </Text>
              <Text color={theme.subtle}>    {task.instructions}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.primary}>↑↓</Text><Text color={theme.secondary}> select  </Text>
        <Text color={theme.primary}>Space</Text><Text color={theme.secondary}> accept/reject  </Text>
        <Text color={theme.primary}>Enter</Text><Text color={theme.secondary}> run {accepted}  </Text>
        <Text color={theme.primary}>Esc</Text><Text color={theme.secondary}> reject all</Text>
      </Box>
    </Box>
  );
}

function Workers({ agents }: { agents: AgentRecord[] }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={theme.subtle}>
      <Text color={theme.secondary}>WORKERS</Text>
      {agents.map(agent => {
        const color = agent.status === "completed" ? theme.success : agent.status === "failed" ? theme.error : agent.status === "running" ? theme.accent : theme.secondary;
        const marker = agent.status === "completed" ? "✓" : agent.status === "failed" ? "×" : agent.status === "running" ? "●" : "○";
        return <Text key={agent.id}><Text color={color}>{marker} {agent.id}</Text><Text color={theme.secondary}>  {agent.latestActivity}</Text></Text>;
      })}
    </Box>
  );
}

function Footer({ cwd, model, reasoning, agents }: { cwd: string; model: string; reasoning: ReasoningEffort; agents: AgentRecord[] }): React.JSX.Element {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={theme.subtle}>{cwd}</Text>
      <Text color={theme.subtle}>{model} · {reasoning}</Text>
    </Box>
  );
}

function phaseCopy(phase: UiPhase, activeWorkers: number): { activity: string; color: string } {
  if (phase === "thinking") return { activity: "Thinking…", color: theme.accentStrong };
  if (phase === "planning") return { activity: "Preparing the delegation…", color: theme.warning };
  if (phase === "delegating") return { activity: "Assigning specialist work…", color: theme.accent };
  if (phase === "working") return { activity: `${activeWorkers} worker${activeWorkers === 1 ? "" : "s"} running…`, color: theme.accent };
  if (phase === "synthesizing") return { activity: "Reviewing worker reports…", color: theme.accentStrong };
  if (phase === "updating") return { activity: "Updating worker context…", color: theme.warning };
  return { activity: "Ready", color: theme.success };
}

export function startSolarUi(harness: SolarHarness, model: string, reasoning: ReasoningEffort): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Solar Harness Preview requires an interactive terminal.");
  render(<SolarApp harness={harness} model={model} reasoning={reasoning} />, { exitOnCtrlC: false });
}
