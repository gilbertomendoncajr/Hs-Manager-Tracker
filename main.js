const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')
const readline = require('readline')

// electron-store v8 é ESM — usar dynamic import
let store
async function getStore() {
  if (!store) {
    const { default: Store } = await import('electron-store')
    store = new Store({
      defaults: {
        sessionToken: null,
        selectedLeagueId: null,
        closeBehavior: 'tray',
        appTheme: 'dark',
        appLang: 'pt',
      },
    })
  }
  return store
}

const BASE_URL = 'http://109.199.115.128'

// Em produção usa sniffer.exe compilado; em dev usa Python diretamente
const isPackaged = app.isPackaged
const RESOURCES  = isPackaged ? process.resourcesPath : __dirname
const SNIFFER_EXE = isPackaged
  ? path.join(RESOURCES, 'sniffer.exe')
  : null
const SNIFFER_PY = path.join(__dirname, 'sniffer.py')

let mainWin = null
let tray = null
let compactWin = null
let flourishWin = null
let tickerWin = null
let filterWin = null
let serverEnabledItems = null   // Set<string> | null — null = not loaded yet (allow all)
let serverTierMap = {}          // Record<string, string> — name → tier
let serverCategoryMap = {}      // Record<string, string> — name → category (item type)
let dropHistory = []            // Array of {ch, payload} — replayed to compact on open
const DROP_HISTORY_MAX = 300
let currentLang = 'pt'

function t(pt, en) { return currentLang === 'en' ? en : pt }

// ── Filtro pessoal (local) ───────────────────────────────────────────────────
let personalFilter = new Set()  // Set<string> — nomes de itens que ativam o overlay
let _personalFilterPath = null  // calculado após app.ready

function personalFilterPath() {
  if (!_personalFilterPath) {
    _personalFilterPath = path.join(app.getPath('userData'), 'personal-filter.json')
  }
  return _personalFilterPath
}

function loadPersonalFilter() {
  try {
    const data = JSON.parse(fs.readFileSync(personalFilterPath(), 'utf8'))
    personalFilter = new Set(Array.isArray(data.enabled) ? data.enabled : [])
  } catch { personalFilter = new Set() }
}

function savePersonalFilter() {
  try { fs.writeFileSync(personalFilterPath(), JSON.stringify({ enabled: [...personalFilter] })) }
  catch {}
}
let snifferProc = null
let sseAbort = null   // AbortController para fechar a conexão SSE ao parar
let isMonitoring = false
let currentLeagueId = null
const charMap = {}   // accountUID (number) → charName (string)
let myDiscordId = null
let myDiscordUsername = null
let charIdentified = false

// ── Janela principal ────────────────────────────────────────────────────────
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 780,
    height: 580,
    minWidth: 680,
    minHeight: 480,
    frame: false,
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#08060b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWin.loadFile('index.html')
  mainWin.setMenuBarVisibility(false)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('HS Drop Logger')
  tray.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus() } })
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir / Open', click: () => { if (mainWin) { mainWin.show(); mainWin.focus() } } },
    { type: 'separator' },
    { label: 'Fechar / Quit', click: () => app.quit() },
  ]))
}

ipcMain.on('win:minimize', () => mainWin && mainWin.minimize())
ipcMain.on('win:close', async () => {
  if (!mainWin) return
  const s = await getStore()
  const pref = s.get('closeBehavior', 'tray')
  if (pref === 'tray') {
    mainWin.hide()
    if (!tray) createTray()
  } else {
    app.quit()
  }
})

