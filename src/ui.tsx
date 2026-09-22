import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { SolarHarness } from "./harness.js";
import { REASONING_EFFORTS, type AgentRecord, type DelegationPlan, type ReasoningEffort } from "./types.js";

type UiPhase = "idle" | "thinking" | "planning" | "delegating" | "working" | "command" | "synthesizing" | "updating";
type ChatMessage = { role: "user" | "solar" | "error"; text: string };
type PendingPlan = { plan: DelegationPlan; request: string; context: string; selected: boolean[]; cursor: number };
type PendingEffort = { cursor: number };
type PendingNew = { cursor: number };
type ThemeName = "dark" | "light";
type Theme = {
  accent: string; accentStrong: string; primary: string; secondary: string;
  subtle: string; success: string; warning: string; error: string; prompt: string;
  background: string; pulse: string;
};

const darkTheme: Theme = {
  accent: "#8ab4f8",
  accentStrong: "#c4b5fd",
  primary: "#e8eaed",
  secondary: "#9aa0a6",
  subtle: "#5f6368",
  success: "#81c995",
  warning: "#fdd663",
  error: "#f28b82",
  prompt: "#a8c7fa",
  background: "#0b0b0b",
  pulse: "#d97757"
};

const lightTheme: Theme = {
  accent: "#185abc",
  accentStrong: "#673ab7",
  primary: "#202124",
  secondary: "#5f6368",
  subtle: "#80868b",
  success: "#137333",
  warning: "#b06000",
  error: "#b3261e",
  prompt: "#174ea6",
  background: "#f8f9fa",
  pulse: "#b45309"
};

const themes: Record<ThemeName, Theme> = { dark: darkTheme, light: lightTheme };
let theme = darkTheme;

