import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SolarHarness } from "solar-harness/dist/harness.js";
import { SOLAR_MODELS } from "solar-harness/dist/models.js";
import { instructionPaths } from "solar-harness/dist/instructions.js";
import { PET_NAMES, petSprite } from "solar-harness/dist/pets.js";
import { loadDefaultEffort, saveDefaultEffort } from "solar-harness/dist/settings.js";
import { formatStats } from "solar-harness/dist/stats.js";
import { solarDirectory } from "solar-harness/dist/solar-dir.js";
import { REASONING_EFFORTS } from "solar-harness/dist/types.js";
import { SOLAR_VERSION_LABEL } from "solar-harness/dist/version.js";
import { ChangeTracker } from "./changes.js";
import { claimBrowser, releaseBrowser } from "./browser-control.js";

const here = dirname(fileURLToPath(import.meta.url));
const preferencesPath = () => join(app.getPath("userData"), "preferences.json");

let window;
// Every open workspace keeps its own harness and change tracker; `harness` and `tracker` are the current one's.
const workspaces = new Map();
let harness;
let tracker;
let busy = false;
let preferences = {};
// The last request /delegate hands to the planner, as the CLI keeps its brief.
let lastRequest = "";

function loadPreferences() {
  try { preferences = JSON.parse(readFileSync(preferencesPath(), "utf8")); } catch { preferences = {}; }
}

function savePreferences() {
  if (demo) return;
  mkdirSync(dirname(preferencesPath()), { recursive: true });
  writeFileSync(preferencesPath(), `${JSON.stringify(preferences, null, 2)}\n`);
}

/** Makes `workspace` current, opening a harness for it the first time. The model, effort, speed, and auto-approve carry over. */
function openWorkspace(workspace) {
  const model = harness?.getModel() ?? preferences.model ?? SOLAR_MODELS[0].id;
  const reasoning = harness?.options?.reasoning ?? loadDefaultEffort();
  const fast = harness?.getFast() ?? false;
  const autoApprove = harness?.getAutoPermissions().enabled ?? false;
  let entry = workspaces.get(workspace);
  if (!entry) {
    entry = { harness: new SolarHarness({ task: "", model, reasoning, cwd: workspace }), tracker: new ChangeTracker(workspace) };
    entry.harness.stats.startChat();
    workspaces.set(workspace, entry);
  } else {
    // Coming back to an open folder starts a fresh chat there; saved chats reopen from the sidebar.
    entry.harness.resetConversation();
    entry.tracker.setWorkspace(workspace);
  }
  ({ harness, tracker } = entry);
  harness.setModel(model);
  harness.setReasoning(reasoning);
  harness.setFast(fast);
  harness.setAutoPermissions(autoApprove);
  lastRequest = "";
  void tracker.snapshot();
  preferences.workspace = workspace;
  preferences.workspaces = [workspace, ...(preferences.workspaces ?? []).filter(path => path !== workspace)];
  savePreferences();
}

function closeWorkspace(workspace) {
  const entry = workspaces.get(workspace);
  if (entry) { void entry.harness.browser.close(); void entry.harness.workspace.close(); workspaces.delete(workspace); }
  preferences.workspaces = (preferences.workspaces ?? []).filter(path => path !== workspace);
  if (harness?.getWorkspace() === workspace) {
    harness = undefined;
    tracker = undefined;
    const next = preferences.workspaces.find(path => existsSync(path));
    if (next) openWorkspace(next); else { preferences.workspace = undefined; savePreferences(); }
  } else savePreferences();
}

// ---------- chat history: one JSON file per chat, with the engine state that continues it ----------

let chatsDirectory = () => join(app.getPath("userData"), "chats");
const chatPath = id => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Unknown chat.");
  return join(chatsDirectory(), `${id}.json`);
};