ipcMain.handle('settings:getCloseBehavior', async () => {
  const s = await getStore()
  return s.get('closeBehavior', 'tray')
})
ipcMain.handle('settings:setCloseBehavior', async (e, val) => {
  const s = await getStore()
  s.set('closeBehavior', val)
})
ipcMain.handle('settings:getStartup', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('settings:setStartup', (e, val) => {
  app.setLoginItemSettings({ openAtLogin: !!val })
})
ipcMain.handle('settings:getTheme', async () => {
  const s = await getStore()
  return s.get('appTheme', 'dark')
})
ipcMain.handle('settings:setTheme', async (e, val) => {
  const s = await getStore()
  s.set('appTheme', val)
})
ipcMain.handle('settings:getLang', async () => {
  const s = await getStore()
  return s.get('appLang', 'pt')
})
ipcMain.handle('settings:setLang', async (e, val) => {
  const s = await getStore()
  s.set('appLang', val)
  currentLang = val
})

// ── Janelas overlay ─────────────────────────────────────────────────────────
function createOverlays() {
  const OVERLAY_PRELOAD = path.join(__dirname, 'preload-overlay.js')
  const { screen } = require('electron')
  const { width } = screen.getPrimaryDisplay().workAreaSize

  flourishWin = new BrowserWindow({
    width: 444, height: 199,
    x: Math.round(width / 2 - 222), y: 20,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: false,
    webPreferences: { preload: OVERLAY_PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  flourishWin.loadFile('flourish.html')
  flourishWin.setIgnoreMouseEvents(true)

  tickerWin = new BrowserWindow({
    width: 578, height: 221,
    x: Math.round(width / 2 - 289), y: 20,
    transparent: true, frame: false,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: false,
    webPreferences: { preload: OVERLAY_PRELOAD, contextIsolation: true, nodeIntegration: false },
  })
  tickerWin.loadFile('ticker.html')
  tickerWin.setIgnoreMouseEvents(true)
}

function sendOverlay(drop) {
  if (tickerWin && !tickerWin.isDestroyed()) tickerWin.webContents.send('overlay:drop', drop)
}

app.whenReady().then(async () => {
  const s = await getStore()
  currentLang = s.get('appLang', 'pt')
  loadPersonalFilter()
  createMainWindow()
  createOverlays()

  if (app.isPackaged) {
    autoUpdater.autoDownload = false
    autoUpdater.checkForUpdates()
    setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000)
  }
})

// ── Auto-updater ────────────────────────────────────────────────────────────
let pendingUpdate = null

autoUpdater.on('update-available', (info) => {
  pendingUpdate = info
  if (mainWin) mainWin.webContents.send('update:available', { version: info.version })
})


autoUpdater.on('error', (err) => {
  console.error('[updater] erro:', err?.message ?? err)
  if (mainWin) mainWin.webContents.send('log:entry', {
    type: 'info',
    message: `[updater] ${err?.message ?? err}`,
    item: null,
    ts: Date.now(),
  })
})

autoUpdater.on('checking-for-update', () => {
  console.log('[updater] verificando atualizações...')
})

autoUpdater.on('update-not-available', () => {
  console.log('[updater] app já está na versão mais recente')
})

ipcMain.handle('update:download', async () => {
  if (!pendingUpdate) return
  const https = require('https')
  const fs = require('fs')
  const os = require('os')

  const version = pendingUpdate.version

  const fail = (msg) => {
    if (mainWin) mainWin.webContents.send('log:entry', { type: 'error', message: `[updater] ${msg}`, item: null, ts: Date.now() })
  }

  // Buscar URL real do asset via GitHub API (evita problema de espaços/dashes no nome)
  const getReleaseAssetUrl = () => new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/gilbertomendoncajr/Hs-Manager-Tracker/releases/tags/v${version}`,
      headers: { 'User-Agent': 'HS-Drop-Logger' },
    }
    https.get(opts, (res) => {
      let body = ''
      res.on('data', (c) => body += c)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          const asset = data.assets?.find((a) => a.name.endsWith('.exe'))
          if (!asset) return reject(new Error('EXE não encontrado no release'))
          resolve({ url: asset.browser_download_url, name: asset.name })
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })

  const followAndDownload = (currentUrl, dest) => {
    https.get(currentUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        followAndDownload(res.headers.location, dest)
        return
      }
      if (res.statusCode !== 200) { fail(`HTTP ${res.statusCode}`); return }

      const total = parseInt(res.headers['content-length'] || '0', 10)
      let downloaded = 0
      const file = fs.createWriteStream(dest)

      res.on('data', (chunk) => {
        downloaded += chunk.length
        if (total > 0 && mainWin) {
          mainWin.webContents.send('update:progress', { percent: Math.round((downloaded / total) * 100) })
        }
      })

      res.pipe(file)
      file.on('finish', () => file.close(() => {
        if (mainWin) mainWin.webContents.send('update:ready', { filePath: dest })
      }))
      file.on('error', (err) => { fs.unlink(dest, () => {}); fail(err.message) })
    }).on('error', (err) => fail(err.message))
  }

  try {
    const { url, name } = await getReleaseAssetUrl()
    const dest = path.join(os.tmpdir(), name)
    followAndDownload(url, dest)
  } catch (err) {
    fail(err.message)
  }
})

ipcMain.handle('update:install', (_e, filePath) => {
  const { shell } = require('electron')
  shell.openPath(filePath)
  setTimeout(() => app.quit(), 1500)
})
app.on('window-all-closed', () => {
  stopMonitor()
  if (flourishWin && !flourishWin.isDestroyed()) flourishWin.destroy()
  if (tickerWin   && !tickerWin.isDestroyed())   tickerWin.destroy()
  app.quit()
})

// ── Helpers de API ──────────────────────────────────────────────────────────
async function apiFetch(urlPath, options = {}) {
  const s = await getStore()
  const token = s.get('sessionToken')
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: token ? `next-auth.session-token=${token}` : '',
      ...(options.headers || {}),
    },
  })

  // Sessão expirou — avisar o usuário para relogar
  if (res.status === 401) {
    sendLog('error', t('⚠ Sessão expirada. Faça login novamente.', '⚠ Session expired. Please log in again.'))
    if (mainWin) mainWin.webContents.send('auth:sessionExpired')
  }

  return res
}

function sendToWin(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function sendLog(type, message, item = null, tab = 'both') {
  const entry = { type, message, item, ts: Date.now(), tab }
  sendToWin(mainWin, 'log:entry', entry)
  sendToWin(compactWin, 'log:entry', entry)
}

function sendState() {
  const knownChars = Object.values(charMap)
  const charName = knownChars.length > 0 ? knownChars[knownChars.length - 1] : null
  const state = { isMonitoring, leagueId: currentLeagueId, charIdentified, charName }
  sendToWin(mainWin, 'monitor:stateChange', state)
  sendToWin(compactWin, 'monitor:stateChange', state)
}

function pushHistory(ch, payload) {
  dropHistory.push({ ch, payload })
  if (dropHistory.length > DROP_HISTORY_MAX) dropHistory.shift()
}

function createCompactWindow() {
  const { screen } = require('electron')
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  compactWin = new BrowserWindow({
    width: 320,
    height: 460,
    minWidth: 260,
    maxWidth: 720,
    minHeight: 200,
    x: width - 340,
    y: Math.round(height / 2 - 230),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-compact.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  compactWin.loadFile('compact.html')
  compactWin.webContents.once('did-finish-load', () => {
    for (const { ch, payload } of dropHistory) {
      sendToWin(compactWin, ch, payload)
    }
  })
  compactWin.on('closed', () => {
    compactWin = null
    // Restore main window when compact closes for any reason
    if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus() }
  })
}

ipcMain.handle('compact:toggle', () => {
  if (compactWin && !compactWin.isDestroyed()) {
    compactWin.close()
    // main window restored via 'closed' handler
  } else {
    createCompactWindow()
    if (mainWin) mainWin.hide()
  }
})

ipcMain.on('compact:close', () => {
  if (compactWin && !compactWin.isDestroyed()) {
    compactWin.close()
    // main window restored via 'closed' handler
  } else {
    if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus() }
  }
})

// ── Auth: OAuth via BrowserWindow separada ──────────────────────────────────
ipcMain.handle('auth:login', () => {
  return new Promise((resolve) => {
    const authWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Login — HS Manager',
      webPreferences: { partition: `temp:hs-auth-${Date.now()}` },
    })

    authWin.loadURL(`${BASE_URL}/api/auth/signin/discord`)

    const tryExtract = async (url) => {
      console.log('[auth] navigated:', url)
      if (!url.startsWith(BASE_URL)) return
      if (url.includes('/api/auth')) return
      const cookies = await authWin.webContents.session.cookies.get({
        url: BASE_URL,
        name: 'next-auth.session-token',
      })
      console.log('[auth] cookies found:', cookies.length)
      if (cookies.length > 0) {
        console.log('[auth] saving token:', cookies[0].value.slice(0, 30) + '...')
        const s = await getStore()
        s.set('sessionToken', cookies[0].value)
        authWin.close()
        resolve({ ok: true })
      }
    }

    authWin.webContents.on('did-navigate', (_e, url) => tryExtract(url))
    authWin.webContents.on('did-navigate-in-page', (_e, url) => tryExtract(url))
    authWin.on('closed', () => resolve({ ok: false, cancelled: true }))
  })
})

ipcMain.handle('auth:logout', async () => {
  const s = await getStore()
  s.set('sessionToken', null)
  // Limpar cookies da partição para forçar login limpo na próxima vez
  const { session: electronSession } = require('electron')
  await electronSession.fromPartition('persist:hs-auth').clearStorageData()
  stopMonitor()
})

ipcMain.handle('auth:getSession', async () => {
  const s = await getStore()
  const token = s.get('sessionToken')
  if (!token) return null
  try {
    const res = await apiFetch('/api/perfil')
    if (!res.ok) { s.set('sessionToken', null); return null }
    const data = await res.json()
    return { discordUsername: data.username, discordId: data.discordId }
  } catch { return null }
})

// ── Ligas ativo do jogador ──────────────────────────────────────────────────
ipcMain.handle('site:getLeagues', async () => {
  try {
    const res = await apiFetch('/api/perfil')
    if (!res.ok) return []
    const data = await res.json()
    const seen = new Set()
    const leagues = []
    for (const reg of data.registrations ?? []) {
      if (!reg.isLeagueActive) continue
      if (seen.has(reg.leagueId)) continue
      seen.add(reg.leagueId)
      leagues.push({ id: reg.leagueId, name: reg.leagueName, guildName: reg.guildName, seasonNumber: reg.seasonNumber })
    }
    return leagues
  } catch { return [] }
})

const LOOT_FILTER = ['Heroic', 'Satanic', 'Angelic', 'Unholy', 'Set']

// ── Post drop para o site ───────────────────────────────────────────────────
async function postDrop(leagueId, drop) {
  let wikiTitle = null, wikiImage = null, wikiCategory = null
  try {
    const wikiRes = await apiFetch(`/api/wiki/search?q=${encodeURIComponent(drop.name)}&exact=1`)
    if (wikiRes.ok) {
      const results = await wikiRes.json()
      if (results.length > 0) {
        wikiTitle = results[0].title
        wikiImage = results[0].imageUrl ?? null
        wikiCategory = results[0].category ?? null
      }
    }
  } catch { /* sem wiki */ }

  let res
  try {
    res = await apiFetch(`/api/dashboard/leagues/${leagueId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        itemName: drop.name,
        itemWikiTitle: wikiTitle,
        itemImageUrl: wikiImage,
        category: wikiCategory,
        rarity: drop.rarity ?? null,
        tier: drop.tier ?? null,
        charName: drop.charName ?? null,
      }),
    })
  } catch (err) {
    sendLog('error', t(`✘ Erro de rede ao registrar ${drop.name}: ${err.message}`, `✘ Network error posting ${drop.name}: ${err.message}`), drop)
    return
  }

  if (res.ok) {
    const charPart = drop.charName || myDiscordUsername || ''
    const discordPart = drop.charName && myDiscordUsername ? ` / ${myDiscordUsername}` : ''
    const who = charPart ? ` [${charPart}${discordPart}]` : ''
    const tierVal = drop.tier ?? serverTierMap[drop.name] ?? null
    const tier = tierVal ? ` [${tierVal}]` : ''
    sendLog('detect', `🎯 ${drop.name}${tier} (${drop.rarity})${who}`, drop, 'liga')
  } else {
    const err = await res.json().catch(() => ({}))
    sendLog('error', t(`✘ Falha ao registrar ${drop.name}: ${err.error ?? res.status}`, `✘ Failed to post ${drop.name}: ${err.error ?? res.status}`), drop)
  }
}