const icon = ["▝▜▄  ", "  ▝▜▄", " ▗▟▀ ", "▝▀   "];
// Avoid emoji-capable glyphs such as ✳, which Windows Terminal renders as a
// green full-color emoji regardless of the requested ANSI foreground color.
const spinnerFrames = ["·", "✦", "✧", "✦"];

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
  const [pendingEffort, setPendingEffort] = useState<PendingEffort | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null);
  const [currentReasoning, setCurrentReasoning] = useState(reasoning);
  const [autoApprove, setAutoApprove] = useState(harness.getAutoPermissions().enabled);
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [workspace, setWorkspace] = useState(harness.getWorkspace());
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [spinner, setSpinner] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    // Animate only the adjacent glyph; the activity text remains one color span.
    const spinnerTimer = setInterval(() => setSpinner(value => value + 1), 240);
    const elapsedTimer = setInterval(() => setElapsed(value => value + 1), 1_000);
    return () => { clearInterval(spinnerTimer); clearInterval(elapsedTimer); };
  }, [busy]);

  useEffect(() => () => {
    stdout.write("\x1b]110\x07\x1b]111\x07");
  }, [stdout]);

  const activeWorkers = agents.filter(agent => agent.status === "running").length;
  const phaseInfo = phaseCopy(phase, activeWorkers);

  const updateWorkers = (nextAgents: AgentRecord[]): void => {
    setAgents(nextAgents);
    const executing = nextAgents.filter(agent => agent.status === "running");
    setPhase(executing.some(agent => agent.latestActivity.startsWith("Running command:")) ? "command" : executing.length ? "working" : "synthesizing");
  };

  const addMessage = (message: ChatMessage): void => setConversation(current => [...current, message]);
  const reportActivity = (message: string): void => {
    const clean = message.replace(/\s+/g, " ").trim();
    if (clean) {
      setActivityLog(current => [...current.slice(-5), clean]);
      if (clean.startsWith("Running command:")) setPhase("command");
    }
  };

  const executeApprovedPlan = async (plan: DelegationPlan, request: string, context: string): Promise<void> => {
    setPendingPlan(null);
    setBusy(true);
    setPhase("delegating");
    setActivityLog([`Launching ${plan.tasks.length} named worker${plan.tasks.length === 1 ? "" : "s"} at ${currentReasoning} reasoning`]);
    addMessage({ role: "solar", text: `Okay — I’m launching ${plan.tasks.length} named worker${plan.tasks.length === 1 ? "" : "s"} at ${currentReasoning} reasoning: ${plan.tasks.map(task => `${task.name} (${task.title})`).join(", ")}. They can create Light-pinned sub-workers when that makes the work genuinely more parallel.` });
    try {
      const result = await harness.executePlan(plan, request, context, updateWorkers, reportActivity);
      addMessage({ role: "solar", text: result });
      setBrief([]);
    } catch (error) {
      addMessage({ role: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  };

  const preparePlan = async (request: string, context: string): Promise<void> => {
    setPhase("planning");
    const plan = await harness.plan(request, context, reportActivity);
    if (harness.getAutoPermissions().enabled) {
      addMessage({ role: "solar", text: `Auto-approve is on, so I’m accepting the ${plan.tasks.length}-worker plan without pausing for review.` });
      await executeApprovedPlan(plan, request, context);
    } else {
      setPendingPlan({ plan, request, context, selected: plan.tasks.map(() => true), cursor: 0 });
    }
  };

  const rejectPlan = (): void => {
    setPendingPlan(null);
    setBrief([]);
    addMessage({ role: "solar", text: "Delegation rejected. No workers were launched and no workspace changes were made." });
  };

  const approvePlan = async (): Promise<void> => {
    if (!pendingPlan) return;
    const tasks = pendingPlan.plan.tasks.filter((_, index) => pendingPlan.selected[index]);
    if (!tasks.length) { rejectPlan(); return; }
    const approved = { ...pendingPlan.plan, tasks };
    const { request, context } = pendingPlan;
    await executeApprovedPlan(approved, request, context);
  };

  const controlAgent = async (line: string): Promise<void> => {
    const [, id, action, ...rest] = line.split(" ");
    if (action === "reasoning" && REASONING_EFFORTS.includes(rest[0] as ReasoningEffort)) {
      const next = await harness.tools.call("orchestrate", { action: "set_reasoning", agentId: id, reasoning: rest[0] as ReasoningEffort }) as AgentRecord[];
      setAgents(next);
      addMessage({ role: "solar", text: `Changed ${id}'s reasoning effort to ${rest[0]}.` });
    } else if (action === "context" && rest.length) {
      const next = await harness.tools.call("orchestrate", { action: "inject_context", agentId: id, context: rest.join(" ") }) as AgentRecord[];
      setAgents(next);
      addMessage({ role: "solar", text: `Passed the new context to ${id}.` });
    } else if (action === "cancel") {
      const next = await harness.tools.call("orchestrate", { action: "cancel", agentId: id }) as AgentRecord[];
      setAgents(next);
      addMessage({ role: "solar", text: `Cancelled ${id} and any sub-workers it owns.` });
    } else {
      addMessage({ role: "error", text: "Usage: /agent <id-or-name> reasoning <light|medium|high|xhigh|max> | context <message> | cancel" });
    }
  };

  const changeEffort = (effort: ReasoningEffort): void => {
    harness.setReasoning(effort);
    setCurrentReasoning(effort);
    setPendingEffort(null);
    addMessage({ role: "solar", text: `Reasoning effort is now ${effort}. This applies to Solar and newly launched top-level workers; new sub-workers remain pinned to Light until Solar explicitly authorizes a change.` });
  };

  const changeTheme = (nextTheme: ThemeName): void => {
    theme = themes[nextTheme];
    applyTerminalTheme(stdout, theme, nextTheme);
    setThemeName(nextTheme);
    addMessage({ role: "solar", text: `Theme changed to ${nextTheme}.` });
  };

  const finishNewSession = async (confirmed: boolean): Promise<void> => {
    setPendingNew(null);
    if (!confirmed) {
      addMessage({ role: "solar", text: "New session cancelled. The current context and workspace are unchanged." });
      return;
    }
    try {
      const nextWorkspace = await harness.resetIntoTestWorkspace();
      setWorkspace(nextWorkspace);
      setAgents([]);
      setBrief([]);
      setPendingPlan(null);
      setPendingEffort(null);
      setConversation([{ role: "solar", text: `Started a completely fresh coordinator session. The test workspace was cleared and is now empty: ${nextWorkspace}` }]);
    } catch (error) {
      addMessage({ role: "error", text: `Unable to start the test workspace: ${error instanceof Error ? error.message : String(error)}` });
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
        addMessage({ role: "solar", text: "Describe the outcome naturally. I’ll explain the delegation, name the workers, show their commands and sub-workers, then synthesize the result. Controls: /new · /auto-approve <on|off> · /theme <light|dark> · /effort [level] · /agents · /agent <id-or-name> reasoning <level> · /agent <id-or-name> context <message> · /agent <id-or-name> cancel · /quit" });
      } else if (line === "/new") {
        setPendingNew({ cursor: 1 });
      } else if (line === "/auto-approve") {
        addMessage({ role: "solar", text: `Auto-approve is ${autoApprove ? "on" : "off"}. Usage: /auto-approve <on|off>` });
      } else if (line.startsWith("/auto-approve ")) {
        const setting = line.slice(14).trim();
        if (setting === "on" || setting === "off") {
          const enabled = setting === "on";
          harness.setAutoPermissions(enabled);
          setAutoApprove(enabled);
          addMessage({ role: "solar", text: `Auto-approve is now ${setting}. ${enabled ? "Future worker plans will launch immediately without the review screen." : "Future worker plans will wait for your review before launch."}` });
        } else addMessage({ role: "error", text: "Usage: /auto-approve <on|off>" });
      } else if (line === "/theme") {
        addMessage({ role: "solar", text: `Current theme: ${themeName}. Usage: /theme <light|dark>` });
      } else if (line.startsWith("/theme ")) {
        const nextTheme = line.slice(7).trim();
        if (nextTheme === "light" || nextTheme === "dark") changeTheme(nextTheme);
        else addMessage({ role: "error", text: "Usage: /theme <light|dark>" });
      } else if (line === "/effort") {
        setPendingEffort({ cursor: REASONING_EFFORTS.indexOf(currentReasoning) });
      } else if (line.startsWith("/effort ")) {
        const effort = line.slice(8).trim() as ReasoningEffort;
        if (REASONING_EFFORTS.includes(effort)) changeEffort(effort);
        else addMessage({ role: "error", text: "Usage: /effort <light|medium|high|xhigh|max>" });
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
        const response = await harness.converse(line, reportActivity);
        setAutoApprove(harness.getAutoPermissions().enabled);
        setAgents(harness.manager.list());
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
    if (pendingNew) {
      if (key.escape || character.toLowerCase() === "n") { void finishNewSession(false); return; }
      if (character.toLowerCase() === "y") { setPendingNew({ cursor: 0 }); return; }
      if (key.leftArrow || key.upArrow) { setPendingNew({ cursor: 0 }); return; }
      if (key.rightArrow || key.downArrow) { setPendingNew({ cursor: 1 }); return; }
      if (key.return) { void finishNewSession(pendingNew.cursor === 0); return; }
      return;
    }
    if (pendingEffort) {
      if (key.escape) { setPendingEffort(null); return; }
      if (key.upArrow) { setPendingEffort(value => value && ({ cursor: Math.max(0, value.cursor - 1) })); return; }
      if (key.downArrow) { setPendingEffort(value => value && ({ cursor: Math.min(REASONING_EFFORTS.length - 1, value.cursor + 1) })); return; }
      if (key.return) { changeEffort(REASONING_EFFORTS[pendingEffort.cursor]); return; }
      return;
    }
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
  return (
    <Box key={themeName} flexDirection="column" paddingX={compact ? 0 : 1}>
      <Header compact={compact} workspace={workspace} status={busy ? phaseInfo.activity : pendingPlan ? "review required" : pendingEffort ? "choose effort" : pendingNew ? "confirm new session" : "ready"} statusColor={busy ? phaseInfo.color : pendingPlan || pendingEffort || pendingNew ? theme.warning : theme.success} />

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

      {agents.length > 0 && <TerminalActivity agents={agents} spinner={spinner} />}

      {pendingPlan && <PlanApproval pending={pendingPlan} />}

      {pendingEffort && <EffortPicker pending={pendingEffort} current={currentReasoning} />}

      {pendingNew && <NewSessionConfirmation pending={pendingNew} workspace={harness.getTestWorkspace()} />}

      {busy && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={theme.pulse}>{spinnerFrames[spinner % spinnerFrames.length]} </Text>
            <ActivityText text={phaseInfo.activity} />
            <Text color={theme.subtle}> · {elapsed}s</Text>
          </Box>
          {activityLog.slice(-4).map((activity, index) => (
            <Text key={`${activity}-${index}`} color={activity.startsWith("Running command:") ? theme.secondary : theme.subtle}>  {activity.startsWith("Running command:") ? "└─ $ " + activity.slice(17) : "│ " + activity}</Text>
          ))}
        </Box>
      )}

      <Box borderStyle="round" borderColor={busy ? theme.subtle : pendingPlan || pendingEffort || pendingNew ? theme.warning : theme.prompt} paddingX={1} marginTop={1}>
        <Text color={busy ? theme.subtle : pendingPlan || pendingEffort || pendingNew ? theme.warning : theme.prompt}>{busy ? "· " : pendingPlan || pendingEffort || pendingNew ? "? " : "> "}</Text>
        <Text color={input && !pendingPlan && !pendingEffort && !pendingNew ? theme.primary : theme.secondary}>
          {pendingPlan ? "Review the proposed workers above" : pendingEffort ? "Choose an effort level above" : pendingNew ? "Confirm the new test-workspace session above" : input || (busy ? "Working…" : "Describe what you want to accomplish")}
        </Text>
        {!busy && !pendingPlan && !pendingEffort && !pendingNew && <Text inverse> </Text>}
      </Box>

      <Footer workspace={workspace} model={model} reasoning={currentReasoning} themeName={themeName} autoApprove={autoApprove} />
    </Box>
  );
}

function EffortPicker({ pending, current }: { pending: PendingEffort; current: ReasoningEffort }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Text bold color={theme.warning}>Reasoning effort</Text>
      {REASONING_EFFORTS.map((effort, index) => (
        <Text key={effort} color={index === pending.cursor ? theme.primary : theme.secondary}>
          <Text color={index === pending.cursor ? theme.warning : theme.subtle}>{index === pending.cursor ? "›" : " "} </Text>
          {effort[0].toUpperCase() + effort.slice(1)}{effort === current ? " (current)" : ""}
        </Text>
      ))}
      <Box marginTop={1}><Text color={theme.primary}>↑↓</Text><Text color={theme.secondary}> select  </Text><Text color={theme.primary}>Enter</Text><Text color={theme.secondary}> apply  </Text><Text color={theme.primary}>Esc</Text><Text color={theme.secondary}> cancel</Text></Box>
    </Box>
  );
}

function NewSessionConfirmation({ pending, workspace }: { pending: PendingNew; workspace: string }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.warning} paddingX={1}>
      <Text bold color={theme.warning}>Start a completely fresh session?</Text>
      <Text color={theme.secondary}>This discards the coordinator conversation, stops all workers, and clears their records.</Text>
      <Text color={theme.error}>Every file and folder inside this test workspace will also be deleted:</Text>
      <Text color={theme.primary}>{workspace}</Text>
      <Text color={theme.subtle}>The empty test folder is kept and becomes the new session workspace. This cannot be undone by Solar Harness.</Text>
      <Box marginTop={1}>
        <Text color={pending.cursor === 0 ? theme.success : theme.secondary}>{pending.cursor === 0 ? "› " : "  "}[ Yes ]</Text>
        <Text>  </Text>
        <Text color={pending.cursor === 1 ? theme.warning : theme.secondary}>{pending.cursor === 1 ? "› " : "  "}[ No ]</Text>
      </Box>
      <Text color={theme.subtle}>←→ choose · Enter confirm · Esc cancel</Text>
    </Box>
  );
}

