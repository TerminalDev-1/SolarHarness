import { hydrateIcons, icon } from "./icons.js";
import { renderMarkdown } from "./markdown.js";
import { diffStat, fileIcon, renderDiff, splitName } from "./diffview.js";

const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const EFFORT_NAMES = { light: "Light", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const MODE_PLACEHOLDERS = {
  chat: "Ask Solar to build, fix, or explain anything",
  plan: "Describe a task. Solar plans it read-only, then you approve",
  ultra: "Ultra runs this task at Max effort with Fast on"
};
// What each mode does, shown when hovering its tab and in the narrow-composer mode menu.
const MODE_INFO = {
  chat: {
    badge: "Can edit files", short: "Talk to Solar; it can edit and run code",
    text: "Talk to Solar normally. It reads, edits, runs, and tests code in your folder.",
    meta: "Your effort and speed"
  },
  plan: {
    badge: "Read-only", short: "A step-by-step plan first, then you approve",
    text: "Solar studies the code and writes a step-by-step plan. Nothing changes until you click Run this plan.",
    meta: "Your effort and speed"
  },
  ultra: {
    badge: "Can edit files", short: "Chat at the strongest settings, for hard tasks",
    text: "Like Chat, but for hard problems: this one task runs at the strongest settings, then your usual settings come back.",
    meta: "Max effort · Fast"
  }
};
// Solar can also switch into Plan, Ultraplan, Ultrareview, or Ultra by itself; /ultraplan and /ultrareview start them directly.
const MODE_TIP_FOOTNOTE = "Solar can also switch modes on its own, or when you ask in plain words.";
const MODE_NAMES = { plan: "Plan", ultra: "Ultra", ultraplan: "Ultraplan", ultrareview: "Ultrareview", delegate: "Delegate" };
// Ultra, Ultraplan, and Ultrareview turns all run at Max effort with Fast on.
const ULTRA_MODES = new Set(["ultra", "ultraplan", "ultrareview"]);
const EFFORT_PIN_TITLES = { ultra: "Ultra pins Max effort" };
// The CLI's slash commands. A trailing space in `insert` means the command takes an argument.
const SLASH_COMMANDS = [
  { command: "/help", detail: "Show available controls", insert: "/help" },
  { command: "/new", detail: "Start a fresh session", insert: "/new" },
  { command: "/plan", detail: "Plan a task read-only, then approve", insert: "/plan " },
  { command: "/ultra", detail: "Run a task at Max effort with Fast on", insert: "/ultra " },
  { command: "/ultraplan", detail: "Max-effort plan with a self-critique", insert: "/ultraplan " },
  { command: "/ultrareview", detail: "Parallel review with verified findings", insert: "/ultrareview" },
  { command: "/delegate", detail: "Prepare an agent plan for the last request", insert: "/delegate" },
  { command: "/sidebyside", detail: "Two recorded agents work on a request", insert: "/sidebyside " },
  { command: "/agents", detail: "Show assigned agents", insert: "/agents" },
  { command: "/agent", detail: "Control an assigned agent", insert: "/agent " },
  { command: "/auto-approve", detail: "Set plan approval on or off", insert: "/auto-approve " },
  { command: "/model", detail: "Choose the model", insert: "/model" },
  { command: "/effort", detail: "Choose effort for this session", insert: "/effort" },
  { command: "/default-effort", detail: "Set the effort every session starts with", insert: "/default-effort " },
  { command: "/speed", detail: "Select Standard or Fast", insert: "/speed" },
  { command: "/fast", detail: "Turn Fast mode on or off", insert: "/fast " },
  { command: "/stats", detail: "Show usage and achievements", insert: "/stats" },
  { command: "/memory", detail: "Show loaded SOLAR.md files", insert: "/memory" },
  { command: "/theme", detail: "Choose dark or light", insert: "/theme " },
  { command: "/pets", detail: "Choose a pet or turn it off", insert: "/pets " },
  { command: "/quit", detail: "Close Solar", insert: "/quit" },
  { command: "/exit", detail: "Close Solar", insert: "/exit" }
];
// Commands that change the session; like the CLI, they wait until Solar finishes.
const WAIT_WHILE_BUSY = new Set(["new", "delegate", "sidebyside", "model", "effort", "speed", "fast"]);
const MEETING_SPEAKERS = ["Aurora", "Helios"];
const MEETING_HINT = "Enter sends to both sessions. Tab switches pane, PgUp and PgDn scroll it, /sidebyside close leaves.";
const MEETING_BUSY = "Aurora and Helios are still talking. Wait for this round to finish.";
const CHAT_HINT = $("composer-hint").textContent;
const SUGGESTIONS = [
  { title: "Explain this codebase", detail: "Walk me through how it fits together", prompt: "Explain how this codebase is structured and how the main pieces fit together." },
  { title: "Find and fix a bug", detail: "Hunt down something broken", prompt: "Look for a bug in this project, explain it, and fix it." },
  { title: "Build a landing page", detail: "A polished single-page site", prompt: "Build a polished, responsive landing page in index.html and open it in the browser." },
  { title: "Write tests", detail: "Cover the riskiest code first", prompt: "Add tests for the riskiest untested code in this project and run them." }
];

let app = {};
let mode = "chat";
let attachments = [];
let busy = false;
let stickToBottom = true;
let reviewFiles = [];
// What the Review panel shows: one response's files ({ files }) or, when null, every change this chat.
let reviewScope = null;
// The chat on screen as a replayable record; it is saved after each change and listed in the sidebar.
let chat = null;
let replaying = false;
let reviewSelected;
let turnCounter = 0;
// The mode of the turn in flight; /ultraplan and /ultrareview speed up the rainbow while they run.
let activeTurnMode;
// Whether this chat has a request /delegate can hand to a team (main.js keeps the request itself).
let lastRequestSent = false;
const turns = new Map();
const history = [];
let historyIndex = -1;
let slashMatches = [];
let slashSelected = 0;
// The open /sidebyside meeting: its two panes replace the thread until it is closed.
let meeting = null;

// ---------- boot ----------

hydrateIcons();
app = await window.solar.state();
document.body.classList.add(`platform-${app.platform}`);
applyTheme();
renderChrome();
renderEmpty();
void refreshChanges();
void renderHistory();
void showPet();

window.solar.onActivity(({ turnId, text }) => turns.get(turnId)?.activity(text));
window.solar.onDiff(diff => { turns.get(diff.turnId)?.diff(diff); scheduleChangesRefresh(); });
window.solar.onAgents(({ turnId, agents }) => turns.get(turnId)?.agents(agents));
window.solar.onMeeting(event => meetingEvent(event));

// ---------- chrome: sidebar, top bar, composer controls ----------

function renderChrome() {
  $("version-label").textContent = `Solar ${app.version}`;
  $("chat-sub").textContent = app.workspace ?? "";
  $("chat-sub").hidden = !app.workspace;
  $("model-label").textContent = app.models.find(model => model.id === app.model)?.name ?? app.model;
  // Ultra modes run at Max effort with Fast on, so show that and lock both pickers. A meeting uses the session's own settings.
  const pinsEffort = ULTRA_MODES.has(mode) && !meeting;
  const pinsFast = pinsEffort;
  const effort = pinsEffort ? "max" : app.effort;
  const fast = pinsFast || app.fast;
  $("effort-label").textContent = EFFORT_NAMES[effort] ?? effort;
  const level = app.efforts.indexOf(effort);
  [...$("effort-meter").children].forEach((bar, index) => bar.classList.toggle("on", index <= level));
  $("speed-label").textContent = fast ? "Fast" : "Standard";
  $("speed-button").classList.toggle("on", fast);
  // Locked, not disabled: a pinned pill still shows its hover card explaining why.
  for (const [id, locked] of [["effort-button", pinsEffort], ["speed-button", pinsFast]]) {
    $(id).classList.toggle("locked", locked);
    $(id).setAttribute("aria-disabled", String(locked));
  }
  $("status-dot").classList.toggle("busy", busy);
  // In a meeting the composer talks to both sessions: no mode tabs, and images wait for the normal chat.
  $("modes").hidden = Boolean(meeting);
  $("attach").hidden = Boolean(meeting);
  $("meeting-tag").hidden = !meeting;
  $("attachments").hidden = Boolean(meeting) || !attachments.length;
  $("input").placeholder = meeting ? (meeting.busy ? "Aurora and Helios are conversing..." : "Send a message to both sessions") : MODE_PLACEHOLDERS[mode];
  $("composer-hint").textContent = meeting ? MEETING_HINT : CHAT_HINT;
  updateSendState();
}

function updateSendState() {
  const typed = $("input").value.trim();
  const command = typed.startsWith("/");
  $("send").disabled = (busy && !command) || (!app.workspace && !command) || (!typed && !attachments.length);
  $("composer").classList.toggle("busy", busy);
  $("composer").classList.toggle("ultra", (!meeting && ULTRA_MODES.has(mode)) || (busy && ULTRA_MODES.has(activeTurnMode)));
  $("composer").classList.toggle("plan", !meeting && mode === "plan");
  $("composer").classList.toggle("in-meeting", Boolean(meeting));
}

$("chat-sub").addEventListener("click", chooseWorkspace);
$("theme-toggle").addEventListener("click", () => void setTheme(app.theme === "light" ? "dark" : "light").catch(error => toast(cleanError(error))));

function applyTheme() {
  document.documentElement.dataset.theme = app.theme;
  const next = app.theme === "light" ? "dark" : "light";
  $("theme-icon").replaceChildren(icon(next === "light" ? "sun" : "moon"));
  $("theme-toggle").title = `Switch to the ${next} theme`;
}

async function setTheme(theme) {
  app = await window.solar.setTheme(theme);
  applyTheme();
}
$("new-chat").addEventListener("click", newChat);
$("add-workspace").addEventListener("click", chooseWorkspace);
$("review-close").addEventListener("click", () => toggleReview(false));

async function chooseWorkspace() {
  try {
    const previous = app.workspace;
    await flushChat();
    app = await window.solar.chooseWorkspace();
    renderChrome();
    if (app.workspace !== previous) { closeMeeting({ quiet: true }); clearThread(); renderEmpty(); await refreshChanges(); }
    await renderHistory();
  } catch (error) { toast(cleanError(error)); }
}

/** Starts a new chat in another open folder; its earlier chats stay in the sidebar. */
async function switchWorkspace(path) {
  if (busy) return toast("Solar is still working. Wait for it to finish first.");
  try {
    await flushChat();
    app = await window.solar.switchWorkspace(path);
    closeMeeting({ quiet: true });
    clearThread();
    renderEmpty();
    renderChrome();
    await refreshChanges();
    await renderHistory();
    $("input").focus();
  } catch (error) { toast(cleanError(error)); }
}

async function removeWorkspace(path) {
  try {
    const current = app.workspace;
    await flushChat();
    app = await window.solar.removeWorkspace(path);
    if (current !== app.workspace) { closeMeeting({ quiet: true }); clearThread(); renderEmpty(); await refreshChanges(); }
    renderChrome();
    await renderHistory();
  } catch (error) { toast(cleanError(error)); }
}

async function newChat() {
  if (busy) return toast("Solar is still working. Wait for it to finish first.");
  try {
    await flushChat();
    const result = await window.solar.newChat();
    if (!result.started) return;
    app = result.state;
    closeMeeting({ quiet: true });
    renderChrome();
    clearThread();
    renderEmpty();
    await refreshChanges();
    await renderHistory();
    $("input").focus();
  } catch (error) { toast(error.message); }
}

for (const button of $("modes").querySelectorAll("button")) {
  button.addEventListener("click", () => { hideTip(); setMode(button.dataset.mode); });
  button.setAttribute("aria-describedby", "tip");
  button.addEventListener("pointerenter", () => scheduleTip(button, () => modeTip(button)));
  button.addEventListener("focus", () => showTip(button, modeTip(button)));
  button.addEventListener("pointerleave", hideTip);
  button.addEventListener("blur", hideTip);
}

// ---------- mode hover cards ----------

let tipTimer;
function scheduleTip(anchor, content) {
  clearTimeout(tipTimer);
  // Once one card is open, moving to the next control swaps it at once.
  tipTimer = setTimeout(() => showTip(anchor, content()), $("tip").hidden ? 350 : 0);
}

function modeTip(button) {
  const info = MODE_INFO[button.dataset.mode];
  return { title: button.textContent, badge: info.badge, badgeKind: info.badge === "Read-only" ? "safe" : "edits", text: info.text, meta: `${info.meta}. ${MODE_TIP_FOOTNOTE}` };
}

/** A hover card above `anchor`: a title with a badge, a description, and a footer line. */
function showTip(anchor, { title, badge, badgeKind = "", text, meta }) {
  if (!$("menu").hidden) return;
  const tip = $("tip");
  const head = el("div", "tip-head");
  head.append(el("strong", "", title), el("span", `tip-badge ${badgeKind}`.trim(), badge));
  tip.replaceChildren(head, el("p", "tip-text", text), el("div", "tip-meta", meta));
  tip.hidden = false;
  const box = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(box.left + box.width / 2 - tip.offsetWidth / 2, window.innerWidth - tip.offsetWidth - 12));
  tip.style.left = `${left}px`;
  tip.style.top = `${box.top - tip.offsetHeight - 10}px`;
  requestAnimationFrame(() => tip.classList.add("open"));
}

