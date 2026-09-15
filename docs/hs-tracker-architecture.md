# HS Manager — Arquitetura do Projeto

## Visão Geral

Mono-repo em `C:\Users\Soutc\HS-Manager-repo\` com dois módulos:
- `dashboard/` — Next.js App Router (TypeScript)
- `bot/` — NestJS (Discord bot)

Implantado na VPS via `/opt/hs-manager/deploy.sh`.

---

## Dashboard (Next.js)

### Autenticação
- **NextAuth** com provider Discord (`lib/auth.ts`)
- `getServerSession(authOptions)` em todos os routes protegidos
- `lib/session.ts` — helpers `getSession()`, `getDiscordId()`, `getIsAdmin()`
- Admins têm acesso a campos extras (ex: receita, dropper arbitrário)

### Banco de Dados
- **PostgreSQL via Prisma** (`lib/db.ts`)
- Tabelas principais: `league`, `item_drop`, `transfers`, `guild_config`, `league_registration`
- `item_drop` tem `id` serial (chave primária usada para dedup no SSE)

### SSE — Drops em Tempo Real

**Arquitetura**: in-process pub/sub, sem Redis nem WebSocket.

```
lib/drop-emitter.ts
  subs: Map<leagueId, Set<ReadableStreamController>>
  subscribe(leagueId, ctrl)   → adiciona controller ao Set
  unsubscribe(leagueId, ctrl) → remove do Set (chamado no cancel() do stream)
  broadcast(leagueId, data)   → envia para TODOS os controllers ativos
                               → remove automaticamente controllers mortos (catch)
```

**Fluxo de um drop**:
1. HS Drop Logger detecta drop via sniffer → `POST /api/dashboard/leagues/{id}/items`
2. API insere no banco → obtém `id` único
3. `broadcast(leagueId, { id, itemName, rarity, tier, charName, dropper, droppedAt })`
4. TODOS os subscribers (HS Drop Logger + outros) recebem o evento via SSE

**Por que o dashboard não duplica**: a UI do dashboard (`components/dashboard/league-detail-view.tsx`) **não assina o stream SSE**. Ela busca itens via `GET /api/dashboard/leagues/{id}/items` uma única vez quando a aba "Itens" é aberta. Duplicatas são impossíveis porque vêm do banco com `id` único.

**Por que o Drop Logger duplicava**: o app Electron assina o stream SSE e adiciona uma linha na tabela para cada evento recebido. Se o SSE reconectar (ex: queda de rede) e o servidor ou cliente tiver múltiplas conexões ativas simultaneamente, o mesmo evento `broadcast` chega múltiplas vezes.

**Correção aplicada no Drop Logger** (`main.js`):
```javascript
// Dedup por evt.id (ID único do banco) — se não houver ID, fallback item+dropper em 10s
const _dedupKey = evt.id != null
  ? `id:${evt.id}`
  : `${evt.itemName}|${evt.dropper?.discordId ?? evt.dropper?.username ?? '?'}`
const _last = _recentLigaDrops.get(_dedupKey)
if (_last && (evt.id != null || Date.now() - _last < 10_000)) continue
_recentLigaDrops.set(_dedupKey, Date.now())
```

---

## Endpoints Relevantes para o Drop Logger

| Método | Path | Descrição |
|--------|------|-----------|
| `GET`  | `/api/dashboard/leagues/{id}/stream` | Abre SSE stream (liga) |
| `POST` | `/api/dashboard/leagues/{id}/items`  | Registra drop → aciona broadcast |
| `GET`  | `/api/dashboard/leagues/{id}/items`  | Lista todos os drops da liga |
| `GET`  | `/api/dashboard/leagues`            | Lista ligas do usuário |

---

## Payload do Broadcast SSE

```json
{
  "id": 42,
  "itemName": "Sword of Azathoth",
  "rarity": "Angelic",
  "tier": "SS",
  "charName": "Wizard",
  "dropper": { "discordId": "12345", "username": "gilberto" },
  "droppedAt": "2026-09-16T..."
}
```

Campo `id` é o `item_drop.id` do banco — único por drop, usado para dedup confiável.

---

## Filtros no Drop Logger

| Filtro | Origem | Uso |
|--------|--------|-----|
| `serverEnabledItems` | `GET /api/...` (admin) | Determina quais itens vão para a aba Liga |
| `personalFilter` | `personal-filter.json` (local) | Determina overlay + som para o usuário |
| `relicFilter` | local | Overlay para relics |

**Regras de som** (após v2.3.x):
- Item no `personalFilter` + rarity Angelic/Unholy ou tier SS → `tink.mp3`
- Item no `personalFilter` + qualquer outro tier/rarity → `map.mp3`
- Item fora do `personalFilter` → sem som

**Regra do overlay**:
- Drop próprio: overlay se estiver no `personalFilter` (ou `relicFilter` para relics)
- Drop SSE (outro jogador): overlay se estiver no `personalFilter`
- Drop SSE: **sem som** (só overlay)

---

## Reconexão SSE no Drop Logger

O `connectSSE(leagueId)` em `main.js`:
- Usa `AbortController` para cancelar conexão anterior antes de criar nova
- Auto-reconecta após 5s em caso de erro (exceto `AbortError`)
- `stopMonitor()` aborta o controller e limpa a referência

Possível causa das 4x notificações: múltiplas conexões SSE ativas simultaneamente
(race condition no abort + auto-reconnect) → mesmo `broadcast` recebido N vezes.
Solução: dedup por `evt.id` no processamento do evento.
