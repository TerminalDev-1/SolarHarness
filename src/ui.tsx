import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { SolarHarness } from "./harness.js";
import { actionStatus, activityDetail, initialActivity } from "./activity.js";
import { PET_NAMES, petFrame, type PetSelection } from "./pets.js";
import { REASONING_EFFORTS, type AgentRecord, type DelegationPlan, type ReasoningEffort } from "./types.js";

type UiPhase = "idle" | "thinking" | "browsing" | "planning" | "delegating" | "working" | "command" | "synthesizing" | "updating";
type ChatMessage = { role: "user" | "solar" | "error"; text: string };
type PendingPlan = { plan: DelegationPlan; request: string; context: string; selected: boolean[]; cursor: number };
type PendingEffort = { cursor: number };
type PendingNew = { cursor: number };
type ThemeName = "dark" | "chromatic";
type Theme = {
  accent: string; accentStrong: string; primary: string; secondary: string;
  subtle: string; success: string; warning: string; error: string;
  promptBright: string; promptSoft: string; chromatic: readonly string[];
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
  promptBright: "#bfdbfe",
  promptSoft: "#93c5fd",
  chromatic: ["#22d3ee", "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa"],
  background: "#0b0b0b",
  pulse: "#d97757"
};

const chromaticTheme: Theme = {
  accent: "#7dd3fc",
  accentStrong: "#a5b4fc",
  primary: "#edf7ff",
  secondary: "#b1c9e5",
  subtle: "#7794b7",
  success: "#6ee7b7",
  warning: "#fbbf24",
  error: "#fda4af",
  promptBright: "#e0f2fe",
  promptSoft: "#93c5fd",
  chromatic: ["#22d3ee", "#38bdf8", "#60a5fa", "#e0f2fe", "#3b82f6", "#6366f1", "#a78bfa"],
  background: "#071529",
  pulse: "#7dd3fc"
};

const themes: Record<ThemeName, Theme> = { dark: darkTheme, chromatic: chromaticTheme };
let theme = chromaticTheme;

