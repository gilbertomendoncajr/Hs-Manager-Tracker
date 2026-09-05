// ── DOM refs ────────────────────────────────────────────────────────────────
const screenLogin   = document.getElementById('screenLogin')
const screenApp     = document.getElementById('screenApp')
const userBadge     = document.getElementById('userBadge')
const userNameText  = document.getElementById('userNameText')
const btnLogin      = document.getElementById('btnLogin')
const btnLogout     = document.getElementById('btnLogout')
const btnFilter     = document.getElementById('btnFilter')
const leagueSelect  = document.getElementById('leagueSelect')
const btnToggle     = document.getElementById('btnToggleMonitor')
const statusDot     = document.getElementById('statusDot')
const statusText    = document.getElementById('statusText')
const statDrops     = document.getElementById('statDrops')
const statRares     = document.getElementById('statRares')
const dropCount     = document.getElementById('dropCount')
const rareCount     = document.getElementById('rareCount')
const tabMeusBtn    = document.getElementById('tabMeus')
const tabLigaBtn    = document.getElementById('tabLiga')
const cntMeus            = document.getElementById('cntMeus')
const cntLiga            = document.getElementById('cntLiga')
const btnToggleFiltered  = document.getElementById('btnToggleFiltered')
const uaSection     = document.getElementById('uaSection')
const uaBody        = document.getElementById('uaBody')
const uaCount       = document.getElementById('uaCount')
const dropHint      = document.getElementById('dropHint')

// fp → true (só para saber se a linha existe)
const uaMap = new Map()

const RARE_RARITIES = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Blessed', 'Set'])

// per-tab counters
let meusDrops = 0, meusRares = 0       // tab:'meus' detect — my drops (raw, local filter)
let ligaDrops = 0, ligaRares = 0       // tab:'liga' detect — site drops (mine sent + others SSE)
let ligaFilteredCount = 0             // tab:'liga-filtrado' — blocked by ADM
let showFiltered = false              // toggle for ADM-filtered entries in Liga tab

let currentTab = 'meus'
let isMonitoring = false
let isPaused = false

const UA_RARITIES = new Set(['Unholy', 'Angelic'])

