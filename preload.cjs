const { contextBridge, ipcRenderer } = require("electron");

const listen = channel => callback => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("solar", {
  state: () => ipcRenderer.invoke("state:get"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  setModel: model => ipcRenderer.invoke("settings:model", model),
  setEffort: effort => ipcRenderer.invoke("settings:effort", effort),
  setFast: enabled => ipcRenderer.invoke("settings:fast", enabled),
  send: request => ipcRenderer.invoke("chat:send", request),
  runPlan: request => ipcRenderer.invoke("chat:runPlan", request),
  newChat: () => ipcRenderer.invoke("chat:new"),
  delegate: request => ipcRenderer.invoke("chat:delegate", request),
  runDelegation: request => ipcRenderer.invoke("chat:runDelegation", request),
  agents: () => ipcRenderer.invoke("agents:list"),
  controlAgent: request => ipcRenderer.invoke("agents:control", request),
  setAutoApprove: enabled => ipcRenderer.invoke("settings:autoApprove", enabled),
  setDefaultEffort: effort => ipcRenderer.invoke("settings:defaultEffort", effort),
  setPet: pet => ipcRenderer.invoke("settings:pet", pet),
  setTheme: theme => ipcRenderer.invoke("settings:theme", theme),
  petFrames: pet => ipcRenderer.invoke("pets:frames", pet),
  stats: () => ipcRenderer.invoke("info:stats"),
  memory: () => ipcRenderer.invoke("info:memory"),
  quit: () => ipcRenderer.invoke("app:quit"),
  changes: () => ipcRenderer.invoke("changes:list"),
  pickImages: () => ipcRenderer.invoke("images:pick"),
  pasteImages: () => ipcRenderer.invoke("images:paste"),
  openFile: path => ipcRenderer.invoke("file:open", path),
  revealFile: path => ipcRenderer.invoke("file:reveal", path),
  onActivity: listen("solar:activity"),
  onDiff: listen("solar:diff"),
  onAgents: listen("solar:agents")
});