// Avoid emoji-capable glyphs such as ✳, which Windows Terminal renders as a
// green full-color emoji regardless of the requested ANSI foreground color.
const spinnerFrames = ["·", "✦", "✧", "✦"];
const splashDurationMs = 1_800;

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
  const [themeName, setThemeName] = useState<ThemeName>("chromatic");
  const [workspace, setWorkspace] = useState(harness.getWorkspace());
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [currentActivity, setCurrentActivity] = useState("working on your request");
  const [spinner, setSpinner] = useState(0);
  const [pet, setPet] = useState<PetSelection>("cat");
  const [elapsed, setElapsed] = useState(0);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), splashDurationMs);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    // Animate only the adjacent glyph; the activity text remains one color span.
    const spinnerTimer = setInterval(() => setSpinner(value => value + 1), 240);
    const elapsedTimer = setInterval(() => setElapsed(value => value + 1), 1_000);
    return () => { clearInterval(spinnerTimer); clearInterval(elapsedTimer); };
  }, [busy]);

  useEffect(() => () => {
    void harness.browser.close();
    stdout.write("\x1b]110\x07\x1b]111\x07");
  }, [harness, stdout]);

  const activeSubAgents = agents.filter(agent => agent.status === "running").length;
  const phaseInfo = phaseCopy(phase, activeSubAgents, currentActivity);

  const updateSubAgents = (nextAgents: AgentRecord[]): void => {
    setAgents(nextAgents);
    const executing = nextAgents.filter(agent => agent.status === "running");
    if (executing.length) setCurrentActivity(executing.at(-1)!.latestActivity);
    setPhase(executing.some(agent => agent.latestActivity.startsWith("Running command:")) ? "command" : executing.length ? "working" : "synthesizing");
  };

  const addMessage = (message: ChatMessage): void => setConversation(current => [...current, message]);
  const reportActivity = (message: string): void => {
    const clean = message.replace(/\s+/g, " ").trim();
    if (clean) {
      setActivityLog(current => [...current.slice(-5), clean]);
      const detail = activityDetail(clean);
      if (detail) setCurrentActivity(detail);
      if (clean.startsWith("Running command:")) setPhase("command");
      if (clean.startsWith("Browser:")) setPhase("browsing");
    }
  };

  const executeApprovedPlan = async (plan: DelegationPlan, request: string, context: string): Promise<void> => {
    setPendingPlan(null);
    setBusy(true);
    setPhase("delegating");
    setActivityLog([`Launching ${plan.tasks.length} named sub-agent${plan.tasks.length === 1 ? "" : "s"} at ${currentReasoning} reasoning`]);
    addMessage({ role: "solar", text: `Okay — I’m launching ${plan.tasks.length} named sub-agent${plan.tasks.length === 1 ? "" : "s"} at ${currentReasoning} reasoning: ${plan.tasks.map(task => `${task.name} (${task.title})`).join(", ")}. They can create Light-pinned sub-delegates when that makes the work genuinely more parallel.` });
    try {
      const result = await harness.executePlan(plan, request, context, updateSubAgents, reportActivity);
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
      addMessage({ role: "solar", text: `Auto-approve is on, so I’m accepting the ${plan.tasks.length}-sub-agent plan without pausing for review.` });
      await executeApprovedPlan(plan, request, context);
    } else {
      setPendingPlan({ plan, request, context, selected: plan.tasks.map(() => true), cursor: 0 });
    }
  };

  const rejectPlan = (): void => {
    setPendingPlan(null);
    setBrief([]);
    addMessage({ role: "solar", text: "Delegation rejected. No sub-agents were launched and no workspace changes were made." });
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
      addMessage({ role: "solar", text: `Cancelled ${id} and any sub-delegates it owns.` });
    } else {
      addMessage({ role: "error", text: "Usage: /agent <id-or-name> reasoning <light|medium|high|xhigh|max> | context <message> | cancel" });
    }
  };

  const changeEffort = (effort: ReasoningEffort): void => {
    harness.setReasoning(effort);
    setCurrentReasoning(effort);
    setPendingEffort(null);
    addMessage({ role: "solar", text: `Reasoning effort is now ${effort}. This applies to Solar and newly launched top-level sub-agents; new sub-delegates remain pinned to Light until Solar explicitly authorizes a change.` });
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
      setConversation([{ role: "solar", text: `Started a completely fresh Solar session. The test workspace was cleared and is now empty: ${nextWorkspace}` }]);
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
    setActivityLog(["Sending your request to Solar"]);
    setCurrentActivity(initialActivity(line));
    setBusy(true);
    setPhase(line === "/delegate" ? "planning" : line.startsWith("/agent ") ? "updating" : "thinking");

    try {
      if (line === "/help") {
        addMessage({ role: "solar", text: "Describe a task for Solar to handle directly, or ask to delegate it. Controls: /delegate · /new · /auto-approve <on|off> · /theme <chromatic|dark> · /pets [cat|dog|fox|off] · /effort [level] · /agents · /agent <id-or-name> reasoning <level> · /agent <id-or-name> context <message> · /agent <id-or-name> cancel · /quit" });
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
          addMessage({ role: "solar", text: `Auto-approve is now ${setting}. ${enabled ? "Future sub-agent plans will launch immediately without the review screen." : "Future sub-agent plans will wait for your review before launch."}` });
        } else addMessage({ role: "error", text: "Usage: /auto-approve <on|off>" });
      } else if (line === "/theme") {
        addMessage({ role: "solar", text: `Current theme: ${themeName}. Usage: /theme <chromatic|dark>` });
      } else if (line.startsWith("/theme ")) {
        const nextTheme = line.slice(7).trim();
        if (nextTheme === "chromatic" || nextTheme === "dark") changeTheme(nextTheme);
        else addMessage({ role: "error", text: "Usage: /theme <chromatic|dark>" });
      } else if (line === "/pets") {
        addMessage({ role: "solar", text: `Current pet: ${pet}. Choose with /pets <cat|dog|fox|off>.` });
      } else if (line.startsWith("/pets ")) {
        const selection = line.slice(6).trim().toLowerCase();
        if (selection === "off" || PET_NAMES.some(name => name === selection)) {
          setPet(selection as PetSelection);
          addMessage({ role: "solar", text: selection === "off" ? "Pet hidden." : `${selection[0].toUpperCase()}${selection.slice(1)} will keep Solar company while it works.` });
        } else addMessage({ role: "error", text: "Usage: /pets <cat|dog|fox|off>" });
      } else if (line === "/effort") {
        setPendingEffort({ cursor: REASONING_EFFORTS.indexOf(currentReasoning) });
      } else if (line.startsWith("/effort ")) {
        const effort = line.slice(8).trim() as ReasoningEffort;
        if (REASONING_EFFORTS.includes(effort)) changeEffort(effort);
        else addMessage({ role: "error", text: "Usage: /effort <light|medium|high|xhigh|max>" });
      } else if (line === "/agents") {
        addMessage({ role: "solar", text: agents.length ? "Sub-agent activity is shown below." : "No sub-agents are assigned. Ask Solar to delegate when you want sub-agents." });
      } else if (line.startsWith("/agent ")) {
        await controlAgent(line);
      } else if (line === "/delegate") {
        if (!brief.length) {
          addMessage({ role: "solar", text: "First tell me what the team should accomplish." });
        } else {
          await preparePlan(brief.join("\n"), brief.join("\n"));
        }
      } else {
        const nextBrief = [line];
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
    if (showSplash) {
      setShowSplash(false);
      if (!key.return && !key.escape && !key.ctrl && !key.meta && character) setInput(character);
      return;
    }
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
  if (showSplash) return <Splash compact={compact} />;
  const contentWidth = Math.min(Math.max(terminalWidth - 4, 20), 88);
  const latestStep = activityLog.at(-1);
  const latestStepLabel = latestStep ? activityDetail(latestStep) ?? latestStep : undefined;
  return (
    <Box key={themeName} width={terminalWidth - 1} justifyContent="center">
    <Box width={contentWidth} flexDirection="column">
      <Header compact={compact} workspace={workspace} />

      {conversation.length === 0 && <Welcome />}

      <Box flexDirection="column">
        {conversation.map((message, index) => <Message key={index} message={message} />)}
      </Box>

      {agents.length > 0 && <SubAgents agents={agents} />}

      {agents.length > 0 && <TerminalActivity agents={agents} spinner={spinner} />}

      {pendingPlan && <PlanApproval pending={pendingPlan} />}

      {pendingEffort && <EffortPicker pending={pendingEffort} current={currentReasoning} />}

      {pendingNew && <NewSessionConfirmation pending={pendingNew} workspace={harness.getTestWorkspace()} />}

      {busy && (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Box>
            <Text color={theme.pulse}>{spinnerFrames[spinner % spinnerFrames.length]} </Text>
            <ActivityText text={phaseInfo} />
            {pet !== "off" && <Text color={theme.secondary}>  {petFrame(pet, spinner)}</Text>}
            <Text color={theme.subtle}> · {elapsed}s</Text>
          </Box>
          {latestStepLabel && latestStepLabel.toLowerCase() !== phaseInfo.toLowerCase() && <Text color={theme.subtle}>  {latestStepLabel}</Text>}
        </Box>
      )}

      <ChromaticInput
        width={contentWidth}
        value={pendingPlan ? "Review the proposed sub-agents above" : pendingEffort ? "Choose an effort level above" : pendingNew ? "Confirm the new test-workspace session above" : input || (busy ? "Solar is working…" : "Ask Solar anything")}
        entered={Boolean(input) && !pendingPlan && !pendingEffort && !pendingNew}
        cursor={!busy && !pendingPlan && !pendingEffort && !pendingNew}
        busy={busy}
      />

      <Footer compact={compact} model={model} reasoning={currentReasoning} themeName={themeName} autoApprove={autoApprove} />
    </Box>
    </Box>
  );
}

function Welcome(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Text bold color={theme.primary}>What can Solar help with?</Text>
      <Text color={theme.secondary}>Browse the web, inspect files, use tools, or build something new.</Text>
    </Box>
  );
}