// ── SSE: receber drops de outros jogadores em tempo real ────────────────────
async function connectSSE(leagueId) {
  if (sseAbort) sseAbort.abort()
  sseAbort = new AbortController()

  const s = await getStore()
  const token = s.get('sessionToken')
  const headers = {
    Accept: 'text/event-stream',
    Cookie: token ? `next-auth.session-token=${token}` : '',
  }

  let buf = ''
  try {
    const res = await fetch(`${BASE_URL}/api/dashboard/leagues/${leagueId}/stream`, {
      headers,
      signal: sseAbort.signal,
    })
    if (!res.ok || !res.body) return

    const reader = res.body.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done || sseAbort.signal.aborted) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6))

          // Notificação de nova versão do app
          if (evt.type === 'version_update') {
            if (mainWin) mainWin.webContents.send('update:available', { version: evt.version })
            continue
          }

          // Ignorar drops do próprio jogador (já apareceram via sniffer)
          if (myDiscordId && evt.dropper?.discordId === myDiscordId) continue
          const drop = {
            name: evt.itemName,
            rarity: evt.rarity,
            tier: evt.tier,
            charName: evt.charName ?? evt.dropper?.username ?? null,
          }
          const who = evt.charName && evt.dropper?.username
            ? `${evt.charName} (${evt.dropper.username})`
            : (evt.charName ?? evt.dropper?.username ?? 'Alguém')
          sendLog('detect', t(`🌐 ${who} dropou: ${drop.name} (${drop.rarity || '?'})`, `🌐 ${who} dropped: ${drop.name} (${drop.rarity || '?'})`), drop, 'liga')
          sendOverlay(drop)
        } catch { /* linha malformada */ }
      }
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.warn('[SSE] desconectado —', err?.message ?? err)
      // Auto-reconectar após 5 segundos se não foi desconexão intencional
      if (!sseAbort?.signal.aborted) {
        setTimeout(() => connectSSE(leagueId), 5000)
      }
    }
  }
}

