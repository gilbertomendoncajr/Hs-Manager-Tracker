// Anuncia uma release no canal #releases do Discord HS Manager
// Uso: node scripts/announce-release.js <versao> "Descrição opcional"
// Ex:  node scripts/announce-release.js 2.5.4 "Correções e nova feature de report"

const https = require('https')

const RELEASES_WEBHOOK = 'https://discord.com/api/webhooks/1549762673791606896/lcKsLkT-SGbT-NtTICepMzlRvrMD5djULm6c4nMOgozGXhjX_EfNIYBRx4g6lPPS96O2'
const GITHUB_REPO      = 'https://github.com/gilbertomendoncajr/Hs-Manager-Tracker/releases/tag'

const version = process.argv[2]
const desc    = process.argv[3] || ''

if (!version) {
  console.error('Uso: node scripts/announce-release.js <versao> "Descrição"')
  process.exit(1)
}

const payload = {
  embeds: [{
    title: `🚀 HS Drop Logger v${version} disponível!`,
    url: `${GITHUB_REPO}/v${version}`,
    color: 0xE8A44A,
    description: desc || `Nova versão **v${version}** publicada.`,
    fields: [
      {
        name: '📥 Download',
        value: `[HS-Drop-Logger-Setup-${version}.exe](${GITHUB_REPO}/v${version})`,
        inline: false,
      },
    ],
    footer: { text: 'HS Manager · Auto-update disponível para usuários com versão anterior instalada' },
    timestamp: new Date().toISOString(),
  }],
}

function postWebhook(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`HTTP ${res.statusCode}: ${raw}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

postWebhook(RELEASES_WEBHOOK, payload)
  .then(() => console.log(`✅ Anúncio da v${version} enviado para #releases!`))
  .catch(err => console.error('❌ Erro:', err.message))
