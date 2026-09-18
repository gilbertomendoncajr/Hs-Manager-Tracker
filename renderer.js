// Escapa strings externas (nomes de itens, jogadores, mensagens) antes de interpolar em innerHTML
const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c]) }

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

const RARITY_COLORS = HS_RARITY_COLORS

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
        ? tr('filter.hideFiltered').replace('{n}', ligaFilteredCount)
        : tr('filter.showFiltered').replace('{n}', ligaFilteredCount)
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

  const ligaSection = document.getElementById('ligaSection')
  const logList = document.getElementById('logList')
  const uaSectionEl = document.getElementById('uaSection')

  if (tab === 'liga') {
    if (ligaSection) ligaSection.style.display = ''
    if (logList) logList.style.display = 'none'
    if (uaSectionEl) uaSectionEl.style.display = 'none'
  } else {
    if (ligaSection) ligaSection.style.display = 'none'
    if (logList) logList.style.display = ''
    if (uaSectionEl) uaSectionEl.style.display = uaBody.children.length > 0 ? 'block' : 'none'
    _refreshUaCount()
  }

  updateEmptyState()
  updateStatsBar()
  const hasMon = isMonitoring
  statDrops.style.display = hasMon ? 'flex' : 'none'
  statRares.style.display = hasMon ? 'flex' : 'none'
}

function _fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

let _soundVolume = 100

// Anuncia drops do filtro pessoal para leitores de tela (região #srLive, só na UI v2)
function announceDrop(drop) {
  const live = document.getElementById('srLive')
  if (!live) return
  live.textContent = ''
  requestAnimationFrame(() => { live.textContent = `Drop: ${drop.name || ''} ${drop.rarity || ''}`.trim() })
}

function playDropSound(drop) {
  if (_soundVolume <= 0) return
  const tierMatch = (drop._tierTag || '').match(/\[(\w+)\]/)
  const tier = tierMatch ? tierMatch[1] : (drop.tier || '')
  const rarity = drop.rarity || ''

  const src = (tier === 'SS' || rarity === 'Angelic' || rarity === 'Unholy')
    ? 'assets/sounds/tink.mp3'
    : 'assets/sounds/map.mp3'
  const audio = new Audio(src)
  audio.volume = _soundVolume / 100
  audio.play().catch(() => {})
}

function addLigaRow(drop) {
  const body = document.getElementById('ligaBody')
  const empty = document.getElementById('ligaEmpty')
  if (!body) return
  if (empty) empty.style.display = 'none'

  const color = RARITY_COLOR_MAP[drop.rarity] || 'var(--text)'
  const tierPart = drop.tier ? ` <span class="ua-tier">[${esc(drop.tier)}]</span>` : ''
  const iconHtml = drop.iconPath
    ? `<img class="ua-item-icon" src="${esc(drop.iconPath)}" onerror="this.style.display='none'" alt="">`
    : ''
  const srcBadge = drop.source === 'sse' ? '<span class="liga-sse-badge">🌐</span>' : ''
  const player = drop.charName && drop.discordUser
    ? `${drop.charName} / ${drop.discordUser}`
    : (drop.charName || drop.discordUser || '')
  const playerHtml = player ? `<span class="ua-player">${esc(player)}</span>` : ''

  const row = document.createElement('tr')
  row.innerHTML = `
    <td class="ua-name" style="color:${color}">${iconHtml}${srcBadge}${esc(drop.name)}${tierPart}${playerHtml}</td>
    <td class="ua-time">${_fmtTime(drop.ts)}</td>
  `
  body.insertBefore(row, body.firstChild)
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
  btn.addEventListener('click', () => {
    navTo(btn.dataset.page)
    if (btn.dataset.page === 'relics') _initRelicFilter()
    if (btn.dataset.page === 'filtro') _initItemFilter()
  })
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
    'cfg.reduceMotion': 'Reduzir animações', 'cfg.reduceMotionDesc': 'Para os pontos piscando e os deslizes das janelas',
    'cfg.startup': 'Iniciar com Windows', 'cfg.startupDesc': 'Abre automaticamente ao ligar o PC',
    'cfg.onClose': 'Ao fechar', 'cfg.onCloseDesc': 'O que acontece ao fechar a janela',
    'cfg.tray': 'Bandeja', 'cfg.exit': 'Fechar',
    'cfg.overlay': 'Overlay', 'cfg.showOverlay': 'Mostrar overlay',
    'cfg.satanicDuration': 'Duração do overlay da Satanic Zone', 'cfg.satanicDurationDesc': 'Quanto tempo o painel de pros e cons fica na tela',
    'cfg.showOverlayDesc': 'Exibe drops e zonas satânicas em tempo real sobre o jogo',
    'cfg.volume': 'Volume do som', 'cfg.volumeDesc': 'Volume do alerta de itens do filtro (0 = mudo)',
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
    'empty.desc2': 'Pressione INICIAR para iniciar o rastreador',
    'empty.desc3': 'Vá para a tela de seleção de personagem e escolha seu personagem',
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
    'status.agoRecent': '< 5s atrás', 'status.agoSec': '{n}s atrás', 'status.agoMin': '{n}min atrás',
    'filter.hideFiltered': '⊘ ocultar filtrados ({n})', 'filter.showFiltered': '⊘ ver filtrados ({n})',
    'league.loading': 'Carregando...', 'league.none': 'Nenhuma liga ativa',
    'league.bpDisabled': '⛔ Blood Pact desativado', 'league.bpUnlinked': '⚠️ Blood Pact não configurado',
    'log.leagueAutoDetected': 'Liga detectada automaticamente: {name} ({char})',
    'modal.activeChar': 'Personagem ativo',
    'modal.resetTitle': 'Reiniciar Farm', 'modal.resetChar': 'Personagem: ',
    'modal.keepLabel': 'Continuar Farm Atual', 'modal.keepDesc': 'Mantém todos os dados desta sessão',
    'modal.clearLabel': 'Limpar e Reiniciar', 'modal.clearDesc': 'Zera drops e estatísticas para um novo farm',
    'btn.resetSession': 'Reiniciar Farm',
    'stats.noResources': 'Nenhum resource ainda', 'stats.noTimeline': 'Nenhum item Heroic+ ainda',
    'stats.noSatanicZone': 'Nenhuma Satanic Zone ativa', 'stats.zoneArea': 'Act {act} — Área {idx}',
    'filter.loadError': 'Erro ao carregar itens.', 'filter.waitingAdmin': 'Aguardando configuração do admin.',
    'filter.catAll': 'Todos', 'filter.noItems': 'Nenhum item encontrado.',
    'filter.countOverlay': '{on} no overlay / {total} total',
    'filter.selectAll': '▶ Marcar todos', 'filter.deselectAll': '✕ Desmarcar todos',
    'filter.cardRemove': 'Clique para remover do overlay', 'filter.cardAdd': 'Clique para ativar no overlay',
    'filter.noSearchResults': 'Nenhum item encontrado para "{q}".',
    'filter.copied': '✓ Copiado!', 'filter.copy': '📋 Copiar',
    'filter.exported': '{n} itens exportados.', 'filter.fileLoaded': 'Arquivo "{file}" carregado.',
    'filter.invalidString': '✕ String inválida.', 'filter.applied': '{n} itens aplicados{skipped}.',
    'preset.saved': '✓ Salvo!', 'preset.save': '💾 Salvar',
    'preset.nameRequired': '✕ Nome obrigatório.', 'preset.none': '— sem preset —',
    'preset.deleteConfirm': 'Excluir o preset "{name}"?',
    'filter.exportTitle': 'EXPORTAR FILTRO', 'filter.exportItems': 'ITENS',
    'filter.importTitle': 'IMPORTAR FILTRO',
    'filter.importPlaceholder': 'Cole a string do filtro aqui...',
    'filter.importMerge': '+ Mesclar', 'filter.importReplace': '↺ Substituir',
    'preset.saveAsTitle': 'SALVAR PRESET COMO',
    'preset.namePlaceholder': 'Nome do preset (ex: Fogo, Gelo...)',
  },
  en: {
    'nav.drops': 'My Drops', 'nav.liga': 'League', 'nav.stats': 'Statistics',
    'nav.filter': 'Filter', 'nav.compact': 'Compact Mode',
    'nav.config': 'Settings', 'nav.about': 'About',
    'cfg.account': 'Account', 'cfg.appearance': 'Appearance', 'cfg.system': 'System',
    'cfg.theme': 'Theme', 'cfg.themeDesc': 'Overall app appearance',
    'cfg.dark': 'Dark', 'cfg.light': 'Light',
    'cfg.lang': 'Language',
    'cfg.reduceMotion': 'Reduce motion', 'cfg.reduceMotionDesc': 'Stops blinking dots and sliding windows',
    'cfg.startup': 'Start with Windows', 'cfg.startupDesc': 'Opens automatically at startup',
    'cfg.onClose': 'On Close', 'cfg.onCloseDesc': 'What happens when you close the window',
    'cfg.tray': 'Tray', 'cfg.exit': 'Quit',
    'cfg.compact': 'Compact Mode', 'cfg.compactDesc': 'Smaller window with minimal UI',
    'cfg.overlay': 'Overlay', 'cfg.showOverlay': 'Show overlay',
    'cfg.satanicDuration': 'Satanic Zone overlay duration', 'cfg.satanicDurationDesc': 'How long the pros and cons panel stays on screen',
    'cfg.showOverlayDesc': 'Displays drops and satanic zones in real time over the game',
    'cfg.volume': 'Sound volume', 'cfg.volumeDesc': 'Volume of the item filter alert (0 = muted)',
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
    'empty.desc2': 'Press START to begin tracking',
    'empty.desc3': 'Go to the character select screen and choose your character',
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
    'status.agoRecent': '< 5s ago', 'status.agoSec': '{n}s ago', 'status.agoMin': '{n}min ago',
    'filter.hideFiltered': '⊘ hide filtered ({n})', 'filter.showFiltered': '⊘ show filtered ({n})',
    'league.loading': 'Loading...', 'league.none': 'No active leagues',
    'league.bpDisabled': '⛔ Blood Pact disabled', 'league.bpUnlinked': '⚠️ Blood Pact not configured',
    'log.leagueAutoDetected': 'League auto-detected: {name} ({char})',
    'modal.activeChar': 'Active character',
    'modal.resetTitle': 'Restart Farm', 'modal.resetChar': 'Character: ',
    'modal.keepLabel': 'Continue Current Farm', 'modal.keepDesc': 'Keeps all data from this session',
    'modal.clearLabel': 'Clear and Restart', 'modal.clearDesc': 'Resets drops and statistics for a new farm',
    'btn.resetSession': 'Restart Farm',
    'stats.noResources': 'No resources yet', 'stats.noTimeline': 'No Heroic+ items yet',
    'stats.noSatanicZone': 'No Satanic Zone active', 'stats.zoneArea': 'Act {act} — Area {idx}',
    'filter.loadError': 'Error loading items.', 'filter.waitingAdmin': 'Waiting for admin configuration.',
    'filter.catAll': 'All', 'filter.noItems': 'No items found.',
    'filter.countOverlay': '{on} in overlay / {total} total',
    'filter.selectAll': '▶ Select all', 'filter.deselectAll': '✕ Deselect all',
    'filter.cardRemove': 'Click to remove from overlay', 'filter.cardAdd': 'Click to activate in overlay',
    'filter.noSearchResults': 'No items found for "{q}".',
    'filter.copied': '✓ Copied!', 'filter.copy': '📋 Copy',
    'filter.exported': '{n} items exported.', 'filter.fileLoaded': 'File "{file}" loaded.',
    'filter.invalidString': '✕ Invalid string.', 'filter.applied': '{n} items applied{skipped}.',
    'preset.saved': '✓ Saved!', 'preset.save': '💾 Save',
    'preset.nameRequired': '✕ Name required.', 'preset.none': '— no preset —',
    'preset.deleteConfirm': 'Delete preset "{name}"?',
    'filter.exportTitle': 'EXPORT FILTER', 'filter.exportItems': 'ITEMS',
    'filter.importTitle': 'IMPORT FILTER',
    'filter.importPlaceholder': 'Paste the filter string here...',
    'filter.importMerge': '+ Merge', 'filter.importReplace': '↺ Replace',
    'preset.saveAsTitle': 'SAVE PRESET AS',
    'preset.namePlaceholder': 'Preset name (e.g. Fire, Ice...)',
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder
    if (strings[key]) el.placeholder = strings[key]
  })
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle
    if (strings[key]) el.title = strings[key]
  })
  document.querySelectorAll('.opt-btn[data-lang]').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === lang)
  })
  // Re-apply dynamic texts that depend on monitoring state
  setMonitorUI(isMonitoring, _charIdentifiedLocal)
  updateStatsBar()
  if (typeof _lastStatsData !== 'undefined' && _lastStatsData) _updateSatanic(_lastStatsData.satanic)
  // Re-render filter UI if loaded (category tabs and item count use tr())
  if (_ifLoaded) {
    _ifBuildCatTabs()
    _ifUpdateCatTabStates()
    _ifSearch ? _ifRenderSearch() : _ifRenderItems()
    _ifUpdateCount()
    _ifPopulatePresetSelect()
  }
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
  if (tog.id === 'togStartup' || tog.id === 'togOverlay' || tog.id === 'togReduceMotion') return  // handled separately with IPC
  tog.addEventListener('click', () => {
    tog.classList.toggle('on')
  })
})