// ── Utils ────────────────────────────────────────────────────────────────────
function showScreen(name) {
  screenLogin.classList.toggle('active', name === 'login')
  screenApp.classList.toggle('active',   name === 'app')
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const RARITY_COLORS = {
  Satanic: '#e03030', Set: '#3ec83e', Heroic: '#00d896',
  Angelic: '#f0e040', Unholy: '#d04888', Blessed: '#9b7af0',
}

function rarityFromMsg(message) {
  for (const r of Object.keys(RARITY_COLORS)) {
    if (message.includes(r)) return r
  }
  return null
}

function isEntryVisible(tab) {
  if (tab === 'both') return true
  if (tab === 'liga-filtrado') return currentTab === 'liga' && showFiltered
  return tab === currentTab
}

function updateTabCounts() {
  cntMeus.textContent = meusDrops
  cntLiga.textContent = ligaDrops
}

function updateStatsBar() {
  dropCount.textContent = meusDrops
  rareCount.textContent = collectedCount
  if (btnToggleFiltered) {
    if (currentTab === 'liga' && ligaFilteredCount > 0) {
      btnToggleFiltered.style.display = 'inline-block'
      btnToggleFiltered.textContent = showFiltered
        ? `⊘ ocultar filtrados (${ligaFilteredCount})`
        : `⊘ ver filtrados (${ligaFilteredCount})`
    } else {
      btnToggleFiltered.style.display = 'none'
    }
  }
}

function toggleFiltered() {
  showFiltered = !showFiltered
  document.querySelectorAll('[data-tab="liga-filtrado"]').forEach(el => {
    el.style.display = showFiltered ? '' : 'none'
  })
  updateStatsBar()
  updateEmptyState()
}

function updateEmptyState() {}

function _refreshUaCount() {
  let count = 0
  uaBody.querySelectorAll('tr[data-rarity]').forEach(r => {
    if (UA_RARITIES.has(r.dataset.rarity) && !r.style.display.includes('none')) count++
  })
  uaCount.textContent = count
}

function switchTab(tab) {
  currentTab = tab
  document.body.classList.toggle('tab-liga', tab === 'liga')
  tabMeusBtn.classList.toggle('active', tab === 'meus')
  tabLigaBtn.classList.toggle('active', tab === 'liga')
  // Hide site-filtered rows in Liga tab, show in My Drops tab
  uaBody.querySelectorAll('tr.ua-site-filtered').forEach(r => {
    r.style.display = tab === 'liga' ? 'none' : ''
  })
  _refreshUaCount()
  updateEmptyState()
  updateStatsBar()
  // Show/hide stats bar based on tab
  const hasMon = isMonitoring
  statDrops.style.display = hasMon ? 'flex' : 'none'
  statRares.style.display = hasMon ? 'flex' : 'none'
}

function addLogEntry({ type, message, item, ts, tab = 'both' }) {
  if (type === 'detect') {
    const rarity = item?.rarity || rarityFromMsg(message)
    const isRare = rarity && RARE_RARITIES.has(rarity)
    if (tab === 'meus' || tab === 'both') {
      meusDrops++
      if (isRare) meusRares++
      if (rarity && rarity in rarityCounters) rarityCounters[rarity]++
    }
    if (tab === 'liga' || tab === 'both') {
      ligaDrops++
      if (isRare) ligaRares++
    }
    updateTabCounts()
    updateStatsBar()
    updateStatsTiles()
  } else if (tab === 'liga-filtrado') {
    ligaFilteredCount++
    updateStatsBar()
  }
}

function clearUATable() {
  uaBody.innerHTML = ''
  uaMap.clear()
  uaSection.style.display = 'none'
  uaCount.textContent = '0'
  if (dropHint) dropHint.style.display = 'flex'
}

// ── Stats data ───────────────────────────────────────────────────────────────
const rarityCounters = { Satanic: 0, Set: 0, Heroic: 0, Angelic: 0, Unholy: 0 }
let collectedCount = 0

function updateStatsTiles() {
  const elapsed = _sessionStart ? (Date.now() - _sessionStart) / 3600000 : 0

  const totalEl = document.getElementById('statDropsTotal')
  const rateEl  = document.getElementById('statDropsRate')
  const colEl   = document.getElementById('statCollectedTotal')
  const rateHour = tr('tiles.rateHour')
  if (totalEl) totalEl.textContent = meusDrops
  if (rateEl)  rateEl.textContent  = elapsed > 0.01 ? `${Math.round(meusDrops / elapsed)} ${rateHour}` : `— ${rateHour}`
  if (colEl)   colEl.textContent   = collectedCount

  const maxCount = Math.max(...Object.values(rarityCounters), 1)
  for (const [rarity, count] of Object.entries(rarityCounters)) {
    const cEl = document.getElementById(`rct-${rarity}`)
    const rrEl = document.getElementById(`rrate-${rarity}`)
    const fEl = document.getElementById(`rfill-${rarity}`)
    if (cEl)  cEl.textContent  = count
    if (rrEl) rrEl.textContent = elapsed > 0.01 && count > 0 ? `${Math.round(count / elapsed)} ${rateHour}` : `— ${rateHour}`
    if (fEl)  fEl.style.width  = `${(count / maxCount) * 100}%`
  }
}

function resetStats() {
  for (const k of Object.keys(rarityCounters)) rarityCounters[k] = 0
  collectedCount = 0
  updateStatsTiles()
  // Reset advanced stats UI (data comes from next onStatsUpdate)
  if (typeof _lastStatsData !== 'undefined') {
    _lastStatsData = null
    _itemTimeline.length = 0
    _renderTimeline()
    _updateOverview({ gold: 0, xp: 0, kills: 0 })
    _updateNotable({})
    _updateResources({})
    _updateTallies({})
    _updateSatanic(null)
  }
}

// ── Session timer ────────────────────────────────────────────────────────────
let _timerInterval = null
let _sessionStart  = null
const sessionTimerEl  = document.getElementById('sessionTimer')
const statsBigTimerEl = document.getElementById('statsBigTimer')

function _fmtElapsed(e) {
  const h = Math.floor(e / 3600000)
  const m = Math.floor((e % 3600000) / 60000)
  const s = Math.floor((e % 60000) / 1000)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function startSessionTimer() {
  stopSessionTimer()
  _sessionStart = Date.now()
  _timerInterval = setInterval(() => {
    const e = Date.now() - _sessionStart
    const str = _fmtElapsed(e)
    if (sessionTimerEl)  sessionTimerEl.textContent  = str
    if (statsBigTimerEl) statsBigTimerEl.textContent = str
    updateStatsTiles()
    if (typeof _lastStatsData !== 'undefined' && _lastStatsData) {
      if (typeof _updateOverview === 'function') _updateOverview(_lastStatsData)
    }
  }, 1000)
}

function stopSessionTimer() {
  clearInterval(_timerInterval)
  _timerInterval = null
  _sessionStart  = null
  if (sessionTimerEl)  sessionTimerEl.textContent  = '00:00:00'
  if (statsBigTimerEl) statsBigTimerEl.textContent = '00:00:00'
}

// ── Navigation ───────────────────────────────────────────────────────────────
function navTo(page) {
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))

  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`)
  if (btn) btn.classList.add('active')

  if (page === 'drops' || page === 'liga') {
    const pg = document.getElementById('p-drops')
    if (pg) pg.classList.add('active')
    switchTab(page === 'liga' ? 'liga' : 'meus')
    return
  }

  const pg = document.getElementById(`p-${page}`)
  if (pg) pg.classList.add('active')
}

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => navTo(btn.dataset.page))
})

// ── i18n ─────────────────────────────────────────────────────────────────────
const I18N = {
  pt: {
    'nav.drops': 'Meus Drops', 'nav.liga': 'Liga', 'nav.stats': 'Estatísticas',
    'nav.filter': 'Filtro', 'nav.compact': 'Modo Compacto',
    'nav.config': 'Configurações', 'nav.about': 'Sobre',
    'cfg.account': 'Conta', 'cfg.appearance': 'Aparência', 'cfg.system': 'Sistema',
    'cfg.theme': 'Tema', 'cfg.themeDesc': 'Aparência geral do app',
    'cfg.dark': 'Escuro', 'cfg.light': 'Claro',
    'cfg.lang': 'Idioma',
    'cfg.startup': 'Iniciar com Windows', 'cfg.startupDesc': 'Abre automaticamente ao ligar o PC',
    'cfg.onClose': 'Ao fechar', 'cfg.onCloseDesc': 'O que acontece ao fechar a janela',
    'cfg.tray': 'Bandeja', 'cfg.exit': 'Fechar',
    'cfg.overlay': 'Overlay', 'cfg.showOverlay': 'Mostrar overlay',
    'cfg.showOverlayDesc': 'Exibe drops em tempo real sobre o jogo',
    'hdr.logout': 'Sair',
    'login.desc': 'Faça login com sua conta Discord para sincronizar drops com o HS Manager.',
    'stat.drops': 'drops', 'stat.rares': 'coletados',
    'hdr.rares': 'COLETADOS',
    'btn.start': '▶ INICIAR', 'btn.stop': '■ PAUSAR', 'btn.resume': '▶ RETOMAR',
    'btn.installRestart': 'INSTALAR E REINICIAR',
    'status.idle': 'Aguardando', 'status.monitoring': 'Monitorando',
    'status.waitRelog': 'Aguardando relog...',
    'th.item': 'Item', 'th.dropped': 'Dropou', 'th.collected': 'Coletou',
    'tiles.totalDrops': 'Total de Drops', 'tiles.totalCollected': 'Total Coletados',
    'tiles.itemsCollected': 'itens coletados', 'tiles.rateHour': '/ hora',
    'btn.login': 'Entrar com Discord', 'btn.loginOpening': 'Abrindo Discord...',
    'msg.npcapInstalling': '⚙ Instalando Npcap... Após instalar, clique INICIAR novamente.',
    'empty.line1': 'Nenhuma atividade ainda.', 'empty.line2': 'Selecione uma liga e inicie o monitor.',
    'empty.title': 'Monitor inativo',
    'empty.desc1': 'Selecione uma liga no rodapé',
    'empty.desc2': 'e pressione INICIAR para começar a registrar drops.',
    'empty.cta': 'INICIAR',
    'update.available': '🔄 Nova versão {v} disponível', 'update.downloading': '🔄 Baixando... {p}%',
    'update.ready': '✅ Atualização pronta!', 'update.btn': 'ATUALIZAR', 'update.btnDl': 'BAIXANDO...',
    'update.initial': '🔄 Nova versão disponível...',
    'timer.label': 'TEMPO DE SESSÃO',
    'filter.title': 'Filtro de Itens', 'filter.desc': 'Configure quais itens serão monitorados',
    'filter.openDesc': 'Abra o painel de filtro para gerenciar raridades e itens detectados.',
    'filter.openBtn': 'Abrir Filtro',
    'cfg.title': 'Configurações',
    'nav.status': 'Status',
    'status.title': 'Status da Conexão',
    'status.monitor': 'Monitor', 'status.filter': 'Filtro do Servidor', 'status.char': 'Personagem',
    'status.loading': 'Carregando...', 'status.waitLogin': 'Entre ou relogue no jogo',
    'hint.waitLogin': 'Entre ou relogue no jogo para iniciar o monitoramento',
    'status.active': 'Monitorando', 'status.stopped': 'Parado',
    'status.filterOk': '{n} itens ativos', 'status.charOk': '✓ {name}',
    'status.lastEvt': 'Último evento do sniffer',
  },
  en: {
    'nav.drops': 'My Drops', 'nav.liga': 'League', 'nav.stats': 'Statistics',
    'nav.filter': 'Filter', 'nav.compact': 'Compact Mode',
    'nav.config': 'Settings', 'nav.about': 'About',
    'cfg.account': 'Account', 'cfg.appearance': 'Appearance', 'cfg.system': 'System',
    'cfg.theme': 'Theme', 'cfg.themeDesc': 'Overall app appearance',
    'cfg.dark': 'Dark', 'cfg.light': 'Light',
    'cfg.lang': 'Language',
    'cfg.startup': 'Start with Windows', 'cfg.startupDesc': 'Opens automatically at startup',
    'cfg.onClose': 'On Close', 'cfg.onCloseDesc': 'What happens when you close the window',
    'cfg.tray': 'Tray', 'cfg.exit': 'Quit',
    'cfg.overlay': 'Overlay', 'cfg.showOverlay': 'Show overlay',
    'cfg.showOverlayDesc': 'Displays drops in real time over the game',
    'hdr.logout': 'Sign Out',
    'login.desc': 'Sign in with your Discord account to sync drops with HS Manager.',
    'stat.drops': 'drops', 'stat.rares': 'collected',
    'hdr.rares': 'COLLECTED',
    'btn.start': '▶ START', 'btn.stop': '■ PAUSE', 'btn.resume': '▶ RESUME',
    'btn.installRestart': 'INSTALL AND RESTART',
    'status.idle': 'Waiting', 'status.monitoring': 'Monitoring',
    'status.waitRelog': 'Waiting for relog...',
    'th.item': 'Item', 'th.dropped': 'Dropped', 'th.collected': 'Collected',
    'tiles.totalDrops': 'Total Drops', 'tiles.totalCollected': 'Total Collected',
    'tiles.itemsCollected': 'items collected', 'tiles.rateHour': '/ hr',
    'btn.login': 'Sign in with Discord', 'btn.loginOpening': 'Opening Discord...',
    'msg.npcapInstalling': '⚙ Installing Npcap... After installing, click START again.',
    'empty.line1': 'No activity yet.', 'empty.line2': 'Select a league and start the monitor.',
    'empty.title': 'Monitor inactive',
    'empty.desc1': 'Select a league in the footer',
    'empty.desc2': 'and press START to begin logging drops.',
    'empty.cta': 'START',
    'update.available': '🔄 Version {v} available', 'update.downloading': '🔄 Downloading... {p}%',
    'update.ready': '✅ Update ready!', 'update.btn': 'UPDATE', 'update.btnDl': 'DOWNLOADING...',
    'update.initial': '🔄 New version available...',
    'timer.label': 'SESSION TIME',
    'filter.title': 'Item Filter', 'filter.desc': 'Configure which items will be monitored',
    'filter.openDesc': 'Open the filter panel to manage rarities and detected items.',
    'filter.openBtn': 'Open Filter',
    'cfg.title': 'Settings',
    'nav.status': 'Status',
    'status.title': 'Connection Status',
    'status.monitor': 'Monitor', 'status.filter': 'Server Filter', 'status.char': 'Character',
    'status.loading': 'Loading...', 'status.waitLogin': 'Enter or relog in game',
    'hint.waitLogin': 'Enter or relog in game to start monitoring',
    'status.active': 'Monitoring', 'status.stopped': 'Stopped',
    'status.filterOk': '{n} active items', 'status.charOk': '✓ {name}',
    'status.lastEvt': 'Last sniffer event',
  },
}

let _currentLang = 'pt'
let _charIdentifiedLocal = false

function tr(key) {
  return (I18N[_currentLang] || I18N.pt)[key] || (I18N.pt)[key] || key
}

function applyLang(lang) {
  _currentLang = lang
  const strings = I18N[lang] || I18N.pt
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n
    if (strings[key]) el.textContent = strings[key]
  })
  document.querySelectorAll('.opt-btn[data-lang]').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === lang)
  })
  // Re-apply dynamic texts that depend on monitoring state
  setMonitorUI(isMonitoring, _charIdentifiedLocal)
  updateStatsBar()
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.querySelectorAll('.opt-btn[data-theme-btn]').forEach(b => {
    b.classList.toggle('on', b.dataset.themeBtn === theme)
  })
}

// ── Config interactions ───────────────────────────────────────────────────────
document.querySelectorAll('.opt-btn[data-theme-btn]').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeBtn
    applyTheme(theme)
    window.api.setTheme && window.api.setTheme(theme)
  })
})

document.querySelectorAll('.opt-btn[data-lang]').forEach(btn => {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang
    applyLang(lang)
    window.api.setLang && window.api.setLang(lang)
  })
})

document.querySelectorAll('.opt-btn[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.opt-group').querySelectorAll('.opt-btn').forEach(b => b.classList.remove('on'))
    btn.classList.add('on')
    window.api.setCloseBehavior && window.api.setCloseBehavior(btn.dataset.close)
  })
})

document.querySelectorAll('.cfg-toggle').forEach(tog => {
  if (tog.id === 'togStartup') return  // handled separately with IPC
  tog.addEventListener('click', () => {
    tog.classList.toggle('on')
  })
})

const btnLogoutCfg = document.getElementById('btnLogoutCfg')
if (btnLogoutCfg) btnLogoutCfg.addEventListener('click', () => btnLogout.click())

const btnOpenFilter = document.getElementById('btnOpenFilter')
if (btnOpenFilter) btnOpenFilter.addEventListener('click', () => window.api.openFilter())

// ── Status tab elements ───────────────────────────────────────────────────────
const stMonDot = document.getElementById('st-mon-dot')
const stMonVal = document.getElementById('st-mon-val')
const stFltDot = document.getElementById('st-flt-dot')
const stFltVal = document.getElementById('st-flt-val')
const stChrDot = document.getElementById('st-chr-dot')
const stChrVal = document.getElementById('st-chr-val')
const stEvtDot = document.getElementById('st-evt-dot')
const stEvtVal = document.getElementById('st-evt-val')

let _lastSnifferTs = null
let _heartbeatTimer = null

function _startHeartbeatDisplay() {
  if (_heartbeatTimer) return
  _heartbeatTimer = setInterval(() => {
    if (!stEvtVal || !_lastSnifferTs) return
    const ago = Math.round((Date.now() - _lastSnifferTs) / 1000)
    if (ago < 5) {
      stEvtVal.textContent = '< 5s atrás'
      if (stEvtDot) stEvtDot.className = 'st-dot active'
    } else if (ago < 60) {
      stEvtVal.textContent = `${ago}s atrás`
      if (stEvtDot) stEvtDot.className = ago > 30 ? 'st-dot pending' : 'st-dot active'
    } else {
      const min = Math.round(ago / 60)
      stEvtVal.textContent = `${min}min atrás`
      if (stEvtDot) stEvtDot.className = 'st-dot err'
    }
  }, 1000)
}

if (window.api.onSnifferHeartbeat) {
  window.api.onSnifferHeartbeat(({ ts }) => {
    _lastSnifferTs = ts
    _startHeartbeatDisplay()
  })
}

const NAV_LOCKABLE = ['drops', 'liga', 'stats', 'filtro']

function _setNavLock(locked) {
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    if (NAV_LOCKABLE.includes(btn.dataset.page)) {
      btn.classList.toggle('nav-locked', locked)
    }
  })
}

function _updateStatusTab(watching, charIdentified) {
  if (!stMonDot) return
  if (!watching) {
    stMonDot.className = 'st-dot'
    stMonVal.textContent = tr('status.stopped')
    stFltDot.className = 'st-dot pending'
    stFltVal.textContent = tr('status.loading')
    stChrDot.className = 'st-dot pending'
    stChrVal.textContent = tr('status.waitLogin')
  } else if (!charIdentified) {
    stMonDot.className = 'st-dot active'
    stMonVal.textContent = tr('status.active')
    stChrDot.className = 'st-dot pending'
    stChrVal.textContent = tr('status.waitLogin')
  } else {
    stMonDot.className = 'st-dot active'
    stMonVal.textContent = tr('status.active')
    stChrDot.className = 'st-dot active'
  }
}

function resetSessionData() {
  meusDrops = 0; meusRares = 0
  ligaDrops = 0; ligaRares = 0
  ligaFilteredCount = 0; showFiltered = false
  dropCount.textContent = '0'
  rareCount.textContent = '0'
  cntMeus.textContent = '0'
  cntLiga.textContent = '0'
  statDrops.style.display = 'none'
  statRares.style.display = 'none'
  clearUATable()
  if (btnToggleFiltered) btnToggleFiltered.style.display = 'none'
  resetStats()
}

function setMonitorUI(watching, charIdentified) {
  const wasMonitoring = isMonitoring
  isMonitoring = watching
  _charIdentifiedLocal = charIdentified
  if (!watching) {
    if (wasMonitoring) isPaused = true  // transição monitoring→paused
    // se wasMonitoring=false (ex: applyLang), mantém isPaused como estava
    if (isPaused) {
      btnToggle.textContent = tr('btn.resume')
      btnToggle.className = 'resume'
    } else {
      btnToggle.textContent = tr('btn.start')
      btnToggle.className = 'start'
    }
    btnToggle.disabled = false
    statusDot.className = 'stat idle'
    statusText.textContent = tr('status.idle')
    stopSessionTimer()
    // Dados preservados — só o estado visual muda (pause, não reset)
    _setNavLock(false)
    _lastSnifferTs = null
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
    if (stEvtDot) stEvtDot.className = 'st-dot'
    if (stEvtVal) stEvtVal.textContent = '—'
  } else if (!charIdentified) {
    btnToggle.textContent = tr('btn.stop')
    btnToggle.className = 'stop'
    btnToggle.disabled = false
    statusDot.className = 'stat waiting'
    statusText.textContent = tr('status.waitRelog')
    statDrops.style.display = 'none'
    statRares.style.display = 'none'
    _setNavLock(true)
    navTo('status')
  } else {
    isPaused = false
    btnToggle.textContent = tr('btn.stop')
    btnToggle.className = 'stop'
    btnToggle.disabled = false
    statusDot.className = 'stat watching'
    statusText.textContent = tr('status.monitoring')
    statDrops.style.display = 'flex'
    statRares.style.display = 'flex'
    startSessionTimer()
    _setNavLock(false)
    // Navigate away from status tab now that char is identified
    const activePage = document.querySelector('.page.active')
    if (activePage && activePage.id === 'p-status') navTo('drops')
  }
  _updateStatusTab(watching, charIdentified)
}

// ── Ligas ────────────────────────────────────────────────────────────────────
async function loadLeagues() {
  leagueSelect.innerHTML = '<option value="">Carregando...</option>'
  btnToggle.disabled = true
  const leagues = await window.api.getLeagues()
  leagueSelect.innerHTML = ''

  if (leagues.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Nenhuma liga ativa'
    leagueSelect.appendChild(opt)
    return
  }

  leagues.forEach((l) => {
    const opt = document.createElement('option')
    opt.value = l.id
    opt.textContent = `${l.name} — ${l.guildName}`
    leagueSelect.appendChild(opt)
  })

  if (window.api.getLeague) {
    const saved = await window.api.getLeague()
    if (saved && leagueSelect.querySelector(`option[value="${saved}"]`)) {
      leagueSelect.value = saved
    }
  }

  btnToggle.disabled = false
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function initAuth() {
  const session = await window.api.getSession()
  if (!session) {
    showScreen('login')
    return
  }
  const displayName = session.discordUsername || session.discordId
  userNameText.textContent = displayName
  const cfgUsername = document.getElementById('cfgUsername')
  if (cfgUsername) cfgUsername.textContent = displayName
  userBadge.style.display = 'flex'
  showScreen('app')
  await loadLeagues()
  const state = await window.api.getMonitorState()
  setMonitorUI(state.isMonitoring, state.charIdentified)
}

async function loadSettings() {
  if (!window.api.getTheme) return
  const [theme, lang, startup, closeBehavior] = await Promise.all([
    window.api.getTheme(),
    window.api.getLang(),
    window.api.getStartup(),
    window.api.getCloseBehavior(),
  ])
  applyTheme(theme || 'dark')
  applyLang(lang || 'pt')

  const togStartup = document.getElementById('togStartup')
  if (togStartup) togStartup.classList.toggle('on', !!startup)

  document.querySelectorAll('.opt-btn[data-close]').forEach(b => {
    b.classList.toggle('on', b.dataset.close === (closeBehavior || 'tray'))
  })
}

const togStartupEl = document.getElementById('togStartup')
if (togStartupEl) {
  togStartupEl.addEventListener('click', async () => {
    togStartupEl.classList.toggle('on')
    window.api.setStartup && window.api.setStartup(togStartupEl.classList.contains('on'))
  })
}

btnLogin.addEventListener('click', async () => {
  btnLogin.disabled = true
  btnLogin.textContent = tr('btn.loginOpening')
  const result = await window.api.login()
  if (result.ok) {
    await initAuth()
  } else if (!result.cancelled) {
    btnLogin.textContent = tr('btn.login')
    btnLogin.disabled = false
  } else {
    btnLogin.textContent = tr('btn.login')
    btnLogin.disabled = false
  }
})

btnFilter.addEventListener('click', () => window.api.openFilter())

leagueSelect.addEventListener('change', () => {
  if (window.api.setLeague && leagueSelect.value) {
    window.api.setLeague(leagueSelect.value)
  }
})

btnLogout.addEventListener('click', async () => {
  await window.api.logout()
  userBadge.style.display = 'none'
  isPaused = false
  resetSessionData()
  setMonitorUI(false)
  showScreen('login')
  btnLogin.textContent = tr('btn.login')
  btnLogin.disabled = false
})

// ── Monitor ──────────────────────────────────────────────────────────────────
btnToggle.addEventListener('click', async () => {
  if (isMonitoring) {
    await window.api.stopMonitor()
  } else if (isPaused) {
    btnToggle.disabled = true
    await window.api.resumeMonitor()
    btnToggle.disabled = false
  } else {
    const leagueId = leagueSelect.value
    if (!leagueId) return
    btnToggle.disabled = true
    const result = await window.api.startMonitor(parseInt(leagueId))
    btnToggle.disabled = false
    if (result.needsNpcap) {
      const install = confirm(_currentLang === 'en'
        ? 'Npcap must be installed to capture packets.\n\nInstall it now?'
        : 'O Npcap precisa estar instalado para capturar pacotes.\n\nDeseja instalar agora?')
      if (install) {
        await window.api.installNpcap()
        addLogEntry({ type: 'info', message: tr('msg.npcapInstalling'), ts: Date.now() })
      }
    } else if (!result.ok) {
      addLogEntry({ type: 'error', message: result.error, ts: Date.now() })
    }
  }
})

// ── Eventos do main ──────────────────────────────────────────────────────────
window.api.onLog((entry) => addLogEntry(entry))
if (window.api.onSessionReset) window.api.onSessionReset(() => resetSessionData())
window.api.onStateChange((state) => {
  setMonitorUI(state.isMonitoring, state.charIdentified)
  if (state.charIdentified && state.charName && stChrVal) {
    stChrVal.textContent = tr('status.charOk').replace('{name}', state.charName)
  }
})
window.api.onFilterLoaded((data) => {
  if (!stFltDot) return
  stFltDot.className = 'st-dot active'
  stFltVal.textContent = tr('status.filterOk').replace('{n}', data.count)
})
window.api.onSessionExpired(() => {
  userBadge.style.display = 'none'
  isPaused = false
  setMonitorUI(false)
  showScreen('login')
  btnLogin.textContent = tr('btn.login')
  btnLogin.disabled = false
})


// ── Auto-update ──────────────────────────────────────────────────────────────
const updateBanner     = document.getElementById('updateBanner')
const updateText       = document.getElementById('updateText')
const updateProgress   = document.getElementById('updateProgress')
const updateBar        = document.getElementById('updateBar')
const btnInstallUpdate = document.getElementById('btnInstallUpdate')

let pendingFilePath = null

window.api.onUpdateAvailable((info) => {
  updateBanner.style.display = 'flex'
  updateText.textContent = tr('update.available').replace('{v}', info.version)
  btnInstallUpdate.textContent = tr('update.btn')
  btnInstallUpdate.style.display = 'block'
  btnInstallUpdate.disabled = false
  btnInstallUpdate.onclick = async () => {
    btnInstallUpdate.disabled = true
    btnInstallUpdate.textContent = tr('update.btnDl')
    updateProgress.style.display = 'block'
    await window.api.downloadUpdate()
  }
})

window.api.onUpdateProgress((data) => {
  updateBar.style.width = `${data.percent}%`
  updateText.textContent = tr('update.downloading').replace('{p}', data.percent)
})

window.api.onUpdateReady((data) => {
  pendingFilePath = data.filePath
  updateBar.style.width = '100%'
  updateText.textContent = tr('update.ready')
  updateProgress.style.display = 'none'
  btnInstallUpdate.disabled = false
  btnInstallUpdate.textContent = tr('btn.installRestart')
  btnInstallUpdate.onclick = () => window.api.installUpdate(pendingFilePath)
})

// ── Tabs ─────────────────────────────────────────────────────────────────────
tabMeusBtn.addEventListener('click', () => switchTab('meus'))
tabLigaBtn.addEventListener('click', () => switchTab('liga'))
if (btnToggleFiltered) btnToggleFiltered.addEventListener('click', toggleFiltered)

// ── Tabela Unholy / Angelic ──────────────────────────────────────────────────
function _addPendingRow(drop, collected = false) {
  const color = RARITY_COLORS[drop.rarity] || 'var(--text)'
  const safeId = (drop.fp || '').replace(/[^a-zA-Z0-9-]/g, '_')
  const row = document.createElement('tr')
  row.dataset.fp = drop.fp
  row.dataset.rarity = drop.rarity || ''
  if (collected) row.classList.add('collected')
  const tierPart = drop._tierTag || ''
  const catPart = drop._category ? `<span class="ua-cat">${drop._category}</span>` : ''
  const iconHtml = drop._iconPath ? `<img class="ua-item-icon" src="${drop._iconPath}" onerror="this.style.display='none'" alt="">` : ''
  const playerPart = drop._charDisplay ? `<span class="ua-player">${drop._charDisplay}</span>` : ''
  row.innerHTML = `
    <td class="ua-name" style="color:${color}">${iconHtml}${drop.name}${tierPart}${catPart}${playerPart}</td>
    <td class="ua-time">${fmtTime(drop.ts_ms)}</td>
    <td class="ua-collect" id="ua-c-${safeId}">${collected ? fmtTime(drop.ts_ms) : '⏳'}</td>
  `
  if (collected) row.querySelector('.ua-collect').classList.add('done')
  uaBody.insertBefore(row, uaBody.firstChild)
  uaMap.set(drop.fp, safeId)
  uaSection.style.display = 'block'
  if (dropHint) dropHint.style.display = 'none'
  uaCount.textContent = uaBody.children.length

  // Incrementar contadores de MEUS DROPS
  const isRare = drop.rarity && RARE_RARITIES.has(drop.rarity)
  meusDrops++
  if (isRare) meusRares++
  updateTabCounts()
  updateStatsBar()
}

window.api.onDropPending((drop) => {
  _addPendingRow(drop, false)
  if (drop._siteFiltered) {
    const row = uaBody.querySelector(`[data-fp="${CSS.escape(drop.fp)}"]`)
    if (row) {
      row.classList.add('ua-site-filtered')
      if (currentTab === 'liga') row.style.display = 'none'
    }
  }
  _refreshUaCount()
})

window.api.onDropCollected((drop) => {
  collectedCount++
  updateStatsTiles()
  const safeId = uaMap.get(drop.fp)
  if (safeId) {
    // Item tinha floor_drop → atualiza linha existente
    const cell = document.getElementById(`ua-c-${safeId}`)
    if (cell) {
      cell.textContent = fmtTime(drop.ts_ms)
      cell.classList.add('done')
    }
    const row = uaBody.querySelector(`[data-fp="${CSS.escape(drop.fp)}"]`)
    if (row) {
      row.classList.add('collected')
      if (drop._siteFiltered) {
        row.classList.add('ua-site-filtered')
        if (currentTab === 'liga') row.style.display = 'none'
      }
    }
  } else {
    // Missed floor → adiciona linha já como coletada
    _addPendingRow(drop, true)
    if (drop._siteFiltered) {
      const row = uaBody.querySelector(`[data-fp="${CSS.escape(drop.fp)}"]`)
      if (row) {
        row.classList.add('ua-site-filtered')
        if (currentTab === 'liga') row.style.display = 'none'
      }
    }
  }
  _refreshUaCount()
})

// ── Stats avançados (gold/xp/kills/tallies/resources/notable/satanic) ────────
const RARITY_COLOR_MAP = {
  Satanic: 'var(--satanic)', Angelic: 'var(--angelic)',
  Unholy: 'var(--unholy)', Heroic: 'var(--heroic)',
  Set: 'var(--set)', Blessed: '#9c6', Mythic: '#fa0',
  Rare: '#62a', Superior: '#888', Common: 'var(--text3)',
}

// Tally label map (normalised key → display label)
const TALLY_LABELS = {
  // bosses
  andariel: 'Andariel', duriel: 'Duriel', mephisto: 'Mephisto',
  diablo: 'Diablo', baal: 'Baal', nihlathak: 'Nihlathak',
  uber_diablo: 'Uber Diablo', uber_duriel: 'Uber Duriel',
  uber_mephisto: 'Uber Mephisto', uber_baal: 'Uber Baal',
  uber_andariel: 'Uber Andariel', uber_izual: 'Uber Izual',
  uber_nihlathak: 'Uber Nihlathak',
  // chests
  superchest: 'Super Chest', goodchest: 'Good Chest', actboss: 'Act Boss',
  chests: 'Baú', horadric: 'Horadric', larzuk: 'Larzuk',
}

// Last received stats payload — used by timer to refresh rates
let _lastStatsData = null

// Boss / chest classification by tally key
function _tallyGroup(k) {
  const boss = ['andariel','duriel','mephisto','diablo','baal','nihlathak',
    'uber_diablo','uber_duriel','uber_mephisto','uber_baal','uber_andariel',
    'uber_izual','uber_nihlathak', 'actboss']
  return boss.includes(k) ? 'boss' : 'chest'
}

// Format large numbers
function _fmtNum(n) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n/1_000).toFixed(1)}k`
  return String(n)
}

