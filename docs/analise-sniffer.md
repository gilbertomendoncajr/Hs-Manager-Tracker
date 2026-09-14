# Análise: hs-tracker vs hs-drop-logger — Captura de Rede

> Gerado em 2026-09-14. Referência para não perder contexto em sessões futuras.

---

## 1. Arquitetura do HS Tracker

O HS Tracker (`C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe`) é um **app Tauri/Rust**.

- **Tamanho**: ~9.5 MB (típico de Tauri — não é Electron)
- **Stack**: Rust (backend) + WebView (frontend bundlado no exe)
- **Captura**: `pcap-2.4.0` crate + Npcap  
- **Repo**: https://github.com/Parazeya/hs-tracker
- **Arquivo principal de captura**: `src\sniffer.rs` (compilado dentro do exe)
- **Confirmado pelas strings no exe**:
  - `pcap_next_ex`, `pcap_create`, `pcap_setfilter` (funções C da libpcap)
  - `C:\Users\ExpertV\.cargo\registry\...\pcap-2.4.0\src\capture\activated\mod.rs`
  - `hs_tracker_lib::sniffer::Shared` (tipo Rust visível)
  - `window.__TAURI_INTERNALS__.invoke` (IPC Tauri)
  - `APPIMAGEhttps://github.com/Parazeya/hs-tracker` (URL do repo no binário)

---

## 2. O Nosso Sniffer: `sniffer.py` → `sniffer.exe`

O `sniffer.py` é uma **porta Python fiel do hs-tracker**, documentada com referências aos arquivos Rust originais:

```
parser.rs  → extract_messages, item_sources, lies_on_floor, belongs_to_player
stats.rs   → RARITIES, seen_fingerprints, told, get_identity
sniffer.rs → filtro BPF dinâmico, deduplicação de pacotes
```

O `sniffer.exe` (em `dist/`) é este Python compilado com PyInstaller.

### 2.1 Como o hs-tracker evita duplicatas

**Dedup por TCP SEQ number** (`sniffer.py` linhas 963-968):

```python
seq = pkt[TCP].seq
if seq in _seen_seqs[key]:
    return  # mesmo pacote capturado em outra interface → ignora
_seen_seqs[key].add(seq)
if len(_seen_seqs[key]) > 256:
    _seen_seqs[key] = set(list(_seen_seqs[key])[-128:])
```

- A chave é `(src_ip, src_port, dst_ip, dst_port)` — identifica o fluxo TCP
- O TCP SEQ é único por segmento dentro de um fluxo
- Pacotes duplicados (capturados em múltiplas interfaces) chegam com o **mesmo SEQ** → descartados imediatamente
- Janela de 256 SEQs por fluxo — memória O(1) bounded

**Por que isso é melhor que dedup por tempo?**
- Pacotes TCP duplicados chegam em microsegundos — o mesmo SEQ aparece antes de qualquer timer poder fazer sentido
- Dois drops reais do mesmo item terão SEQs **completamente diferentes** (TCP é stream sequencial)
- Não há falsos positivos: dois drops de mesmo item com 10ms de diferença são preservados

### 2.2 FlowBuffer: carry mechanism (linhas 325-447)

Porta do `Reassembler` do parser.rs:

- Acumula payloads TCP por fluxo (`_flows` dict: 4-tuple → FlowBuffer)
- `drain()` extrai JSONs completos com brace-matching, mantém carry (JSON incompleto no fim)
- **Cada byte processado exatamente uma vez** → sem ghost detections
- `_opens_a_value()`: `{` só abre mensagem se seguido de `"` ou `}` — evita bytes de framing TCP sendo interpretados como JSON
- `CARRY_TTL = 1.0s`: segmento perdido é descartado após 1s, não trava o fluxo
- `CARRY_MAX = 64KB`: payload corrompido descarta o buffer

### 2.3 Dedup de Itens por Fingerprint (`_pending_drops`)

O sniffer rastreia o ciclo de vida de cada item individualmente:

```python
_seen_fp:       set[str]         # sightings já processados ("d:FP" floor, "p:FP" pickup)
_told:          set[str]         # identidades já reportadas ao main.js
_pending_drops: dict[str, dict]  # ident → drop aguardando coleta
```

- **`_try_floor(item, fingerprint)`**: registra item no chão, retorna `ident` se deve emitir `floor_drop`, `None` se duplicata
- **`_try_collect(item, fingerprint)`**: registra coleta, retorna `(ident, had_floor)` — `had_floor=True` se o item passou pelo chão

O campo `had_floor` é emitido **pelo sniffer** no evento `collected`:

```json
{"type": "collected", "name": "bonetti's rapier", "rarity": "Satanic", 
 "had_floor": true, "fp": "123456-789-10-3", "ts_ms": 1726320000000}
```

### 2.4 Identidade dos Itens (fingerprint)

O sniffer usa o fingerprint do item (campo `fp` nos packets), não o nome:

```python
def _identity(item, fingerprint) -> str:
    # 1. Usa o fingerprint direto (ex: "12345-678-90-3")
    if fp: return str(fp)
    # 2. Usa campo "sh" (hash)
    if h:  return f"h:{h}"  
    # 3. Usa seed+type+id
    if seed or item_type or item_id: return f"g:{seed}:{item_type}:{item_id}"
    # 4. MD5 do JSON como último recurso
    return "c:" + hashlib.md5(json.dumps(item, sort_keys=True).encode()).hexdigest()[:16]
```