function ActivityText({ text }: { text: string }): React.JSX.Element {
  // Keep this as one ANSI color span. Per-character bold/reset sequences can
  // briefly restore the terminal's default (often green) foreground on Windows.
  return <Text color={theme.pulse}>{text}</Text>;
}

function Header({ compact, workspace, status, statusColor }: { compact: boolean; workspace: string; status: string; statusColor: string }): React.JSX.Element {
  return (
    <Box marginTop={1} marginBottom={1} paddingLeft={1} flexDirection={compact ? "column" : "row"}>
      <Box flexDirection="column" marginRight={compact ? 0 : 2}>
        {icon.map((line, index) => <Text key={line} color={index < 2 ? theme.accentStrong : theme.accent}>{line}</Text>)}
      </Box>
      <Box flexDirection="column" marginTop={compact ? 1 : 0}>
        <Text bold color={theme.primary}>Solar</Text><Text color={theme.subtle}>  Harness Preview</Text>
        <Text color={theme.secondary}>Coordinator · named workers · nested delegation</Text>
        <Text color={theme.subtle}>Workspace: {workspace}</Text>
        {status !== "ready" && <Text color={statusColor}>✦ {status}</Text>}
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
                <Text bold={focused}> {task.name}</Text><Text color={theme.subtle}> — {task.title}</Text>
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
      <Text color={theme.secondary}>AGENT TREE</Text>
      {agents.map(agent => {
        const color = agent.status === "completed" ? theme.success : agent.status === "failed" ? theme.error : agent.status === "running" ? theme.accent : theme.secondary;
        const marker = agent.status === "completed" ? "✓" : agent.status === "failed" ? "×" : agent.status === "running" ? "●" : agent.status === "waiting" ? "◇" : "○";
        const branch = agent.depth === 1 ? "  └─ " : "";
        return <Text key={agent.id}><Text color={color}>{branch}{marker} {agent.name}</Text><Text color={theme.subtle}> [{agent.id}]</Text><Text color={theme.secondary}> · {agent.reasoning}{agent.reasoningPinned ? " pinned" : ""} · {agent.latestActivity}</Text></Text>;
      })}
    </Box>
  );
}