function _hourRate(count, elapsedHours) {
  if (elapsedHours < 0.01 || count === 0) return '— / hora'
  return `${_fmtNum(Math.round(count / elapsedHours))} / hora`
}

// Item timeline data
const _itemTimeline = []

function _updateOverview(data) {
  const elapsed = _sessionStart ? (Date.now() - _sessionStart) / 3600000 : 0

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }

  set('sovGold',      _fmtNum(data.gold || 0))
  set('sovGoldRate',  _hourRate(data.gold || 0, elapsed))
  set('sovXp',        _fmtNum(data.xp || 0))
  set('sovXpRate',    _hourRate(data.xp || 0, elapsed))
  set('sovKills',     _fmtNum(data.kills || 0))
  set('sovKillsRate', _hourRate(data.kills || 0, elapsed))
  set('sovSessionRate', _hourRate(collectedCount, elapsed))
}

function _updateNotable(notable) {
  const el = document.getElementById('notableList')
  if (!el) return
  const entries = Object.entries(notable || {}).filter(([,v]) => v > 0)
  if (!entries.length) {
    el.innerHTML = '<div class="stats-kv-empty">Nenhum item notable ainda</div>'
    return
  }
  el.innerHTML = entries.map(([name, count]) =>
    `<div class="stats-kv-row"><span class="stats-kv-name">${name}</span><span class="stats-kv-val">${count}</span></div>`
  ).join('')
}

