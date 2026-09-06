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
const dropHintTitle = document.getElementById('dropHintTitle')
const dropHintSub   = document.getElementById('dropHintSub')
const dropHintArrowLabel = document.getElementById('dropHintArrowLabel')

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

function updateDropHint() {
  if (!dropHint) return
  if (uaBody && uaBody.children.length > 0) {
    dropHint.style.display = 'none'
    return
  }
  dropHint.style.display = 'flex'
  if (!isMonitoring) {
    dropHint.dataset.state = 'inactive'
    if (dropHintTitle) dropHintTitle.textContent = tr('empty.inactive')
    if (dropHintSub) dropHintSub.textContent = ''
    if (dropHintArrowLabel) dropHintArrowLabel.textContent = tr('empty.cta')
  } else if (!_charIdentifiedLocal) {
    dropHint.dataset.state = 'login'
    if (dropHintTitle) dropHintTitle.textContent = tr('empty.waitChar')
    if (dropHintSub) dropHintSub.textContent = tr('status.waitLogin')
  } else {
    dropHint.dataset.state = 'monitoring'
    if (dropHintTitle) dropHintTitle.textContent = tr('empty.monitoring')
    if (dropHintSub) dropHintSub.textContent = _charNameLocal || ''
  }
}

function clearUATable() {
  uaBody.innerHTML = ''
  uaMap.clear()
  uaSection.style.display = 'none'
  uaCount.textContent = '0'
  updateDropHint()
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
    'empty.title': 'Monitor inativo', 'empty.cta': 'INICIAR',
    'empty.inactive': 'Monitor inativo', 'empty.waitChar': 'Aguardando personagem', 'empty.monitoring': 'Monitorando',
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
    'empty.title': 'Monitor inactive', 'empty.cta': 'START',
    'empty.inactive': 'Monitor inactive', 'empty.waitChar': 'Awaiting character', 'empty.monitoring': 'Monitoring',
    'status.active': 'Monitoring', 'status.stopped': 'Stopped',
    'status.filterOk': '{n} active items', 'status.charOk': '✓ {name}',
    'status.lastEvt': 'Last sniffer event',
  },
}