function TerminalActivity({ agents, spinner }: { agents: AgentRecord[]; spinner: number }): React.JSX.Element | null {
  const commands = agents.flatMap(agent => agent.recentActivity
    .filter(activity => activity.startsWith("Running command:") || activity.startsWith("Command completed:"))
    .map(activity => ({ name: agent.name, activity }))
  ).slice(-5);
  if (!commands.length) return null;
  const running = agents.some(agent => agent.status === "running" && agent.latestActivity.startsWith("Running command:"));
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2} borderStyle="single" borderLeft borderRight={false} borderTop={false} borderBottom={false} borderColor={theme.subtle}>
      <Text color={running ? theme.pulse : theme.secondary}>{running ? spinnerFrames[spinner % spinnerFrames.length] : "·"} TERMINAL</Text>
      {commands.map((command, index) => {
        const completed = command.activity.startsWith("Command completed:");
        const text = command.activity.replace(/^(Running command|Command completed):\s*/, "");
        return <Text key={`${command.name}-${text}-${index}`} color={theme.secondary}><Text color={completed ? theme.success : theme.pulse}>{completed ? "✓" : "$"}</Text> <Text color={theme.subtle}>{command.name}</Text>  {text}</Text>;
      })}
    </Box>
  );
}

function Footer({ workspace, model, reasoning, themeName, autoApprove }: { workspace: string; model: string; reasoning: ReasoningEffort; themeName: ThemeName; autoApprove: boolean }): React.JSX.Element {
  const workspaceName = workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace;
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={theme.subtle}>workspace: {workspaceName}</Text>
      <Text color={theme.subtle}>{model} · {reasoning} · {themeName} · auto {autoApprove ? "on" : "off"}</Text>
    </Box>
  );
}