// ── Connection monitor (detects area transitions via netstat — equiv. ao netstat2 do HS Tracker) ──
let _connMonitor = null
let _lastGameIPs = new Set()
let _cachedGamePid = null
let _pidCacheMs = 0

async function _getHeroSiegePid() {
  if (Date.now() - _pidCacheMs < 5_000 && _cachedGamePid !== null) return _cachedGamePid
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq HeroSiege.exe" /FO CSV /NH 2>NUL', (err, stdout) => {
      _pidCacheMs = Date.now()
      const match = (stdout || '').match(/"HeroSiege\.exe","(\d+)"/)
      _cachedGamePid = match ? parseInt(match[1]) : null
      resolve(_cachedGamePid)
    })
  })
}

async function _getGameRemoteIPs(pid) {
  return new Promise((resolve) => {
    exec('netstat -ano -p TCP', (err, stdout) => {
      if (!stdout) return resolve(new Set())
      const ips = new Set()
      const pidStr = String(pid)
      for (const line of stdout.split('\n')) {
        const cols = line.trim().split(/\s+/)
        if (cols.length < 5 || cols[0] !== 'TCP' || cols[3] !== 'ESTABLISHED' || cols[4] !== pidStr) continue
        const lastColon = cols[2].lastIndexOf(':')
        if (lastColon < 1) continue
        const ip = cols[2].slice(0, lastColon)
        if (ip && ip !== '0.0.0.0' && !ip.startsWith('127.')) ips.add(ip)
      }
      resolve(ips)
    })
  })
}

