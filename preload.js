const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getSession: () => ipcRenderer.invoke('auth:getSession'),

  // Dados do site
  getLeagues: () => ipcRenderer.invoke('site:getLeagues'),

  // Npcap
  installNpcap: () => ipcRenderer.invoke('npcap:install'),

  // Monitor
  startMonitor: (leagueId) => ipcRenderer.invoke('monitor:start', leagueId),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  resumeMonitor: () => ipcRenderer.invoke('monitor:resume'),
  getMonitorState: () => ipcRenderer.invoke('monitor:getState'),

  // Eventos do main → renderer
  onLog: (cb) => ipcRenderer.on('log:entry', (_e, entry) => cb(entry)),
  onStateChange: (cb) => ipcRenderer.on('monitor:stateChange', (_e, state) => cb(state)),
  onSessionExpired: (cb) => ipcRenderer.on('auth:sessionExpired', () => cb()),
  onDropPending: (cb) => ipcRenderer.on('drop:pending', (_e, drop) => cb(drop)),
  onDropCollected: (cb) => ipcRenderer.on('drop:collected', (_e, drop) => cb(drop)),
  onLigaDrop: (cb) => ipcRenderer.on('drop:liga', (_e, drop) => cb(drop)),
  onFilterLoaded: (cb) => ipcRenderer.on('filter:loaded', (_e, data) => cb(data)),
  onSnifferHeartbeat: (cb) => ipcRenderer.on('sniffer:heartbeat', (_e, data) => cb(data)),
  onSessionReset: (cb) => ipcRenderer.on('session:reset', () => cb()),
  onStatsUpdate:  (cb) => ipcRenderer.on('stats:update', (_e, data) => cb(data)),
  onStatsAccount: (cb) => ipcRenderer.on('stats:account', (_e, data) => cb(data)),
  onLeagueAutoSelected: (cb) => ipcRenderer.on('monitor:leagueAutoSelected', (_e, data) => cb(data)),
  onBpMode: (cb) => ipcRenderer.on('monitor:bpMode', (_e, data) => cb(data)),
  onBpUnlinked: (cb) => ipcRenderer.on('monitor:bpUnlinked', (_e, data) => cb(data)),
  resetSession: () => ipcRenderer.invoke('monitor:resetSession'),

  // Auto-update
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (_e, data) => cb(data)),
  installUpdate: (filePath) => ipcRenderer.invoke('update:install', filePath),

  // Filtro de itens (admin — leitura do servidor)
  openFilter: () => ipcRenderer.invoke('filter:open'),
  closeFilter: () => ipcRenderer.invoke('filter:close'),
  getFilterItems: () => ipcRenderer.invoke('filter:getItems'),
  getFilterTiers: () => ipcRenderer.invoke('filter:getTiers'),
  getFilterPrefs: () => ipcRenderer.invoke('filter:getPrefs'),
  saveFilterPrefs: (prefs) => ipcRenderer.invoke('filter:savePrefs', prefs),

  // Controles de janela
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winClose:    () => ipcRenderer.send('win:close'),

  // Configurações persistidas
  getCloseBehavior: () => ipcRenderer.invoke('settings:getCloseBehavior'),
  setCloseBehavior: (val) => ipcRenderer.invoke('settings:setCloseBehavior', val),
  getStartup: () => ipcRenderer.invoke('settings:getStartup'),
  setStartup: (val) => ipcRenderer.invoke('settings:setStartup', val),
  getTheme: () => ipcRenderer.invoke('settings:getTheme'),
  setTheme: (val) => ipcRenderer.invoke('settings:setTheme', val),
  getLang: () => ipcRenderer.invoke('settings:getLang'),
  setLang: (val) => ipcRenderer.invoke('settings:setLang', val),
  getOverlayEnabled: () => ipcRenderer.invoke('settings:getOverlayEnabled'),
  setOverlayEnabled: (val) => ipcRenderer.invoke('settings:setOverlayEnabled', val),
  getSatanicDuration: () => ipcRenderer.invoke('settings:getSatanicDuration'),
  setSatanicDuration: (val) => ipcRenderer.invoke('settings:setSatanicDuration', val),
  getVolume: () => ipcRenderer.invoke('settings:getVolume'),
  setVolume: (val) => ipcRenderer.invoke('settings:setVolume', val),
  getLeague: () => ipcRenderer.invoke('settings:getLeague'),
  setLeague: (val) => ipcRenderer.invoke('settings:setLeague', val),

  // Janela compacta
  toggleCompact: () => ipcRenderer.invoke('compact:toggle'),

  // Filtro pessoal (local — controla overlay)
  getPersonalEnabled: () => ipcRenderer.invoke('personal:getEnabled'),
  togglePersonal: (name) => ipcRenderer.invoke('personal:toggle', name),
  setAllPersonal: (names, value) => ipcRenderer.invoke('personal:setAll', names, value),

  // Presets de filtro
  getPresets: () => ipcRenderer.invoke('preset:getAll'),
  savePreset: (name, items) => ipcRenderer.invoke('preset:save', name, items),
  setActivePreset: (name) => ipcRenderer.invoke('preset:setActive', name),
  deletePreset: (name) => ipcRenderer.invoke('preset:delete', name),

  // Relic filter
  getRelics: () => ipcRenderer.invoke('relic:getAll'),
  getRelicEnabled: () => ipcRenderer.invoke('relic:getEnabled'),
  toggleRelic: (name) => ipcRenderer.invoke('relic:toggle', name),
  setAllRelics: (names, value) => ipcRenderer.invoke('relic:setAll', names, value),

  // Bug report
  sendReport: (title, text, imagePath, includeLog) => ipcRenderer.invoke('report:send', { title, text, imagePath, includeLog }),
})