const btnLogoutCfg = document.getElementById('btnLogoutCfg')
if (btnLogoutCfg) btnLogoutCfg.addEventListener('click', () => btnLogout.click())

const btnOpenFilter = document.getElementById('btnOpenFilter')
if (btnOpenFilter) btnOpenFilter.addEventListener('click', () => { navTo('filtro'); _initItemFilter() })

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
      stEvtVal.textContent = tr('status.agoRecent')
      if (stEvtDot) stEvtDot.className = 'st-dot active'
    } else if (ago < 60) {
      stEvtVal.textContent = tr('status.agoSec').replace('{n}', ago)
      if (stEvtDot) stEvtDot.className = ago > 30 ? 'st-dot pending' : 'st-dot active'
    } else {
      const min = Math.round(ago / 60)
      stEvtVal.textContent = tr('status.agoMin').replace('{n}', min)
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
    // Limpar opções especiais de BP sem reabilitar o dropdown
    _bpAutoLocked = false
    const noBpOpt = leagueSelect.querySelector('option[value="__no_bp__"]')
    if (noBpOpt) noBpOpt.remove()
    const unlinkedOpt = leagueSelect.querySelector('option[value="__bp_unlinked__"]')
    if (unlinkedOpt) unlinkedOpt.remove()
    document.body.classList.remove('no-bp')
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
  leagueSelect.innerHTML = `<option value="">${tr('league.loading')}</option>`
  btnToggle.disabled = true
  const leagues = await window.api.getLeagues()
  leagueSelect.innerHTML = ''

  if (leagues.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = tr('league.none')
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
  const [theme, lang, startup, closeBehavior, overlayEnabled, volume, satanicDuration] = await Promise.all([
    window.api.getTheme(),
    window.api.getLang(),
    window.api.getStartup(),
    window.api.getCloseBehavior(),
    window.api.getOverlayEnabled(),
    window.api.getVolume(),
    window.api.getSatanicDuration ? window.api.getSatanicDuration() : 18,
  ])
  applyTheme(theme || 'dark')
  applyLang(lang || 'pt')

  const togStartup = document.getElementById('togStartup')
  if (togStartup) togStartup.classList.toggle('on', !!startup)

  const togOverlay = document.getElementById('togOverlay')
  if (togOverlay) togOverlay.classList.toggle('on', overlayEnabled !== false)

  const selSatanicTtl = document.getElementById('selSatanicDuration')
  if (selSatanicTtl) selSatanicTtl.value = String(satanicDuration || 18)

  _soundVolume = typeof volume === 'number' ? volume : 100
  const rngVolume = document.getElementById('rngVolume')
  const volumeVal = document.getElementById('volumeVal')
  if (rngVolume) rngVolume.value = _soundVolume
  if (volumeVal) volumeVal.textContent = `${_soundVolume}%`

  document.querySelectorAll('.opt-btn[data-close]').forEach(b => {
    b.classList.toggle('on', b.dataset.close === (closeBehavior || 'tray'))
  })
}

const selSatanicDurationEl = document.getElementById('selSatanicDuration')
if (selSatanicDurationEl) {
  selSatanicDurationEl.addEventListener('change', () => {
    window.api.setSatanicDuration && window.api.setSatanicDuration(Number(selSatanicDurationEl.value))
  })
}

const togReduceMotionEl = document.getElementById('togReduceMotion')
if (togReduceMotionEl && window.getReduceMotion) {
  togReduceMotionEl.classList.toggle('on', window.getReduceMotion())
  togReduceMotionEl.addEventListener('click', () => {
    togReduceMotionEl.classList.toggle('on')
    window.setReduceMotion(togReduceMotionEl.classList.contains('on'))
  })
}

const togStartupEl = document.getElementById('togStartup')
if (togStartupEl) {
  togStartupEl.addEventListener('click', async () => {
    togStartupEl.classList.toggle('on')
    window.api.setStartup && window.api.setStartup(togStartupEl.classList.contains('on'))
  })
}

const togOverlayEl = document.getElementById('togOverlay')
if (togOverlayEl) {
  togOverlayEl.addEventListener('click', () => {
    togOverlayEl.classList.toggle('on')
    window.api.setOverlayEnabled && window.api.setOverlayEnabled(togOverlayEl.classList.contains('on'))
  })
}

const rngVolumeEl = document.getElementById('rngVolume')
const volumeValEl = document.getElementById('volumeVal')
if (rngVolumeEl) {
  rngVolumeEl.addEventListener('input', () => {
    _soundVolume = Number(rngVolumeEl.value)
    if (volumeValEl) volumeValEl.textContent = `${_soundVolume}%`
  })
  // Ao soltar o slider: salva e toca uma amostra no volume escolhido
  rngVolumeEl.addEventListener('change', () => {
    window.api.setVolume && window.api.setVolume(_soundVolume)
    playDropSound({ rarity: 'Angelic' })
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

btnFilter.addEventListener('click', () => { navTo('filtro'); _initItemFilter() })

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
  if (state.charIdentified && state.charName) {
    updateCharCard(state.charName, state.charClass)
  } else if (!state.charIdentified) {
    if (sideCharCard) sideCharCard.hidden = true
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
  const catPart = drop._category ? `<span class="ua-cat">${esc(drop._category)}</span>` : ''
  const iconHtml = drop._iconPath ? `<img class="ua-item-icon" src="${esc(drop._iconPath)}" onerror="this.style.display='none'" alt="">` : ''
  const playerPart = drop._charDisplay ? `<span class="ua-player">${esc(drop._charDisplay)}</span>` : ''
  row.innerHTML = `
    <td class="ua-name" style="color:${color}">${iconHtml}${esc(drop.name)}${tierPart}${catPart}${playerPart}</td>
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
  if (drop._inPersonalFilter) { playDropSound(drop); announceDrop(drop) }
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
    if (drop._inPersonalFilter) { playDropSound(drop); announceDrop(drop) }
  }
  _refreshUaCount()
})

if (window.api.onLigaDrop) {
  window.api.onLigaDrop((drop) => addLigaRow(drop))
}

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
  const rateHour = tr('tiles.rateHour')
  if (elapsedHours < 0.01 || count === 0) return `— ${rateHour}`
  return `${_fmtNum(Math.round(count / elapsedHours))} ${rateHour}`
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
    el.innerHTML = `<div class="stats-kv-empty">${tr('stats.noResources')}</div>`
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
  const renderGroup = (keys, col) => {
    const active = keys.filter(k => (t[k] || 0) > 0)
    return active.map(k =>
      `<div class="stc-card">
        <span class="stc-count" style="color:${col}">${t[k]}</span>
        <span class="stc-label">${TALLY_LABELS[k]}</span>
      </div>`
    ).join('')
  }
  const bossHtml   = renderGroup(_TALLY_BOSSES, 'var(--satanic)')
  const chestHtml  = renderGroup(_TALLY_CHESTS, 'var(--heroic)')
  const clearHtml  = renderGroup(_TALLY_CLEARS, 'var(--angelic)')
  const hasAny = bossHtml || chestHtml || clearHtml
  if (!hasAny) {
    el.innerHTML = '<div class="stc-empty">No activity recorded yet.<br>Start farming to track your kills and chests.</div>'
    return
  }
  el.innerHTML =
    (bossHtml  ? `<div class="stc-group-label">BOSSES</div><div class="stc-group">${bossHtml}</div>`  : '') +
    (chestHtml ? `<div class="stc-group-label">CHESTS</div><div class="stc-group">${chestHtml}</div>` : '') +
    (clearHtml ? `<div class="stc-group-label">CLEARS</div><div class="stc-group">${clearHtml}</div>` : '')
}

// Buff/debuff decode tables — sourced from hs-tracker buffs.js
// Cada entrada: [nome, descrição PT, descrição EN]
const SATANIC_BUFFS = {
  1:  ['Loot Goblin I',      '+1 Max Loot por Inimigo Morto',              '+1 Max Loot per Enemy Killed'],
  2:  ['Loot Goblin II',     '+2 Max Loot por Inimigo Morto',              '+2 Max Loot per Enemy Killed'],
  3:  ['Rune Master',        '+15% Chance de Drop de Runas',               '+15% Rune Drop Chance'],
  4:  ['Gold Hunger',        '+40% Ouro de Monstros Mortos',               '+40% Gold from Slain Monsters'],
  5:  ['Heroic Windfall',    '+3% Chance de Drop Heroic',                  '+3% Heroic Drop Chance'],
  6:  ['Angelic Fortune',    '+25% Chance de Drop Angelic',                '+25% Angelic Drop Chance'],
  7:  ["Zephy's Grace",      '+50% Velocidade de Movimento',               '+50% Movement Speed'],
  8:  ['Fury of Tempest',    '+60% Velocidade de Ataque',                  '+60% Attack Speed'],
  9:  ['Rapid Casting',      '+60% Velocidade de Conjuração',              '+60% Cast Speed'],
  10: ['Onslaught',          '+100% Dano de Ataque',                       '+100% Attack Damage'],
  11: ['Nether Surge',       '+40% Dano de Magia',                         '+40% Spell Damage'],
  12: ['Relic Keepers',      '2% Chance de Relic ao Matar Ancião',         '2% Relic Chance on Elder Kill'],
  13: ["Goblin's Greed",     '0.5% Chance de Goblin do Tesouro',           '0.5% Treasure Goblin Chance'],
  14: ['Artifact Digger',    '+55% Magic Find',                            '+55% Magic Find'],
  15: ['Artifact Seeker',    '+110% Magic Find',                           '+110% Magic Find'],
  16: ['Artifact Excavator', '+170% Magic Find',                           '+170% Magic Find'],
  17: ['Recruit',            '+10% Ganho de XP',                           '+10% XP Gain'],
  18: ['Combat Training',    '+15% Ganho de XP',                           '+15% XP Gain'],
  19: ['Battle Scarred',     '+20% Ganho de XP',                           '+20% XP Gain'],
  20: ['Clairvoyance',       '+100% em toda recuperação',                  '+100% to all recovery'],
  21: ['Aftermath',          '3% Chance de Invocar Legião na Morte',       '3% Chance to Summon Legion on Death'],
  22: ['Deep Cuts',          '+200% Dano de Golpe Crítico',                '+200% Critical Strike Damage'],
  23: ['Old Town',           '+15% Chance de Packs Antigos',               '+15% Old Packs Chance'],
  24: ['Terror Zone',        '+25% Chance de Packs Antigos',               '+25% Old Packs Chance'],
  25: ['Fields of Carnage',  '+30% Chance de Packs Antigos',               '+30% Old Packs Chance'],
}
const SATANIC_DEBUFFS = [
  ["Dusk's Shroud",      '-20% Raio de Luz',                      '-20% Light Radius'],
  ['Elemental Erosion',  '-75% Todas as Resistências',            '-75% All Resistances'],
  ['Sundered Armor',     '+25% Dano Recebido',                    '+25% Damage Taken'],
  ['Vitality Drain',     '-25% Vida',                              '-25% Life'],
  ['Essence Drain',      '-25% Mana',                              '-25% Mana'],
  ['Abyssal Gloom',      '+100% Escuridão',                        '+100% Darkness'],
  ['Skill Debilitation', '-10% Todas as Skills',                   '-10% All Skills'],
  ['Weakening Essence',  '-20% Todos os Atributos',                '-20% All Attributes'],
  ['Lifeflow Starvation','Regeneração reduzida',                   'Reduced Regeneration'],
  ['Sanguine Impairment','-75% Roubo de Vida',                     '-75% Life Steal'],
  ['Arcane Impairment',  '-75% Roubo de Mana',                     '-75% Mana Steal'],
  ['Consumed Time',      '-25% Recuperação de Cooldown',           '-25% Cooldown Recovery'],
  ['Absolute Limbo',     '-50% Recuperação de Cooldown',           '-50% Cooldown Recovery'],
  ['Boulder Fall',       '3% Chance de Boulder na Morte',          '3% Boulder Chance on Death'],
  ['Lingering Evil',     '-25% Velocidade de Movimento',           '-25% Movement Speed'],
  ['Fatal Wounds',       '10% Chance de Dano Duplo dos Monstros',  '10% Chance of Double Damage from Monsters'],
  ['Bloated Veins',      '+70% Vida dos Monstros',                 '+70% Monster Life'],
  ['Abnormal Dwelling',  '+130% Vida dos Monstros',                '+130% Monster Life'],
  ['Colossal Bloating',  '+200% Vida dos Monstros',                '+200% Monster Life'],
  ['Necrosis',           '1% de Vida drenada por segundo',         '1% Life Drained per Second'],
  ['Venomous Presence',  '+200% Duração de Veneno',                '+200% Poison Duration'],
  ['Flaming Agony',      'Nova de Fogo na morte dos monstros',     'Fire Nova on monster death'],
  ['Unholy Agility',     'Monstros mais rápidos e agressivos',     'Monsters are faster and more aggressive'],
  ['Broken Armor',       'Você não pode bloquear ataques',         'You cannot block attacks'],
  ['Hemorrhage',         'Ataques de monstros causam sangramento', 'Monster attacks cause bleeding'],
  ['Crippling Slow',     'Ataques infligem 50% de lentidão',       'Attacks inflict 50% slow'],
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
      return tr('stats.zoneArea').replace('{act}', act).replace('{idx}', idx)
    }
  }
  return String(raw)
}

function _updateSatanic(satanic) {
  const el = document.getElementById('satanicZoneBlock')
  if (!el) return
  if (!satanic || !satanic.zone) {
    el.innerHTML = `<div class="satanic-none">${tr('stats.noSatanicZone')}</div>`
    return
  }
  const zoneName = _fmtZoneName(satanic.zone)
  const buffIds   = satanic.buffs   || []
  const debuffIds = satanic.debuffs || []

  const renderBuff = (id) => {
    const b = SATANIC_BUFFS[id]
    const name = b ? b[0] : `Buff ${id}`
    const desc = b ? (_currentLang === 'en' ? b[2] : b[1]) : ''
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
    const desc = d ? (_currentLang === 'en' ? d[2] : d[1]) : ''
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

  const zoneDropsHtml = _renderZoneDrops(satanic.zone)

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
    </div>
    ${zoneDropsHtml}`
}

function _fmtDropRate(rate) {
  if (!rate) return '?'
  if (rate >= 1_000_000) return `1 / ${(rate / 1_000_000).toFixed(1)}M`
  if (rate >= 1_000)     return `1 / ${Math.round(rate / 1_000)}k`
  return `1 / ${rate}`
}

function _renderZoneDrops(rawZone) {
  if (typeof ZONE_DROPS === 'undefined' || typeof ZONE_DROP_RATE === 'undefined') return ''
  const parts = String(rawZone).split('_')
  if (parts.length < 3) return ''
  const act = parseInt(parts[parts.length - 2], 10)
  const idx = parseInt(parts[parts.length - 1], 10)
  if (isNaN(act) || isNaN(idx)) return ''
  const code   = `${act}-${idx}`
  const codeBD = `${act}-BD`
  const codeD  = `${act}-D`

  const results = []
  for (const [name, zones] of Object.entries(ZONE_DROPS)) {
    if (zones.includes(code) || zones.includes(codeBD) || zones.includes(codeD)) {
      results.push({ name, rate: ZONE_DROP_RATE[name] || 9999999, rarity: (typeof ZONE_RARITY !== 'undefined' ? ZONE_RARITY[name] : null) || 'Set' })
    }
  }
  if (!results.length) return ''
  results.sort((a, b) => a.rate - b.rate)
  const top = results.slice(0, 6)

  const RARITY_COL = { Satanic: 'var(--satanic)', Angelic: 'var(--angelic)', Unholy: 'var(--unholy)', Heroic: 'var(--heroic)', Set: 'var(--set)' }

  const rows = top.map(it => {
    const col = RARITY_COL[it.rarity] || 'var(--text)'
    const cap = it.name.replace(/\b\w/g, c => c.toUpperCase())
    return `<div class="szd-row">
      <span class="szd-name" style="color:${col}">${cap}</span>
      <span class="szd-rate">${it.rarity === 'Set' ? 'SS' : it.rarity.slice(0,2).toUpperCase()} &nbsp; ${_fmtDropRate(it.rate)}</span>
    </div>`
  }).join('')

  return `<div class="szd-block">
    <div class="szd-header">
      <span class="szd-title">DROPS IN THIS ZONE</span>
      <span class="szd-zone">${_fmtZoneName(rawZone)}</span>
    </div>
    ${rows}
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
    el.innerHTML = `<div class="stl-empty">${tr('stats.noTimeline')}</div>`
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
      <span class="stl-name">${esc(item.name)}</span>
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

let _bpAutoLocked = false

if (window.api.onLeagueAutoSelected) {
  window.api.onLeagueAutoSelected(({ leagueId, leagueName, charName }) => {
    const opt = leagueSelect.querySelector(`option[value="${leagueId}"]`)
    if (opt) {
      leagueSelect.value = leagueId
      leagueSelect.disabled = true
      _bpAutoLocked = true
      if (window.api.setLeague) window.api.setLeague(leagueId)
      addLogEntry({ type: 'info', message: tr('log.leagueAutoDetected').replace('{name}', leagueName).replace('{char}', charName), ts: Date.now() })
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
      opt.textContent = tr('league.bpDisabled')
      leagueSelect.insertBefore(opt, leagueSelect.firstChild)
    }
    leagueSelect.value = '__no_bp__'
  } else {
    const noBpOpt = leagueSelect.querySelector('option[value="__no_bp__"]')
    if (noBpOpt) noBpOpt.remove()
  }
}

// ── Class icon helper ─────────────────────────────────────────────────────────
// Index 0 unused — game sends 1-based class IDs matching the in-game class grid order
const CLASS_ID_NAMES = [
  null,
  'Viking','Pyromancer','Marksman','Pirate','Nomad','Redneck',
  'Necromancer','Samurai','Paladin','Amazon','Demon_Slayer','Demonspawn',
  'Shaman','White_Mage','Marauder','Plague_Doctor','Shield_Lancer',
  'Jotunn','Illusionist','Exo','Butcher','Stormweaver'
]
function classToFileName(cls) {
  if (cls == null) return null
  if (typeof cls === 'number' || /^\d+$/.test(String(cls))) {
    return CLASS_ID_NAMES[parseInt(cls)] || null
  }
  return String(cls).trim()
    .replace(/\s+/g, '_')
    .replace(/[öÖ]/g, 'o')
    .replace(/^(.)/, c => c.toUpperCase())
}
function classToDisplayName(cls) {
  const file = classToFileName(cls)
  if (!file) return ''
  return file.replace(/_/g, ' ')
}

const sideCharCard     = document.getElementById('sideCharCard')
const sideCharClassIcon = document.getElementById('sideCharClassIcon')
const sideCharNameEl   = document.getElementById('sideCharName')
const sideCharClassName = document.getElementById('sideCharClassName')

function updateCharCard(charName, charClass) {
  if (!sideCharCard) return
  if (!charName) { sideCharCard.hidden = true; return }
  const file = classToFileName(charClass)
  if (file && sideCharClassIcon) {
    sideCharClassIcon.src = `assets/classes/${file}.png`
    sideCharClassIcon.alt = classToDisplayName(charClass)
    sideCharClassIcon.hidden = false
  } else if (sideCharClassIcon) {
    sideCharClassIcon.hidden = true
  }
  if (sideCharNameEl) sideCharNameEl.textContent = charName
  if (sideCharClassName) sideCharClassName.textContent = classToDisplayName(charClass)
  sideCharCard.hidden = false
}

if (window.api.onBpMode) {
  window.api.onBpMode(({ active, charName, charClass }) => {
    setBpMode(active)
    if (charName) updateCharCard(charName, charClass)
  })
}

if (window.api.onBpUnlinked) {
  window.api.onBpUnlinked(() => {
    leagueSelect.disabled = true
    const prev = leagueSelect.querySelector('option[value="__bp_unlinked__"]')
    if (!prev) {
      const opt = document.createElement('option')
      opt.value = '__bp_unlinked__'
      opt.textContent = tr('league.bpUnlinked')
      leagueSelect.insertBefore(opt, leagueSelect.firstChild)
    }
    leagueSelect.value = '__bp_unlinked__'
  })
}

const btnResetSession  = document.getElementById('btnResetSession')
const resetModal       = document.getElementById('resetModal')
const resetModalChar   = document.getElementById('resetModalChar')
const resetOptCancel   = document.getElementById('resetOptCancel')
const resetOptClear    = document.getElementById('resetOptClear')

function openResetModal() {
  const charName = document.querySelector('.monitor-char')?.textContent?.trim()
    || _charIdentifiedLocal && tr('modal.activeChar')
    || '—'
  if (resetModalChar) resetModalChar.textContent = charName
  if (resetModal) resetModal.classList.add('open')
}
function closeResetModal() {
  if (resetModal) resetModal.classList.remove('open')
}

if (btnResetSession)  btnResetSession.addEventListener('click', openResetModal)
if (resetOptCancel)   resetOptCancel.addEventListener('click', closeResetModal)
if (resetModal)       resetModal.addEventListener('click', (e) => { if (e.target === resetModal) closeResetModal() })
if (resetOptClear) {
  resetOptClear.addEventListener('click', () => {
    closeResetModal()
    if (window.api.resetSession) window.api.resetSession()
  })
}

// ── Window controls ──────────────────────────────────────────────────────────
const btnWinMinimize = document.getElementById('btnWinMinimize')
const btnWinClose    = document.getElementById('btnWinClose')
if (btnWinMinimize) btnWinMinimize.addEventListener('click', () => window.api.winMinimize())
if (btnWinClose)    btnWinClose.addEventListener('click',    () => window.api.winClose())

const btnCompact = document.getElementById('btnCompact')
if (btnCompact) {
  btnCompact.addEventListener('click', async () => {
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
  row.innerHTML = `<span class="dbg-time">${time}</span><span class="dbg-msg">${esc(entry.message)}</span>`
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

// ── Relic Filter page ─────────────────────────────────────────────────────────
let _rfcAllRelics = []
let _rfcEnabled   = new Set()
let _rfcLoaded    = false

async function _initRelicFilter() {
  if (!_rfcLoaded) {
    _rfcAllRelics = await window.api.getRelics()
    const enabled = await window.api.getRelicEnabled()
    _rfcEnabled   = new Set(enabled)
    _rfcLoaded    = true
    _rfcBindActions()
  }
  _rfcRender(document.getElementById('rfcSearch')?.value?.trim() ?? '')
}

function _rfcBindActions() {
  const search = document.getElementById('rfcSearch')
  if (search) search.addEventListener('input', e => _rfcRender(e.target.value.trim()))

  document.getElementById('rfcEnableAll')?.addEventListener('click', async () => {
    const visible = _rfcVisible(document.getElementById('rfcSearch')?.value?.trim() ?? '')
    const names = visible.map(r => r.name)
    await window.api.setAllRelics(names, true)
    for (const n of names) _rfcEnabled.add(n)
    _rfcRender(document.getElementById('rfcSearch')?.value?.trim() ?? '')
  })

  document.getElementById('rfcDisableAll')?.addEventListener('click', async () => {
    const visible = _rfcVisible(document.getElementById('rfcSearch')?.value?.trim() ?? '')
    const names = visible.map(r => r.name)
    await window.api.setAllRelics(names, false)
    for (const n of names) _rfcEnabled.delete(n)
    _rfcRender(document.getElementById('rfcSearch')?.value?.trim() ?? '')
  })
}

function _rfcVisible(q) {
  if (!q) return _rfcAllRelics
  const lq = q.toLowerCase()
  return _rfcAllRelics.filter(r => r.name.toLowerCase().includes(lq))
}

function _rfcRender(q) {
  const grid  = document.getElementById('rfcGrid')
  const count = document.getElementById('rfcCount')
  if (!grid) return

  const visible = _rfcVisible(q)
  const enabledCount = [..._rfcEnabled].filter(n => _rfcAllRelics.some(r => r.name === n)).length
  if (count) count.textContent = `${enabledCount} / ${_rfcAllRelics.length} enabled`

  grid.innerHTML = ''
  for (const relic of visible) {
    const isOn = _rfcEnabled.has(relic.name)
    const card = document.createElement('div')
    card.className = `rfc-card${isOn ? ' on' : ''}`
    const initials = relic.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
    const slug = relic.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    card.innerHTML = `
      <div class="rfc-icon">
        <span class="rfc-init">${initials}</span>
        <img src="assets/icons/relics/${slug}.png" alt="" onerror="this.remove()">
      </div>
      <span class="rfc-name">${relic.name}</span>
    `
    card.addEventListener('click', async () => {
      const newState = await window.api.toggleRelic(relic.name)
      if (newState) _rfcEnabled.add(relic.name)
      else _rfcEnabled.delete(relic.name)
      card.classList.toggle('on', newState)
      card.querySelector('.rfc-icon').style.background = newState ? 'var(--heroic)' : ''
      card.querySelector('.rfc-icon').style.color = newState ? '#000' : ''
      const en = [..._rfcEnabled].filter(n => _rfcAllRelics.some(r => r.name === n)).length
      if (count) count.textContent = `${en} / ${_rfcAllRelics.length} enabled`
    })
    grid.appendChild(card)
  }
}

// ── Item Filter (inline) ──────────────────────────────────────────────────────
const IF_CAT_ICONS = {
  Helmet: '⛑', Armor: '🔰', Boots: '👢', Weapon: '⚔',
  Gloves: '🥊', Amulet: '📿', Shield: '🛡', Ring: '💍',
  Belt: '🔗', Charm: '✨', Potion: '🧪',
}
const IF_CAT_ORDER = ['Weapon', 'Shield', 'Helmet', 'Boots', 'Armor', 'Gloves', 'Belt', 'Amulet', 'Ring', 'Charm', 'Potion']

let _ifAllItems         = {}
let _ifPersonal         = new Set()
let _ifActiveCategories = new Set()
let _ifRarities         = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Set'])
let _ifTiers            = new Set(['D', 'C', 'B', 'A', 'S', 'SS'])
let _ifSearch           = ''
let _ifLoaded           = false
let _ifHasTiers         = false
let _ifPresetsData      = { presets: {}, active: null }  // cache local dos presets

async function _initItemFilter() {
  if (_ifLoaded) { _ifUpdateCount(); return }
  document.getElementById('ifContent').innerHTML = '<div class="if-loading">LOADING ITEMS...</div>'

  let items = {}
  try { items = (await window.api.getFilterItems()) || {} }
  catch (err) {
    document.getElementById('ifContent').innerHTML =
      `<div class="if-empty">${tr('filter.loadError')}<br><small style="color:var(--satanic)">${err.message || err}</small></div>`
    return
  }

  if (!items || Object.keys(items).length === 0) {
    document.getElementById('ifContent').innerHTML =
      `<div class="if-empty">${tr('filter.waitingAdmin')}</div>`
    return
  }

  let enabledNames = []
  try {
    enabledNames = await Promise.race([
      window.api.getPersonalEnabled(),
      new Promise(r => setTimeout(() => r([]), 3000)),
    ])
  } catch {}

  _ifAllItems  = items
  _ifPersonal  = new Set(Array.isArray(enabledNames) ? enabledNames : [])

  // Merge tier data from server (independent of whether server returned items)
  try {
    const tiers = await window.api.getFilterTiers()  // Record<name, tier>
    if (tiers && Object.keys(tiers).length > 0) {
      for (const arr of Object.values(_ifAllItems)) {
        for (const item of arr) {
          if (!item.tier && tiers[item.name]) item.tier = tiers[item.name]
        }
      }
    }
  } catch {}

  _ifLoaded    = true
  _ifHasTiers  = Object.values(_ifAllItems).some(arr => arr.some(i => i.tier))

  try { _ifPresetsData = await window.api.getPresets() } catch {}

  _ifBuildCatTabs()
  _ifBindRarityChips()
  _ifBindTierChips()
  _ifBindSearchBar()
  _ifBindPresets()

  _ifRenderItems()
  _ifUpdateCatTabStates()
  _ifUpdateCount()
}

function _ifBuildCatTabs() {
  const bar = document.getElementById('ifCatBar')
  bar.innerHTML = ''

  const todosTab = document.createElement('div')
  todosTab.className = 'if-cat-tab active'
  todosTab.dataset.cat = '__todos__'
  todosTab.innerHTML = `<span class="cat-icon">☰</span>${tr('filter.catAll')}`
  todosTab.addEventListener('click', () => _ifToggleCategory('__todos__'))
  bar.appendChild(todosTab)

  for (const cat of IF_CAT_ORDER) {
    if (!_ifAllItems[cat]?.length) continue
    const total = _ifAllItems[cat].length
    const myOn  = _ifAllItems[cat].filter(i => _ifPersonal.has(i.name)).length
    const tab = document.createElement('div')
    tab.className = 'if-cat-tab'
    tab.dataset.cat = cat
    tab.innerHTML = `<span class="cat-icon">${IF_CAT_ICONS[cat] || '•'}</span>${cat}<span class="cat-badge">${myOn}/${total}</span>`
    tab.addEventListener('click', () => _ifToggleCategory(cat))
    bar.appendChild(tab)
  }
}

function _ifRefreshCatBadge(cat) {
  const tab = document.querySelector(`.if-cat-tab[data-cat="${cat}"]`)
  if (!tab) return
  const total = _ifAllItems[cat]?.length || 0
  const myOn  = (_ifAllItems[cat] || []).filter(i => _ifPersonal.has(i.name)).length
  tab.querySelector('.cat-badge').textContent = `${myOn}/${total}`
}

function _ifBindRarityChips() {
  document.querySelectorAll('#p-filtro .if-rchip').forEach(chip => {
    chip.addEventListener('click', () => {
      const r = chip.dataset.rarity
      if (r === 'All') {
        const allActive = _ifRarities.size === 5
        if (allActive) {
          _ifRarities.clear()
          document.querySelectorAll('#p-filtro .if-rchip').forEach(c => c.classList.remove('active'))
        } else {
          _ifRarities = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Set'])
          document.querySelectorAll('#p-filtro .if-rchip').forEach(c => c.classList.add('active'))
        }
      } else {
        if (_ifRarities.has(r)) { _ifRarities.delete(r); chip.classList.remove('active') }
        else { _ifRarities.add(r); chip.classList.add('active') }
        const allChip = document.querySelector('#p-filtro .if-rchip.All')
        if (allChip) allChip.classList.toggle('active', _ifRarities.size === 5)
      }
      if (_ifSearch) _ifRenderSearch()
      else _ifRenderItems()
    })
  })
}

function _ifBindTierChips() {
  document.querySelectorAll('#p-filtro .if-tchip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.tier
      if (t === 'All') {
        const allActive = _ifTiers.size === 6
        if (allActive) {
          _ifTiers.clear()
          document.querySelectorAll('#p-filtro .if-tchip').forEach(c => c.classList.remove('active'))
        } else {
          _ifTiers = new Set(['D', 'C', 'B', 'A', 'S', 'SS'])
          document.querySelectorAll('#p-filtro .if-tchip').forEach(c => c.classList.add('active'))
        }
      } else {
        if (_ifTiers.has(t)) { _ifTiers.delete(t); chip.classList.remove('active') }
        else { _ifTiers.add(t); chip.classList.add('active') }
        const allChip = document.querySelector('#p-filtro .if-tchip.All')
        if (allChip) allChip.classList.toggle('active', _ifTiers.size === 6)
      }
      if (_ifSearch) _ifRenderSearch()
      else _ifRenderItems()
    })
  })
}

function _ifBindSearchBar() {
  const searchEl = document.getElementById('ifSearch')
  const clearBtn = document.getElementById('ifSearchClear')
  const refreshBtn = document.getElementById('ifRefresh')

  if (searchEl) {
    searchEl.addEventListener('input', e => {
      _ifSearch = e.target.value.trim()
      if (clearBtn) clearBtn.hidden = !_ifSearch
      if (_ifSearch) _ifRenderSearch()
      else _ifRenderItems()
      _ifUpdateCount()
    })
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchEl) searchEl.value = ''
      _ifSearch = ''
      clearBtn.hidden = true
      _ifRenderItems()
      _ifUpdateCount()
    })
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      _ifLoaded = false
      _ifAllItems = {}
      _ifSearch = ''
      if (searchEl) searchEl.value = ''
      if (clearBtn) clearBtn.hidden = true
      _initItemFilter()
    })
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportBtn      = document.getElementById('ifExport')
  const exportOverlay  = document.getElementById('ifExportOverlay')
  const exportOutput   = document.getElementById('ifExportOutput')
  const exportCountEl  = document.getElementById('ifExportCount')
  const exportStatusEl = document.getElementById('ifExportStatus')
  const exportCopyBtn  = document.getElementById('ifExportCopy')
  const exportDlBtn    = document.getElementById('ifExportDownload')
  const exportCloseBtn = document.getElementById('ifExportClose')

  if (exportBtn && exportOverlay) {
    exportBtn.addEventListener('click', () => {
      const names = [..._ifPersonal]
      if (exportCountEl) exportCountEl.textContent = names.length
      if (exportOutput)  exportOutput.value = btoa(JSON.stringify(names))
      if (exportStatusEl) exportStatusEl.textContent = ''
      exportOverlay.hidden = false
    })
  }
  if (exportCloseBtn && exportOverlay) {
    exportCloseBtn.addEventListener('click', () => { exportOverlay.hidden = true })
  }
  if (exportCopyBtn && exportOutput) {
    exportCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(exportOutput.value).then(() => {
        exportCopyBtn.textContent = tr('filter.copied')
        setTimeout(() => { exportCopyBtn.textContent = tr('filter.copy') }, 1800)
      })
    })
  }
  if (exportDlBtn) {
    exportDlBtn.addEventListener('click', () => {
      const names = [..._ifPersonal]
      const blob = new Blob([JSON.stringify(names, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = 'hs-filter.json'
      a.click()
      URL.revokeObjectURL(url)
      if (exportStatusEl) exportStatusEl.textContent = tr('filter.exported').replace('{n}', names.length)
    })
  }

  // ── Import ──────────────────────────────────────────────────────────────────
  const importBtn   = document.getElementById('ifImport')
  const importOverlay = document.getElementById('ifImportOverlay')
  const importInput = document.getElementById('ifImportInput')
  const statusEl    = document.getElementById('ifImportStatus')
  const fileBtn     = document.getElementById('ifImportFile')
  const mergeBtn    = document.getElementById('ifImportMerge')
  const replaceBtn  = document.getElementById('ifImportReplace')
  const cancelBtn   = document.getElementById('ifImportCancel')

  if (importBtn && importOverlay) {
    importBtn.addEventListener('click', () => {
      if (importInput) importInput.value = ''
      if (statusEl) statusEl.textContent = ''
      importOverlay.hidden = false
      if (importInput) importInput.focus()
    })
  }
  if (cancelBtn && importOverlay) {
    cancelBtn.addEventListener('click', () => { importOverlay.hidden = true })
  }
  if (fileBtn && importInput) {
    fileBtn.addEventListener('click', () => {
      const picker = document.createElement('input')
      picker.type = 'file'
      picker.accept = '.json,.txt'
      picker.onchange = e => {
        const file = e.target.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = ev => {
          const raw = ev.target.result.trim()
          // Se for JSON puro, converte para base64 para manter um único caminho de decodificação
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              importInput.value = btoa(JSON.stringify(parsed))
            } else {
              importInput.value = raw
            }
          } catch {
            importInput.value = raw
          }
          if (statusEl) statusEl.textContent = tr('filter.fileLoaded').replace('{file}', file.name)
        }
        reader.readAsText(file)
      }
      picker.click()
    })
  }

  function _ifApplyImport(mode) {
    if (!importInput || !statusEl) return
    let names
    try {
      names = JSON.parse(atob(importInput.value.trim()))
      if (!Array.isArray(names)) throw new Error()
    } catch {
      statusEl.textContent = tr('filter.invalidString')
      statusEl.style.color = 'var(--satanic)'
      return
    }

    const allKnown = new Set(Object.values(_ifAllItems).flat().map(i => i.name))
    const valid   = names.filter(n => typeof n === 'string' && allKnown.has(n))
    const skipped = names.length - valid.length

    const toRemove = mode === 'replace' ? [..._ifPersonal] : []
    if (mode === 'replace') _ifPersonal.clear()
    for (const n of valid) _ifPersonal.add(n)

    const ops = []
    if (toRemove.length) ops.push(window.api.setAllPersonal(toRemove, false))
    if (valid.length)    ops.push(window.api.setAllPersonal(valid, true))
    Promise.all(ops).then(() => {
      _ifRenderItems()
      _ifBuildCatTabs()
      _ifUpdateCatTabStates()
      _ifUpdateCount()
      importOverlay.hidden = true
    })

    statusEl.style.color = 'var(--text3)'
    statusEl.textContent = tr('filter.applied').replace('{n}', valid.length).replace('{skipped}', skipped ? ` (${skipped})` : '')
  }

  if (mergeBtn)   mergeBtn.addEventListener('click',   () => _ifApplyImport('merge'))
  if (replaceBtn) replaceBtn.addEventListener('click', () => _ifApplyImport('replace'))
}

function _ifPopulatePresetSelect() {
  const sel = document.getElementById('ifPresetSelect')
  if (!sel) return
  sel.innerHTML = `<option value="">${tr('preset.none')}</option>`
  for (const name of Object.keys(_ifPresetsData.presets)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    if (name === _ifPresetsData.active) opt.selected = true
    sel.appendChild(opt)
  }
  if (!_ifPresetsData.active) sel.value = ''
}

function _ifBindPresets() {
  _ifPopulatePresetSelect()

  const sel       = document.getElementById('ifPresetSelect')
  const saveBtn   = document.getElementById('ifPresetSave')
  const saveAsBtn = document.getElementById('ifPresetSaveAs')
  const delBtn    = document.getElementById('ifPresetDelete')

  // Overlay "Salvar como"
  const saveAsOverlay = document.getElementById('ifSaveAsOverlay')
  const saveAsInput   = document.getElementById('ifSaveAsInput')
  const saveAsConfirm = document.getElementById('ifSaveAsConfirm')
  const saveAsCancel  = document.getElementById('ifSaveAsCancel')
  const saveAsStatus  = document.getElementById('ifSaveAsStatus')

  if (sel) {
    sel.addEventListener('change', async () => {
      const name = sel.value
      await window.api.setActivePreset(name)
      _ifPresetsData.active = name || null
      if (name && _ifPresetsData.presets[name]) {
        _ifPersonal = new Set(_ifPresetsData.presets[name])
      } else {
        _ifPersonal = new Set(await window.api.getPersonalEnabled())
      }
      _ifRenderItems()
      _ifBuildCatTabs()
      _ifUpdateCatTabStates()
      _ifUpdateCount()
    })
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const name = _ifPresetsData.active
      if (!name) {
        if (saveAsOverlay) { saveAsOverlay.hidden = false; if (saveAsInput) saveAsInput.focus() }
        return
      }
      _ifPresetsData.presets[name] = [..._ifPersonal]
      await window.api.savePreset(name, [..._ifPersonal])
      saveBtn.textContent = tr('preset.saved')
      setTimeout(() => { saveBtn.textContent = tr('preset.save') }, 1600)
    })
  }

  if (saveAsBtn && saveAsOverlay) {
    saveAsBtn.addEventListener('click', () => {
      if (saveAsInput) saveAsInput.value = ''
      if (saveAsStatus) saveAsStatus.textContent = ''
      saveAsOverlay.hidden = false
      if (saveAsInput) saveAsInput.focus()
    })
  }
  if (saveAsCancel && saveAsOverlay) {
    saveAsCancel.addEventListener('click', () => { saveAsOverlay.hidden = true })
  }
  if (saveAsInput) {
    saveAsInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveAsConfirm?.click()
      if (e.key === 'Escape') saveAsCancel?.click()
    })
  }
  if (saveAsConfirm) {
    saveAsConfirm.addEventListener('click', async () => {
      const name = saveAsInput?.value.trim()
      if (!name) { if (saveAsStatus) saveAsStatus.textContent = tr('preset.nameRequired'); return }
      _ifPresetsData.presets[name] = [..._ifPersonal]
      _ifPresetsData.active = name
      await window.api.savePreset(name, [..._ifPersonal])
      await window.api.setActivePreset(name)
      _ifPopulatePresetSelect()
      saveAsOverlay.hidden = true
    })
  }

  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      const name = _ifPresetsData.active
      if (!name) return
      if (!confirm(tr('preset.deleteConfirm').replace('{name}', name))) return
      const result = await window.api.deletePreset(name)
      delete _ifPresetsData.presets[name]
      _ifPresetsData.active = result.active
      if (result.active && _ifPresetsData.presets[result.active]) {
        _ifPersonal = new Set(_ifPresetsData.presets[result.active])
      }
      _ifPopulatePresetSelect()
      _ifRenderItems()
      _ifUpdateCount()
    })
  }
}

function _ifToggleCategory(cat) {
  if (cat === '__todos__') {
    _ifActiveCategories.clear()
  } else {
    if (_ifActiveCategories.has(cat)) _ifActiveCategories.delete(cat)
    else _ifActiveCategories.add(cat)
  }
  _ifUpdateCatTabStates()
  _ifRenderItems()
}

function _ifUpdateCatTabStates() {
  const allActive = _ifActiveCategories.size === 0
  document.querySelectorAll('.if-cat-tab').forEach(t => {
    if (t.dataset.cat === '__todos__') t.classList.toggle('active', allActive)
    else t.classList.toggle('active', _ifActiveCategories.has(t.dataset.cat))
  })
}

function _ifPassesTierFilter(item) {
  if (!item.tier) return true   // unrated items always pass through
  return _ifTiers.has(item.tier)
}

function _ifRenderItems() {
  const content = document.getElementById('ifContent')
  if (!content) return

  const catsToShow = _ifActiveCategories.size > 0
    ? IF_CAT_ORDER.filter(c => _ifActiveCategories.has(c) && _ifAllItems[c]?.length)
    : IF_CAT_ORDER.filter(c => _ifAllItems[c]?.length)

  const items = []
  for (const cat of catsToShow) {
    for (const it of (_ifAllItems[cat] || [])) {
      if (_ifRarities.has(it.rarity) && _ifPassesTierFilter(it)) items.push({ ...it, cat })
    }
  }

  if (items.length === 0) {
    content.innerHTML = `<div class="if-empty">${tr('filter.noItems')}</div>`
    return
  }

  const myOn = items.filter(i => _ifPersonal.has(i.name)).length
  const label = _ifActiveCategories.size === 0
    ? '☰ TODOS'
    : _ifActiveCategories.size === 1
      ? `${IF_CAT_ICONS[catsToShow[0]] || '•'} ${catsToShow[0].toUpperCase()}`
      : catsToShow.map(c => IF_CAT_ICONS[c] || c).join(' ')

  content.innerHTML = `
    <div class="if-cat-header">
      <h3>${label}</h3>
      <div class="sep"></div>
      <span style="font-size:10px;color:var(--text2)">${tr('filter.countOverlay').replace('{on}', myOn).replace('{total}', items.length)}</span>
    </div>
    <div class="if-select-row">
      <button class="if-btn-mini" id="ifBtnSelectAll">${tr('filter.selectAll')}</button>
      <button class="if-btn-mini deselect" id="ifBtnDeselectAll">${tr('filter.deselectAll')}</button>
    </div>
    <div class="if-item-grid" id="ifItemGrid"></div>
  `

  document.getElementById('ifBtnSelectAll').addEventListener('click', async () => {
    const names = items.map(i => i.name)
    await window.api.setAllPersonal(names, true)
    for (const n of names) _ifPersonal.add(n)
    _ifRenderItems()
    for (const cat of catsToShow) _ifRefreshCatBadge(cat)
    _ifUpdateCount()
  })

  document.getElementById('ifBtnDeselectAll').addEventListener('click', async () => {
    const names = items.map(i => i.name)
    await window.api.setAllPersonal(names, false)
    for (const n of names) _ifPersonal.delete(n)
    _ifRenderItems()
    for (const cat of catsToShow) _ifRefreshCatBadge(cat)
    _ifUpdateCount()
  })

  const grid = document.getElementById('ifItemGrid')
  for (const item of items) {
    const isOn = _ifPersonal.has(item.name)
    const admOn = item.enabled
    const icon = IF_CAT_ICONS[item.cat] || '•'
    const iconContent = item.image_url
      ? `<img src="${item.image_url}" alt="" onerror="this.remove()">`
      : icon

    const card = document.createElement('div')
    card.className = `if-item-card ${item.rarity} ${isOn ? 'personal-on' : 'personal-off'}`
    card.title = isOn ? tr('filter.cardRemove') : tr('filter.cardAdd')
    const tierBadge = item.tier ? `<span class="if-tier-badge ${item.tier}">${item.tier}</span>` : ''
    card.innerHTML = `
      <div class="if-item-icon">${iconContent}</div>
      <div class="if-item-info">
        <div class="if-item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="if-item-meta">
          <span class="if-item-rarity ${item.rarity}">${item.rarity.toUpperCase()}</span>
          ${tierBadge}
          <span class="if-adm-badge ${admOn ? 'on' : 'off'}">${admOn ? 'ADM ✓' : 'ADM ✗'}</span>
        </div>
      </div>
      <label class="if-toggle">
        <input type="checkbox" ${isOn ? 'checked' : ''}>
        <span class="if-toggle-track"></span>
      </label>
    `

    card.addEventListener('click', async () => {
      const newState = await window.api.togglePersonal(item.name)
      if (newState) _ifPersonal.add(item.name)
      else _ifPersonal.delete(item.name)

      card.classList.toggle('personal-on', newState)
      card.classList.toggle('personal-off', !newState)
      card.title = newState ? tr('filter.cardRemove') : tr('filter.cardAdd')
      card.querySelector('input').checked = newState

      const header = content.querySelector('.if-cat-header span')
      if (header) {
        const myCount = items.filter(i => _ifPersonal.has(i.name)).length
        header.textContent = tr('filter.countOverlay').replace('{on}', myCount).replace('{total}', items.length)
      }
      _ifRefreshCatBadge(item.cat)
      _ifUpdateCount()
    })

    grid.appendChild(card)
  }
}

function _ifRenderSearch() {
  const content = document.getElementById('ifContent')
  if (!content) return
  const q = _ifSearch.toLowerCase()

  const results = []
  for (const cat of IF_CAT_ORDER) {
    for (const item of (_ifAllItems[cat] || [])) {
      if (!_ifRarities.has(item.rarity)) continue
      if (!_ifPassesTierFilter(item)) continue
      if (!item.name.toLowerCase().includes(q)) continue
      results.push({ ...item, cat })
    }
  }

  if (results.length === 0) {
    content.innerHTML = `<div class="if-empty">${tr('filter.noSearchResults').replace('{q}', `<strong>${esc(_ifSearch)}</strong>`)}</div>`
    return
  }

  content.innerHTML = `
    <div class="if-cat-header">
      <h3>🔍 RESULTADOS</h3>
      <div class="sep"></div>
      <span style="font-size:10px;color:var(--text2)">${results.length} item(s)</span>
    </div>
    <div class="if-item-grid" id="ifItemGrid"></div>
  `

  const grid = document.getElementById('ifItemGrid')
  for (const item of results) {
    const isOn = _ifPersonal.has(item.name)
    const admOn = item.enabled
    const icon = IF_CAT_ICONS[item.cat] || '•'
    const iconContent = item.image_url
      ? `<img src="${item.image_url}" alt="" onerror="this.remove()">`
      : icon
    const tierBadge = item.tier ? `<span class="if-tier-badge ${item.tier}">${item.tier}</span>` : ''

    const card = document.createElement('div')
    card.className = `if-item-card ${item.rarity} ${isOn ? 'personal-on' : 'personal-off'}`
    card.title = isOn ? tr('filter.cardRemove') : tr('filter.cardAdd')
    card.innerHTML = `
      <div class="if-item-icon">${iconContent}</div>
      <div class="if-item-info">
        <div class="if-item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="if-item-meta">
          <span class="if-item-rarity ${item.rarity}">${item.rarity.toUpperCase()}</span>
          <span style="font-size:9px;color:var(--text2);font-family:'Chakra Petch',sans-serif">${esc(item.cat)}</span>
          ${tierBadge}
          <span class="if-adm-badge ${admOn ? 'on' : 'off'}">${admOn ? 'ADM ✓' : 'ADM ✗'}</span>
        </div>
      </div>
      <label class="if-toggle">
        <input type="checkbox" ${isOn ? 'checked' : ''}>
        <span class="if-toggle-track"></span>
      </label>
    `

    card.addEventListener('click', async () => {
      const newState = await window.api.togglePersonal(item.name)
      if (newState) _ifPersonal.add(item.name)
      else _ifPersonal.delete(item.name)

      card.classList.toggle('personal-on', newState)
      card.classList.toggle('personal-off', !newState)
      card.title = newState ? tr('filter.cardRemove') : tr('filter.cardAdd')
      card.querySelector('input').checked = newState

      _ifRefreshCatBadge(item.cat)
      _ifUpdateCount()
    })

    grid.appendChild(card)
  }
}

function _ifUpdateCount() {
  let total = 0, myActive = 0
  for (const cat of Object.keys(_ifAllItems)) {
    for (const item of _ifAllItems[cat]) {
      total++
      if (_ifPersonal.has(item.name)) myActive++
    }
  }
  const el = document.getElementById('ifCount')
  if (el) el.textContent = total > 0 ? tr('filter.countOverlay').replace('{on}', myActive).replace('{total}', total) : ''
}

// ── Report ───────────────────────────────────────────────────────────────────
;(function initReport() {
  const rptTitle     = document.getElementById('rptTitle')
  const rptText      = document.getElementById('rptText')
  const rptPickImg   = document.getElementById('rptPickImg')
  const rptFileInput = document.getElementById('rptFileInput')
  const rptImgName   = document.getElementById('rptImgName')
  const rptClearImg  = document.getElementById('rptClearImg')
  const rptImgPreview = document.getElementById('rptImgPreview')
  const rptIncludeLog = document.getElementById('rptIncludeLog')
  const rptSend      = document.getElementById('rptSend')
  const rptStatus    = document.getElementById('rptStatus')
  if (!rptSend) return

  let _imgPath = null

  rptPickImg.addEventListener('click', () => rptFileInput.click())

  rptFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (!file) return
    _imgPath = file.path
    rptImgName.textContent = file.name
    rptClearImg.style.display = 'inline'
    const reader = new FileReader()
    reader.onload = (ev) => { rptImgPreview.src = ev.target.result; rptImgPreview.style.display = 'block' }
    reader.readAsDataURL(file)
  })

  rptClearImg.addEventListener('click', () => {
    _imgPath = null
    rptImgName.textContent = ''
    rptClearImg.style.display = 'none'
    rptImgPreview.style.display = 'none'
    rptImgPreview.src = ''
    rptFileInput.value = ''
  })

  rptSend.addEventListener('click', async () => {
    const title = rptTitle ? rptTitle.value.trim() : ''
    const text  = rptText.value.trim()
    if (!title) {
      rptStatus.textContent = 'Por favor, adicione um título antes de enviar.'
      rptStatus.className = 'rpt-status error'
      return
    }
    if (!text) {
      rptStatus.textContent = 'Por favor, descreva o problema antes de enviar.'
      rptStatus.className = 'rpt-status error'
      return
    }
    rptSend.disabled = true
    rptStatus.textContent = 'Enviando...'
    rptStatus.className = 'rpt-status'

    const result = await window.api.sendReport(title, text, _imgPath, rptIncludeLog.checked)

    if (result.ok) {
      rptStatus.textContent = '✓ Report enviado! Obrigado pelo feedback.'
      rptStatus.className = 'rpt-status ok'
      rptTitle.value = ''
      rptText.value = ''
      _imgPath = null
      rptImgName.textContent = ''
      rptClearImg.style.display = 'none'
      rptImgPreview.style.display = 'none'
      rptImgPreview.src = ''
      rptFileInput.value = ''
    } else {
      rptStatus.textContent = `Erro ao enviar: ${result.error}`
      rptStatus.className = 'rpt-status error'
    }
    rptSend.disabled = false
  })
})()

// ── Init ─────────────────────────────────────────────────────────────────────
loadSettings()
initAuth()
