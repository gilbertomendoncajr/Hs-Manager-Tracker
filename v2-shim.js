(function () {
  /* ── 1. Redirect status page → drops ──────────────────────────────────── */
  const statusPage = document.getElementById('p-status')
  if (statusPage) {
    new MutationObserver(function () {
      if (!statusPage.classList.contains('active')) return
      statusPage.classList.remove('active')
      const drops = document.getElementById('p-drops')
      if (drops) drops.classList.add('active')
      document.querySelectorAll('.nav-btn[data-page]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.page === 'drops')
      })
    }).observe(statusPage, { attributes: true, attributeFilter: ['class'] })
  }

  /* ── 2. Mirror drop/rare counts to header cards ────────────────────────── */
  function mirrorText(srcId, dstId) {
    const src = document.getElementById(srcId)
    const dst = document.getElementById(dstId)
    if (!src || !dst) return
    dst.textContent = src.textContent
    new MutationObserver(function () {
      dst.textContent = src.textContent
    }).observe(src, { childList: true, characterData: true, subtree: true })
  }

  document.addEventListener('DOMContentLoaded', function () {
    mirrorText('dropCount', 'hdrDropCount')
    mirrorText('rareCount', 'hdrRareCount')
  })

  /* ── 3. Lock Liga/Stats nav until monitor starts; show/hide empty state ── */
  const LOCKED_PAGES = ['liga', 'stats']

  function setNavLock(watching) {
    document.querySelectorAll('.nav-btn[data-page]').forEach(function (btn) {
      if (LOCKED_PAGES.includes(btn.dataset.page)) {
        btn.classList.toggle('nav-locked', !watching)
      }
    })

    const empty = document.getElementById('logEmpty')
    if (empty) {
      const logList = document.getElementById('logList')
      const hasEntries = logList && logList.querySelector('.log-entry')
      if (watching && hasEntries) empty.style.display = 'none'
    }
  }

  // Apply initial lock (monitor hasn't started yet)
  setNavLock(false)

  // Watch #statusDot class changes — renderer sets 'watching' when active
  const statusDot = document.getElementById('statusDot')
  if (statusDot) {
    new MutationObserver(function () {
      const watching = statusDot.classList.contains('watching')
      setNavLock(watching)
    }).observe(statusDot, { attributes: true, attributeFilter: ['class'] })
  }

  // Also hide empty state when first log entry appears
  const logList = document.getElementById('logList')
  if (logList) {
    new MutationObserver(function () {
      const hasEntries = !!logList.querySelector('.log-entry')
      const empty = document.getElementById('logEmpty')
      if (empty && hasEntries) empty.style.display = 'none'
    }).observe(logList, { childList: true })
  }
})()
