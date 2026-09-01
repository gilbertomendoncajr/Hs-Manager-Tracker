// ── DOM refs ────────────────────────────────────────────────────────────────
const screenLogin   = document.getElementById('screenLogin')
const screenApp     = document.getElementById('screenApp')
const userBadge     = document.getElementById('userBadge')
const userNameText  = document.getElementById('userNameText')
const btnLogin      = document.getElementById('btnLogin')
const btnLogout     = document.getElementById('btnLogout')
const leagueSelect  = document.getElementById('leagueSelect')
const btnToggle     = document.getElementById('btnToggleMonitor')
const statusDot     = document.getElementById('statusDot')
const statusText    = document.getElementById('statusText')
const logList       = document.getElementById('logList')
const logEmpty      = document.getElementById('logEmpty')
const watchItems    = document.getElementById('watchlistItems')
const watchInput    = document.getElementById('watchInput')
const btnAddWatch   = document.getElementById('btnAddWatch')
const btnClearLog   = document.getElementById('btnClearLog')

let isMonitoring = false

// ── Utils ────────────────────────────────────────────────────────────────────
function showScreen(name) {
  screenLogin.classList.toggle('active', name === 'login')
  screenApp.classList.toggle('active',   name === 'app')
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function addLogEntry({ type, message, ts }) {
  logEmpty.style.display = 'none'
  const el = document.createElement('div')
  el.className = `log-entry ${type}`
  el.innerHTML = `<span class="log-time">${fmtTime(ts)}</span><span class="log-msg">${message}</span>`
  logList.insertBefore(el, logList.firstChild)
}

function setMonitorUI(watching) {
  isMonitoring = watching
  if (watching) {
    btnToggle.textContent = '■ Pausar'
    btnToggle.className = 'stop'
    statusDot.className = 'status-dot watching'
    statusText.textContent = 'Monitorando'
  } else {
    btnToggle.textContent = '▶ Iniciar'
    btnToggle.className = 'start'
    statusDot.className = 'status-dot idle'
    statusText.textContent = 'Aguardando'
  }
}

// ── Watchlist ────────────────────────────────────────────────────────────────
async function renderWatchlist() {
  const list = await window.api.getWatchlist()
  watchItems.innerHTML = ''
  list.forEach((entry) => {
    const chip = document.createElement('div')
    chip.className = 'watch-chip'
    chip.innerHTML = `<span>${entry}</span><button class="remove" data-entry="${entry}" title="Remover">×</button>`
    watchItems.appendChild(chip)
  })
  watchItems.querySelectorAll('.remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = btn.dataset.entry
      const current = await window.api.getWatchlist()
      await window.api.setWatchlist(current.filter((e) => e !== entry))
      renderWatchlist()
    })
  })
}

btnAddWatch.addEventListener('click', async () => {
  const val = watchInput.value.trim()
  if (!val) return
  const current = await window.api.getWatchlist()
  if (current.includes(val)) { watchInput.value = ''; return }
  await window.api.setWatchlist([...current, val])
  watchInput.value = ''
  renderWatchlist()
})

watchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnAddWatch.click() })

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
  await renderWatchlist()
  const state = await window.api.getMonitorState()
  setMonitorUI(state.isMonitoring)
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
    if (!result.ok) {
      addLogEntry({ type: 'error', message: result.error, ts: Date.now() })
    }
  }
})

// ── Eventos do main ──────────────────────────────────────────────────────────
window.api.onLog((entry) => addLogEntry(entry))
window.api.onStateChange((state) => setMonitorUI(state.isMonitoring))

btnClearLog.addEventListener('click', () => {
  logList.innerHTML = ''
  logEmpty.style.display = 'flex'
  logList.appendChild(logEmpty)
})

// ── Init ─────────────────────────────────────────────────────────────────────
initAuth()
