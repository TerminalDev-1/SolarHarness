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
// Each chat has its own session (harness, change tracker, busy flag), so several chats work at once, even in one folder.
const sessions = new Map();
// The folder new chats open in.
let currentWorkspace;
let preferences = {};
// Model, effort, speed, and auto-approve, set from the composer and applied to every session.
let settings;

function loadPreferences() {
  try { preferences = JSON.parse(readFileSync(preferencesPath(), "utf8")); } catch { preferences = {}; }
}

function savePreferences() {
  if (demo) return;
  mkdirSync(dirname(preferencesPath()), { recursive: true });
  writeFileSync(preferencesPath(), `${JSON.stringify(preferences, null, 2)}\n`);
}

/** Lists `workspace` in the sidebar (if new) and opens new chats there. */
function openWorkspace(workspace) {
  currentWorkspace = workspace;
  preferences.workspace = workspace;
  const listed = preferences.workspaces ?? [];
  if (!listed.includes(workspace)) preferences.workspaces = [workspace, ...listed];
  savePreferences();
}

/** Hides a folder from the sidebar; its files and saved chats stay, and chats still working there finish. */
function closeWorkspace(workspace) {
  preferences.workspaces = (preferences.workspaces ?? []).filter(path => path !== workspace);
  for (const [id, entry] of sessions) if (entry.workspace === workspace && !entry.busy) { closeSession(entry); sessions.delete(id); }
  if (currentWorkspace === workspace) {
    currentWorkspace = preferences.workspaces.find(path => existsSync(path));
    preferences.workspace = currentWorkspace;
  }
  savePreferences();
}

function applySettings(harness) {
  harness.setModel(settings.model);
  harness.setReasoning(settings.reasoning);
  harness.setFast(settings.fast);
  harness.setAutoPermissions(settings.autoApprove);
}

function updateSettings(change) {
  Object.assign(settings, change);
  for (const entry of sessions.values()) applySettings(entry.harness);
}

/** The session for a chat, opened in `workspace` (the current folder by default) the first time it is used. */
function session(chatId, workspace = currentWorkspace) {
  if (typeof chatId !== "string" || !/^[a-z0-9-]+$/i.test(chatId)) throw new Error("Unknown chat.");
  let entry = sessions.get(chatId);
  if (!entry) {
    if (!workspace) throw new Error("Open a folder first.");
    const harness = new SolarHarness({ task: "", model: settings.model, reasoning: settings.reasoning, cwd: workspace });
    applySettings(harness);
    harness.stats.startChat();
    // lastRequest is what /delegate hands to the planner, as the CLI keeps its brief.
    entry = { harness, tracker: new ChangeTracker(workspace), workspace, busy: false, lastRequest: "" };
    void entry.tracker.snapshot();
    sessions.set(chatId, entry);
  }
  return entry;
}

function closeSession(entry) { void entry.harness.browser.close(); void entry.harness.workspace.close(); }

// ---------- chat history: one JSON file per chat, with the engine state that continues it ----------

let chatsDirectory = () => join(app.getPath("userData"), "chats");
const chatPath = id => {
  if (typeof id !== "string" || !/^[a-z0-9-]+$/i.test(id)) throw new Error("Unknown chat.");
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
    workspace: currentWorkspace,
    workspaceName: currentWorkspace ? basename(currentWorkspace) : undefined,
    model: settings.model,
    effort: settings.reasoning,
    fast: settings.fast,
    autoApprove: settings.autoApprove,
    defaultEffort: loadDefaultEffort(),
    pet: preferences.pet ?? "off",
    theme: currentTheme(),
    pets: PET_NAMES,
    models: SOLAR_MODELS,
    efforts: REASONING_EFFORTS,
    platform: process.platform,
    running: [...sessions].filter(([, entry]) => entry.busy).map(([id]) => id)
  };
}

const send = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };

/** Relays every activity line, plus a diff whenever the line reports a file change. */
function activityRelay(entry, turnId) {
  return event => {
    send("solar:activity", { turnId, text: event });
    if (event.startsWith("File: ")) {
      void entry.tracker.fromEvent(event).then(diff => { if (diff) send("solar:diff", { turnId, ...diff }); });
    }
  };
}

/** Runs one turn in a chat's own session; other chats keep working meanwhile. */
async function runTurn(chatId, turnId, work) {
  const entry = session(chatId);
  if (entry.busy) throw new Error("This chat is still working on its last message.");
  entry.busy = true;
  try {
    await Promise.all([entry.tracker.snapshot(), claimBrowser(entry.harness.browser).catch(() => {})]);
    return await work(entry, activityRelay(entry, turnId));
  } finally {
    entry.busy = false;
    await releaseBrowser(entry.harness.browser).catch(() => {});
  }
}

/** A finished reply plus any achievements it unlocked. */
function reply(entry, text) {
  return { kind: "reply", reply: text, achievements: entry.harness.takeAchievements() };
}