function _startConnMonitor() {
  if (_connMonitor) return
  _lastGameIPs = new Set()
  _cachedGamePid = null
  _pidCacheMs = 0
  _connMonitor = setInterval(async () => {
    if (!isMonitoring) return
    try {
      const pid = await _getHeroSiegePid()
      if (!pid) return
      const ips = await _getGameRemoteIPs(pid)
      if (ips.size === 0) return
      const added = [...ips].filter(ip => !_lastGameIPs.has(ip))
      if (_lastGameIPs.size > 0 && added.length > 0) {
        lastSnifferEventMs = Date.now()
        spawnSniffer()
      }
      _lastGameIPs = ips
    } catch { /* ignore */ }
  }, 2_000)
}

function _stopConnMonitor() {
  if (_connMonitor) { clearInterval(_connMonitor); _connMonitor = null }
  _lastGameIPs = new Set()
  _cachedGamePid = null
}

// ── Monitor via sniffer Python ──────────────────────────────────────────────
let lastSnifferEventMs = 0
let snifferWatchdog = null

function stopMonitor() {
  _stopConnMonitor()
  if (snifferWatchdog) { clearInterval(snifferWatchdog); snifferWatchdog = null }
  if (sseAbort) { sseAbort.abort(); sseAbort = null }
  if (snifferProc) {
    snifferProc.kill()
    snifferProc = null
  }
  isMonitoring = false
  charIdentified = false
  currentLeagueId = null
  sendState()
}