function ChromaticInput({ width, value, entered, cursor, busy }: { width: number; value: string; entered: boolean; cursor: boolean; busy: boolean }): React.JSX.Element {
  const available = Math.max(1, width - 7);
  const visibleValue = entered ? value.slice(-available) : value.slice(0, available);
  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      <ChromaticRail width={width} glyph="▄" colors={theme.chromatic} />
      <Box width={width}>
        <Text color={theme.chromatic[0]}>▌</Text>
        <Box width={width - 2} paddingX={1}>
          <Text color={theme.promptBright}>› </Text>
          <Text color={entered ? theme.primary : busy ? theme.secondary : theme.promptSoft}>{visibleValue}</Text>
          {cursor && <Text inverse> </Text>}
        </Box>
        <Text color={theme.chromatic.at(-1)}>▐</Text>
      </Box>
      <ChromaticRail width={width} glyph="▀" colors={[...theme.chromatic].reverse()} />
    </Box>
  );
}

function ChromaticRail({ width, glyph, colors }: { width: number; glyph: string; colors: readonly string[] }): React.JSX.Element {
  return (
    <Box width={width}>
      {colors.map((color, index) => {
        const start = Math.floor(index * width / colors.length);
        const end = Math.floor((index + 1) * width / colors.length);
        return <Text key={`${color}-${index}`} color={color}>{glyph.repeat(end - start)}</Text>;
      })}
    </Box>
  );
}