/** Solar switched itself into plan or ultraplan (switch_mode): show the plan for approval, like /plan's. */
function selfPlan(entry, plan) {
  return { kind: "plan", request: plan.request, plan: plan.plan, ultra: plan.ultra, achievements: entry.harness.takeAchievements() };
}

/** Drafts a sub-agent plan. With auto-approve on, the renderer launches it without the review card, as the CLI does. */
async function delegationPlan(entry, request, onActivity) {
  const plan = await entry.harness.plan(request, request, onActivity);
  return { request, context: request, plan, autoApproved: entry.harness.getAutoPermissions().enabled };
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
    if (!result.canceled && result.filePaths[0]) openWorkspace(result.filePaths[0]);
    return state();
  });

  ipcMain.handle("workspace:switch", (_event, path) => {
    if (!existsSync(path)) throw new Error(`${path} no longer exists.`);
    openWorkspace(path);
    return state();
  });

  // Removes a folder from the sidebar only; its files and saved chats stay.
  ipcMain.handle("workspace:remove", (_event, path) => { closeWorkspace(path); return state(); });

  ipcMain.handle("chats:list", () => listChats());

  // Saves the renderer's record of a chat plus what its session needs to continue it.
  ipcMain.handle("chats:save", async (_event, chat) => {
    const entry = sessions.get(chat?.id);
    if (!entry) return;
    await mkdir(chatsDirectory(), { recursive: true });
    await writeFile(chatPath(chat.id), JSON.stringify({ ...chat, workspace: entry.workspace, updated: Date.now(), lastRequest: entry.lastRequest, engine: entry.harness.conversationState() }));
  });

  // Reopens a saved chat; a chat not open this run gets a session that resumes its Codex conversation.
  ipcMain.handle("chats:open", async (_event, id) => {
    const chat = JSON.parse(await readFile(chatPath(id), "utf8"));
    if (!sessions.has(id)) {
      if (!existsSync(chat.workspace)) throw new Error(`This chat's folder no longer exists: ${chat.workspace}`);
      const entry = session(id, chat.workspace);
      entry.harness.restoreConversation(chat.engine ?? { transcript: [] });
      entry.lastRequest = chat.lastRequest ?? "";
    }
    if (existsSync(chat.workspace)) openWorkspace(chat.workspace);
    return { chat, state: state() };
  });

  ipcMain.handle("chats:delete", async (_event, id) => {
    const { title } = JSON.parse(await readFile(chatPath(id), "utf8"));
    if (sessions.get(id)?.busy) throw new Error("This chat is still working. Wait for it to finish before deleting it.");
    const { response } = await dialog.showMessageBox(window, {
      type: "warning", buttons: ["Delete chat", "Cancel"], defaultId: 1, cancelId: 1,
      title: "Delete chat", message: `Delete "${title}"?`, detail: "The chat is removed from your history. Files in the folder are not touched."
    });
    if (response !== 0) return false;
    await rm(chatPath(id), { force: true });
    const entry = sessions.get(id);
    if (entry) { closeSession(entry); sessions.delete(id); }
    return true;
  });

  ipcMain.handle("settings:model", (_event, model) => { updateSettings({ model }); preferences.model = model; savePreferences(); return state(); });
  ipcMain.handle("settings:effort", (_event, effort) => {
    if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
    updateSettings({ reasoning: effort });
    return state();
  });
  ipcMain.handle("settings:fast", (_event, enabled) => { updateSettings({ fast: Boolean(enabled) }); return state(); });

  ipcMain.handle("chat:send", (_event, { chatId, turnId, text, images = [], mode = "chat" }) => runTurn(chatId, turnId, async (entry, onActivity) => {
    const { harness } = entry;
    if (mode === "plan" || mode === "ultraplan") return { kind: "plan", request: text, ultra: mode === "ultraplan", plan: await harness.planTask(text, mode === "ultraplan", onActivity) };
    if (mode === "ultrareview") return reply(entry, await harness.ultraReview(text, onActivity));
    entry.lastRequest = text;
    const result = mode === "ultra" ? await harness.converseUltra(text, onActivity, images) : await harness.converse(text, onActivity, undefined, images);
    if (result.plan) return selfPlan(entry, result.plan);
    // Solar decided the task needs a team: draft the sub-agent plan in the same turn, like the CLI.
    if (result.readyToDelegate) return { ...reply(entry, result.reply), delegation: await delegationPlan(entry, text, onActivity) };
    return reply(entry, result.reply);
  }));

  ipcMain.handle("chat:runPlan", (_event, { chatId, turnId, request, plan }) => runTurn(chatId, turnId, async (entry, onActivity) => {
    const result = await entry.harness.executeTaskPlan(request, plan, onActivity);
    if (result.plan) return selfPlan(entry, result.plan);
    if (result.readyToDelegate) return { ...reply(entry, result.reply), delegation: await delegationPlan(entry, request, onActivity) };
    return reply(entry, result.reply);
  }));

  // /delegate: plan a team for the chat's last request.
  ipcMain.handle("chat:delegate", (_event, { chatId, turnId }) => {
    if (!session(chatId).lastRequest) throw new Error("First tell Solar what the team should accomplish.");
    return runTurn(chatId, turnId, async (entry, onActivity) => ({ kind: "delegation", delegation: await delegationPlan(entry, entry.lastRequest, onActivity) }));
  });

  // Runs the sub-agents the user accepted, streaming the team's progress to the turn.
  ipcMain.handle("chat:runDelegation", (_event, { chatId, turnId, request, context, plan }) => runTurn(chatId, turnId, async (entry, onActivity) => {
    const onProgress = agents => send("solar:agents", { turnId, agents: agents.map(agentView) });
    return reply(entry, await entry.harness.executePlan(plan, request, context, onProgress, onActivity));
  }));

  // /sidebyside: Aurora carries out the request (and edits), Helios verifies read-only, over three rounds. `continuing`
  // resumes the same two sessions with a follow-up; each pane's status and messages stream as solar:meeting.
  ipcMain.handle("chat:meeting", (_event, { chatId, turnId, topic, continuing = false }) => runTurn(chatId, turnId, async (entry, onActivity) => {
    const readback = await entry.harness.sideBySide(topic, undefined,
      (speaker, text) => send("solar:meeting", { turnId, speaker, text }),
      { continue: continuing, onSession: (speaker, sessionId, status, activity) => {
        send("solar:meeting", { turnId, speaker, sessionId, status, activity });
        // Aurora's file edits land in the Review panel like any turn's.
        if (activity.startsWith("File: ")) onActivity(activity);
      } });
    return { kind: "meeting", readback, recordings: await solarDirectory(entry.workspace, "sessions") };
  }));

  ipcMain.handle("agents:list", (_event, chatId) => sessions.get(chatId)?.harness.manager.list().map(agentView) ?? []);
  ipcMain.handle("agents:control", async (_event, { chatId, agentId, action, value }) => {
    const input = action === "reasoning" ? { action: "set_reasoning", agentId, reasoning: value }
      : action === "context" ? { action: "inject_context", agentId, context: value }
      : action === "cancel" ? { action: "cancel", agentId } : undefined;
    if (!input || !agentId || (action === "context" && !value)) throw new Error("Usage: /agent <id-or-name> reasoning <light|medium|high|xhigh|max> | context <message> | cancel");
    if (action === "reasoning" && !REASONING_EFFORTS.includes(value)) throw new Error(`Unknown effort: ${value}`);
    const agents = await session(chatId).harness.tools.call("orchestrate", input);
    return agents.map(agentView);
  });

  ipcMain.handle("settings:autoApprove", (_event, enabled) => { updateSettings({ autoApprove: Boolean(enabled) }); return state(); });
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

  ipcMain.handle("info:stats", (_event, chatId) => formatStats(session(chatId).harness.stats.snapshot()));
  ipcMain.handle("info:memory", (_event, chatId) => {
    const { harness } = session(chatId);
    return { files: harness.getInstructionFiles().map(({ scope, path, truncated }) => ({ scope, path, truncated })), paths: instructionPaths(harness.getWorkspace()) };
  });
  ipcMain.handle("app:quit", () => app.quit());

  // A new chat gets its own session when it is first used. Folders named test are emptied first, after a confirmation.
  ipcMain.handle("chat:new", async (_event, chatId) => {
    if (!currentWorkspace) return { started: false };
    if (basename(currentWorkspace).toLowerCase() === "test") {
      if ([...sessions.values()].some(entry => entry.busy && entry.workspace === currentWorkspace)) throw new Error("A chat is still working in this test folder. Wait for it to finish before emptying the folder.");
      const { response } = await dialog.showMessageBox(window, {
        type: "warning", buttons: ["Delete and start fresh", "Cancel"], defaultId: 1, cancelId: 1,
        title: "Start a new chat", message: `This deletes everything in ${currentWorkspace}.`,
        detail: "Folders named test are emptied when a new chat starts."
      });
      if (response !== 0) return { started: false };
      await session(chatId).harness.startNewSession();
    }
    return { started: true, state: state() };
  });

  ipcMain.handle("changes:list", (_event, chatId) => sessions.get(chatId)?.tracker.sessionChanges() ?? []);

  ipcMain.handle("images:pick", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Add images for Solar", properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("images:paste", async () => {
    const image = clipboard.readImage();
    if (!currentWorkspace || image.isEmpty()) return [];
    const target = join(await solarDirectory(currentWorkspace, "pasted"), `clipboard-${Date.now()}.png`);
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
  settings = { model: preferences.model ?? SOLAR_MODELS[0].id, reasoning: loadDefaultEffort(), fast: false, autoApprove: false };
  if (demo) {
    // The demo never touches saved preferences or a real project.
    demo.installDemoHarness();
    preferences = {};
    settings.model = SOLAR_MODELS[0].id;
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
  for (const entry of sessions.values()) closeSession(entry);
  if (process.platform !== "darwin") app.quit();
});