function spawnSniffer() {
  if (snifferProc) {
    snifferProc.kill()
    snifferProc = null
  }

  try {
    if (isPackaged) {
      snifferProc = spawn(SNIFFER_EXE, [], { cwd: RESOURCES, stdio: ['ignore', 'pipe', 'pipe'] })
    } else {
      snifferProc = spawn('python', [SNIFFER_PY], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] })
    }
  } catch (err) {
    stopMonitor()
    sendLog('error', t(`❌ Falha ao iniciar sniffer: ${err.message}`, `❌ Failed to start sniffer: ${err.message}`))
    return
  }

  lastSnifferEventMs = Date.now()

  const rl = readline.createInterface({ input: snifferProc.stdout })
  rl.on('line', async (line) => {
    try {
      let msg
      try { msg = JSON.parse(line) } catch { return }
      if (!msg || typeof msg !== 'object') return

      if (msg.error) {
        sendLog('error', `❌ Sniffer: ${msg.error}`)
        stopMonitor()
        return
      }

      lastSnifferEventMs = Date.now()

      if (msg.type === 'player_login') {
        charMap[msg.accountUID] = msg.charName
        if (!charIdentified) {
          charIdentified = true
          sendState()
          sendLog('info', t(`✅ Personagem identificado: ${msg.charName} — monitorando drops!`, `✅ Character identified: ${msg.charName} — monitoring drops!`))
        }
        return
      }

      sendToWin(mainWin, 'sniffer:heartbeat', { ts: Date.now() })

      const drop = msg
      if (!drop.name) return
      if (drop.resource) return

      const uid = parseInt((drop.fp || '').split('-')[1] || '0', 10)
      if (uid && charMap[uid]) drop.charName = charMap[uid]

      const matches = LOOT_FILTER.some((w) => {
        const wl = w.toLowerCase()
        return (
          drop.rarity?.toLowerCase() === wl ||
          drop.name?.toLowerCase().includes(wl)
        )
      })
      if (!matches) return

      const tierVal    = serverTierMap[drop.name] ?? null
      const tierTag    = tierVal ? ` [${tierVal}]` : ''
      const charPart   = drop.charName ? ` [${drop.charName}]` : ''
      const categoryVal = serverCategoryMap[drop.name] ?? null

      if (drop.type === 'floor_drop') {
        if (personalFilter.size > 0 && personalFilter.has(drop.name)) sendOverlay(drop)
        const isPendingSiteFiltered = serverEnabledItems !== null && !serverEnabledItems.has(drop.name)
        const pendingPayload = { ...drop, _tierTag: tierTag, _category: categoryVal, _siteFiltered: isPendingSiteFiltered }
        pushHistory('drop:pending', pendingPayload)
        sendToWin(mainWin, 'drop:pending', pendingPayload)
        sendToWin(compactWin, 'drop:pending', pendingPayload)
        return
      }

      if (drop.type === 'collected') {
        const isSiteFiltered = serverEnabledItems !== null && !serverEnabledItems.has(drop.name)
        const logMsg = `⚔ ${drop.name}${tierTag} (${drop.rarity})${charPart} ✓`
        const collectedPayload = { ...drop, _logMsg: logMsg, _tierTag: tierTag, _category: categoryVal, _siteFiltered: isSiteFiltered }
        pushHistory('drop:collected', collectedPayload)
        sendToWin(mainWin, 'drop:collected', collectedPayload)
        sendToWin(compactWin, 'drop:collected', collectedPayload)
        if (isSiteFiltered) {
          sendLog('info', t(`⊘ ${drop.name}${tierTag} filtrado pelo ADM`, `⊘ ${drop.name}${tierTag} filtered by ADM`), drop, 'liga-filtrado')
          return
        }
        if (charIdentified) await postDrop(currentLeagueId, drop)
        return
      }

      // fallback: tipo antigo sem field "type"
      const isSiteFilteredFallback = serverEnabledItems !== null && !serverEnabledItems.has(drop.name)
      const fallbackPayload = { ...drop, had_floor: false, _logMsg: '', _tierTag: tierTag, _category: categoryVal, _siteFiltered: isSiteFilteredFallback }
      pushHistory('drop:collected', fallbackPayload)
      sendToWin(mainWin, 'drop:collected', fallbackPayload)
      sendToWin(compactWin, 'drop:collected', fallbackPayload)
      if (isSiteFilteredFallback) {
        sendLog('info', `⊘ ${drop.name}${tierTag} filtrado pelo ADM`, drop, 'liga-filtrado')
        return
      }
      if (charIdentified) await postDrop(currentLeagueId, drop)
    } catch (err) {
      sendLog('error', t(`❌ Erro ao processar drop: ${err.message}`, `❌ Error processing drop: ${err.message}`))
    }
  })

  snifferProc.stderr.on('data', (data) => {
    const msg = data.toString().trim()
    if (!msg) return
    if (msg.includes('PermissionError') || msg.includes('Access is denied')) {
      sendLog('error', t('❌ Sem permissão — reinicie o app como Administrador', '❌ No permission — restart the app as Administrator'))
      stopMonitor()
    } else if (msg.includes('No libpcap provider') || msg.includes("pcap won't be used")) {
      const { shell } = require('electron')
      sendLog('error', t('❌ Npcap não instalado. Abrindo site de download...', '❌ Npcap not installed. Opening download page...'))
      shell.openExternal('https://npcap.com/#download')
      stopMonitor()
    } else if (msg.includes('No module named')) {
      sendLog('error', `❌ Python: ${msg}`)
      stopMonitor()
    } else {
      sendLog('info', `[py] ${msg.slice(0, 120)}`)
    }
  })

  const thisProc = snifferProc
  snifferProc.on('exit', (code) => {
    if (snifferProc !== thisProc) return
    if (isMonitoring) {
      sendLog('error', t(`❌ Sniffer encerrou inesperadamente (code ${code})`, `❌ Sniffer exited unexpectedly (code ${code})`))
      stopMonitor()
    }
  })
}