function _updateResources(resources) {
  const el = document.getElementById('resourceList')
  if (!el) return
  const entries = Object.entries(resources || {}).filter(([,v]) => v > 0)
    .sort((a,b) => b[1]-a[1])
  if (!entries.length) {
    el.innerHTML = '<div class="stats-kv-empty">Nenhum resource ainda</div>'
    return
  }
  el.innerHTML = entries.map(([rarity, count]) => {
    const col = RARITY_COLOR_MAP[rarity] || 'var(--text)'
    return `<div class="stats-kv-row"><span class="stats-kv-name" style="color:${col}">${rarity}</span><span class="stats-kv-val">${count}</span></div>`
  }).join('')
}

function _updateTallies(tallies) {
  const el = document.getElementById('tallyGrid')
  if (!el) return
  const entries = Object.entries(tallies || {}).filter(([,v]) => v > 0)
    .sort((a,b) => b[1]-a[1])
  if (!entries.length) {
    el.innerHTML = '<div class="stats-kv-empty">Aguardando dados…</div>'
    return
  }
  const bossColor = 'var(--satanic)'
  const chestColor = 'var(--heroic)'
  el.innerHTML = entries.map(([k, count]) => {
    const label = TALLY_LABELS[k] || k.replace(/_/g,' ')
    const col = _tallyGroup(k) === 'boss' ? bossColor : chestColor
    return `<div class="stats-tally-card"><span class="stc-name" style="color:${col}">${label}</span><span class="stc-val">${count}</span></div>`
  }).join('')
}