let _currentLang = 'pt'
let _charIdentifiedLocal = false
let _charNameLocal = null

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
  updateDropHint()
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

  if (displayName === 'gilbertomendonca') {
    _initDebugLog()
  }

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
window.api.onLog((entry) => {
  addLogEntry(entry)
  _pushDebugLog(entry)
})
if (window.api.onSessionReset) window.api.onSessionReset(() => resetSessionData())
window.api.onStateChange((state) => {
  if (state.charName) _charNameLocal = state.charName
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
  if (drop.rarity && drop.rarity in rarityCounters) rarityCounters[drop.rarity]++
  updateTabCounts()
  updateStatsBar()
  updateStatsTiles()
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

// Tally label map — keys are _norm_tally() output (statistic prefix stripped,
// all non-alphanumeric removed, lowercased). Matches hs-tracker TALLIES table.
const TALLY_LABELS = {
  // main bosses
  satankills: 'Satan',        damienkills: 'Damien',
  reaperkills: 'Reaper',      anubiskills: 'Anubis',
  guragkills: 'Gurag',        meviuskills: 'Mevius',
  odinkills: 'Odin',          cthulhukills: 'Cthulhu',
  karpkingkills: 'Karp King',
  // uber bosses
  uberdamienkills: 'Uber Damien',           uberreaperkills: 'Uber Reaper',
  uberlunakills: 'Uber Luna',               uberendrixiakills: 'Uber Endrixia',
  ubergabrielkills: 'Uber Gabriel',         uberkingrakhulkills: 'Uber King Rakhul',
  ubersheepkingkills: 'Uber Sheep King',    ubersungleekills: 'Uber Sung Lee',
  uberamunrakills: 'Uber Amun Ra',          uberarchitectkills: 'Uber Architect',
  uberpapalegbakills: 'Uber Papa Legba',    ubercaptaingrimtidekills: 'Uber Grimtide',
  uberbloodmaidenkills: 'Uber Blood Maiden',
  uberphantomleviathankills: 'Uber Leviathan',
  uberchaostowerkills: 'Uber Chaos Tower',
  // clears
  chaostowerfloorclears: 'CT Floors',  wormholeclears: 'Wormholes',
  // chests
  commonchestsopened: 'Common',  rarechestopened: 'Rare',
  crystalchestopened: 'Crystal', rubychestsopened: 'Ruby',
  dungeonchestsopened: 'Dungeon',
}

// Last received stats payload — used by timer to refresh rates
let _lastStatsData = null

// Boss / chest / clear classification by normalized tally key
function _tallyGroup(k) {
  if (k.endsWith('kills')) return 'boss'
  if (k.endsWith('clears')) return 'clear'
  return 'chest'
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

// Fixed notable groups — always rendered even when 0
const NOTABLE_FIXED = [
  { label: 'Angelic Key',       keys: ['angelic key'] },
  { label: 'Satanic Dice',      keys: ['satanic dice'] },
  { label: "Prophet's Wisdom",  keys: ["prophet's wisdom"] },
  { label: 'S Runes',  keys: ['qi','xo','sur','ber','jah','drax','zed'] },
  { label: 'SS Runes', keys: ['fawn','flo','nju','jol','sus','kek','jord'] },
]

function _updateNotable(notable) {
  const el = document.getElementById('notableList')
  if (!el) return
  const low = {}
  for (const [k, v] of Object.entries(notable || {})) low[k.toLowerCase()] = v
  el.innerHTML = `<div class="stc-group">${NOTABLE_FIXED.map(g => {
    const count = g.keys.reduce((s, k) => s + (low[k] || 0), 0)
    return `<div class="stc-card">
      <span class="stc-count" style="color:var(--angelic)">${count}</span>
      <span class="stc-label">${g.label}</span>
    </div>`
  }).join('')}</div>`
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

const _TALLY_BOSSES = [
  'satankills','damienkills','reaperkills','anubiskills','guragkills','meviuskills',
  'odinkills','cthulhukills','karpkingkills',
  'uberdamienkills','uberreaperkills','uberlunakills','uberendrixiakills',
  'ubergabrielkills','uberkingrakhulkills','ubersheepkingkills','ubersungleekills',
  'uberamunrakills','uberarchitectkills','uberpapalegbakills','ubercaptaingrimtidekills',
  'uberbloodmaidenkills','uberphantomleviathankills','uberchaostowerkills',
]
const _TALLY_CHESTS = ['commonchestsopened','rarechestopened','crystalchestopened','rubychestsopened','dungeonchestsopened']
const _TALLY_CLEARS = ['chaostowerfloorclears','wormholeclears']

function _updateTallies(tallies) {
  const el = document.getElementById('tallyGrid')
  if (!el) return
  const t = tallies || {}
  const renderGroup = (keys, col) => keys.map(k =>
    `<div class="stc-card">
      <span class="stc-count" style="color:${col}">${t[k] || 0}</span>
      <span class="stc-label">${TALLY_LABELS[k]}</span>
    </div>`
  ).join('')
  el.innerHTML =
    `<div class="stc-group-label">BOSSES</div><div class="stc-group">${renderGroup(_TALLY_BOSSES, 'var(--satanic)')}</div>` +
    `<div class="stc-group-label">BAÚS</div><div class="stc-group">${renderGroup(_TALLY_CHESTS, 'var(--heroic)')}</div>` +
    `<div class="stc-group-label">CLEARS</div><div class="stc-group">${renderGroup(_TALLY_CLEARS, 'var(--angelic)')}</div>`
}

// Buff/debuff decode tables — sourced from hs-tracker buffs.js
const SATANIC_BUFFS = {
  1:  ['Loot Goblin I',      '+1 Max Loot por Inimigo Morto'],
  2:  ['Loot Goblin II',     '+2 Max Loot por Inimigo Morto'],
  3:  ['Rune Master',        '+15% Chance de Drop de Runas'],
  4:  ['Gold Hunger',        '+40% Ouro de Monstros Mortos'],
  5:  ['Heroic Windfall',    '+3% Chance de Drop Heroic'],
  6:  ['Angelic Fortune',    '+25% Chance de Drop Angelic'],
  7:  ["Zephy's Grace",      '+50% Velocidade de Movimento'],
  8:  ['Fury of Tempest',    '+60% Velocidade de Ataque'],
  9:  ['Rapid Casting',      '+60% Velocidade de Conjuração'],
  10: ['Onslaught',          '+100% Dano de Ataque'],
  11: ['Nether Surge',       '+40% Dano de Magia'],
  12: ['Relic Keepers',      '2% Chance de Relic ao Matar Ancião'],
  13: ["Goblin's Greed",     '0.5% Chance de Goblin do Tesouro'],
  14: ['Artifact Digger',    '+55% Magic Find'],
  15: ['Artifact Seeker',    '+110% Magic Find'],
  16: ['Artifact Excavator', '+170% Magic Find'],
  17: ['Recruit',            '+10% Ganho de XP'],
  18: ['Combat Training',    '+15% Ganho de XP'],
  19: ['Battle Scarred',     '+20% Ganho de XP'],
  20: ['Clairvoyance',       '+100% em toda recuperação'],
  21: ['Aftermath',          '3% Chance de Invocar Legião na Morte'],
  22: ['Deep Cuts',          '+200% Dano de Golpe Crítico'],
  23: ['Old Town',           '+15% Chance de Packs Antigos'],
  24: ['Terror Zone',        '+25% Chance de Packs Antigos'],
  25: ['Fields of Carnage',  '+30% Chance de Packs Antigos'],
}
const SATANIC_DEBUFFS = [
  ["Dusk's Shroud",      '-20% Raio de Luz'],
  ['Elemental Erosion',  '-75% Todas as Resistências'],
  ['Sundered Armor',     '+25% Dano Recebido'],
  ['Vitality Drain',     '-25% Vida'],
  ['Essence Drain',      '-25% Mana'],
  ['Abyssal Gloom',      '+100% Escuridão'],
  ['Skill Debilitation', '-10% Todas as Skills'],
  ['Weakening Essence',  '-20% Todos os Atributos'],
  ['Lifeflow Starvation','Regeneração reduzida'],
  ['Sanguine Impairment','-75% Roubo de Vida'],
  ['Arcane Impairment',  '-75% Roubo de Mana'],
  ['Consumed Time',      '-25% Recuperação de Cooldown'],
  ['Absolute Limbo',     '-50% Recuperação de Cooldown'],
  ['Boulder Fall',       '3% Chance de Boulder na Morte'],
  ['Lingering Evil',     '-25% Velocidade de Movimento'],
  ['Fatal Wounds',       '10% Chance de Dano Duplo dos Monstros'],
  ['Bloated Veins',      '+70% Vida dos Monstros'],
  ['Abnormal Dwelling',  '+130% Vida dos Monstros'],
  ['Colossal Bloating',  '+200% Vida dos Monstros'],
  ['Necrosis',           '1% de Vida drenada por segundo'],
  ['Venomous Presence',  '+200% Duração de Veneno'],
  ['Flaming Agony',      'Nova de Fogo na morte dos monstros'],
  ['Unholy Agility',     'Monstros mais rápidos e agressivos'],
  ['Broken Armor',       'Você não pode bloquear ataques'],
  ['Hemorrhage',         'Ataques de monstros causam sangramento'],
  ['Crippling Slow',     'Ataques infligem 50% de lentidão'],
]

// Zone area names sourced from hs-tracker buffs.js ZONES table
const ZONE_AREAS = {
  1: ['Outskirts of Inoya', 'Fields of Battle', 'The Pumpkin Patch', 'Woodhill Plains', "King's Garden", 'Witching River'],
  2: ['Crystal Village', 'Chilling Lake', 'Arctic Tundra', 'Snowy Mountains', 'The Glacial Trail'],
  3: ['Corrupted Oasis', 'Dry Hills', "Mos'Arathim Desert", 'Pyramid Level 1', 'Pyramid Level 2', 'Curacan Hollow'],
  4: ['Old Mining Village', 'The Highland Mines', 'Corrupted Cave', 'The Nightmare', "The Devil's Breach"],
  5: ['Mt. Fuji', 'Misty Swamp', 'Fuji Coast', 'Sea of Karponia', 'Temple of Zamjo'],
  6: ['Highland Graveyard', 'The Cathedral', 'Prison Dungeon', 'Steam Train', 'The Depths of Hell'],
  7: ['Deep Space', 'Event Horizon', 'The Black Hole', 'Parallel Dimension', 'Subconscious Mind', 'Shattered Realm'],
  8: ['Forest of the Slain', 'Flooded Plains', 'Forgotten Caves', 'Camp of Souls', 'Helheim'],
  9: ['Abyss Jungle', 'Shipwreck Cove', 'Tormented Reef', 'Boreal Island', 'Volcanic Island', 'Abyss Realm'],
}

// Parses zone codes like "Satanic_5_5", "Act_08_02", "SZ_8_2" — the prefix is ignored,
// only the act number (second segment) and area index (third) matter.
function _fmtZoneName(raw) {
  const parts = String(raw).split('_')
  if (parts.length >= 3) {
    const act = parseInt(parts[parts.length - 2], 10)
    const idx = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(act) && !isNaN(idx) && act > 0) {
      const areas = ZONE_AREAS[act]
      if (areas && idx >= 1 && idx <= areas.length) return `Act ${act} — ${areas[idx - 1]}`
      return `Act ${act} — Área ${idx}`
    }
  }
  return String(raw)
}

function _updateSatanic(satanic) {
  const el = document.getElementById('satanicZoneBlock')
  if (!el) return
  if (!satanic || !satanic.zone) {
    el.innerHTML = '<div class="satanic-none">Nenhuma Satanic Zone ativa</div>'
    return
  }
  const zoneName = _fmtZoneName(satanic.zone)
  const buffIds   = satanic.buffs   || []
  const debuffIds = satanic.debuffs || []

  const renderBuff = (id) => {
    const b = SATANIC_BUFFS[id]
    const name = b ? b[0] : `Buff ${id}`
    const desc = b ? b[1] : ''
    return `<div class="szb-mod">
      <img class="szb-icon" src="assets/icons/buffs/${id}.png" alt="" onerror="this.style.display='none'">
      <div class="szb-mod-text">
        <div class="szb-mod-name pros">${name}</div>
        ${desc ? `<div class="szb-mod-desc">${desc}</div>` : ''}
      </div>
    </div>`
  }
  const renderDebuff = (id) => {
    const d = SATANIC_DEBUFFS[id - 1]
    const name = d ? d[0] : `Debuff ${id}`
    const desc = d ? d[1] : ''
    return `<div class="szb-mod">
      <div class="szb-mod-text">
        <div class="szb-mod-name cons">${name}</div>
        ${desc ? `<div class="szb-mod-desc">${desc}</div>` : ''}
      </div>
    </div>`
  }

  const prosHtml = buffIds.length
    ? buffIds.map(renderBuff).join('')
    : '<div class="szb-mod-empty">—</div>'
  const consHtml = debuffIds.length
    ? debuffIds.map(renderDebuff).join('')
    : '<div class="szb-mod-empty">—</div>'

  el.innerHTML = `
    <div class="satanic-zone-block">
      <div class="szb-name">${zoneName}</div>
      <div class="szb-cols">
        <div class="szb-col">
          <div class="szb-col-label pros">PROS</div>
          ${prosHtml}
        </div>
        <div class="szb-col">
          <div class="szb-col-label cons">CONS</div>
          ${consHtml}
        </div>
      </div>
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

if (window.api.onLeagueAutoSelected) {
  window.api.onLeagueAutoSelected(({ leagueId, leagueName, charName }) => {
    const opt = leagueSelect.querySelector(`option[value="${leagueId}"]`)
    if (opt) {
      leagueSelect.value = leagueId
      if (window.api.setLeague) window.api.setLeague(leagueId)
      addLogEntry({ type: 'info', message: `Liga detectada automaticamente: ${leagueName} (${charName})`, ts: Date.now() })
    }
  })
}

function setBpMode(active) {
  document.body.classList.toggle('no-bp', !active)
  if (!active) {
    leagueSelect.disabled = true
    const prev = leagueSelect.querySelector('option[value="__no_bp__"]')
    if (!prev) {
      const opt = document.createElement('option')
      opt.value = '__no_bp__'
      opt.textContent = '⛔ Blood Pact desativado'
      leagueSelect.insertBefore(opt, leagueSelect.firstChild)
    }
    leagueSelect.value = '__no_bp__'
  } else {
    leagueSelect.disabled = false
    const noBpOpt = leagueSelect.querySelector('option[value="__no_bp__"]')
    if (noBpOpt) noBpOpt.remove()
  }
}

if (window.api.onBpMode) {
  window.api.onBpMode(({ active }) => setBpMode(active))
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

// ── Debug log (admin only) ────────────────────────────────────────────────────
let _debugLogEnabled = false

function _pushDebugLog(entry) {
  if (!_debugLogEnabled) return
  const list  = document.getElementById('debugLogList')
  const empty = document.getElementById('debugLogEmpty')
  const btn   = document.getElementById('btnDebugLog')
  if (!list) return
  if (empty) empty.style.display = 'none'
  const ts   = new Date(entry.ts || Date.now())
  const time = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}:${String(ts.getSeconds()).padStart(2,'0')}`
  const row  = document.createElement('div')
  const type = entry.type || 'info'
  row.className = `dbg-row ${type}`
  row.innerHTML = `<span class="dbg-time">${time}</span><span class="dbg-msg">${entry.message || ''}</span>`
  list.appendChild(row)
  list.scrollTop = list.scrollHeight
  if (btn) btn.classList.add('has-entries')
}

function _initDebugLog() {
  _debugLogEnabled = true
  const btn     = document.getElementById('btnDebugLog')
  const overlay = document.getElementById('debugLogOverlay')
  const close   = document.getElementById('btnDebugLogClose')
  const clear   = document.getElementById('btnDebugLogClear')
  if (!btn || !overlay) return
  btn.style.display = 'flex'
  btn.addEventListener('click', () => {
    overlay.classList.add('open')
    btn.classList.remove('has-entries')
  })
  close && close.addEventListener('click', () => overlay.classList.remove('open'))
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open') })
  clear && clear.addEventListener('click', () => {
    const list  = document.getElementById('debugLogList')
    const empty = document.getElementById('debugLogEmpty')
    if (list)  list.innerHTML = ''
    if (empty) { empty.style.display = 'block'; list.appendChild(empty) }
    btn.classList.remove('has-entries')
  })
}

// ── Init ─────────────────────────────────────────────────────────────────────
loadSettings()
initAuth()