function hasNpcap() {
  const fs = require('fs')
  const windir = process.env.WINDIR || 'C:\\Windows'
  return fs.existsSync(path.join(windir, 'System32', 'Npcap', 'wpcap.dll'))
}

ipcMain.handle('npcap:install', () => {
  const { shell } = require('electron')
  const npcapPath = path.join(RESOURCES, 'npcap-installer.exe')
  shell.openPath(npcapPath)
})

ipcMain.handle('monitor:start', async (_e, leagueId) => {
  if (!hasNpcap()) {
    return { ok: false, needsNpcap: true }
  }

  if (isMonitoring) stopMonitor()

  // Capturar Discord ID do usuário logado para filtrar SSE
  try {
    const profileRes = await apiFetch('/api/perfil')
    if (profileRes.ok) {
      const p = await profileRes.json()
      myDiscordId = p.discordId ?? null
      myDiscordUsername = p.username ?? null
    }
  } catch { /* sem perfil */ }

  currentLeagueId = leagueId
  isMonitoring = true
  charIdentified = false
  dropHistory = []
  sendState()

  // Carregar filtro do servidor
  fetchServerFilter().then(data => {
    if (data?.enabledNames) {
      serverEnabledItems = new Set(data.enabledNames)
      const newTierMap = {}
      const newCategoryMap = {}
      for (const [category, items] of Object.entries(data.grouped ?? {})) {
        for (const item of items) {
          if (item.tier) newTierMap[item.name] = item.tier
          newCategoryMap[item.name] = category
        }
      }
      serverTierMap = newTierMap
      serverCategoryMap = newCategoryMap
      sendLog('info', t(`📋 Filtro carregado: ${serverEnabledItems.size} itens ativos`, `📋 Filter loaded: ${serverEnabledItems.size} active items`))
      sendToWin(mainWin, 'filter:loaded', { count: serverEnabledItems.size })
    }
  }).catch(() => {})

  // Conectar SSE para drops de outros membros da guilda
  connectSSE(leagueId)

  sendLog('warn', t('▶ Entre ou relogue no jogo para iniciar o monitoramento', '▶ Enter or relog in game to start monitoring'))

  spawnSniffer()

  // Monitor de conexão: detecta mudança de área via netstat (equiv. ao netstat2 do HS Tracker).
  // Quando o IP remoto do HeroSiege.exe muda → reinicia sniffer imediatamente (gap ~2s vs 30s).
  _startConnMonitor()

  // Watchdog de silêncio: fallback para falhas desconhecidas do sniffer.
  // Threshold alto (30s) pois o connection monitor já cuida das transições de área.
  snifferWatchdog = setInterval(() => {
    if (!isMonitoring) return
    const elapsed = Date.now() - lastSnifferEventMs
    if (elapsed > 30_000) {
      sendLog('warn', t('⚠ Sniffer silencioso — reconectando...', '⚠ Sniffer silent — reconnecting...'))
      lastSnifferEventMs = Date.now()
      spawnSniffer()
    }
  }, 5_000)

  return { ok: true }
})

