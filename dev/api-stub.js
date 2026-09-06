// Stub de window.api para abrir index-v2.html num navegador comum (sem Electron).
// Só é carregado quando o preload não injetou window.api. Não vai para o build.
(function () {
  if (window.api) return
  const noop = () => {}
  const resolved = (v) => () => Promise.resolve(v)
  const listeners = {}
  const on = (name) => (cb) => { listeners[name] = cb }

  window.api = {
    login: resolved({ ok: true, user: { username: 'gilbertomendonca' } }),
    logout: resolved(true),
    getSession: resolved({ username: 'gilbertomendonca' }),
    getLeagues: resolved([
      { id: 1, name: "Caramelo's BP SS2 — Caramelos Enterprise Season Two Extended" },
      { id: 2, name: 'Blood Pact Hardcore' },
    ]),
    installNpcap: resolved(true),
    startMonitor: resolved(true),
    stopMonitor: resolved(true),
    getMonitorState: resolved({ watching: false, charIdentified: false }),
    onLog: on('log'),
    onStateChange: on('state'),
    onSessionExpired: on('expired'),
    onDropPending: on('pending'),
    onDropCollected: on('collected'),
    onFilterLoaded: on('filter'),
    onSnifferHeartbeat: on('heartbeat'),
    onUpdateAvailable: on('updAvail'),
    downloadUpdate: resolved(true),
    onUpdateProgress: on('updProg'),
    onUpdateReady: on('updReady'),
    installUpdate: resolved(true),
    openFilter: resolved(true),
    closeFilter: resolved(true),
    getFilterItems: resolved([]),
    getFilterPrefs: resolved({}),
    saveFilterPrefs: resolved(true),
    winMinimize: noop,
    winClose: noop,
    getCloseBehavior: resolved('tray'),
    setCloseBehavior: resolved(true),
    getStartup: resolved(false),
    setStartup: resolved(true),
    getTheme: resolved('dark'),
    setTheme: resolved(true),
    getLang: resolved('pt'),
    setLang: resolved(true),
    toggleCompact: resolved(true),
    getPersonalEnabled: resolved({}),
    togglePersonal: resolved(true),
    setAllPersonal: resolved(true),
  }

  // Helpers para simular eventos pelo console: window.__sim.drop(), .log(), .state()
  const RAR = ['Satanic', 'Set', 'Heroic', 'Angelic', 'Unholy']
  let n = 0
  window.__sim = {
    emit: (name, payload) => listeners[name] && listeners[name](payload),
    state: (watching = true, charIdentified = true) =>
      window.__sim.emit('state', { watching, charIdentified }),
    filter: (count = 276) => window.__sim.emit('filter', { count }),
    log: (message = 'Personagem identificado: SkibiGSF — monitorando drops!', type = 'ok') =>
      window.__sim.emit('log', { ts: Date.now(), message, type, tab: 'both' }),
    drop: (name, rarity, opts = {}) => {
      n++
      const d = {
        fp: 'fp' + n,
        name: name || ['Rift Warrior\'s Skull', 'Ice Howl\'s Cuirass', 'Dante\'s Demon Blade',
          'Soulreplenish Pendant of the Everlasting Midnight Sovereign [C]'][n % 4],
        rarity: rarity || RAR[n % RAR.length],
        ts_ms: Date.now(),
        _tierTag: opts.tier || '',
        _category: opts.category || ['Amulet', 'Armor', 'Weapon', 'Boots'][n % 4],
        _siteFiltered: !!opts.filtered,
      }
      window.__sim.emit('pending', d)
      return d
    },
    collect: (d) => window.__sim.emit('collected', d),
    fill: (count = 40) => { for (let i = 0; i < count; i++) window.__sim.drop() },
    update: () => window.__sim.emit('updAvail', { version: '2.0.0' }),
  }
})()