async function listChats() {
  let names = [];
  try { names = (await readdir(chatsDirectory())).filter(name => name.endsWith(".json")); } catch { return []; }
  const chats = await Promise.all(names.map(async name => {
    try {
      const { id, title, workspace, updated } = JSON.parse(await readFile(join(chatsDirectory(), name), "utf8"));
      return { id, title, workspace, updated };
    } catch { return undefined; }
  }));
  return chats.filter(Boolean).sort((a, b) => b.updated - a.updated);
}

function state() {
  return {
    version: SOLAR_VERSION_LABEL,
    workspaces: (preferences.workspaces ?? []).filter(path => existsSync(path)).map(path => ({ path, name: basename(path) })),
    workspace: harness?.getWorkspace(),
    workspaceName: harness ? basename(harness.getWorkspace()) : undefined,
    model: harness?.getModel() ?? preferences.model ?? SOLAR_MODELS[0].id,
    effort: harness?.options?.reasoning ?? loadDefaultEffort(),
    fast: harness?.getFast() ?? false,
    autoApprove: harness?.getAutoPermissions().enabled ?? false,
    defaultEffort: loadDefaultEffort(),
    pet: preferences.pet ?? "off",
    theme: currentTheme(),
    pets: PET_NAMES,
    models: SOLAR_MODELS,
    efforts: REASONING_EFFORTS,
    platform: process.platform,
    busy
  };
}

const send = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };

/** Relays every activity line, plus a diff whenever the line reports a file change. */
function activityRelay(turnId) {
  return event => {
    send("solar:activity", { turnId, text: event });
    if (event.startsWith("File: ")) {
      void tracker.fromEvent(event).then(diff => { if (diff) send("solar:diff", { turnId, ...diff }); });
    }
  };
}

async function runTurn(turnId, work) {
  if (!harness) throw new Error("Open a folder first.");
  if (busy) throw new Error("Solar is still working on the last message.");
  busy = true;
  const turnHarness = harness;
  try {
    await Promise.all([tracker.snapshot(), claimBrowser(turnHarness.browser).catch(() => {})]);
    return await work(activityRelay(turnId));
  } finally {
    busy = false;
    await releaseBrowser(turnHarness.browser).catch(() => {});
  }
}

/** A finished reply plus any achievements it unlocked. */
function reply(text) {
  return { kind: "reply", reply: text, achievements: harness.takeAchievements() };
}

/** Solar switched itself into plan or ultraplan (switch_mode): show the plan for approval, like /plan's. */
function selfPlan(plan) {
  return { kind: "plan", request: plan.request, plan: plan.plan, ultra: plan.ultra, achievements: harness.takeAchievements() };
}

/** Drafts a sub-agent plan. With auto-approve on, the renderer launches it without the review card, as the CLI does. */
async function delegationPlan(request, onActivity) {
  const plan = await harness.plan(request, request, onActivity);
  return { request, context: request, plan, autoApproved: harness.getAutoPermissions().enabled };
}

async function runTeam(turnId, plan, request, context, onActivity) {
  const onProgress = agents => send("solar:agents", { turnId, agents: agents.map(agentView) });
  return reply(await harness.executePlan(plan, request, context, onProgress, onActivity));
}

/** The parts of an AgentRecord the renderer shows; drops dates and session ids. */
function agentView(agent) {
  return {
    id: agent.id, name: agent.name, title: agent.title, depth: agent.depth, status: agent.status,
    reasoning: agent.reasoning, reasoningPinned: agent.reasoningPinned, latestActivity: agent.latestActivity, error: agent.error
  };
}