ipcMain.handle('monitor:stop', () => {
  stopMonitor()
  sendLog('info', t('■ Monitor pausado', '■ Monitor paused'))
})

// ── Filtro de Itens ─────────────────────────────────────────────────────────
const ITEM_CATEGORIES = {
  0: 'Helmet', 1: 'Armor', 2: 'Boots', 3: 'Weapon',
  4: 'Gloves', 5: 'Amulet', 6: 'Shield', 7: 'Ring',
  8: 'Belt', 10: 'Charm',
}

ipcMain.handle('filter:open', () => {
  if (filterWin && !filterWin.isDestroyed()) {
    filterWin.focus()
    return
  }
  filterWin = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    title: 'Filtro de Itens — HS Drop Logger',
    backgroundColor: '#0d0a18',
    parent: mainWin,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  filterWin.loadFile('filter.html')
  filterWin.setMenuBarVisibility(false)
  filterWin.on('closed', () => { filterWin = null })
})

ipcMain.handle('filter:close', () => {
  if (filterWin && !filterWin.isDestroyed()) filterWin.close()
})

// Fetch server filter (used both for the filter window and drop processing)
async function fetchServerFilter() {
  try {
    const res = await fetch(`${BASE_URL}/api/filter`)
    if (!res.ok) return null
    return await res.json()  // { grouped, enabledNames, total }
  } catch { return null }
}

ipcMain.handle('filter:getItems', async () => {
  const data = await fetchServerFilter()
  if (!data) return {}
  // Convert grouped (by category name) to grouped by category name with enabled state
  return data.grouped  // { "Weapon": [{name, rarity, enabled}], ... }
})

ipcMain.handle('filter:getPrefs', async () => {
  return { hiddenItems: [] }
})

ipcMain.handle('filter:savePrefs', async () => {
  return { ok: false, reason: 'read-only' }
})

// ── Filtro pessoal ───────────────────────────────────────────────────────────
ipcMain.handle('personal:getEnabled', () => [...personalFilter])

ipcMain.handle('personal:toggle', (_, name) => {
  if (personalFilter.has(name)) personalFilter.delete(name)
  else personalFilter.add(name)
  savePersonalFilter()
  return personalFilter.has(name)
})

ipcMain.handle('personal:setAll', (_, names, value) => {
  for (const name of names) {
    if (value) personalFilter.add(name)
    else personalFilter.delete(name)
  }
  savePersonalFilter()
})

ipcMain.handle('monitor:getState', () => ({ isMonitoring, leagueId: currentLeagueId, charIdentified }))