function hideTip() {
  clearTimeout(tipTimer);
  $("tip").classList.remove("open");
  $("tip").hidden = true;
}

function setMode(next) {
  mode = next;
  for (const button of $("modes").querySelectorAll("button")) button.classList.toggle("active", button.dataset.mode === mode);
  $("input").placeholder = MODE_PLACEHOLDERS[mode];
  closeMenu();
  renderChrome();
}

const openModelMenu = () => openMenu($("model-button"), app.models.map(model => ({
  label: model.name, detail: model.detail, selected: model.id === app.model,
  run: async () => { app = await window.solar.setModel(model.id); renderChrome(); }
})));

const pinnedToast = id => { toast(id === "speed-button" ? `${MODE_NAMES[mode]} always runs at Fast speed. Switch to Chat to choose.` : `${EFFORT_PIN_TITLES[mode]}. Switch to Chat to choose.`); };

const openEffortMenu = () => $("effort-button").classList.contains("locked") ? pinnedToast("effort-button") : openMenu($("effort-button"), app.efforts.map(effort => ({
  label: EFFORT_NAMES[effort], detail: effort === "light" ? "Quickest replies" : effort === "max" ? "Deepest reasoning" : "", selected: effort === app.effort,
  run: async () => { app = await window.solar.setEffort(effort); renderChrome(); }
})));

const openSpeedMenu = () => $("speed-button").classList.contains("locked") ? pinnedToast("speed-button") : openMenu($("speed-button"), [
  { label: "Fast", detail: "Quicker replies", fast: true },
  { label: "Standard", detail: "Normal speed", fast: false }
].map(speed => ({
  label: speed.label, detail: speed.detail, selected: speed.fast === app.fast,
  run: async () => { app = await window.solar.setFast(speed.fast); renderChrome(); }
})));

$("model-button").addEventListener("click", () => { hideTip(); openModelMenu(); });
$("effort-button").addEventListener("click", () => { hideTip(); openEffortMenu(); });
$("speed-button").addEventListener("click", () => { hideTip(); openSpeedMenu(); });

// Hover cards for the pickers, built when shown so they describe the current setting.
const PILL_TIPS = {
  "model-button": () => {
    const model = app.models.find(item => item.id === app.model);
    return {
      title: "Model", badge: model?.name ?? app.model,
      text: model?.detail ? `${model.detail}. Switching keeps the conversation going on the new model.` : "Switching keeps the conversation going on the new model.",
      meta: "New sub-agents use it too"
    };
  },
  "effort-button": () => {
    const locked = $("effort-button").classList.contains("locked");
    return {
      title: "Reasoning effort", badge: locked ? "Max" : EFFORT_NAMES[app.effort],
      text: "How hard Solar thinks before it acts. Higher effort is more thorough, but slower and uses more tokens. Light is quickest.",
      meta: locked ? `Locked: ${EFFORT_PIN_TITLES[mode]}` : `This session only. New sessions start at ${EFFORT_NAMES[app.defaultEffort]}; change that with /default-effort`
    };
  },
  "speed-button": () => {
    const locked = $("speed-button").classList.contains("locked");
    return {
      title: "Speed", badge: locked || app.fast ? "Fast" : "Standard",
      text: "Fast gets replies sooner but uses more credits. Standard is the normal pace. Effort is separate: it sets how hard Solar thinks.",
      meta: locked ? `Locked: ${MODE_NAMES[mode]} always runs at Fast speed` : "Applies from the next message"
    };
  }
};
for (const [id, content] of Object.entries(PILL_TIPS)) {
  const pill = $(id);
  pill.setAttribute("aria-describedby", "tip");
  pill.addEventListener("pointerenter", () => scheduleTip(pill, content));
  pill.addEventListener("focus", () => showTip(pill, content()));
  pill.addEventListener("pointerleave", hideTip);
  pill.addEventListener("blur", hideTip);
}

// ---------- popover menu ----------

