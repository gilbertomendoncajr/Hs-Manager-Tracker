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
const logList       = document.getElementById('logList')
const logEmpty      = document.getElementById('logEmpty')
const btnClearLog   = document.getElementById('btnClearLog')
const statDrops     = document.getElementById('statDrops')
const statRares     = document.getElementById('statRares')
const dropCount     = document.getElementById('dropCount')
const rareCount     = document.getElementById('rareCount')

const RARE_RARITIES = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Blessed', 'Set'])
let sessionDrops = 0
let sessionRares = 0

let isMonitoring = false

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

function addLogEntry({ type, message, item, ts }) {
  logEmpty.style.display = 'none'

  if (type === 'detect') {
    sessionDrops++
    dropCount.textContent = sessionDrops
    const rarity = item?.rarity || rarityFromMsg(message)
    if (rarity && RARE_RARITIES.has(rarity)) {
      sessionRares++
      rareCount.textContent = sessionRares
    }
  }

  const rarity = item?.rarity || rarityFromMsg(message)
  const stripeColor = (type === 'detect' && rarity) ? RARITY_COLORS[rarity] : ''

  const el = document.createElement('div')
  el.className = `log-entry ${type}`
  el.innerHTML = `
    <div class="log-stripe" style="background:${stripeColor || 'transparent'}"></div>
    <div class="log-inner">
      <span class="log-time">${fmtTime(ts)}</span>
      <span class="log-msg">${message}</span>
    </div>
  `
  logList.insertBefore(el, logList.firstChild)
}

function setMonitorUI(watching, charIdentified) {
  isMonitoring = watching
  if (!watching) {
    btnToggle.textContent = '▶ INICIAR'
    btnToggle.className = 'start'
    btnToggle.disabled = false
    statusDot.className = 'stat idle'
    statusText.textContent = 'Aguardando'
    sessionDrops = 0
    sessionRares = 0
    dropCount.textContent = '0'
    rareCount.textContent = '0'
    statDrops.style.display = 'none'
    statRares.style.display = 'none'
  } else if (!charIdentified) {
    btnToggle.textContent = '■ PAUSAR'
    btnToggle.className = 'stop'
    btnToggle.disabled = false
    statusDot.className = 'stat waiting'
    statusText.textContent = 'Aguardando relog...'
    statDrops.style.display = 'none'
    statRares.style.display = 'none'
  } else {
    btnToggle.textContent = '■ PAUSAR'
    btnToggle.className = 'stop'
    btnToggle.disabled = false
    statusDot.className = 'stat watching'
    statusText.textContent = 'Monitorando'
    statDrops.style.display = 'flex'
    statRares.style.display = 'flex'
  }
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

  btnToggle.disabled = false
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function initAuth() {
  const session = await window.api.getSession()
  if (!session) {
    showScreen('login')
    return
  }
  userNameText.textContent = session.discordUsername || session.discordId
  userBadge.style.display = 'flex'
  showScreen('app')
  await loadLeagues()
  const state = await window.api.getMonitorState()
  setMonitorUI(state.isMonitoring, state.charIdentified)
}

btnLogin.addEventListener('click', async () => {
  btnLogin.disabled = true
  btnLogin.textContent = 'Abrindo Discord...'
  const result = await window.api.login()
  if (result.ok) {
    await initAuth()
  } else if (!result.cancelled) {
    btnLogin.textContent = 'Entrar com Discord'
    btnLogin.disabled = false
  } else {
    btnLogin.textContent = 'Entrar com Discord'
    btnLogin.disabled = false
  }
})

btnFilter.addEventListener('click', () => window.api.openFilter())

btnLogout.addEventListener('click', async () => {
  await window.api.logout()
  userBadge.style.display = 'none'
  setMonitorUI(false)
  showScreen('login')
  btnLogin.textContent = 'Entrar com Discord'
  btnLogin.disabled = false
})

// ── Monitor ──────────────────────────────────────────────────────────────────
btnToggle.addEventListener('click', async () => {
  if (isMonitoring) {
    await window.api.stopMonitor()
  } else {
    const leagueId = leagueSelect.value
    if (!leagueId) return
    btnToggle.disabled = true
    const result = await window.api.startMonitor(parseInt(leagueId))
    btnToggle.disabled = false
    if (result.needsNpcap) {
      const install = confirm('O Npcap precisa estar instalado para capturar pacotes.\n\nDeseja instalar agora?')
      if (install) {
        await window.api.installNpcap()
        addLogEntry({ type: 'info', message: '⚙ Instalando Npcap... Após instalar, clique INICIAR novamente.', ts: Date.now() })
      }
    } else if (!result.ok) {
      addLogEntry({ type: 'error', message: result.error, ts: Date.now() })
    }
  }
})

// ── Eventos do main ──────────────────────────────────────────────────────────
window.api.onLog((entry) => addLogEntry(entry))
window.api.onStateChange((state) => setMonitorUI(state.isMonitoring, state.charIdentified))
window.api.onSessionExpired(() => {
  userBadge.style.display = 'none'
  setMonitorUI(false)
  showScreen('login')
  btnLogin.textContent = 'Entrar com Discord'
  btnLogin.disabled = false
})

btnClearLog.addEventListener('click', () => {
  logList.innerHTML = ''
  logEmpty.style.display = 'flex'
  logList.appendChild(logEmpty)
  sessionDrops = 0; sessionRares = 0
  dropCount.textContent = '0'
  rareCount.textContent = '0'
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
  updateText.textContent = `🔄 Nova versão ${info.version} disponível`
  btnInstallUpdate.textContent = 'ATUALIZAR'
  btnInstallUpdate.style.display = 'block'
  btnInstallUpdate.disabled = false
  btnInstallUpdate.onclick = async () => {
    btnInstallUpdate.disabled = true
    btnInstallUpdate.textContent = 'BAIXANDO...'
    updateProgress.style.display = 'block'
    await window.api.downloadUpdate()
  }
})

window.api.onUpdateProgress((data) => {
  updateBar.style.width = `${data.percent}%`
  updateText.textContent = `🔄 Baixando... ${data.percent}%`
})

window.api.onUpdateReady((data) => {
  pendingFilePath = data.filePath
  updateBar.style.width = '100%'
  updateText.textContent = '✅ Atualização pronta!'
  updateProgress.style.display = 'none'
  btnInstallUpdate.disabled = false
  btnInstallUpdate.textContent = 'INSTALAR E REINICIAR'
  btnInstallUpdate.onclick = () => window.api.installUpdate(pendingFilePath)
})

// ── Init ─────────────────────────────────────────────────────────────────────
initAuth()