function phaseCopy(phase: UiPhase, activeWorkers: number): { activity: string; color: string } {
  if (phase === "thinking") return { activity: "Thinking…", color: theme.accentStrong };
  if (phase === "planning") return { activity: "Preparing the delegation…", color: theme.warning };
  if (phase === "delegating") return { activity: "Assigning specialist work…", color: theme.accent };
  if (phase === "working") return { activity: `${activeWorkers} worker${activeWorkers === 1 ? "" : "s"} running…`, color: theme.accent };
  if (phase === "command") return { activity: `${activeWorkers} agent${activeWorkers === 1 ? "" : "s"} using the terminal…`, color: theme.pulse };
  if (phase === "synthesizing") return { activity: "Reviewing worker reports…", color: theme.accentStrong };
  if (phase === "updating") return { activity: "Updating worker context…", color: theme.warning };
  return { activity: "Ready", color: theme.success };
}

export function startSolarUi(harness: SolarHarness, model: string, reasoning: ReasoningEffort): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Solar Harness Preview requires an interactive terminal.");
  render(<SolarApp harness={harness} model={model} reasoning={reasoning} />, { exitOnCtrlC: false });
}

function applyTerminalTheme(stdout: NodeJS.WriteStream, palette: Theme, themeName: ThemeName): void {
  if (themeName === "dark") {
    // Restore native terminal colors so light-mode black cannot survive on dark.
    stdout.write("\x1b]110\x07\x1b]111\x07\x1b[0m\x1b[2J\x1b[H");
    return;
  }
  stdout.write(`\x1b]10;${palette.primary}\x07\x1b]11;${palette.background}\x07\x1b[0m\x1b[2J\x1b[H`);
}