function openMenu(anchor, items) {
  const menu = $("menu");
  menu.replaceChildren(...items.map(item => {
    const button = el("button", `menu-item${item.selected ? " selected" : ""}`);
    const text = el("span", "menu-text");
    text.append(el("span", "menu-label", item.label));
    if (item.detail) text.append(el("span", "menu-detail", item.detail));
    button.append(text, icon("check", "menu-check"));
    button.addEventListener("click", async () => { closeMenu(); try { await item.run(); } catch (error) { toast(error.message); } });
    return button;
  }));
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12))}px`;
  menu.style.top = `${box.top - menu.offsetHeight - 8}px`;
  requestAnimationFrame(() => menu.classList.add("open"));
}

function closeMenu() { $("menu").classList.remove("open"); $("menu").hidden = true; }
document.addEventListener("pointerdown", event => { if (!$("menu").hidden && !$("menu").contains(event.target) && !event.target.closest(".pill")) closeMenu(); });

// ---------- composer ----------

const input = $("input");
input.addEventListener("input", () => { autosize(); updateSendState(); historyIndex = -1; updateSlashMenu(); });
input.addEventListener("keydown", event => {
  if (event.isComposing) return;
  if (slashMatches.length) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      slashSelected = (slashSelected + (event.key === "ArrowDown" ? 1 : -1) + slashMatches.length) % slashMatches.length;
      renderSlashMenu();
      return;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) { event.preventDefault(); chooseSlashCommand(slashMatches[slashSelected]); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSlashMenu(); return; }
  }
  // Like the CLI's meeting view: Tab selects a pane, PgUp and PgDn scroll only that pane.
  if (meeting && ["Tab", "PageUp", "PageDown"].includes(event.key) && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (event.key === "Tab") selectPane(1 - meeting.selected);
    else { const body = meeting.panes[meeting.selected].body; body.scrollBy({ top: (event.key === "PageUp" ? -0.8 : 0.8) * body.clientHeight }); }
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); return; }
  // Like the CLI: Up and Down walk through earlier messages while the box is empty or browsing them.
  if ((event.key === "ArrowUp" || event.key === "ArrowDown") && history.length && (historyIndex >= 0 || !input.value) && !event.shiftKey) {
    if (event.key === "ArrowUp") historyIndex = Math.min(history.length - 1, historyIndex + 1);
    else if (historyIndex >= 0) historyIndex--;
    else return;
    event.preventDefault();
    input.value = historyIndex < 0 ? "" : history[history.length - 1 - historyIndex];
    autosize();
    updateSendState();
  }
});

// ---------- slash commands ----------

function updateSlashMenu() {
  const typed = input.value;
  slashMatches = typed.startsWith("/") && !/\s/.test(typed) ? SLASH_COMMANDS.filter(item => item.command.startsWith(typed.toLowerCase())) : [];
  slashSelected = Math.min(slashSelected, Math.max(0, slashMatches.length - 1));
  renderSlashMenu();
}

function renderSlashMenu() {
  const menu = $("slash-menu");
  menu.hidden = !slashMatches.length;
  $("composer").classList.toggle("slashing", slashMatches.length > 0);
  menu.replaceChildren(...slashMatches.map((item, index) => {
    const row = el("button", `slash-item${index === slashSelected ? " selected" : ""}`);
    row.append(el("span", "slash-command", item.command), el("span", "slash-detail", item.detail));
    row.addEventListener("pointerdown", event => event.preventDefault());
    row.addEventListener("click", () => chooseSlashCommand(item));
    return row;
  }));
  menu.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function closeSlashMenu() { slashMatches = []; renderSlashMenu(); }

/** Commands that take an argument are inserted for typing; the rest run at once. */
function chooseSlashCommand(item) {
  closeSlashMenu();
  input.value = item.insert;
  autosize();
  updateSendState();
  input.focus();
  if (!item.insert.endsWith(" ")) void submit();
}

/** Runs a slash command. Returns false for text that is not a known command, which is then sent as a message. */
async function runCommand(line) {
  const match = line.match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  const name = match[1].toLowerCase();
  const arg = (match[2] ?? "").trim();
  const turnMode = ["plan", "ultra", "ultraplan", "ultrareview"].includes(name) ? name : undefined;
  const handler = COMMANDS[name];
  if (!turnMode && !handler) return false;
  // Other commands return to the normal chat, as in the CLI; never while the sessions are mid-round.
  if (meeting && name !== "sidebyside") {
    if (meeting.busy) { toast(MEETING_BUSY); return true; }
    closeMeeting();
  }
  if (busy && (turnMode || WAIT_WHILE_BUSY.has(name))) { toast("Solar is still working. Wait for it to finish first."); return true; }
  if (turnMode && !app.workspace) { toast("Open a folder first."); return true; }
  if (turnMode && !arg && turnMode !== "ultrareview" && !(turnMode === "ultra" && attachments.length)) { toast(`Add a task after /${name}.`); return true; }
  remember(line);
  clearInput();
  try {
    if (turnMode) await startTurn(turnMode, arg);
    else await handler(arg);
  } catch (error) { toast(cleanError(error)); }
  return true;
}

const onOff = arg => arg === "on" ? true : arg === "off" ? false : undefined;

const COMMANDS = {
  help: () => addNote("Commands", commandList()),
  new: () => newChat(),
  // Like the CLI, /delegate needs a request first; say so instead of starting a turn that can only fail.
  delegate: () => lastRequestSent
    ? runTurn({ mode: "delegate", text: "Plan a team of sub-agents for the last request" })
    : addNote("Delegate", "First tell Solar what the team should accomplish, then use /delegate. You can also just ask for a team in your own words."),
  sidebyside: async arg => {
    if (arg.toLowerCase() === "close") {
      if (!meeting) return addNote("Side-by-side", "No side-by-side session is open. Start one with /sidebyside <request>.");
      return meeting.busy ? toast(MEETING_BUSY) : closeMeeting();
    }
    const usage = "Usage: /sidebyside <request>, or /sidebyside close. Aurora carries out the request and makes the edits; Helios inspects and verifies from a read-only session.";
    if (!arg) return meeting ? toast(usage) : addNote("Side-by-side", usage);
    if (!app.workspace) return toast("Open a folder first.");
    // A new request starts two fresh sessions.
    closeMeeting();
    openMeeting(arg);
    await talkInMeeting(arg, false);
  },
  agents: async () => {
    const agents = await window.solar.agents();
    addNote("Team", agents.length ? teamList(agents) : "No sub-agents are assigned. Ask Solar to delegate when you want sub-agents.");
  },
  agent: async arg => {
    const [agentId, action, ...rest] = arg.split(/\s+/);
    const value = action === "reasoning" ? rest[0]?.toLowerCase() : rest.join(" ");
    const agents = await window.solar.controlAgent({ agentId, action, value });
    const done = action === "reasoning" ? `Changed ${agentId}'s reasoning effort to ${value}.`
      : action === "context" ? `Passed the new context to ${agentId}.` : `Cancelled ${agentId} and any sub-delegates it owns.`;
    addNote("Team", done, teamList(agents));
  },
  "auto-approve": async arg => {
    const enabled = onOff(arg);
    if (enabled === undefined) return addNote("Auto-approve", `Auto-approve is ${app.autoApprove ? "on" : "off"}. Usage: /auto-approve <on|off>`);
    app = await window.solar.setAutoApprove(enabled);
    addNote("Auto-approve", `Auto-approve is now ${arg}. ${enabled ? "Future sub-agent plans will launch immediately without the review card." : "Future sub-agent plans will wait for your review before launch."}`);
  },
  model: async arg => {
    if (!arg) return openModelMenu();
    const choice = app.models.find(item => item.id === arg.toLowerCase() || item.name.toLowerCase() === arg.toLowerCase());
    if (!choice) return toast(`Usage: /model <${app.models.map(item => item.id).join("|")}>, or /model to choose from a list`);
    app = await window.solar.setModel(choice.id);
    renderChrome();
    addNote("Model", `Model is now ${choice.name}. The conversation continues on it, and new sub-agents use it too.`);
  },
  effort: async arg => {
    if (!arg) return openEffortMenu();
    if (!app.efforts.includes(arg.toLowerCase())) return toast(`Usage: /effort <${app.efforts.join("|")}>`);
    app = await window.solar.setEffort(arg.toLowerCase());
    renderChrome();
    addNote("Effort", `Reasoning effort is now ${EFFORT_NAMES[app.effort]} for this session. New sessions still start at the default (${EFFORT_NAMES[app.defaultEffort]}); change that with /default-effort.`);
  },
  "default-effort": async arg => {
    if (!arg) return addNote("Default effort", `Default effort is ${EFFORT_NAMES[app.defaultEffort]}. Every new Solar session starts with it. Usage: /default-effort <${app.efforts.join("|")}>`);
    if (!app.efforts.includes(arg.toLowerCase())) return toast(`Usage: /default-effort <${app.efforts.join("|")}>`);
    app = await window.solar.setDefaultEffort(arg.toLowerCase());
    addNote("Default effort", `Default effort is now ${EFFORT_NAMES[app.defaultEffort]}. Every new Solar session will start with it. This session stays at ${EFFORT_NAMES[app.effort]}; use /effort to change it now.`);
  },
  speed: () => openSpeedMenu(),
  fast: async arg => {
    const enabled = onOff(arg);
    if (enabled === undefined) return addNote("Speed", `Fast mode is ${app.fast ? "on" : "off"}. Use /fast on, /fast off, or /speed.`);
    app = await window.solar.setFast(enabled);
    renderChrome();
    addNote("Speed", `Speed is now ${enabled ? "Fast" : "Standard"}. New Codex turns will use this setting.`);
  },
  stats: async () => addNote("Stats", preformatted(await window.solar.stats())),
  memory: async () => {
    const { files, paths } = await window.solar.memory();
    addNote("Memory", files.length
      ? preformatted(`Loaded SOLAR.md instructions (later files override earlier ones):\n${files.map(file => `${file.scope}: ${file.path}${file.truncated ? " (truncated)" : ""}`).join("\n")}`)
      : preformatted(`No SOLAR.md instructions are loaded. Create one at any of:\n${paths.map(item => `${item.scope}: ${item.path}`).join("\n")}`));
  },
  theme: async arg => {
    const choice = arg.toLowerCase();
    if (!choice) return addNote("Theme", `Current theme: ${app.theme}. Usage: /theme <dark|light>, or use the sun and moon button at the bottom of the sidebar.`);
    if (choice !== "dark" && choice !== "light") return toast("Usage: /theme <dark|light>");
    await setTheme(choice);
    addNote("Theme", `Theme changed to ${choice}.`);
  },
  pets: async arg => {
    const choice = arg.toLowerCase();
    if (!choice) return addNote("Pets", `Current pet: ${app.pet}. Choose with /pets <${[...app.pets, "off"].join("|")}>.`);
    if (choice !== "off" && !app.pets.includes(choice)) return toast(`Usage: /pets <${[...app.pets, "off"].join("|")}>`);
    app = await window.solar.setPet(choice);
    await showPet();
    addNote("Pets", choice === "off" ? "Pet hidden." : `${capitalize(choice)} is exploring the composer.`);
  },
  quit: () => window.solar.quit(),
  exit: () => window.solar.quit()
};