O fingerprint é único por **instância** do item, não por nome. Dois drops do mesmo item = dois fingerprints diferentes.

---

## 3. Problemas Atuais no `main.js`

### Problema 1: Dedup por nome+tempo (500ms) é redundante e problemático

**Código atual** (`main.js` linhas 1049-1059):
```javascript
const dedupKey = `${drop.name}|${drop.charName ?? ''}`
const now = Date.now()
const lastSeen = _recentDrops.get(dedupKey)
if (lastSeen && now - lastSeen < 500) return  // ← PROBLEMA
```

**Por que está errado**:
- O sniffer já garante que cada evento `collected` é único via TCP SEQ + `_seen_fp`
- Dois drops reais do mesmo item em < 500ms são possíveis no jogo e seriam **silenciosamente descartados**
- A chave é o nome do item — imprecisa (dois itens com mesmo nome são indistinguíveis)

### Problema 2: `_floorDropped` map reinventa o que `had_floor` já resolve

**Código atual**:
```javascript
// No handler floor_drop:
_floorDropped.set(`${drop.name}|${drop.charName}`, Date.now())

// No handler collected:
const floorTs = _floorDropped.get(dedupKey)
if (!floorTs || now - floorTs > 30000) return  // sem floor = baú
```

**Por que está errado**:
- O sniffer já emite `had_floor: true/false` no evento `collected`
- A janela de 30s é uma heurística imprecisa — o sniffer usa fingerprint, que é exato
- O `_floorDropped` usa nome como chave: se dois drops do mesmo item estão no chão ao mesmo tempo, o segundo vai corretamente detectar que houve floor_drop, mas pode colidir com o primeiro

### Problema 3: Handlers desconectados

O fluxo atual no `main.js`:
```
floor_drop → guarda no _floorDropped (por nome)
collected  → verifica _floorDropped (por nome, com TTL 30s)
```

O fluxo correto do hs-tracker (já implementado no sniffer):
```
floor_drop → emitido pelo sniffer (item caiu no chão)
collected  → emitido com had_floor=true/false (sniffer já sabe)
```

---

## 4. Como Corrigir o `main.js`

### Correção

No handler de `collected` (linhas ~1037-1063), substituir toda a lógica de `_recentDrops` e `_floorDropped` por:

```javascript
if (drop.type === 'collected') {
  // ...payload, display, etc. (mantém igual)
  if (charIdentified) {
    if (!drop.had_floor) return  // sniffer já determinou que veio do baú
    await postDrop(currentLeagueId, drop)
  }
  return
}
```

E remover as duas constantes globais:
```javascript
// REMOVER:
const _recentDrops = new Map()
const _floorDropped = new Map()
```

E remover o handler de `floor_drop` que faz `_floorDropped.set(...)` (linhas 1031-1033).

### O que NÃO mudar

- O handler de `floor_drop` para overlay/pending (UI) — mantém
- O fallback para tipo antigo (sem campo `type`) — mantém com dedup 500ms
- Todo o resto da lógica de display, filtros, SSE

---

## 5. Diagrama do Fluxo Correto

```
Pacote TCP
    │
    ▼
sniffer.py — on_packet()
    │
    ├─ SEQ já visto? → descarta (dedup de interface)
    │
    ├─ FlowBuffer.push() + drain() → JSONs completos
    │
    └─ process_all() → item_sources()
            │
            ├─ item no chão (lies_on_floor=True)
            │      │
            │      ├─ _try_floor(): fingerprint já visto? → descarta
            │      └─ emite: {type:"floor_drop", fp:"...", had_floor:false}
            │             _pending_drops[ident] = {}
            │
            └─ pickup (operations.add)
                   │
                   ├─ _try_collect(): fingerprint já coletado? → descarta
                   │      had_floor = ident in _pending_drops
                   └─ emite: {type:"collected", fp:"...", had_floor:true/false}
                                                              ↑
                                          true = veio do chão (não do baú)
                                          false = veio do baú

main.js — ipc: sniffer-data
    │
    ├─ floor_drop → UI overlay/pending (sem lógica de dedup)
    │
    └─ collected, had_floor=true → postDrop()
       collected, had_floor=false → ignora (baú)
```

---

## 6. Versão Atual do sniffer.exe

O `dist/sniffer.exe` é o `sniffer.py` compilado com PyInstaller. Ele já implementa:
- ✅ Dedup por TCP SEQ
- ✅ FlowBuffer/carry
- ✅ `had_floor` no evento `collected`
- ✅ Dedup por fingerprint (`_seen_fp`, `_told`, `_pending_drops`)

O `main.js` **não precisa** reimplementar nada disso — só precisa confiar no campo `had_floor`.

---

## 7. Arquivo de Build

- **Sniffer source**: `C:\Users\Soutc\hs-drop-logger\sniffer.py`
- **Sniffer spec**: `C:\Users\Soutc\hs-drop-logger\sniffer.spec`
- **Sniffer output**: `C:\Users\Soutc\hs-drop-logger\dist\sniffer.exe`
- **HS Tracker exe**: `C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe`
- **HS Tracker repo**: https://github.com/Parazeya/hs-tracker
