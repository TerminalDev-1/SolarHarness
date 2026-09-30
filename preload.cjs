const { contextBridge, ipcRenderer } = require("electron");

const listen = channel => callback => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("solar", {
  state: () => ipcRenderer.invoke("state:get"),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  switchWorkspace: path => ipcRenderer.invoke("workspace:switch", path),
  removeWorkspace: path => ipcRenderer.invoke("workspace:remove", path),
  chats: () => ipcRenderer.invoke("chats:list"),
  saveChat: chat => ipcRenderer.invoke("chats:save", chat),
  openChat: id => ipcRenderer.invoke("chats:open", id),
  deleteChat: id => ipcRenderer.invoke("chats:delete", id),
  setModel: model => ipcRenderer.invoke("settings:model", model),
  setEffort: effort => ipcRenderer.invoke("settings:effort", effort),
  setFast: enabled => ipcRenderer.invoke("settings:fast", enabled),
  send: request => ipcRenderer.invoke("chat:send", request),
  runPlan: request => ipcRenderer.invoke("chat:runPlan", request),
  newChat: chatId => ipcRenderer.invoke("chat:new", chatId),
  delegate: request => ipcRenderer.invoke("chat:delegate", request),
  runDelegation: request => ipcRenderer.invoke("chat:runDelegation", request),
  meeting: request => ipcRenderer.invoke("chat:meeting", request),
  agents: chatId => ipcRenderer.invoke("agents:list", chatId),
  controlAgent: request => ipcRenderer.invoke("agents:control", request),
  setAutoApprove: enabled => ipcRenderer.invoke("settings:autoApprove", enabled),
  setDefaultEffort: effort => ipcRenderer.invoke("settings:defaultEffort", effort),
  setPet: pet => ipcRenderer.invoke("settings:pet", pet),
  setTheme: theme => ipcRenderer.invoke("settings:theme", theme),
  petFrames: pet => ipcRenderer.invoke("pets:frames", pet),
  stats: chatId => ipcRenderer.invoke("info:stats", chatId),
  memory: chatId => ipcRenderer.invoke("info:memory", chatId),
  quit: () => ipcRenderer.invoke("app:quit"),
  changes: chatId => ipcRenderer.invoke("changes:list", chatId),
  pickImages: () => ipcRenderer.invoke("images:pick"),
  pasteImages: () => ipcRenderer.invoke("images:paste"),
  openFile: path => ipcRenderer.invoke("file:open", path),
  revealFile: path => ipcRenderer.invoke("file:reveal", path),
  onActivity: listen("solar:activity"),
  onDiff: listen("solar:diff"),
  onAgents: listen("solar:agents"),
  onMeeting: listen("solar:meeting")
});