function commandList() {
  const list = el("div", "command-list");
  for (const item of SLASH_COMMANDS) {
    const row = el("div", "command-row");
    row.append(el("code", "", item.insert.trim() + (item.insert.endsWith(" ") ? " …" : "")), el("span", "", item.detail));
    list.append(row);
  }
  return list;
}

function preformatted(text) { return el("pre", "note-pre", text); }

function remember(line) {
  if (line && history.at(-1) !== line) history.push(line);
  historyIndex = -1;
}

function clearInput() {
  input.value = "";
  autosize();
  closeSlashMenu();
  updateSendState();
}
input.addEventListener("paste", async event => {
  if (![...event.clipboardData.items].some(item => item.type.startsWith("image/"))) return;
  event.preventDefault();
  addAttachments(await window.solar.pasteImages());
});
$("send").addEventListener("click", () => void submit());
$("attach").addEventListener("click", async () => addAttachments(await window.solar.pickImages()));

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
}

function addAttachments(paths) {
  for (const path of paths) if (!attachments.includes(path) && attachments.length < 8) attachments.push(path);
  renderAttachments();
  updateSendState();
  input.focus();
}

function renderAttachments() {
  const box = $("attachments");
  box.hidden = !attachments.length;
  box.replaceChildren(...attachments.map(path => {
    const chip = el("div", "attachment");
    const image = el("img");
    image.src = fileUrl(path);
    image.alt = "";
    const remove = el("button", "attachment-remove");
    remove.append(icon("close"));
    remove.title = "Remove";
    remove.addEventListener("click", () => { attachments = attachments.filter(item => item !== path); renderAttachments(); updateSendState(); });
    chip.append(image, el("span", "attachment-name", basename(path)), remove);
    return chip;
  }));
}

async function submit() {
  const text = input.value.trim();
  if (text.startsWith("/") && await runCommand(text)) return;
  if (meeting) {
    if (busy || !text) return;
    // A follow-up resumes both existing sessions; an unknown /command leaves the meeting, as in the CLI.
    if (!text.startsWith("/")) { remember(text); clearInput(); await talkInMeeting(text, true); return; }
    closeMeeting();
  }
  if (busy || !app.workspace || (!text && !attachments.length)) return;
  remember(text);
  clearInput();
  await startTurn(mode, text);
}

/** Images go with Chat and Ultra turns; plans and reviews leave them waiting, as in the CLI. */
async function startTurn(turnMode, text) {
  const takesImages = turnMode === "chat" || turnMode === "ultra";
  const images = takesImages ? attachments : [];
  if (takesImages) lastRequestSent = true;
  if (takesImages && images.length) { attachments = []; renderAttachments(); updateSendState(); }
  const message = text || (images.length ? `Take a look at the attached image${images.length === 1 ? "" : "s"}.` : "");
  // An empty Ultrareview reviews the current changes; the engine picks that scope itself.
  await runTurn({ text: message, display: message || "Review the current changes", images, mode: turnMode });
}

// ---------- the thread ----------

