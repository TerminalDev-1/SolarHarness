import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdout } from "ink";
import { SolarHarness } from "./harness.js";
import { actionStatus, activityDetail, initialActivity } from "./activity.js";
import { PET_NAMES, petSprite, type PetSelection } from "./pets.js";
import { formatStats } from "./stats.js";
import { REASONING_EFFORTS, type AgentRecord, type DelegationPlan, type ReasoningEffort } from "./types.js";

type UiPhase = "idle" | "thinking" | "browsing" | "planning" | "delegating" | "working" | "command" | "synthesizing" | "updating";
type ChatMessage = { role: "user" | "solar" | "error"; text: string };
type PendingPlan = { plan: DelegationPlan; request: string; context: string; selected: boolean[]; cursor: number };
type PendingEffort = { cursor: number };
type PendingSpeed = { cursor: number };
type PendingNew = { cursor: number };
type ThemeName = "dark" | "light";
type Theme = {
  accent: string; accentStrong: string; primary: string; secondary: string;
  subtle: string; success: string; warning: string; error: string;
  rail: readonly string[];
  pulse: string; background?: string;
};

const darkTheme: Theme = {
  accent: "#aeb8c5",
  accentStrong: "#d5dce5",
  primary: "#e8eaed",
  secondary: "#9aa0a6",
  subtle: "#5f6368",
  success: "#81c995",
  warning: "#fdd663",
  error: "#f28b82",
  rail: ["#647181", "#aeb8c5", "#eef2f6", "#ffffff", "#cbd5e1", "#647181"],
  pulse: "#d97757"
};

const lightTheme: Theme = {
  accent: "#185abc", accentStrong: "#673ab7", primary: "#202124",
  secondary: "#5f6368", subtle: "#80868b", success: "#137333",
  warning: "#b06000", error: "#b3261e", pulse: "#b45309",
  rail: ["#27364b", "#536780", "#869bb1", "#dbe5ee", "#ffffff", "#b7c9d9"],
  background: "#f8f9fa"
};
const themes: Record<ThemeName, Theme> = { dark: darkTheme, light: lightTheme };
let theme = darkTheme;

// The rainbow-blue input stays independent of the dark interface palette.
const rainbowInput = {
  background: "#0a347a",
  primary: "#f2fbff",
  secondary: "#c8e7ff",
  prompt: "#effbff",
  placeholder: "#b4e8ff",
  rail: ["#00dcff", "#22bdff", "#348cff", "#75c7ff", "#ecfaff", "#528cff", "#4162ff", "#6158f6", "#a970ff"]
} as const;

// Avoid emoji-capable glyphs such as ✳, which Windows Terminal renders as a
// green full-color emoji regardless of the requested ANSI foreground color.
const spinnerFrames = ["·", "✦", "✧", "✦"];
const splashDurationMs = 1_800;
const slashCommands = [
  { command: "/help", detail: "Show available controls", insert: "/help" },
  { command: "/new", detail: "Start a fresh session", insert: "/new" },
  { command: "/auto-approve", detail: "Set plan approval on or off", insert: "/auto-approve " },
  { command: "/theme", detail: "Choose dark or light", insert: "/theme " },
  { command: "/pets", detail: "Choose a pet or turn it off", insert: "/pets " },
  { command: "/speed", detail: "Select Standard or Fast", insert: "/speed" },
  { command: "/fast", detail: "Turn Fast mode on or off", insert: "/fast " },
  { command: "/stats", detail: "Show usage and achievements", insert: "/stats" },
  { command: "/effort", detail: "Choose reasoning effort", insert: "/effort" },
  { command: "/agents", detail: "Show assigned agents", insert: "/agents" },
  { command: "/agent", detail: "Control an assigned agent", insert: "/agent " },
  { command: "/delegate", detail: "Prepare an agent plan", insert: "/delegate" },
  { command: "/quit", detail: "Close Solar Harness", insert: "/quit" },
  { command: "/exit", detail: "Close Solar Harness", insert: "/exit" }
] as const;
type SlashCommand = (typeof slashCommands)[number];

