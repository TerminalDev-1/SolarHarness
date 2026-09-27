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
  changes: () => ipcRenderer.invoke("changes:list"),
  pickImages: () => ipcRenderer.invoke("images:pick"),
  pasteImages: () => ipcRenderer.invoke("images:paste"),
  openFile: path => ipcRenderer.invoke("file:open", path),
  revealFile: path => ipcRenderer.invoke("file:reveal", path),
  onActivity: listen("solar:activity"),
  onDiff: listen("solar:diff")
});