const thread = $("thread");
const updateJump = () => { $("jump-latest").hidden = stickToBottom || thread.scrollHeight <= thread.clientHeight; };
thread.addEventListener("scroll", () => { stickToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80; updateJump(); });
const scrollToBottom = (force = false) => { if (force || stickToBottom) thread.scrollTop = thread.scrollHeight; updateJump(); };
$("jump-latest").addEventListener("click", () => { stickToBottom = true; thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" }); });

function clearThread() {
  chat = null;
  lastRequestSent = false;
  $("thread-inner").replaceChildren();
  $("jump-latest").hidden = true;
  turns.clear();
  $("chat-title").textContent = "New chat";
}

function workspaceCard() {
  const card = el("button", "workspace-card");
  card.title = `${app.workspace}\nClick to open a different folder (Ctrl+O)`;
  const text = el("span", "workspace-text");
  text.append(el("span", "workspace-name", app.workspaceName), el("span", "workspace-path", app.workspace));
  card.append(icon("folder", "workspace-icon"), text, icon("swap", "chevron"));
  card.addEventListener("click", chooseWorkspace);
  return card;
}

function renderEmpty() {
  const inner = $("thread-inner");
  inner.replaceChildren();
  const hero = el("div", "hero");
  const sun = el("div", "hero-sun");
  for (let index = 0; index < 12; index++) sun.append(el("i"));
  hero.append(sun);
  if (!app.workspace) {
    hero.append(el("h1", "", "Open a folder to begin"), el("p", "", "Solar works inside a project folder: it reads, edits, runs, and tests your code there."));
    const button = el("button", "primary-button");
    button.append(icon("folder"), document.createTextNode("Open folder"));
    button.addEventListener("click", chooseWorkspace);
    hero.append(button);
  } else {
    hero.append(el("h1", "", "What should we build today?"), workspaceCard());
    const grid = el("div", "suggestions");
    for (const suggestion of SUGGESTIONS) {
      const card = el("button", "suggestion");
      card.append(el("span", "suggestion-title", suggestion.title), el("span", "suggestion-detail", suggestion.detail));
      card.addEventListener("click", () => { input.value = suggestion.prompt; autosize(); updateSendState(); input.focus(); });
      grid.append(card);
    }
    hero.append(grid);
  }
  inner.append(hero);
}

function addUserMessage(text, images, turnMode) {
  $("thread-inner").querySelector(".hero")?.remove();
  const article = el("article", "turn user");
  const bubble = el("div", "bubble");
  if (turnMode !== "chat") bubble.append(el("span", `mode-tag ${turnMode}`, MODE_NAMES[turnMode]));
  bubble.append(document.createTextNode(text));
  if (images.length) {
    const strip = el("div", "bubble-images");
    for (const path of images) { const image = el("img"); image.src = fileUrl(path); image.title = basename(path); strip.append(image); }
    bubble.append(strip);
  }
  article.append(bubble);
  $("thread-inner").append(article);
  const title = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  if ($("chat-title").textContent === "New chat") $("chat-title").textContent = title;
  record({ type: "user", text, images, mode: turnMode });
  if (chat && chat.title === "New chat") chat.title = title;
}

/** One request to Solar: a chat message, a reviewed plan to run, a team to plan (/delegate), or an approved team to launch. */
async function runTurn({ text, display = text, images = [], mode: turnMode = "chat", plan, delegation }) {
  const turnId = ++turnCounter;
  if (!plan && !delegation) addUserMessage(display, images, turnMode);
  const entry = record({ type: "solar", mode: delegation ? "team" : turnMode, activity: [], diffs: [], agents: null, result: null, elapsed: 0 });
  const turn = createSolarTurn(turnId, delegation ? "team" : turnMode, { entry });
  turns.set(turnId, turn);
  activeTurnMode = plan || delegation ? undefined : turnMode;
  busy = true;
  renderChrome();
  scrollToBottom(true);
  let result;
  try {
    result = plan ? await window.solar.runPlan({ turnId, request: text, plan })
      : delegation ? await window.solar.runDelegation({ turnId, request: delegation.request, context: delegation.context, plan: delegation.plan })
      : turnMode === "delegate" ? await window.solar.delegate({ turnId })
      : await window.solar.send({ turnId, text, images, mode: turnMode });
    if (result.kind === "plan") turn.finishPlan(result.request, result.plan, result.ultra, result.achievements);
    else turn.finish(result.reply, result);
  } catch (error) {
    turn.fail(cleanError(error));
  } finally {
    busy = false;
    renderChrome();
    void refreshChanges();
    scrollToBottom();
    saveChat();
  }
  // With auto-approve on, a drafted team launches straight away, as in the CLI.
  if (result?.delegation?.autoApproved) await runTurn({ delegation: result.delegation });
}

/** One Solar reply: a live header, a timeline of steps with inline diffs, then the answer and a files summary. */
function createSolarTurn(turnId, turnMode, { entry = {}, elapsed: replayed } = {}) {
  // A turn replayed from history draws what it recorded; only live turns record.
  const replay = replayed !== undefined;
  const article = el("article", `turn solar${turnMode === "ultra" || turnMode === "ultraplan" || turnMode === "ultrareview" ? " ultra" : ""}`);
  const head = el("div", "solar-head");
  const avatar = el("span", "avatar working");
  const name = el("span", "solar-name", "Solar");
  const status = el("span", "solar-status shimmer", "Thinking");
  const elapsed = el("span", "solar-elapsed", "0s");
  head.append(avatar, name, status, elapsed);

  const steps = el("div", "steps open");
  const toggle = el("button", "steps-toggle");
  const toggleLabel = el("span", "", "Working");
  toggle.append(icon("chevron", "steps-caret"), toggleLabel);
  toggle.addEventListener("click", () => steps.classList.toggle("open"));
  const list = el("div", "steps-list");
  steps.append(toggle, list);
  const body = el("div", "solar-body");
  article.append(head, steps, body);
  $("thread-inner").append(article);

  const started = Date.now() - (replayed ?? 0) * 1000;
  const timer = replay ? undefined : setInterval(() => { elapsed.textContent = formatElapsed((Date.now() - started) / 1000); }, 1000);
  let stepCount = 0;
  let lastText = "";
  let lastNote;
  const commands = new Map();
  const files = new Map();
  let team;

  const addStep = (kind, iconName, label, detail) => {
    const step = el("div", `step ${kind}`);
    const marker = el("span", "step-marker");
    marker.append(icon(iconName));
    const content = el("div", "step-content");
    content.append(el("span", "step-label", label));
    if (detail) content.append(el("span", "step-detail", detail));
    step.append(marker, content);
    list.append(step);
    stepCount++;
    scrollToBottom();
    return step;
  };

  return {
    activity(text) {
      if (text === lastText) return;
      lastText = text;
      if (!replay) entry.activity?.push(text);
      const parsed = classify(text);
      if (!parsed) return;
      // Solar switched itself into an Ultra mode mid-turn: the turn takes on the Ultra look.
      if (parsed.kind === "mode" && /^Ultra/.test(parsed.mode)) article.classList.add("ultra");
      if (parsed.status) status.textContent = parsed.status;
      if (parsed.kind === "file") return;
      if (parsed.kind === "command-done") {
        const step = commands.get(parsed.detail);
        if (step) { markDone(step); return; }
        addStep("command done", "check", "Ran", parsed.detail);
        return;
      }
      const step = addStep(parsed.kind, parsed.icon, parsed.label, parsed.detail);
      if (parsed.kind === "note") lastNote = { step, text: parsed.label };
      if (parsed.kind === "command") commands.set(parsed.detail, step);
    },
    diff(file) {
      if (!replay) entry.diffs?.push(file);
      let card = files.get(file.path);
      if (!card) {
        card = { added: 0, removed: 0, diffs: [], kind: file.kind, name: file.name, path: file.path };
        files.set(file.path, card);
      }
      card.added += file.added;
      card.removed += file.removed;
      card.diffs.push(file);
      if (file.kind === "deleted") card.kind = "deleted";
      const step = el("div", "step file");
      const marker = el("span", "step-marker");
      marker.append(icon(file.kind === "added" ? "file-plus" : file.kind === "deleted" ? "file-minus" : "file"));
      step.append(marker, fileCard(file, { preview: 14, onOpen: () => reviewTurn(file.path) }));
      list.append(step);
      stepCount++;
      status.textContent = `${file.kind === "added" ? "Created" : file.kind === "deleted" ? "Deleted" : "Edited"} ${splitName(file.name).base}`;
      scrollToBottom();
    },
    agents(list) {
      if (!replay) entry.agents = list;
      if (!team) { team = el("div", "team"); article.insertBefore(team, body); }
      team.replaceChildren(el("div", "team-head", "Team"), teamList(list));
      const running = list.filter(agent => agent.status === "running");
      status.textContent = running.length ? `${running.length} sub-agent${running.length === 1 ? "" : "s"} working` : "Synthesizing the reports";
      scrollToBottom();
    },
    finish(reply = "", { achievements = [], delegation } = {}) {
      if (!replay) entry.result = { kind: "reply", reply, achievements, delegation };
      done();
      // The final agent message is also narrated; drop the note that repeats the reply.
      if (reply && lastNote && reply.replace(/\s+/g, " ").startsWith(lastNote.text.replace(/\.\.\.$/, "").replace(/\s+/g, " "))) { lastNote.step.remove(); stepCount--; }
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      if (reply || !delegation) body.append(renderMarkdown(reply || "Done."));
      if (files.size) body.append(filesSummary());
      for (const achievement of achievements) body.append(achievementBadge(achievement));
      if (delegation) body.append(delegationCard(delegation, entry));
      avatar.classList.remove("working");
      status.textContent = "";
    },
    finishPlan(request, plan, ultra, achievements = []) {
      if (!replay) entry.result = { kind: "plan", request, plan, ultra, achievements };
      done();
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      const card = el("div", "plan-card");
      const header = el("div", "plan-head");
      header.append(icon("map"), el("span", "", ultra ? "Proposed ultraplan" : "Proposed plan"), el("span", "plan-note", "Read-only. Nothing has changed yet."));
      const actions = el("div", "plan-actions");
      const run = el("button", "primary-button");
      run.append(icon("play"), document.createTextNode("Run this plan"));
      const dismiss = el("button", "ghost-button", "Dismiss");
      run.addEventListener("click", async () => {
        if (busy) return toast("Solar is still working.");
        actions.replaceChildren(el("span", "plan-status", "Approved"));
        entry.decided = "Approved";
        await runTurn({ text: request, plan });
      });
      dismiss.addEventListener("click", () => { actions.replaceChildren(el("span", "plan-status muted", "Dismissed")); entry.decided = "Dismissed"; saveChat(); });
      // A plan reopened from history keeps the decision made on it.
      if (entry.decided) actions.append(el("span", `plan-status${entry.decided === "Dismissed" ? " muted" : ""}`, entry.decided));
      else actions.append(run, dismiss);
      card.append(header, renderMarkdown(plan), actions);
      body.append(card);
      for (const achievement of achievements) body.append(achievementBadge(achievement));
      avatar.classList.remove("working");
      status.textContent = "";
    },
    fail(message) {
      if (!replay) entry.result = { kind: "error", message };
      done();
      toggleLabel.textContent = summary();
      if (!stepCount) steps.remove();
      const card = el("div", "error-card");
      card.append(icon("alert"), el("span", "", message));
      body.append(card);
      if (files.size) body.append(filesSummary());
      avatar.classList.remove("working");
      avatar.classList.add("failed");
      status.textContent = "";
    }
  };

  function done() {
    clearInterval(timer);
    if (!replay) entry.elapsed = (Date.now() - started) / 1000;
    elapsed.textContent = formatElapsed((Date.now() - started) / 1000);
    status.classList.remove("shimmer");
    steps.classList.remove("open");
    for (const step of commands.values()) if (!step.classList.contains("done")) markDone(step);
  }

  function markDone(step) {
    step.classList.add("done");
    step.querySelector(".step-marker").replaceChildren(icon("check"));
    const label = step.querySelector(".step-label");
    if (label.textContent === "Running") label.textContent = "Ran";
  }

  function summary() {
    const seconds = formatElapsed((Date.now() - started) / 1000);
    return `Worked for ${seconds}${stepCount ? ` · ${stepCount} step${stepCount === 1 ? "" : "s"}` : ""}`;
  }

  /** This response's files, each with every hunk it made, for the Review panel. */
  function turnFiles() {
    return [...files.values()].map(file => ({ path: file.path, name: file.name, kind: file.kind, added: file.added, removed: file.removed, hunks: file.diffs.flatMap(diff => diff.hunks) }));
  }

  function reviewTurn(path) { void toggleReview(true, path, { files: turnFiles() }); }

  function filesSummary() {
    const box = el("div", "files-summary");
    const header = el("div", "files-summary-head");
    let added = 0;
    let removed = 0;
    for (const file of files.values()) { added += file.added; removed += file.removed; }
    header.append(el("span", "", `${files.size} file${files.size === 1 ? "" : "s"} changed`), diffStat(added, removed));
    // Opens the diff pane with just this response's changes.
    const review = el("button", "ghost-button small review-button");
    review.append(icon("diff"), document.createTextNode("Review"));
    review.addEventListener("click", () => reviewTurn());
    header.append(review);
    box.append(header);
    for (const file of turnFiles()) box.append(fileCard(file, { collapsed: true, onOpen: () => reviewTurn(file.path) }));
    return box;
  }
}

/** The sub-agent plan Solar drafted: accept or reject each agent, then launch the accepted ones. */
function delegationCard(delegation, entry = {}) {
  const { plan } = delegation;
  const card = el("div", "plan-card delegation-card");
  const header = el("div", "plan-head");
  header.append(icon("team"), el("span", "", "Review delegation"), el("span", "plan-note", `${plan.tasks.length} sub-agent${plan.tasks.length === 1 ? "" : "s"}`));
  card.append(header, el("p", "delegation-summary", plan.summary));
  const actions = el("div", "plan-actions");
  if (delegation.autoApproved) {
    actions.append(el("span", "plan-status", `Auto-approve is on, so the ${plan.tasks.length}-sub-agent plan launches without pausing for review.`));
    card.append(taskList(plan.tasks), actions);
    return card;
  }
  if (entry.decided) {
    card.classList.add("decided");
    actions.append(el("span", "plan-status", entry.decided));
    card.append(taskList(plan.tasks), actions);
    return card;
  }
  const accepted = plan.tasks.map(() => true);
  const run = el("button", "primary-button");
  const label = document.createTextNode("");
  run.append(icon("play"), label);
  const refresh = () => {
    const count = accepted.filter(Boolean).length;
    label.textContent = count ? `Run ${count} sub-agent${count === 1 ? "" : "s"}` : "Nothing accepted";
    run.disabled = !count;
  };
  const tasks = taskList(plan.tasks, (index, checked) => { accepted[index] = checked; refresh(); });
  const reject = el("button", "ghost-button", "Reject");
  run.addEventListener("click", async () => {
    if (busy) return toast("Solar is still working.");
    const chosen = plan.tasks.filter((_, index) => accepted[index]);
    card.classList.add("decided");
    actions.replaceChildren(el("span", "plan-status", `Launching ${chosen.length} sub-agent${chosen.length === 1 ? "" : "s"}`));
    entry.decided = `Launched ${chosen.length} sub-agent${chosen.length === 1 ? "" : "s"}`;
    await runTurn({ delegation: { ...delegation, plan: { ...plan, tasks: chosen } } });
  });
  reject.addEventListener("click", () => {
    card.classList.add("decided");
    actions.replaceChildren(el("span", "plan-status muted", "Delegation rejected. No sub-agents were launched and no workspace changes were made."));
    entry.decided = "Delegation rejected. No sub-agents were launched.";
    saveChat();
  });
  refresh();
  actions.append(run, reject);
  card.append(tasks, actions);
  return card;
}

function taskList(tasks, onToggle) {
  const list = el("div", "task-list");
  tasks.forEach((task, index) => {
    const row = el(onToggle ? "label" : "div", "task-row");
    if (onToggle) {
      const box = el("input");
      box.type = "checkbox";
      box.checked = true;
      box.addEventListener("change", () => { row.classList.toggle("rejected", !box.checked); onToggle(index, box.checked); });
      row.append(box);
    }
    const text = el("div", "task-text");
    const title = el("div", "task-title");
    title.append(el("strong", "", task.name), el("span", "", ` · ${task.title}`));
    text.append(title, el("div", "task-detail", task.instructions));
    row.append(text);
    list.append(row);
  });
  return list;
}

function achievementBadge(achievement) {
  const badge = el("div", "achievement");
  badge.append(el("span", "achievement-mark", "◆"), document.createTextNode(`Achievement unlocked: ${achievement}`));
  return badge;
}

/** Sub-agents exactly as the harness reports them. */
function teamList(agents) {
  const list = el("div", "team-list");
  for (const agent of agents) {
    const row = el("div", `agent ${agent.status}${agent.depth ? " delegate" : ""}`);
    row.append(el("span", "agent-marker"));
    const text = el("div", "agent-text");
    const title = el("div", "agent-title");
    title.append(el("strong", "", agent.name), el("span", "agent-id", agent.id), el("span", "agent-meta", `${agent.depth ? "sub-delegate" : "sub-agent"} · ${EFFORT_NAMES[agent.reasoning] ?? agent.reasoning}${agent.reasoningPinned ? " pinned" : ""} · ${agent.status}`));
    text.append(title, el("div", "agent-activity", agent.error ?? agent.latestActivity));
    row.append(text);
    list.append(row);
  }
  return list;
}

/** A note from the app itself (slash command output), styled apart from Solar's replies. */
function addNote(title, ...content) {
  $("thread-inner").querySelector(".hero")?.remove();
  const article = el("article", "turn note");
  const card = el("div", "note-card");
  card.append(el("div", "note-title", title));
  for (const item of content) card.append(typeof item === "string" ? el("p", "", item) : item);
  article.append(card);
  $("thread-inner").append(article);
  scrollToBottom(true);
  // Buttons are live controls, so history keeps the note's words only.
  record({ type: "note", title, parts: content.map(item => typeof item === "string" ? item : item.tagName === "BUTTON" ? null : { pre: item.innerText || item.textContent }).filter(Boolean) });
  saveChat();
}

// ---------- chat history ----------

/** Adds an item to the chat record. A chat starts with its first message, so notes before that are not kept. */
function record(item) {
  if (replaying) return item;
  if (!chat && item.type === "user" && app.workspace) chat = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, workspace: app.workspace, title: "New chat", created: Date.now(), items: [] };
  chat?.items.push(item);
  return item;
}

let saveTimer;
let pendingSave;
function saveChat() {
  if (!chat || replaying) return;
  const saving = chat;
  clearTimeout(saveTimer);
  pendingSave = async () => {
    pendingSave = undefined;
    try { await window.solar.saveChat(saving); } catch { /* A chat that can't be saved still works on screen. */ }
  };
  saveTimer = setTimeout(async () => { await pendingSave?.(); await renderHistory(); }, 250);
}

/** Writes a waiting save now: the engine state saved with a chat must be that chat's, before a new chat, folder, or chat replaces it. */
async function flushChat() {
  clearTimeout(saveTimer);
  await pendingSave?.();
}

/** Draws a saved chat exactly as it was recorded. */
function replayChat(saved) {
  replaying = true;
  try {
    for (const item of saved.items) {
      if (item.type === "user") addUserMessage(item.text, item.images ?? [], item.mode ?? "chat");
      else if (item.type === "note") addNote(item.title, ...item.parts.map(part => typeof part === "string" ? part : preformatted(part.pre)));
      else if (item.type === "solar") {
        const turn = createSolarTurn(0, item.mode, { entry: item, elapsed: item.elapsed ?? 0 });
        for (const text of item.activity ?? []) turn.activity(text);
        for (const file of item.diffs ?? []) turn.diff(file);
        if (item.agents) turn.agents(item.agents);
        const result = item.result;
        if (result?.kind === "reply") turn.finish(result.reply, result);
        else if (result?.kind === "plan") turn.finishPlan(result.request, result.plan, result.ultra, result.achievements);
        else turn.fail(result?.message ?? "This reply was interrupted before it finished.");
      }
    }
  } finally { replaying = false; }
}

async function openChat(id) {
  if (chat?.id === id) return;
  if (busy) return toast("Solar is still working. Wait for it to finish first.");
  try {
    await flushChat();
    const result = await window.solar.openChat(id);
    closeMeeting({ quiet: true });
    app = result.state;
    clearThread();
    chat = result.chat;
    lastRequestSent = Boolean(chat.lastRequest);
    replayChat(chat);
    $("chat-title").textContent = chat.title;
    renderChrome();
    await refreshChanges();
    await renderHistory();
    scrollToBottom(true);
    $("input").focus();
  } catch (error) { toast(cleanError(error)); }
}

/** The sidebar: each open folder with its chats, newest first. */
async function renderHistory() {
  let chats = [];
  try { chats = await window.solar.chats(); } catch { /* No history yet. */ }
  const groups = (app.workspaces ?? []).map(workspace => {
    const group = el("div", `side-workspace${workspace.path === app.workspace ? " current" : ""}`);
    const head = el("div", "side-workspace-head");
    const open = el("button", "side-workspace-open");
    open.title = `${workspace.path}\nStart a new chat in this folder`;
    open.append(icon("folder"), el("span", "side-workspace-name", workspace.name));
    open.addEventListener("click", () => void switchWorkspace(workspace.path));
    const remove = el("button", "icon-button side-remove");
    remove.title = "Remove from the sidebar (the folder and its chats are kept)";
    remove.append(icon("close"));
    remove.addEventListener("click", () => void removeWorkspace(workspace.path));
    head.append(open, remove);
    group.append(head);
    const mine = chats.filter(item => item.workspace === workspace.path);
    for (const item of mine) {
      const row = el("div", `side-chat${item.id === chat?.id ? " current" : ""}`);
      const openButton = el("button", "side-chat-open");
      openButton.title = item.title;
      openButton.append(el("span", "side-chat-title", item.title), el("span", "side-chat-time", relativeTime(item.updated)));
      openButton.addEventListener("click", () => void openChat(item.id));
      const remove = el("button", "icon-button side-remove");
      remove.title = "Delete chat";
      remove.append(icon("trash"));
      remove.addEventListener("click", async () => {
        try {
          if (!await window.solar.deleteChat(item.id)) return;
          if (chat?.id === item.id) await newChat();
          await renderHistory();
        } catch (error) { toast(cleanError(error)); }
      });
      row.append(openButton, remove);
      group.append(row);
    }
    if (!mine.length) group.append(el("div", "side-empty", "No chats yet"));
    return group;
  });
  $("side-history").replaceChildren(...(groups.length ? groups : [el("div", "side-empty", "Add a folder to start.")]));
}

function relativeTime(time) {
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 1440)}d`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- side-by-side meetings ----------

function openMeeting(topic) {
  meeting = { topic, selected: 0, busy: false, turnId: 0, panes: MEETING_SPEAKERS.map(meetingPane) };
  $("meeting-topic").textContent = topic;
  $("meeting-panes").replaceChildren(...meeting.panes.map(pane => pane.root));
  $("meeting-recordings").hidden = true;
  $("meeting-note").hidden = true;
  $("meeting").hidden = false;
  $("thread").hidden = true;
  $("jump-latest").hidden = true;
  selectPane(0);
  renderChrome();
}

/** One session's pane: speaker, status, session ID, latest activity, and its own scrolling history. */
function meetingPane(speaker, index) {
  const root = el("div", `pane ${speaker.toLowerCase()}`);
  root.dataset.status = "starting";
  const head = el("div", "pane-head");
  const avatar = el("span", "avatar");
  const status = el("span", "pane-status", "Starting");
  head.append(avatar, el("strong", "pane-name", speaker), el("span", "pane-role", index ? "Checks · read-only" : "Does the work · edits"), status);
  const session = el("div", "pane-session", "Session: new (its ID arrives with the first reply)");
  const activity = el("div", "pane-activity", index ? "Starting a read-only session to inspect and verify" : "Starting a session to carry out the request");
  const body = el("div", "pane-body");
  const foot = el("div", "pane-foot", "Latest messages");
  root.append(head, session, activity, body, foot);
  root.addEventListener("pointerdown", () => selectPane(index));
  const pane = { speaker, root, avatar, status, session, activity, body, foot, stick: true, round: 0, live: undefined };
  body.addEventListener("scroll", () => {
    pane.stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    foot.textContent = pane.stick ? "Latest messages" : "Viewing earlier messages";
  });
  return pane;
}

function selectPane(index) {
  meeting.selected = index;
  meeting.panes.forEach((pane, item) => pane.root.classList.toggle("selected", item === index));
}

/** A reply only arrives at the end of each round, so the steps the session reports meanwhile show in its pane. */
function liveStep(pane, activity) {
  if (!activity || /^\s*[{[]/.test(activity)) return;
  if (!pane.live) {
    pane.live = el("div", "pane-live");
    pane.live.append(el("div", "pane-live-title", `${pane.speaker} is working on round ${pane.round + 1}`));
    pane.body.append(pane.live);
  }
  if (pane.live.lastChild.textContent === activity) return;
  pane.live.append(el("div", "pane-live-step", activity));
  // Keep the title and the latest few steps.
  while (pane.live.children.length > 7) pane.live.children[1].remove();
  if (pane.stick) pane.body.scrollTop = pane.body.scrollHeight;
}

function endLive(pane) { pane.live?.remove(); pane.live = undefined; }

function paneMessage(pane, from, text) {
  const you = from === "You";
  const message = el("div", `pane-message${you ? " you" : ""}`);
  message.append(el("div", "pane-from", you ? "You" : `${from} · round ${pane.round}`), you ? el("div", "pane-text", text) : renderMarkdown(text));
  pane.body.append(message);
  if (pane.stick) pane.body.scrollTop = pane.body.scrollHeight;
}

/** Status and messages exactly as the harness reports them for each session. */
function meetingEvent({ turnId, speaker, text, sessionId, status, activity }) {
  const pane = meeting?.turnId === turnId && meeting.panes.find(item => item.speaker === speaker);
  if (!pane) return;
  if (text !== undefined) { endLive(pane); pane.round++; paneMessage(pane, speaker, text); return; }
  pane.root.dataset.status = status;
  pane.status.textContent = capitalize(status);
  if (sessionId) pane.session.textContent = `Session: ${sessionId}`;
  if (status === "running") liveStep(pane, activity);
  else endLive(pane);
  pane.activity.textContent = activity;
  pane.avatar.classList.toggle("working", status === "running");
  pane.avatar.classList.toggle("failed", status === "failed");
}

/** Sends the request or a follow-up to both sessions: three rounds, then each saves a readback. */
async function talkInMeeting(text, continuing) {
  const current = meeting;
  current.turnId = ++turnCounter;
  current.busy = true;
  for (const pane of current.panes) { pane.round = 0; pane.stick = true; paneMessage(pane, "You", text); }
  $("meeting-note").hidden = true;
  busy = true;
  renderChrome();
  try {
    const result = await window.solar.meeting({ turnId: current.turnId, topic: text, continuing });
    current.recordings = result.recordings;
    current.readback = result.readback;
    $("meeting-recordings").hidden = false;
    meetingNote("Both sessions saved their readbacks. Send another message to continue in the same sessions, or leave with /sidebyside close.");
  } catch (error) {
    meetingNote(cleanError(error), true);
  } finally {
    current.busy = false;
    busy = false;
    renderChrome();
    void refreshChanges();
  }
}

function meetingNote(text, failed = false) {
  const note = $("meeting-note");
  note.replaceChildren(icon(failed ? "alert" : "check"), el("span", "", text));
  note.classList.toggle("failed", failed);
  note.hidden = false;
}

/** Back to Solar chat. The sessions stay resumable in the engine until /new; a note records the meeting in the thread. */
function closeMeeting({ quiet = false } = {}) {
  if (!meeting) return;
  const { topic, recordings, readback } = meeting;
  meeting = null;
  $("meeting").hidden = true;
  $("thread").hidden = false;
  renderChrome();
  if (quiet) return;
  const content = [`Returned to Solar chat from the side-by-side session on "${topic}".${recordings ? " Recordings and session notes are saved." : ""}`];
  if (readback) {
    const details = el("details", "note-details");
    details.append(el("summary", "", "Readbacks"), renderMarkdown(readback));
    content.push(details);
  }
  if (recordings) {
    const open = el("button", "ghost-button small");
    open.append(icon("folder"), document.createTextNode("Open recordings"));
    open.addEventListener("click", () => void window.solar.openFile(recordings));
    content.push(open);
  }
  addNote("Side-by-side", ...content);
  $("input").focus();
}

$("meeting-close").addEventListener("click", () => meeting?.busy ? toast(MEETING_BUSY) : closeMeeting());
$("meeting-recordings").addEventListener("click", () => { if (meeting?.recordings) void window.solar.openFile(meeting.recordings); });

// ---------- pet ----------

let petFrames = [];
let petTick = 0;
let petTimer;

/** The engine's ASCII pet walks back and forth along the top of the composer. */
async function showPet() {
  clearInterval(petTimer);
  petFrames = app.pet && app.pet !== "off" ? await window.solar.petFrames(app.pet) : [];
  $("pet").hidden = !petFrames.length;
  $("app").classList.toggle("has-pet", petFrames.length > 0);
  if (!petFrames.length) return;
  const step = () => {
    const pet = $("pet");
    const travel = Math.max(0, Math.floor(($("composer").offsetWidth - pet.offsetWidth - 40) / 8));
    const period = Math.max(1, travel * 2);
    const position = Math.min(petTick % period, period - petTick % period);
    pet.textContent = petFrames[petTick % petFrames.length].join("\n");
    pet.style.transform = `translateX(${position * 8}px)`;
    petTick++;
  };
  step();
  petTimer = setInterval(step, 220);
}

/** A collapsible file card: icon, path, +/- counts, and its diff. */
function fileCard(file, { preview, collapsed = false, onOpen = () => void toggleReview(true, file.path) } = {}) {
  const card = el("div", `file-card${collapsed ? "" : " open"}`);
  const header = el("button", "file-card-head");
  const { dir, base } = splitName(file.name);
  const title = el("span", "file-title");
  if (dir) title.append(el("span", "file-dir", dir));
  title.append(el("span", "file-base", base));
  header.append(fileIcon(file.kind), title);
  if (file.kind === "added") header.append(el("span", "kind-badge added", "New"));
  if (file.kind === "deleted") header.append(el("span", "kind-badge deleted", "Deleted"));
  header.append(diffStat(file.added, file.removed), icon("chevron", "file-caret"));
  const open = el("button", "icon-button file-open");
  open.title = "Open in the Review panel";
  open.append(icon("expand"));
  open.addEventListener("click", event => { event.stopPropagation(); onOpen(); });
  header.append(open);
  header.addEventListener("click", () => card.classList.toggle("open"));
  const body = el("div", "file-card-body");
  body.append(renderDiff(file, { limit: preview }));
  card.append(header, body);
  return card;
}

/** Maps a harness activity line to a timeline step. */
function classify(text) {
  let match;
  if ((match = text.match(/^Thinking: (.+)$/))) return { kind: "thinking", icon: "brain", label: match[1], status: match[1] };
  if ((match = text.match(/^Note: (.+)$/))) return { kind: "note", icon: "note", label: match[1], status: undefined };
  if ((match = text.match(/^Running command: (.+)$/))) return { kind: "command", icon: "terminal", label: "Running", detail: match[1], status: "Running a command" };
  if ((match = text.match(/^Command completed: (.+)$/))) return { kind: "command-done", detail: match[1], status: "Checking the output" };
  if ((match = text.match(/^Workspace: (.+)$/))) return { kind: "command", icon: "terminal", label: "Workspace", detail: match[1], status: "Running a command" };
  if ((match = text.match(/^Web search: (.+)$/))) return { kind: "web", icon: "search", label: capitalize(match[1]), status: capitalize(match[1]) };
  if ((match = text.match(/^Browser: (.+)$/))) return { kind: "web", icon: "globe", label: "Browser", detail: match[1], status: "Using the browser" };
  if ((match = text.match(/^Image: (.+)$/))) return { kind: "image", icon: "image", label: "Looking at", detail: match[1], status: `Looking at ${match[1]}` };
  if (text.startsWith("File: ")) return { kind: "file" };
  if ((match = text.match(/^Mode: ([^,]+)(?:, (.+))?$/))) return { kind: "mode", mode: match[1], icon: "spark", label: `Switched to ${match[1]}`, detail: match[2], status: `Switched to ${match[1]}` };
  if ((match = text.match(/^(?:Plan|Review): (.+)$/))) return { kind: "stage", icon: "map", label: capitalize(match[1]), status: capitalize(match[1]) };
  if (/^Inspecting runtime operations/.test(text)) return { kind: "stage", icon: "map", label: text, status: text };
  if (/^\s*[{[]/.test(text)) return undefined;
  return { kind: "misc", icon: "dot", label: text };
}

// ---------- review panel and sidebar changes ----------

let changesTimer;
function scheduleChangesRefresh() { clearTimeout(changesTimer); changesTimer = setTimeout(() => void refreshChanges(), 400); }

async function refreshChanges() {
  try { reviewFiles = await window.solar.changes(); } catch { reviewFiles = []; }
  let added = 0;
  let removed = 0;
  for (const file of reviewFiles) { added += file.added; removed += file.removed; }
  $("side-stats").replaceChildren(...(reviewFiles.length ? [diffStat(added, removed)] : []));
  const side = $("side-changes");
  side.replaceChildren(...(reviewFiles.length ? reviewFiles.map(file => {
    const row = el("button", "side-file");
    const { dir, base } = splitName(file.name);
    const name = el("span", "side-file-name");
    name.append(el("span", "file-base", base));
    if (dir) name.append(el("span", "file-dir", dir.replace(/\/$/, "")));
    row.title = file.name;
    row.append(fileIcon(file.kind), name, diffStat(file.added, file.removed));
    row.addEventListener("click", () => void toggleReview(true, file.path));
    return row;
  }) : [el("div", "side-empty", "Files Solar edits will show up here.")]));
  if (!$("review").hidden) renderReview();
}

/** Opens or closes the diff pane: one response's files with `scope`, or every change this chat without. */
async function toggleReview(force, path, scope) {
  const panel = $("review");
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  $("app").classList.toggle("reviewing", open);
  if (!open) { reviewScope = null; return; }
  reviewScope = scope ?? null;
  $("review-title-text").textContent = reviewScope ? "This response" : "Changes";
  if (path) reviewSelected = path;
  await refreshChanges();
}

function renderReview() {
  const shown = reviewScope?.files ?? reviewFiles;
  let added = 0;
  let removed = 0;
  for (const file of shown) { added += file.added; removed += file.removed; }
  $("review-totals").replaceChildren(el("span", "muted", `${shown.length} file${shown.length === 1 ? "" : "s"}`), diffStat(added, removed, { bar: true }));
  if (!shown.some(file => file.path === reviewSelected)) reviewSelected = shown[0]?.path;
  $("review-files").replaceChildren(...shown.map(file => {
    const row = el("button", `review-file${file.path === reviewSelected ? " selected" : ""}`);
    const { dir, base } = splitName(file.name);
    const name = el("span", "review-file-name");
    name.append(el("span", "file-base", base));
    if (dir) name.append(el("span", "file-dir", dir.replace(/\/$/, "")));
    row.append(fileIcon(file.kind), name, diffStat(file.added, file.removed));
    row.addEventListener("click", () => { reviewSelected = file.path; renderReview(); });
    return row;
  }));
  const diffBox = $("review-diff");
  const file = shown.find(item => item.path === reviewSelected);
  if (!file) {
    const empty = el("div", "review-empty");
    empty.append(icon("diff"), el("strong", "", "No changes yet"), el("span", "", "When Solar edits files, every change lands here as a diff you can review."));
    diffBox.replaceChildren(empty);
    return;
  }
  const head = el("div", "review-diff-head");
  const title = el("div", "file-title");
  const { dir, base } = splitName(file.name);
  if (dir) title.append(el("span", "file-dir", dir));
  title.append(el("span", "file-base", base));
  const actions = el("div", "review-actions");
  const openButton = el("button", "ghost-button small");
  openButton.append(icon("external"), document.createTextNode("Open"));
  openButton.addEventListener("click", () => void window.solar.openFile(file.path));
  const reveal = el("button", "ghost-button small");
  reveal.append(icon("folder"), document.createTextNode("Reveal"));
  reveal.addEventListener("click", () => void window.solar.revealFile(file.path));
  actions.append(openButton, reveal);
  head.append(fileIcon(file.kind), title, diffStat(file.added, file.removed), actions);
  diffBox.replaceChildren(head, renderDiff(file));
}

// ---------- keyboard ----------

document.addEventListener("keydown", event => {
  if (event.key === "Escape") { closeMenu(); closeSlashMenu(); return; }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "n") { event.preventDefault(); void newChat(); }
  else if (event.key.toLowerCase() === "o") { event.preventDefault(); void chooseWorkspace(); }
  else if (event.key === "\\") { event.preventDefault(); void toggleReview(); }
});

input.focus();

// ---------- helpers ----------

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${rest}s`;
  return minutes ? `${minutes}m ${rest}s` : `${seconds}s`;
}

function capitalize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function basename(path) { return path.split(/[\\/]/).pop(); }
function fileUrl(path) { return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/").replace(/^([A-Za-z])%3A/, "$1:")}`; }
function cleanError(error) { return String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""); }

let toastTimer;
function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  requestAnimationFrame(() => element.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.classList.remove("show"); setTimeout(() => { element.hidden = true; }, 250); }, 3600);
}