function Splash({ compact }: { compact: boolean }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={2} paddingX={compact ? 1 : 4}>
      <Text color={theme.pulse}>       \  |  /</Text>
      <Text color={theme.pulse}>     --  O  --</Text>
      <Text color={theme.pulse}>       /  |  \</Text>
      <Box marginTop={1}><Text bold color={theme.primary}>S O L A R   H A R N E S S</Text></Box>
      <Text color={theme.secondary}>Welcome to Solar Harness.</Text>
      <Box marginTop={1}><Text color={theme.subtle}>Press any key to continue</Text></Box>
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
      <Text color={theme.secondary}>This discards the Solar conversation, stops all sub-agents, and clears their records.</Text>
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

function Header({ compact, workspace }: { compact: boolean; workspace: string }): React.JSX.Element {
  const workspaceLabel = compact ? workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace : workspace;
  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column" paddingX={1}>
      <Text><Text bold color={theme.pulse}>✦ Solar</Text><Text color={theme.secondary}> Harness</Text></Text>
      <Text color={theme.subtle}>{workspaceLabel}</Text>
    </Box>
  );
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  const color = message.role === "user" ? theme.accent : message.role === "error" ? theme.error : theme.accentStrong;
  const label = message.role === "user" ? "You" : message.role === "error" ? "Error" : "Solar";
  return (
    <Box marginBottom={1} paddingX={1}>
      <Box width={8}><Text bold color={color}>{label}</Text></Box>
      <Box flexGrow={1}><Text color={message.role === "error" ? theme.error : theme.primary}>{message.text}</Text></Box>
    </Box>
  );
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

function SubAgents({ agents }: { agents: AgentRecord[] }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color={theme.accent}>Team</Text>
      {agents.map(agent => {
        const color = agent.status === "completed" ? theme.success : agent.status === "failed" ? theme.error : agent.status === "running" ? theme.accent : theme.secondary;
        const marker = agent.status === "completed" ? "✓" : agent.status === "failed" ? "×" : agent.status === "running" ? "●" : agent.status === "waiting" ? "◇" : "○";
        const branch = agent.depth === 1 ? "  └─ " : "";
        return <Text key={agent.id}><Text color={color}>{branch}{marker} {agent.name}</Text><Text color={theme.subtle}> [{agent.id}]</Text><Text color={theme.secondary}> · {agent.depth === 0 ? "sub-agent" : "sub-delegate"} · {agent.reasoning}{agent.reasoningPinned ? " pinned" : ""} · {agent.latestActivity}</Text></Text>;
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
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text color={running ? theme.pulse : theme.secondary}>{running ? spinnerFrames[spinner % spinnerFrames.length] : "·"} Recent commands</Text>
      {commands.map((command, index) => {
        const completed = command.activity.startsWith("Command completed:");
        const text = command.activity.replace(/^(Running command|Command completed):\s*/, "");
        return <Text key={`${command.name}-${text}-${index}`} color={theme.secondary}><Text color={completed ? theme.success : theme.pulse}>{completed ? "✓" : "·"}</Text> <Text color={theme.subtle}>{command.name}</Text>  {text}</Text>;
      })}
    </Box>
  );
}

function Footer({ compact, model, reasoning, themeName, autoApprove }: { compact: boolean; model: string; reasoning: ReasoningEffort; themeName: ThemeName; autoApprove: boolean }): React.JSX.Element {
  return (
    <Box paddingX={1} marginTop={1} justifyContent="space-between">
      <Text color={theme.subtle}>Enter send · ↑↓ history · /help</Text>
      {!compact && <Text color={theme.subtle}>{model} · {reasoning} · {themeName} · auto {autoApprove ? "on" : "off"}</Text>}
    </Box>
  );
}

function phaseCopy(phase: UiPhase, activeSubAgents: number, detail: string): string {
  if (phase === "thinking" || phase === "browsing" || phase === "command") return actionStatus(phase, detail);
  if (phase === "planning") return `Planning — ${detail}`;
  if (phase === "delegating") return `Launching sub-agents — ${detail}`;
  if (phase === "working") return `${activeSubAgents} sub-agent${activeSubAgents === 1 ? "" : "s"} — ${detail}`;
  if (phase === "synthesizing") return `Reviewing — ${detail}`;
  if (phase === "updating") return `Updating — ${detail}`;
  return "";
}

export function startSolarUi(harness: SolarHarness, model: string, reasoning: ReasoningEffort): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Solar Harness Preview requires an interactive terminal.");
  theme = chromaticTheme;
  applyTerminalTheme(process.stdout, chromaticTheme, "chromatic");
  render(<SolarApp harness={harness} model={model} reasoning={reasoning} />, { exitOnCtrlC: false });
}

function applyTerminalTheme(stdout: NodeJS.WriteStream, palette: Theme, themeName: ThemeName): void {
  if (themeName === "dark") {
    // Restore native terminal colors so the chromatic palette does not survive on dark.
    stdout.write("\x1b]110\x07\x1b]111\x07\x1b[0m\x1b[2J\x1b[H");
    return;
  }
  stdout.write(`\x1b]10;${palette.primary}\x07\x1b]11;${palette.background}\x07\x1b[0m\x1b[2J\x1b[H`);
}
