const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getSession: () => ipcRenderer.invoke('auth:getSession'),

  // Dados do site
  getLeagues: () => ipcRenderer.invoke('site:getLeagues'),

  // Monitor
  startMonitor: (leagueId) => ipcRenderer.invoke('monitor:start', leagueId),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  getMonitorState: () => ipcRenderer.invoke('monitor:getState'),

  // Eventos do main → renderer
  onLog: (cb) => ipcRenderer.on('log:entry', (_e, entry) => cb(entry)),
  onStateChange: (cb) => ipcRenderer.on('monitor:stateChange', (_e, state) => cb(state)),
  onSessionExpired: (cb) => ipcRenderer.on('auth:sessionExpired', () => cb()),

  // Auto-update
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', () => cb()),
  installUpdate: () => ipcRenderer.invoke('update:install'),
})
