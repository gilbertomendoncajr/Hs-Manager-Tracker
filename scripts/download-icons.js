#!/usr/bin/env node
/**
 * Baixa todos os ícones dos itens do filtro para assets/icons/items/
 * Rodar uma vez antes de buildar o instalador. Não requer autenticação.
 *
 * Uso:
 *   node scripts/download-icons.js
 */

const fs   = require('fs')
const path = require('path')

const BASE_URL  = 'http://109.199.115.128'
const ICONS_DIR = path.join(__dirname, '..', 'assets', 'icons', 'items')
const BATCH     = 5
const DELAY_MS  = 100

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/, '').toLowerCase()
}

async function downloadOne(name, imageUrl) {
  if (!imageUrl) { process.stdout.write('-'); return }
  const filePath = path.join(ICONS_DIR, sanitize(name) + '.png')
  if (fs.existsSync(filePath)) { process.stdout.write('.'); return }
  try {
    const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hs-drop-logger/1.0)' } })
    if (!res.ok) { process.stdout.write('x'); return }
    const buf = await res.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(buf))
    process.stdout.write('✓')
  } catch {
    process.stdout.write('!')
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  await fs.promises.mkdir(ICONS_DIR, { recursive: true })

  console.log('Buscando lista de itens do filtro...')
  const res = await fetch(`${BASE_URL}/api/filter`)
  if (!res.ok) {
    console.error(`\n❌  Falha ao buscar filtro: ${res.status}`)
    process.exit(1)
  }
  const data = await res.json()

  const entries = []
  for (const items of Object.values(data.grouped ?? {})) {
    for (const item of items) {
      if (item.image_url) entries.push({ name: item.name, imageUrl: item.image_url })
    }
  }
  console.log(`${entries.length} itens com ícone encontrados. Baixando...\n`)

  for (let i = 0; i < entries.length; i += BATCH) {
    await Promise.all(entries.slice(i, i + BATCH).map(e => downloadOne(e.name, e.imageUrl)))
    if (i + BATCH < entries.length) await sleep(DELAY_MS)
  }

  const total = fs.readdirSync(ICONS_DIR).length
  console.log(`\n\n✅  ${total} ícones em assets/icons/items/`)
  console.log('    Legenda: ✓ baixado  . já existia  - sem url  x erro')
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1) })