function registerIpc() {
  ipcMain.handle("state:get", () => state());

  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(window, { title: "Open a folder for Solar", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return state();
    if (busy) throw new Error("Wait for Solar to finish before switching folders.");
    if (result.filePaths[0] !== harness?.getWorkspace()) openWorkspace(result.filePaths[0]);
    return state();
  });

  ipcMain.handle("workspace:switch", (_event, path) => {
    if (busy) throw new Error("Wait for Solar to finish before switching folders.");
    if (!existsSync(path)) throw new Error(`${path} no longer exists.`);
    openWorkspace(path);
    return state();
  });

  // Removes a folder from the sidebar only; its files and saved chats stay.
  ipcMain.handle("workspace:remove", (_event, path) => {
    if (busy && harness?.getWorkspace() === path) throw new Error("Wait for Solar to finish before removing this folder.");
    closeWorkspace(path);
    return state();
  });

  ipcMain.handle("chats:list", () => listChats());

  // Saves the renderer's record of the current chat plus what the engine needs to continue it.
  ipcMain.handle("chats:save", async (_event, chat) => {
    if (!chat?.id || !harness || chat.workspace !== harness.getWorkspace()) return;
    await mkdir(chatsDirectory(), { recursive: true });
    await writeFile(chatPath(chat.id), JSON.stringify({ ...chat, updated: Date.now(), lastRequest, engine: harness.conversationState() }));
  });

  // Reopens a saved chat in its folder; the next message resumes its Codex session.
  ipcMain.handle("chats:open", async (_event, id) => {
    if (busy) throw new Error("Wait for Solar to finish before opening another chat.");
    const chat = JSON.parse(await readFile(chatPath(id), "utf8"));
    if (!existsSync(chat.workspace)) throw new Error(`This chat's folder no longer exists: ${chat.workspace}`);
    if (harness?.getWorkspace() !== chat.workspace) openWorkspace(chat.workspace);
    harness.restoreConversation(chat.engine ?? { transcript: [] });
    lastRequest = chat.lastRequest ?? "";
    tracker.reset();
    void tracker.snapshot();
    return { chat, state: state() };
  });

  ipcMain.handle("chats:delete", async (_event, id) => {
    const { title } = JSON.parse(await readFile(chatPath(id), "utf8"));
    const { response } = await dialog.showMessageBox(window, {
      type: "warning", buttons: ["Delete chat", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Delete chat", message: `Delete "${title}"?`, detail: "The chat is removed from your history. Files in the folder are not touched."
    });
    if (response !== 0) return false;
    await rm(chatPath(id), { force: true });
    return true;
  });

  ipcMain.handle("settings:model", (_event, model) => { harness?.setModel(model); preferences.model = model; savePreferences(); return state(); });
  ipcMain.handle("settings:effort", (_event, effort) => {
    if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
    harness?.setReasoning(effort);
    return state();
  });
  ipcMain.handle("settings:fast", (_event, enabled) => { harness?.setFast(Boolean(enabled)); return state(); });

  ipcMain.handle("chat:send", (_event, { turnId, text, images = [], mode = "chat" }) => runTurn(turnId, async onActivity => {
    if (mode === "plan" || mode === "ultraplan") return { kind: "plan", request: text, ultra: mode === "ultraplan", plan: await harness.planTask(text, mode === "ultraplan", onActivity) };
    if (mode === "ultrareview") return reply(await harness.ultraReview(text, onActivity));
    lastRequest = text;
    const result = mode === "ultra" ? await harness.converseUltra(text, onActivity, images) : await harness.converse(text, onActivity, undefined, images);
    if (result.plan) return selfPlan(result.plan);
    // Solar decided the task needs a team: draft the sub-agent plan in the same turn, like the CLI.
    if (result.readyToDelegate) return { ...reply(result.reply), delegation: await delegationPlan(text, onActivity) };
    return reply(result.reply);
  }));

  ipcMain.handle("chat:runPlan", (_event, { turnId, request, plan }) => runTurn(turnId, async onActivity => {
    const result = await harness.executeTaskPlan(request, plan, onActivity);
    if (result.plan) return selfPlan(result.plan);
    if (result.readyToDelegate) return { ...reply(result.reply), delegation: await delegationPlan(request, onActivity) };
    return reply(result.reply);
  }));

  // /delegate: plan a team for the last request.
  ipcMain.handle("chat:delegate", (_event, { turnId }) => {
    if (!lastRequest) throw new Error("First tell Solar what the team should accomplish.");
    return runTurn(turnId, async onActivity => ({ kind: "delegation", delegation: await delegationPlan(lastRequest, onActivity) }));
  });

  // Runs the sub-agents the user accepted, streaming the team's progress to the turn.
  ipcMain.handle("chat:runDelegation", (_event, { turnId, request, context, plan }) => runTurn(turnId, onActivity => runTeam(turnId, plan, request, context, onActivity)));

  // /sidebyside: Aurora carries out the request (and edits), Helios verifies read-only, over three rounds. `continuing`
  // resumes the same two sessions with a follow-up; each pane's status and messages stream as solar:meeting.
  ipcMain.handle("chat:meeting", (_event, { turnId, topic, continuing = false }) => runTurn(turnId, async onActivity => {
    const readback = await harness.sideBySide(topic, undefined,
      (speaker, text) => send("solar:meeting", { turnId, speaker, text }),
      { continue: continuing, onSession: (speaker, sessionId, status, activity) => {
        send("solar:meeting", { turnId, speaker, sessionId, status, activity });
        // Aurora's file edits land in the Review panel like any turn's.
        if (activity.startsWith("File: ")) onActivity(activity);
      } });
    return { kind: "meeting", readback, recordings: await solarDirectory(harness.getWorkspace(), "sessions") };
  }));

  ipcMain.handle("agents:list", () => harness ? harness.manager.list().map(agentView) : []);
  ipcMain.handle("agents:control", async (_event, { agentId, action, value }) => {
    if (!harness) throw new Error("Open a folder first.");
    const input = action === "reasoning" ? { action: "set_reasoning", agentId, reasoning: value }
      : action === "context" ? { action: "inject_context", agentId, context: value }
      : action === "cancel" ? { action: "cancel", agentId } : undefined;
    if (!input || !agentId || (action === "context" && !value)) throw new Error("Usage: /agent <id-or-name> reasoning <light|medium|high|xhigh|max> | context <message> | cancel");
    if (action === "reasoning" && !REASONING_EFFORTS.includes(value)) throw new Error(`Unknown effort: ${value}`);
    const agents = await harness.tools.call("orchestrate", input);
    return agents.map(agentView);
  });

  ipcMain.handle("settings:autoApprove", (_event, enabled) => { harness?.setAutoPermissions(Boolean(enabled)); return state(); });
  ipcMain.handle("settings:defaultEffort", (_event, effort) => {
    if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
    if (!demo) saveDefaultEffort(effort);
    return state();
  });
  ipcMain.handle("settings:theme", (_event, theme) => {
    if (theme !== "dark" && theme !== "light") throw new Error(`Unknown theme: ${theme}`);
    preferences.theme = theme;
    savePreferences();
    applyWindowTheme();
    return state();
  });
  ipcMain.handle("settings:pet", (_event, pet) => {
    if (pet !== "off" && !PET_NAMES.includes(pet)) throw new Error(`Unknown pet: ${pet}`);
    preferences.pet = pet;
    savePreferences();
    return state();
  });
  // One full blink cycle of the engine's pet sprite; the renderer walks it along the composer.
  ipcMain.handle("pets:frames", (_event, pet) => PET_NAMES.includes(pet) ? Array.from({ length: 56 }, (_, tick) => petSprite(pet, tick)) : []);

  ipcMain.handle("info:stats", () => {
    if (!harness) throw new Error("Open a folder first.");
    return formatStats(harness.stats.snapshot());
  });
  ipcMain.handle("info:memory", () => {
    if (!harness) throw new Error("Open a folder first.");
    return { files: harness.getInstructionFiles().map(({ scope, path, truncated }) => ({ scope, path, truncated })), paths: instructionPaths(harness.getWorkspace()) };
  });
  ipcMain.handle("app:quit", () => app.quit());

  ipcMain.handle("chat:new", async () => {
    if (!harness) return { started: false };
    if (busy) throw new Error("Wait for Solar to finish before starting a new chat.");
    if (harness.clearsOnNew()) {
      const { response } = await dialog.showMessageBox(window, {
        type: "warning", buttons: ["Delete and start fresh", "Cancel"], defaultId: 1, cancelId: 1,
        title: "Start a new chat", message: `This deletes everything in ${harness.getWorkspace()}.`,
        detail: "Folders named test are emptied when a new chat starts."
      });
      if (response !== 0) return { started: false };
    }
    await harness.startNewSession();
    lastRequest = "";
    // The Review panel's session list starts over with each chat.
    tracker.setWorkspace(harness.getWorkspace());
    void tracker.snapshot();
    return { started: true, state: state() };
  });

  ipcMain.handle("changes:list", () => tracker ? tracker.sessionChanges() : []);

  ipcMain.handle("images:pick", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Add images for Solar", properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("images:paste", async () => {
    const image = clipboard.readImage();
    if (!harness || image.isEmpty()) return [];
    const target = join(await solarDirectory(harness.getWorkspace(), "pasted"), `clipboard-${Date.now()}.png`);
    await writeFile(target, image.toPNG());
    return [target];
  });

  ipcMain.handle("file:open", (_event, path) => existsSync(path) ? shell.openPath(path) : "File no longer exists.");
  ipcMain.handle("file:reveal", (_event, path) => shell.showItemInFolder(path));
}

