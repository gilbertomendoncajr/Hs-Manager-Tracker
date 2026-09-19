// Janela de login do Discord: sem barra nativa. Injeta uma faixa fina arrastável com botão de fechar
// em qualquer página carregada nela (dashboard e discord.com).
const { ipcRenderer } = require('electron')

function mountBar() {
  if (document.getElementById('hsAuthBar')) return
  const style = document.createElement('style')
  style.textContent = `
    #hsAuthBar { position: fixed; top: 0; left: 0; right: 0; height: 30px; z-index: 2147483647;
      display: flex; align-items: center; justify-content: space-between; padding-left: 12px;
      background: #09080A; border-bottom: 1px solid #231820; -webkit-app-region: drag;
      font: 600 11px/1 system-ui, sans-serif; letter-spacing: .08em; color: #9E8A80; user-select: none; }
    #hsAuthBar button { -webkit-app-region: no-drag; width: 42px; height: 100%; border: 0; background: none;
      color: #9E8A80; font-size: 16px; cursor: pointer; }
    #hsAuthBar button:hover { background: #C82020; color: #fff; }
    #hsAuthBar button:focus-visible { outline: 2px solid #C88820; outline-offset: -2px; }
  `
  const bar = document.createElement('div')
  bar.id = 'hsAuthBar'
  bar.innerHTML = '<span>HS MANAGER</span><button type="button" aria-label="Fechar">✕</button>'
  bar.querySelector('button').addEventListener('click', () => ipcRenderer.send('auth:close'))
  document.documentElement.append(style, bar)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBar)
else mountBar()