function _updateSatanic(satanic) {
  const el = document.getElementById('satanicZoneBlock')
  if (!el) return
  if (!satanic || !satanic.zone) {
    el.innerHTML = '<div class="satanic-none">Nenhuma Satanic Zone ativa</div>'
    return
  }
  const buffTags  = (satanic.buffs  || []).map(b => `<span class="szb-tag buff">${b}</span>`).join('')
  const debufTags = (satanic.debuffs || []).map(d => `<span class="szb-tag debuf">${d}</span>`).join('')
  el.innerHTML = `
    <div class="satanic-zone-block">
      <div class="szb-name">${satanic.zone}</div>
      <div class="szb-tags">${buffTags}${debufTags}${(!buffTags && !debufTags) ? '<span class="stats-kv-empty">Sem buffs/debuffs</span>' : ''}</div>
    </div>`
}

function _addToTimeline(drop) {
  const HEROIC_PLUS = new Set(['Satanic','Angelic','Unholy','Heroic'])
  if (!HEROIC_PLUS.has(drop.rarity)) return
  _itemTimeline.unshift({ name: drop.name, rarity: drop.rarity, ts_ms: drop.ts_ms || Date.now() })
  if (_itemTimeline.length > 50) _itemTimeline.pop()
  _renderTimeline()
}