const WINDOW_THEMES = {
  dark: { background: "#0b0b10", symbols: "#a1a1aa" },
  light: { background: "#f7f6f3", symbols: "#52525b" }
};
const currentTheme = () => preferences.theme === "light" ? "light" : "dark";

/** Native controls (title bar buttons, scrollbars, dialogs) follow the app's theme. */
function applyWindowTheme() {
  const colors = WINDOW_THEMES[currentTheme()];
  nativeTheme.themeSource = currentTheme();
  if (!window || window.isDestroyed()) return;
  window.setBackgroundColor(colors.background);
  if (process.platform !== "darwin") window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbols, height: 44 });
}

function createWindow() {
  const colors = WINDOW_THEMES[currentTheme()];
  nativeTheme.themeSource = currentTheme();
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    backgroundColor: colors.background,
    title: "Solar",
    show: false,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 44 } }),
    // Screenshot runs render offscreen so no window appears on the desktop.
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: capturing }
  });
  if (!capturing) window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", event => event.preventDefault());
  void window.loadFile(join(here, "renderer", "index.html"));
}

const demo = process.env.SOLAR_DESKTOP_DEMO ? await import("./demo.js") : undefined;
const capturing = Boolean(demo && process.env.SOLAR_DESKTOP_SCREENSHOTS);
// Offscreen captures are more reliable on the software renderer.
if (capturing) app.disableHardwareAcceleration();

app.whenReady().then(() => {
  loadPreferences();
  if (demo) {
    // The demo never touches saved preferences or a real project.
    demo.installDemoHarness();
    preferences = {};
    // Demo chats go in a scratch folder, never the real history.
    const demoChats = demo.demoChatsDirectory();
    chatsDirectory = () => demoChats;
  }
  const launchFolder = demo ? demo.prepareDemoWorkspace() : process.env.SOLAR_WORKSPACE ?? preferences.workspace;
  if (launchFolder && existsSync(launchFolder)) openWorkspace(launchFolder);
  if (demo) openWorkspace(demo.prepareDemoWorkspace("solar-demo-second-"));
  if (demo && launchFolder) openWorkspace(launchFolder);
  registerIpc();
  createWindow();
  if (capturing) {
    window.webContents.once("did-finish-load", async () => {
      await demo.captureScreenshots(window, process.env.SOLAR_DESKTOP_SCREENSHOTS);
      app.quit();
    });
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => {
  if (harness) { void harness.browser.close(); void harness.workspace.close(); }
  if (process.platform !== "darwin") app.quit();
});
