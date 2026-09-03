const CAT_ICONS = {
  Helmet: '⛑', Armor: '🔰', Boots: '👢', Weapon: '⚔',
  Gloves: '🥊', Amulet: '📿', Shield: '🛡', Ring: '💍',
  Belt: '🔗', Charm: '✨',
}
const CAT_ORDER = ['Weapon', 'Shield', 'Helmet', 'Boots', 'Armor', 'Gloves', 'Belt', 'Amulet', 'Ring', 'Charm']

let allItems = {}
let personalEnabled = new Set()
let activeCategory = null
let activeRarities = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Set'])
let searchQuery = ''

async function init() {
  document.getElementById('content').innerHTML = '<div id="loading">CARREGANDO ITENS...</div>'

  let items = {}
  try {
    items = (await window.api.getFilterItems()) || {}
  } catch (err) {
    document.getElementById('content').innerHTML =
      `<div class="empty">Erro ao carregar itens do servidor.<br><small style="color:var(--satanic);font-family:monospace">${err.message || err}</small></div>`
    return
  }

  if (!items || Object.keys(items).length === 0) {
    document.getElementById('content').innerHTML =
      '<div class="empty">Nenhum item encontrado. Execute o Scan Wiki no dashboard.</div>'
    return
  }

  let enabledNames = []
  try {
    if (typeof window.api.getPersonalEnabled === 'function') {
      enabledNames = await Promise.race([
        window.api.getPersonalEnabled(),
        new Promise(resolve => setTimeout(() => resolve([]), 3000)),
      ])
    }
  } catch { /* sem filtro pessoal ainda */ }

  allItems = items
  personalEnabled = new Set(Array.isArray(enabledNames) ? enabledNames : [])

  buildCatTabs()
  buildRarityChips()
  const first = CAT_ORDER.find(c => allItems[c]?.length > 0)
  if (first) activeCategory = first
  if (searchQuery) {
    renderSearch()
  } else {
    if (first) selectCategory(first)
  }
  updateCount()
}

function buildCatTabs() {
  const bar = document.getElementById('catBar')
  bar.innerHTML = ''
  for (const cat of CAT_ORDER) {
    if (!allItems[cat]?.length) continue
    const total = allItems[cat].length
    const myEnabled = allItems[cat].filter(i => personalEnabled.has(i.name)).length
    const tab = document.createElement('div')
    tab.className = 'cat-tab'
    tab.dataset.cat = cat
    tab.innerHTML = `<span class="cat-icon">${CAT_ICONS[cat] || '•'}</span>${cat}<span class="cat-badge">${myEnabled}/${total}</span>`
    tab.addEventListener('click', () => selectCategory(cat))
    bar.appendChild(tab)
  }
}

function refreshCatBadge(cat) {
  const tab = document.querySelector(`.cat-tab[data-cat="${cat}"]`)
  if (!tab) return
  const total = allItems[cat]?.length || 0
  const myEnabled = (allItems[cat] || []).filter(i => personalEnabled.has(i.name)).length
  tab.querySelector('.cat-badge').textContent = `${myEnabled}/${total}`
}

function buildRarityChips() {
  document.querySelectorAll('.rchip').forEach(chip => {
    chip.addEventListener('click', () => {
      const r = chip.dataset.rarity
      if (r === 'All') {
        const allActive = activeRarities.size === 5
        if (allActive) {
          activeRarities.clear()
          chip.classList.remove('active')
          document.querySelectorAll('.rchip:not(.All)').forEach(c => c.classList.remove('active'))
        } else {
          activeRarities = new Set(['Satanic', 'Angelic', 'Unholy', 'Heroic', 'Set'])
          chip.classList.add('active')
          document.querySelectorAll('.rchip:not(.All)').forEach(c => c.classList.add('active'))
        }
      } else {
        if (activeRarities.has(r)) { activeRarities.delete(r); chip.classList.remove('active') }
        else { activeRarities.add(r); chip.classList.add('active') }
        const allChip = document.querySelector('.rchip.All')
        if (activeRarities.size === 5) allChip.classList.add('active')
        else allChip.classList.remove('active')
      }
      if (searchQuery) renderSearch()
      else renderItems(activeCategory)
    })
  })
}

function selectCategory(cat) {
  activeCategory = cat
  document.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat)
  })
  renderItems(cat)
}