function _renderTimeline() {
  const el = document.getElementById('itemTimeline')
  if (!el) return
  if (!_itemTimeline.length) {
    el.innerHTML = '<div class="stl-empty">Nenhum item Heroic+ ainda</div>'
    return
  }
  const sessionStartMs = _sessionStart || Date.now()
  el.innerHTML = _itemTimeline.slice(0, 30).map(item => {
    const elapsedSec = Math.floor((item.ts_ms - sessionStartMs) / 1000)
    const h = Math.floor(elapsedSec / 3600)
    const m = Math.floor((elapsedSec % 3600) / 60)
    const s = elapsedSec % 60
    const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    const col = RARITY_COLOR_MAP[item.rarity] || 'var(--text)'
    return `<div class="stl-row">
      <span class="stl-time">${timeStr}</span>
      <span class="stl-rarity" style="color:${col}">${item.rarity}</span>
      <span class="stl-name">${item.name}</span>
    </div>`
  }).join('')
}

// Stats update handler
if (window.api.onStatsUpdate) {
  window.api.onStatsUpdate((data) => {
    _lastStatsData = data
    _updateOverview(data)
    _updateNotable(data.notable)
    _updateResources(data.resources)
    _updateTallies(data.tallies)
    _updateSatanic(data.satanic)
  })
}

// Register second listener for timeline (IPC allows multiple listeners)
if (window.api.onDropCollected) {
  window.api.onDropCollected((drop) => { _addToTimeline(drop) })
}

// ── Window controls ──────────────────────────────────────────────────────────
const btnWinMinimize = document.getElementById('btnWinMinimize')
const btnWinClose    = document.getElementById('btnWinClose')
if (btnWinMinimize) btnWinMinimize.addEventListener('click', () => window.api.winMinimize())
if (btnWinClose)    btnWinClose.addEventListener('click',    () => window.api.winClose())

const btnCompact = document.getElementById('btnCompact')
if (btnCompact) {
  btnCompact.addEventListener('click', async () => {
    // Main window will be hidden by main.js — no toggle needed here
    await window.api.toggleCompact()
  })
}

// ── Init ─────────────────────────────────────────────────────────────────────
loadSettings()
initAuth()
