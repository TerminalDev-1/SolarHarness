import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SolarHarness } from "solar-harness/dist/harness.js";
import { SOLAR_MODELS } from "solar-harness/dist/models.js";
import { loadDefaultEffort } from "solar-harness/dist/settings.js";
import { solarDirectory } from "solar-harness/dist/solar-dir.js";
import { REASONING_EFFORTS } from "solar-harness/dist/types.js";
import { SOLAR_VERSION_LABEL } from "solar-harness/dist/version.js";
import { ChangeTracker } from "./changes.js";
import { claimBrowser, releaseBrowser } from "./browser-control.js";

const here = dirname(fileURLToPath(import.meta.url));
const preferencesPath = () => join(app.getPath("userData"), "preferences.json");

let window;
let harness;
let tracker;
let busy = false;
let preferences = {};

function loadPreferences() {
  try { preferences = JSON.parse(readFileSync(preferencesPath(), "utf8")); } catch { preferences = {}; }
}

function savePreferences() {
  if (demo) return;
  mkdirSync(dirname(preferencesPath()), { recursive: true });
  writeFileSync(preferencesPath(), `${JSON.stringify(preferences, null, 2)}\n`);
}

function openWorkspace(workspace) {
  const model = harness?.getModel() ?? preferences.model ?? SOLAR_MODELS[0].id;
  const reasoning = harness?.options?.reasoning ?? loadDefaultEffort();
  const fast = harness?.getFast() ?? false;
  if (harness) { void harness.browser.close(); void harness.workspace.close(); }
  harness = new SolarHarness({ task: "", model, reasoning, cwd: workspace });
  harness.setFast(fast);
  harness.stats.startChat();
  tracker = new ChangeTracker(workspace);
  void tracker.snapshot();
  preferences.workspace = workspace;
  savePreferences();
}

function state() {
  return {
    version: SOLAR_VERSION_LABEL,
    workspace: harness?.getWorkspace(),
    workspaceName: harness ? basename(harness.getWorkspace()) : undefined,
    model: harness?.getModel() ?? preferences.model ?? SOLAR_MODELS[0].id,
    effort: harness?.options?.reasoning ?? loadDefaultEffort(),
    fast: harness?.getFast() ?? false,
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

function registerIpc() {
  ipcMain.handle("state:get", () => state());

  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(window, { title: "Open a folder for Solar", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return state();
    if (busy) throw new Error("Wait for Solar to finish before switching folders.");
    openWorkspace(result.filePaths[0]);
    return state();
  });

  ipcMain.handle("settings:model", (_event, model) => { harness?.setModel(model); preferences.model = model; savePreferences(); return state(); });
  ipcMain.handle("settings:effort", (_event, effort) => {
    if (!REASONING_EFFORTS.includes(effort)) throw new Error(`Unknown effort: ${effort}`);
    harness?.setReasoning(effort);
    return state();
  });
  ipcMain.handle("settings:fast", (_event, enabled) => { harness?.setFast(Boolean(enabled)); return state(); });

  ipcMain.handle("chat:send", (_event, { turnId, text, images = [], mode = "chat" }) => runTurn(turnId, async onActivity => {
    if (mode === "plan" || mode === "ultraplan") return { kind: "plan", request: text, plan: await harness.planTask(text, mode === "ultraplan", onActivity) };
    if (mode === "ultrareview") return { kind: "reply", reply: await harness.ultraReview(text, onActivity) };
    const result = mode === "ultra" ? await harness.converseUltra(text, onActivity, images) : await harness.converse(text, onActivity, undefined, images);
    return { kind: "reply", reply: result.reply };
  }));

  ipcMain.handle("chat:runPlan", (_event, { turnId, request, plan }) => runTurn(turnId, async onActivity => {
    const result = await harness.executeTaskPlan(request, plan, onActivity);
    return { kind: "reply", reply: result.reply };
  }));

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

function createWindow() {
  nativeTheme.themeSource = "dark";
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    backgroundColor: "#0b0b10",
    title: "Solar",
    show: false,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 16 } } : { titleBarOverlay: { color: "#0b0b10", symbolColor: "#a1a1aa", height: 44 } }),
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
  }
  const launchFolder = demo ? demo.prepareDemoWorkspace() : process.env.SOLAR_WORKSPACE ?? preferences.workspace;
  if (launchFolder && existsSync(launchFolder)) openWorkspace(launchFolder);
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
