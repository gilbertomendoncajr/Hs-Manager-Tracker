# UI v2 — Base "Blood Pact" (chassi)

Data: 2026-09-05

## Objetivo

Substituir o visual genérico da janela principal por uma base gótica/industrial
inspirada nos mockups gerados (pasta `assets/ref/`), sem alterar a lógica do
`renderer.js`. A base é um "chassi": estrutura, paleta, tipografia e slots
reservados. Ícones e imagens entram depois, trocando arquivos em `assets/`.

## Decisões

- **Arquivo novo `index-v2.html`** em paralelo. `index.html` continua sendo o
  padrão até aprovação. `main.js` carrega v2 quando `HSDL_UI=v2`
  (`npm run start:v2`). Ao aprovar, troca-se o padrão e apaga-se o v1.
- **Abordagem híbrida.** Moldura raster (PNG 9-slice) só na casca da janela,
  no painel da marca e no botão principal (PAUSAR/INICIAR). Todo o miolo é
  CSS: bordas 1px em tom de metal, cantoneiras em CSS, textura sutil.
- **Fonte mono limpa.** IBM Plex Mono (400/500/600/700) no corpo, Space Mono
  700 nos números grandes (timer, contadores). Fontes empacotadas em
  `assets/fonts/`, sem dependência de rede. Fallback: Cascadia Mono, Consolas.
- **Sem tema claro.** Toggle removido das Configurações; `applyTheme` do
  renderer continua rodando sem efeito.
- **Sem página Status.** O menu fica: Drops, League, Statistics, Filters,
  Compact Mode, Settings, About. Os quatro indicadores (monitor, filtro,
  personagem, último evento) vivem no card MONITORING do cabeçalho; clique no
  card abre um popover com os quatro. `navTo('status')` é redirecionado para
  `drops` por um shim em `index-v2.html`.
- **Janela maior e redimensionável.** 1100x720 padrão, mínimo 960x640,
  quando v2 está ativo.
- **Contrato com o renderer intacto.** Todos os 54 IDs e as classes de estado
  (`active`, `on`, `done`, `collected`, `nav-locked`, `stat idle|waiting|watching`,
  `st-dot active|err|pending`, `start|stop`, `log-entry <type>`,
  `ua-site-filtered`) são preservados.

## Layout (janela 1100x720)

```
┌ casca (moldura raster 9-slice) ────────────────────────────────────────┐
│ sidebar 236px            │ header: [MONITORING] [DROPS] [RARES] … [user] [SAIR] [– ×]
│  ┌ marca ┐               │ ┌ painel tabela ───────────────────────────┐
│  │ logo  │               │ │ barra: ⚡ UNHOLY/ANGELIC [n]      [LIMPAR] │
│  │ título│               │ │ ITEM               DROPOU      COLETOU   │
│  └───────┘               │ │ ▌[ico] nome          00:00:00   ⏳/✓     │
│  ▸ Drops                 │ │ … (scroll interno)                       │
│    League                │ └──────────────────────────────────────────┘
│    Statistics            │ ┌ activity log (recolhível) ───────────────┐
│    Filters               │ │ 00:00:00 ● [ico] mensagem                │
│  ──────────              │ └──────────────────────────────────────────┘
│  [Compact Mode  (o)]     │ ┌ rodapé ──────────────────────────────────┐
│    Settings              │ │ [avatar] liga ▾ │ SESSÃO 00:00:00 │ [PAUSAR]│
│    About                 │ └──────────────────────────────────────────┘
│  v1.9.2  (emblema)       │
└────────────────────────────────────────────────────────────────────────┘
```

Páginas Statistics, Filters, Settings e About ocupam a mesma área do painel
tabela + log, com o mesmo estilo de painel.

## Slots de imagem

Cada slot é um elemento com `data-slot="<nome>"`. Sem imagem, mostra um
placeholder discreto (borda tracejada em modo dev, vazio em produção).
Lista e tamanhos em `assets/SLOTS.md`.

## Estados obrigatórios

Vazio (0 drops), cheio (60+ com scroll interno), nome de item longo
(truncado com reticências e title), liga longa (truncada), banner de update,
monitor parado / aguardando relog / monitorando, navegação bloqueada.

## Verificação

Servir a pasta via HTTP com stub de `window.api` (`dev/api-stub.js`, só carrega
quando o preload não existe) e conferir em 1100x720 e 960x640: sem scroll
horizontal, tabela rola dentro do painel, estados acima renderizam.
Depois rodar `npm run start:v2` no Electron real.