function renderItems(cat) {
  const content = document.getElementById('content')
  const items = (allItems[cat] || []).filter(it => activeRarities.has(it.rarity))

  if (items.length === 0) {
    content.innerHTML = '<div class="empty">Nenhum item encontrado para os filtros selecionados.</div>'
    return
  }

  const icon = CAT_ICONS[cat] || '•'
  const myEnabled = items.filter(i => personalEnabled.has(i.name)).length

  content.innerHTML = `
    <div class="cat-header">
      <h2>${icon} ${cat.toUpperCase()}</h2>
      <div class="sep"></div>
      <span style="font-size:11px;color:var(--text2)">${myEnabled} no meu overlay / ${items.length} total</span>
    </div>
    <div class="select-all-row">
      <button class="btn-mini" id="btnSelectAll">▶ Marcar todos</button>
      <button class="btn-mini deselect" id="btnDeselectAll">✕ Desmarcar todos</button>
    </div>
    <div class="item-grid" id="itemGrid"></div>
  `

  document.getElementById('btnSelectAll').addEventListener('click', async () => {
    const names = items.map(i => i.name)
    await window.api.setAllPersonal(names, true)
    for (const n of names) personalEnabled.add(n)
    renderItems(cat)
    refreshCatBadge(cat)
    updateCount()
  })

  document.getElementById('btnDeselectAll').addEventListener('click', async () => {
    const names = items.map(i => i.name)
    await window.api.setAllPersonal(names, false)
    for (const n of names) personalEnabled.delete(n)
    renderItems(cat)
    refreshCatBadge(cat)
    updateCount()
  })

  const grid = document.getElementById('itemGrid')
  for (const item of items) {
    const isOn = personalEnabled.has(item.name)
    const admOn = item.enabled

    const iconContent = item.image_url
      ? `<img src="${item.image_url}" alt="" onerror="this.outerHTML='${icon}'">`
      : icon

    const card = document.createElement('div')
    card.className = `item-card ${item.rarity} ${isOn ? 'personal-on' : 'personal-off'}`
    card.title = isOn ? 'Clique para remover do overlay' : 'Clique para ativar no overlay'
    card.innerHTML = `
      <div class="item-icon">${iconContent}</div>
      <div class="item-info">
        <div class="item-name" title="${item.name}">${item.name}</div>
        <div class="item-meta">
          <span class="item-rarity ${item.rarity}">${item.rarity.toUpperCase()}</span>
          <span class="adm-badge ${admOn ? 'on' : 'off'}">${admOn ? 'ADM ✓' : 'ADM ✗'}</span>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${isOn ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
    `

    card.addEventListener('click', async () => {
      const newState = await window.api.togglePersonal(item.name)
      if (newState) personalEnabled.add(item.name)
      else personalEnabled.delete(item.name)

      card.classList.toggle('personal-on', newState)
      card.classList.toggle('personal-off', !newState)
      card.title = newState ? 'Clique para remover do overlay' : 'Clique para ativar no overlay'
      card.querySelector('input').checked = newState

      const countEl = content.querySelector('.cat-header span')
      if (countEl) {
        const myCount = items.filter(i => personalEnabled.has(i.name)).length
        countEl.textContent = `${myCount} no meu overlay / ${items.length} total`
      }
      refreshCatBadge(cat)
      updateCount()
    })

    grid.appendChild(card)
  }
}

function renderSearch() {
  const content = document.getElementById('content')
  const q = searchQuery.toLowerCase()

  const results = []
  for (const cat of CAT_ORDER) {
    for (const item of (allItems[cat] || [])) {
      if (!activeRarities.has(item.rarity)) continue
      if (!item.name.toLowerCase().includes(q)) continue
      results.push({ ...item, cat })
    }
  }

  if (results.length === 0) {
    content.innerHTML = `<div class="empty">Nenhum item encontrado para "<strong>${searchQuery}</strong>".</div>`
    return
  }

  content.innerHTML = `
    <div class="cat-header">
      <h2>🔍 RESULTADOS</h2>
      <div class="sep"></div>
      <span style="font-size:11px;color:var(--text2)">${results.length} item(s) encontrado(s)</span>
    </div>
    <div class="item-grid" id="itemGrid"></div>
  `

  const grid = document.getElementById('itemGrid')
  for (const item of results) {
    const isOn = personalEnabled.has(item.name)
    const admOn = item.enabled
    const icon = CAT_ICONS[item.cat] || '•'
    const iconContent = item.image_url
      ? `<img src="${item.image_url}" alt="" onerror="this.outerHTML='${icon}'">`
      : icon

    const card = document.createElement('div')
    card.className = `item-card ${item.rarity} ${isOn ? 'personal-on' : 'personal-off'}`
    card.title = isOn ? 'Clique para remover do overlay' : 'Clique para ativar no overlay'
    card.innerHTML = `
      <div class="item-icon">${iconContent}</div>
      <div class="item-info">
        <div class="item-name" title="${item.name}">${item.name}</div>
        <div class="item-meta">
          <span class="item-rarity ${item.rarity}">${item.rarity.toUpperCase()}</span>
          <span style="font-size:9px;color:var(--text2);font-family:'Chakra Petch',sans-serif">${item.cat}</span>
          <span class="adm-badge ${admOn ? 'on' : 'off'}">${admOn ? 'ADM ✓' : 'ADM ✗'}</span>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${isOn ? 'checked' : ''}>
        <span class="toggle-track"></span>
      </label>
    `

    card.addEventListener('click', async () => {
      const newState = await window.api.togglePersonal(item.name)
      if (newState) personalEnabled.add(item.name)
      else personalEnabled.delete(item.name)

      card.classList.toggle('personal-on', newState)
      card.classList.toggle('personal-off', !newState)
      card.title = newState ? 'Clique para remover do overlay' : 'Clique para ativar no overlay'
      card.querySelector('input').checked = newState

      refreshCatBadge(item.cat)
      updateCount()
    })

    grid.appendChild(card)
  }
}

function updateCount() {
  let total = 0, myActive = 0
  for (const cat of Object.keys(allItems)) {
    for (const item of allItems[cat]) {
      total++
      if (personalEnabled.has(item.name)) myActive++
    }
  }
  document.getElementById('itemCount').textContent = total > 0
    ? `${myActive} no overlay / ${total} total`
    : ''
}

document.getElementById('backBtn').addEventListener('click', () => window.api.closeFilter())
document.getElementById('refreshBtn').addEventListener('click', () => init())

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim()
  const clearBtn = document.getElementById('searchClear')
  clearBtn.classList.toggle('visible', searchQuery.length > 0)
  if (searchQuery) {
    renderSearch()
  } else {
    renderItems(activeCategory)
  }
  updateCount()
})

document.getElementById('searchClear').addEventListener('click', () => {
  document.getElementById('searchInput').value = ''
  searchQuery = ''
  document.getElementById('searchClear').classList.remove('visible')
  renderItems(activeCategory)
  updateCount()
})

init()