interface SolarAppProps {
  harness: SolarHarness;
  model: string;
  reasoning: ReasoningEffort;
  initialSplash: boolean;
}

function SolarApp({ harness, model, reasoning, initialSplash }: SolarAppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState("");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelection, setSlashSelection] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [brief, setBrief] = useState<string[]>([]);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [pendingEffort, setPendingEffort] = useState<PendingEffort | null>(null);
  const [pendingSpeed, setPendingSpeed] = useState<PendingSpeed | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null);
  const [currentReasoning, setCurrentReasoning] = useState(reasoning);
  const [autoApprove, setAutoApprove] = useState(harness.getAutoPermissions().enabled);
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [workspace, setWorkspace] = useState(harness.getWorkspace());
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [currentActivity, setCurrentActivity] = useState("working on your request");
  const [spinner, setSpinner] = useState(0);
  const [pet, setPet] = useState<PetSelection>("cat");
  const [petTick, setPetTick] = useState(0);
  const [fast, setFast] = useState(harness.getFast());
  const [elapsed, setElapsed] = useState(0);
  const [showSplash, setShowSplash] = useState(initialSplash);

  useEffect(() => {
    harness.stats.startChat();
    if (!initialSplash) return;
    const timer = setTimeout(() => setShowSplash(false), splashDurationMs);
    return () => clearTimeout(timer);
  }, [initialSplash]);

  useEffect(() => {
    const timer = setInterval(() => setPetTick(value => value + 1), 240);
    return () => clearInterval(timer);
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
  const slashMatches = slashMenuOpen && /^\/[^\s]*$/.test(input)
    ? slashCommands.filter(item => item.command.startsWith(input))
    : [];

  const chooseSlashCommand = (item: SlashCommand): void => {
    setInput(item.insert);
    setSlashMenuOpen(false);
    setSlashSelection(0);
    setHistoryIndex(-1);
  };

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
      for (const achievement of harness.takeAchievements()) addMessage({ role: "solar", text: `◆ Achievement unlocked: ${achievement}` });
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

  const changeSpeed = (enabled: boolean): void => {
    harness.setFast(enabled);
    setFast(enabled);
    setPendingSpeed(null);
    addMessage({ role: "solar", text: `Speed is now ${enabled ? "Fast" : "Standard"}. New Codex turns will use this setting.` });
  };

  const changeTheme = (nextTheme: ThemeName): void => {
    theme = themes[nextTheme];
    applyTerminalTheme(stdout, nextTheme);
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
    setSlashMenuOpen(false);
    setSlashSelection(0);
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
        addMessage({ role: "solar", text: "Describe a task or ask to delegate it. Controls: /theme <dark|light> · /speed · /fast <on|off|status> · /stats · /pets <cat|dog|fox|off> · /effort · /agents · /delegate · /new · /auto-approve · /help · /quit" });
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
        addMessage({ role: "solar", text: `Current theme: ${themeName}. Usage: /theme <dark|light>` });
      } else if (line.startsWith("/theme ")) {
        const selected = line.slice(7).trim();
        if (selected === "dark" || selected === "light") changeTheme(selected);
        else addMessage({ role: "error", text: "Usage: /theme <dark|light>" });
      } else if (line === "/pets") {
        addMessage({ role: "solar", text: `Current pet: ${pet}. Choose with /pets <cat|dog|fox|off>.` });
      } else if (line.startsWith("/pets ")) {
        const selection = line.slice(6).trim().toLowerCase();
        if (selection === "off" || PET_NAMES.some(name => name === selection)) {
          setPet(selection as PetSelection);
          addMessage({ role: "solar", text: selection === "off" ? "Pet hidden." : `${selection[0].toUpperCase()}${selection.slice(1)} is exploring the interface.` });
        } else addMessage({ role: "error", text: "Usage: /pets <cat|dog|fox|off>" });
      } else if (line === "/speed") {
        setPendingSpeed({ cursor: fast ? 1 : 0 });
      } else if (line === "/fast" || line === "/fast status") {
        addMessage({ role: "solar", text: `Fast mode is ${fast ? "on" : "off"}. Use /fast on, /fast off, or /speed.` });
      } else if (line === "/fast on" || line === "/fast off") {
        changeSpeed(line === "/fast on");
      } else if (line.startsWith("/fast ")) {
        addMessage({ role: "error", text: "Usage: /fast <on|off|status>" });
      } else if (line === "/stats") {
        addMessage({ role: "solar", text: formatStats(harness.stats.snapshot()) });
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
        for (const achievement of harness.takeAchievements()) addMessage({ role: "solar", text: `◆ Achievement unlocked: ${achievement}` });
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
      if (!key.return && !key.escape && !key.ctrl && !key.meta && character) {
        setInput(character);
        setSlashMenuOpen(character === "/");
      }
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
    if (pendingSpeed) {
      if (key.escape) { setPendingSpeed(null); return; }
      if (key.upArrow || key.downArrow) { setPendingSpeed(value => value && ({ cursor: 1 - value.cursor })); return; }
      if (key.return) { changeSpeed(pendingSpeed.cursor === 1); return; }
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
    if (slashMatches.length) {
      if (key.escape) { setSlashMenuOpen(false); return; }
      if (key.upArrow) { setSlashSelection(value => (value - 1 + slashMatches.length) % slashMatches.length); return; }
      if (key.downArrow) { setSlashSelection(value => (value + 1) % slashMatches.length); return; }
      if (key.tab || key.return) { chooseSlashCommand(slashMatches[Math.min(slashSelection, slashMatches.length - 1)]); return; }
    }
    if (key.return) { void submit(); return; }
    if (key.backspace || key.delete) {
      const next = input.slice(0, -1);
      setInput(next);
      setSlashMenuOpen(next.startsWith("/") && !next.includes(" "));
      setSlashSelection(0);
      return;
    }
    if (key.upArrow && inputHistory.length) {
      const nextIndex = Math.min(inputHistory.length - 1, historyIndex + 1);
      setHistoryIndex(nextIndex);
      setInput(inputHistory[inputHistory.length - 1 - nextIndex] ?? "");
      setSlashMenuOpen(false);
      return;
    }
    if (key.downArrow && historyIndex >= 0) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      setInput(nextIndex < 0 ? "" : inputHistory[inputHistory.length - 1 - nextIndex] ?? "");
      setSlashMenuOpen(false);
      return;
    }
    if (!key.ctrl && !key.meta && character) {
      const next = input + character;
      setInput(next);
      setSlashMenuOpen(next.startsWith("/") && !next.includes(" "));
      setSlashSelection(0);
    }
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
      <Header compact={compact} workspace={workspace} width={contentWidth} />

      {pet !== "off" && <PetCompanion pet={pet} tick={petTick} width={contentWidth} />}

      {conversation.length === 0 && <Welcome />}

      <Box flexDirection="column">
        {conversation.map((message, index) => <Message key={index} message={message} />)}
      </Box>

      {agents.length > 0 && <SubAgents agents={agents} />}

      {agents.length > 0 && <TerminalActivity agents={agents} spinner={spinner} />}

      {pendingPlan && <PlanApproval pending={pendingPlan} />}

      {pendingEffort && <EffortPicker pending={pendingEffort} current={currentReasoning} />}
      {pendingSpeed && <SpeedPicker pending={pendingSpeed} fast={fast} model={model} />}

      {pendingNew && <NewSessionConfirmation pending={pendingNew} workspace={harness.getTestWorkspace()} />}

      {busy && (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Box>
            <Text color={theme.pulse}>{spinnerFrames[spinner % spinnerFrames.length]} </Text>
            <ActivityText text={phaseInfo} />
            <Text color={theme.subtle}> · {elapsed}s</Text>
          </Box>
          {latestStepLabel && latestStepLabel.toLowerCase() !== phaseInfo.toLowerCase() && <Text color={theme.subtle}>  {latestStepLabel}</Text>}
        </Box>
      )}

      {slashMatches.length > 0 && <SlashCommandMenu matches={slashMatches} selected={slashSelection} />}

      <RainbowInput
        width={contentWidth}
        value={pendingPlan ? "Review the proposed sub-agents above" : pendingEffort ? "Choose an effort level above" : pendingSpeed ? "Choose a speed above" : pendingNew ? "Confirm the new test-workspace session above" : input || (busy ? "Solar is working…" : "Ask Solar anything")}
        entered={Boolean(input) && !pendingPlan && !pendingEffort && !pendingSpeed && !pendingNew}
        cursor={!busy && !pendingPlan && !pendingEffort && !pendingSpeed && !pendingNew}
        busy={busy}
      />

      <Footer compact={compact} model={model} reasoning={currentReasoning} autoApprove={autoApprove} fast={fast} themeName={themeName} />
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

function PetCompanion({ pet, tick, width }: { pet: PetSelection; tick: number; width: number }): React.JSX.Element {
  const travel = Math.max(0, width - 19);
  const period = Math.max(1, travel * 2);
  const step = tick % period;
  const position = Math.min(step, period - step);
  return <Box flexDirection="column" paddingLeft={position} marginBottom={1}>
    {petSprite(pet, tick).map((line, index) => <Text key={index} color={index === 0 ? theme.accentStrong : index === 3 ? theme.subtle : theme.secondary}>{line}</Text>)}
  </Box>;
}

function SlashCommandMenu({ matches, selected }: { matches: readonly SlashCommand[]; selected: number }): React.JSX.Element {
  const first = Math.max(0, Math.min(selected - 3, matches.length - 7));
  const visible = matches.slice(first, first + 7);
  return (
    <Box flexDirection="column" marginTop={1} paddingX={2}>
      <Text color={theme.subtle}>Commands · ↑↓ select · Tab/Enter insert · Esc close</Text>
      {visible.map((item, index) => {
        const active = first + index === selected;
        return <Text key={item.command} color={active ? theme.primary : theme.secondary}>
          <Text color={active ? theme.pulse : theme.subtle}>{active ? "›" : " "} </Text>
          <Text bold={active}>{item.command}</Text>
          <Text color={theme.subtle}>  {item.detail}</Text>
        </Text>;
      })}
      {matches.length > visible.length && <Text color={theme.subtle}>  {selected + 1}/{matches.length}</Text>}
    </Box>
  );
}

function RainbowInput({ width, value, entered, cursor, busy }: { width: number; value: string; entered: boolean; cursor: boolean; busy: boolean }): React.JSX.Element {
  const available = Math.max(1, width - 7);
  const visibleValue = entered ? value.slice(-available) : value.slice(0, available);
  const remaining = Math.max(0, width - 2 - 3 - visibleValue.length - Number(cursor));
  return (
    <Box flexDirection="column" marginTop={1} width={width}>
      <GradientRail width={width} glyph="▄" colors={rainbowInput.rail} />
      <Box width={width}>
        <Text color={rainbowInput.rail[0]}>▌</Text>
        <Text backgroundColor={rainbowInput.background}>
          <Text color={rainbowInput.prompt}> › </Text>
          <Text color={entered ? rainbowInput.primary : busy ? rainbowInput.secondary : rainbowInput.placeholder}>{visibleValue}</Text>
          {cursor && <Text inverse> </Text>}
          {" ".repeat(remaining)}
        </Text>
        <Text color={rainbowInput.rail.at(-1)}>▐</Text>
      </Box>
      <GradientRail width={width} glyph="▀" colors={[...rainbowInput.rail].reverse()} />
    </Box>
  );
}

function GradientRail({ width, glyph, colors }: { width: number; glyph: string; colors: readonly string[] }): React.JSX.Element {
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

function SpeedPicker({ pending, fast, model }: { pending: PendingSpeed; fast: boolean; model: string }): React.JSX.Element {
  return <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.warning} paddingX={1}>
    <Text bold color={theme.warning}>Speed</Text>
    <Text color={pending.cursor === 0 ? theme.primary : theme.secondary}>{pending.cursor === 0 ? "›" : " "} Standard{!fast ? " (current)" : ""}</Text>
    <Text color={pending.cursor === 1 ? theme.primary : theme.secondary}>{pending.cursor === 1 ? "›" : " "} Fast{fast ? " (current)" : ""} · {fastDescription(model)}</Text>
    <Text color={theme.subtle}>↑↓ select · Enter apply · Esc cancel</Text>
  </Box>;
}

function fastDescription(model: string): string {
  if (/^gpt-5\.4/i.test(model)) return "up to 1.5× faster · 2× credits";
  if (/^gpt-5\.[56]/i.test(model)) return "up to 1.5× faster · 2.5× credits";
  if (/^gpt-6-(?:astra|sol|luna)/i.test(model)) return "faster responses · 2.5× credits where available";
  return "faster responses · higher credit use where available";
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

function Header({ compact, workspace, width }: { compact: boolean; workspace: string; width: number }): React.JSX.Element {
  const workspaceLabel = compact ? workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace : workspace;
  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column">
      <Box paddingX={1} flexDirection="column">
        <Text><Text bold color={theme.pulse}>▣ Solar</Text><Text color={theme.secondary}> Harness</Text></Text>
        <Text color={theme.subtle}>{workspaceLabel}</Text>
      </Box>
      <GradientRail width={width} glyph="▄" colors={theme.rail} />
    </Box>
  );
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  const color = message.role === "user" ? theme.accent : message.role === "error" ? theme.error : theme.accentStrong;
  const label = message.role === "user" ? "You" : message.role === "error" ? "Error" : "Solar";
  return (
    <Box marginBottom={1} paddingX={1}>
      <Text color={color}>▌ </Text>
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

function Footer({ compact, model, reasoning, autoApprove, fast, themeName }: { compact: boolean; model: string; reasoning: ReasoningEffort; autoApprove: boolean; fast: boolean; themeName: ThemeName }): React.JSX.Element {
  return (
    <Box paddingX={1} marginTop={1} justifyContent="space-between">
      <Text color={theme.subtle}>Enter send · ↑↓ history · /help</Text>
      {!compact && <Text color={theme.subtle}>{model} · {reasoning} · {fast ? "Fast" : "Standard"} · {themeName} · auto {autoApprove ? "on" : "off"}</Text>}
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

type LaunchOptions = { cwd: string; model: string; reasoning: ReasoningEffort };

export function startSolarUi(launch: LaunchOptions): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Solar Harness Preview requires an interactive terminal.");
  theme = darkTheme;
  applyTerminalTheme(process.stdout, "dark");
  const harness = new SolarHarness({ task: "", cwd: launch.cwd, model: launch.model, reasoning: launch.reasoning });
  render(<SolarApp harness={harness} model={launch.model} reasoning={launch.reasoning} initialSplash={true} />, { exitOnCtrlC: false });
}
function applyTerminalTheme(stdout: NodeJS.WriteStream, selected: ThemeName): void {
  if (selected === "dark") stdout.write("\x1b]110\x07\x1b]111\x07\x1b[0m\x1b[2J\x1b[H");
  else stdout.write(`\x1b]10;${lightTheme.primary}\x07\x1b]11;${lightTheme.background}\x07\x1b[0m\x1b[2J\x1b[H`);
}
