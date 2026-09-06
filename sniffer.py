"""
hs-drop-logger sniffer — porta da lógica do hs-tracker (Rust):
https://github.com/Parazeya/hs-tracker

parser.rs  → extract_messages, item_sources, lies_on_floor, belongs_to_player
stats.rs   → RARITIES, seen_fingerprints, told, get_identity
sniffer.rs → filtro BPF dinâmico, deduplicação de pacotes

Reassembly: carry mechanism do hs-tracker — cada byte processado exatamente uma vez.
"""

import json, sys, re, base64, hashlib, time, os, threading
from collections import defaultdict
from datetime import datetime

# ─── logging ────────────────────────────────────────────────────────────────

# Opt-in (HS_SNIFFER_DEBUG=1): o log roda dentro do callback de captura, e abrir
# o arquivo a cada linha atrasava o scapy o bastante para o Npcap descartar
# pacotes nas rajadas de entrada de área. Ligado, o arquivo fica aberto uma vez.

_DEBUG = os.environ.get("HS_SNIFFER_DEBUG", "").lower() in ("1", "true")
_debug_fh = None

def log_debug(msg: str):
    global _debug_fh
    if not _DEBUG: return
    if _debug_fh is None:
        _debug_fh = open("sniffer_debug.txt", "a", encoding="utf-8", buffering=1)
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    _debug_fh.write(f"[{ts}] {msg}" + chr(10))

# ─── saída (stdout → main.js) ────────────────────────────────────────────────
# Uma linha JSON por evento. O heartbeat sai de outra thread, então a escrita é
# serializada para nunca misturar duas linhas.

_out_lock = threading.Lock()

def emit_line(obj: dict):
    line = json.dumps(obj, ensure_ascii=False) + chr(10)
    with _out_lock:
        sys.stdout.write(line)
        sys.stdout.flush()

# contadores lidos pelo heartbeat
_stats = {"packets": 0, "msgs": 0}

# ─── RARITIES (stats.rs) ────────────────────────────────────────────────────

RARITIES: dict[int, str] = {
    1: "Common", 2: "Superior", 3: "Rare", 4: "Set",
    5: "Mythic",  6: "Satanic", 7: "Angelic", 8: "Blessed",
    9: "Heroic", 10: "Unholy",
}
JOURNAL_RARITIES = {"Satanic", "Set", "Heroic", "Angelic", "Unholy"}

# ─── item DB (name + rarity via sniffer_items.json) ─────────────────────────
# Chave: (item_type, item_id, weapon_type) — idêntico ao hs-tracker
# Packed original: (type << 24) | (id << 8) | wt

ITEM_DB: dict[tuple[int,int,int], tuple[str,str]] = {}
RARITY_BY_NAME: dict[str,str] = {}
# Pre-filtered set of (type, id) pairs with JOURNAL_RARITIES — for fast floor-item lookup
KNOWN_JOURNAL_PAIRS: set[tuple[int,int]] = set()

def _load_db():
    import os
    if getattr(sys, "frozen", False):
        # sniffer_items.json is placed next to sniffer.exe (extraResources),
        # not inside the PyInstaller bundle (_MEIPASS is the internal temp dir)
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, "sniffer_items.json")
    if not os.path.exists(path):
        log_debug("sniffer_items.json nao encontrado — sem fallback de nomes")
        return
    try:
        with open(path, encoding="utf-8") as f:
            db = json.load(f)
        for key, entry in db.items():
            parts = key.split(",")
            item_type, item_id, wt = int(parts[0]), int(parts[1]), int(parts[2])
            name, rarity = entry[0], entry[1]
            ITEM_DB[(item_type, item_id, wt)] = (name, rarity)
            if name:
                RARITY_BY_NAME[name.lower()] = rarity
            if rarity in JOURNAL_RARITIES:
                KNOWN_JOURNAL_PAIRS.add((item_type, item_id))
        log_debug(f"ITEM_DB: {len(ITEM_DB)} itens, KNOWN_JOURNAL_PAIRS: {len(KNOWN_JOURNAL_PAIRS)}, RARITY_BY_NAME: {len(RARITY_BY_NAME)} nomes")
    except Exception as ex:
        log_debug(f"Erro ao carregar ITEM_DB: {ex}")

_load_db()

# ─── campos (parser.rs constantes) ──────────────────────────────────────────

MARKET_FIELDS      = {"marketId","market_id","market_tokens","marketTokens",
                      "seller_name","sellerName","price"}
ITEM_WRAPPER       = ["addedItemObject","added_item_object"]
ITEM_SIG           = {"seed","a","itemId","item_id","gid"}
ITEM_NAMED_SIG     = {"seed","itemId","item_id","gid"}
ITEM_RARITY        = ["rarity","itemRarity","item_rarity","d"]
ITEM_DATA          = ["itemData","item_data"]
PICKUP             = ["pickup_add_data","pickupAddData"]
OWNER              = ["gd","gid"]
RELIC_TYPE         = 16

# ─── helpers de campo ────────────────────────────────────────────────────────

def _f(obj: dict, names: list):
    for n in names:
        if n in obj:
            return obj[n]
    return None

def _i(obj: dict, names: list) -> int:
    v = _f(obj, names)
    if v is None: return 0
    try: return int(v)
    except: return 0

def _item_like(v) -> bool:
    if not isinstance(v, dict): return False
    return bool(ITEM_SIG & v.keys()) or bool({"rarity","itemRarity","item_rarity","d"} & v.keys())

def _belongs_to_player(item: dict) -> bool:
    for f in OWNER:
        v = item.get(f)
        if isinstance(v, dict) and "player" in v:
            return True
    return False

def _lies_on_floor(item: dict) -> bool:
    return any(f in item for f in OWNER)

def _fp_type(fp) -> int | None:
    if not fp: return None
    try: return int(str(fp).rsplit("-",1)[-1])
    except: return None

def _is_inventory_ctx(d: dict, item_data) -> bool:
    if isinstance(item_data, dict) and any(f in item_data for f in PICKUP):
        return True
    route = str(_f(d, ["route","__route"]) or "").lower()
    ctx = route + " " + str(d)[:300]
    return "inventory" in ctx.lower() or "pickup" in ctx.lower()

def _obj_items(v) -> list:
    if isinstance(v, list):   return [(None, x) for x in v if isinstance(x, dict)]
    if isinstance(v, dict):   return [(k, x) for k, x in v.items() if isinstance(x, dict)]
    return []

# Session credentials the client attaches to outgoing requests — their presence
# means this is OUR packet going out, not a server drop answer coming back.
CLIENT_ENVELOPE = {"identifier", "checksum"}

# Item types whose id IS the identity (keys, collectibles, materials, socketables,
# vaults) — same as hs-tracker's SELF_NUMBERED. For these, c==0 is simply what
# they are and the id is the lookup key (safe to name even without named flag).
RESOURCE_TYPES = frozenset([12, 13, 14, 15, 19])

# ─── item_sources (parser.rs) ────────────────────────────────────────────────

def item_sources(d: dict) -> list[tuple]:
    if not isinstance(d, dict): return []
    if MARKET_FIELDS & d.keys(): return []
    # Client's own requests carry session credentials; server drop answers do not.
    if CLIENT_ENVELOPE & d.keys(): return []

    ops = d.get("operations")
    if isinstance(ops, dict):
        if "split" in ops: return []
        if "add" in ops:
            return [(fp, item, False) for fp, item in _obj_items(ops["add"])]
        if "stack" in ops:
            out = []
            for fp, v in (ops["stack"].items() if isinstance(ops["stack"], dict) else []):
                if isinstance(v, dict):
                    p = _f(v, PICKUP)
                    if p: out.append((fp, p, False))
            return out

    added = _f(d, ["itemsAdded","items_added"])
    if added is not None:
        return [(fp, item, False) for fp, item in _obj_items(added)]

    item_data = _f(d, ITEM_DATA)
    if item_data is not None:
        if _is_inventory_ctx(d, item_data):
            if isinstance(item_data, dict):
                p = _f(item_data, PICKUP)
                if p: return [(None, p, False)]
                nested = []
                for fp, v in item_data.items():
                    if isinstance(v, dict):
                        p = _f(v, PICKUP)
                        if p: nested.append((fp, p, False))
                if nested: return nested
                if _item_like(item_data): return [(None, item_data, False)]
                return [(fp, item, False) for fp, item in _obj_items(item_data)]
        else:
            candidates = []
            if _item_like(item_data):
                candidates = [(None, item_data)]
            elif isinstance(item_data, dict):
                candidates = [(k, v) for k, v in item_data.items() if isinstance(v, dict)]

            out = []
            for fp, item in candidates:
                if _belongs_to_player(item):
                    log_debug(f"  [skip belongs_to_player] {fp}")
                    continue
                on_floor = _lies_on_floor(item)
                c_val      = _i(item, ["c"])
                fp_type_v  = _fp_type(fp)
                if on_floor:
                    log_debug(f"  [FLOOR_ITEM] fp={fp} c={c_val} fp_type={fp_type_v} item={json.dumps(item)[:200]}")
                    # Exact hs-tracker filter: c==1 = named/confirmed drop; c==0 = loot-table
                    # candidate (pre-MF roll). Relics are always tracked regardless of c.
                    if c_val != 1 and fp_type_v != RELIC_TYPE:
                        log_debug(f"  [skip floor c={c_val}]")
                        continue
                else:
                    if c_val != 1 and fp_type_v != RELIC_TYPE:
                        log_debug(f"  [skip non_floor c={c_val}] {fp}")
                        continue
                out.append((fp, item, on_floor))
            return out

    wrapped = _f(d, ITEM_WRAPPER)
    if wrapped and isinstance(wrapped, dict):
        return [(None, wrapped, False)]

    if ITEM_NAMED_SIG & d.keys() and {"rarity","itemRarity","item_rarity","d"} & d.keys():
        return [(None, d, False)]

    return []

# ─── identidade + deduplicação (stats.rs) ───────────────────────────────────

_seen_fp:      set[str]        = set()
_told:         set[str]        = set()
_pending_drops: dict[str, dict] = {}   # ident → drop parcial (aguardando coleta)

def _identity(item: dict, fingerprint) -> str:
    h  = str(_f(item, ["sh"]) or "")
    fp = fingerprint or _f(item, ["fingerprint","addedItemFingerprint"]) or ""
    seed      = _i(item, ["seed","a"])
    item_type = _i(item, ["type","itemType","item_type"])
    item_id   = _i(item, ["id","itemId","item_id"])
    if fp: return str(fp)
    if h:  return f"h:{h}"
    if seed or item_type or item_id: return f"g:{seed}:{item_type}:{item_id}"
    return "c:" + hashlib.md5(json.dumps(item, sort_keys=True).encode()).hexdigest()[:16]

def _try_floor(item: dict, fingerprint) -> str | None:
    """Registra sighting de chão. Retorna ident se deve emitir floor_drop, None se duplicata."""
    global _seen_fp, _told, _pending_drops
    ident    = _identity(item, fingerprint)
    sighting = f"d:{ident}"
    if sighting in _seen_fp:
        log_debug(f"  [dedup floor] já visto no chão")
        return None
    _seen_fp.add(sighting)
    if ident in _told:
        log_debug(f"  [dedup told] já coletado")
        return None
    if ident in _pending_drops:
        log_debug(f"  [dedup pending] já pendente")
        return None
    _pending_drops[ident] = {}
    if len(_seen_fp) > 20000:
        _seen_fp.clear(); _told.clear(); _pending_drops.clear()
    return ident

def _try_collect(item: dict, fingerprint) -> tuple[str | None, bool]:
    """Registra coleta. Retorna (ident, had_floor) se deve emitir collected, (None,_) se duplicata."""
    global _seen_fp, _told, _pending_drops
    ident    = _identity(item, fingerprint)
    sighting = f"p:{ident}"
    if sighting in _seen_fp:
        log_debug(f"  [dedup pickup] já processado")
        return None, False
    _seen_fp.add(sighting)
    if ident in _told:
        log_debug(f"  [dedup told] já coletado")
        return None, False
    _told.add(ident)
    had_floor = ident in _pending_drops
    if had_floor:
        del _pending_drops[ident]
    if len(_seen_fp) > 20000:
        _seen_fp.clear(); _told.clear(); _pending_drops.clear()
    return ident, had_floor

# ─── FlowBuffer — carry mechanism (parser.rs Reassembler) ───────────────────

class FlowBuffer:
    """
    Porta do Reassembler do hs-tracker:
    - Acumula payloads TCP por fluxo
    - drain() extrai JSONs completos e mantém carry (JSON incompleto no fim)
    - Cada byte processado exatamente uma vez → sem ghost detections

    Duas proteções vindas do parser.rs:
    - opens_a_value: um '{' só abre mensagem se vier seguido de '"' ou '}'.
      Um 0x7B solto no framing binário era carregado para sempre e deixava o
      fluxo mudo até acumular CARRY_MAX.
    - desistência do carry: se o JSON incompleto não fechou em CARRY_TTL
      (segmento perdido ou fora de ordem), pula o opener e lê o que veio
      atrás dele. O Rust conta rodadas de flush por ack; aqui o drain roda a
      cada pacote, então a medida equivalente é tempo.
    """
    SCAN_BUDGET = 5_000_000  # anti-quadrático para dados corrompidos
    CARRY_MAX   = 64 * 1024  # descarta carry > 64KB (mensagem perdida)
    CARRY_TTL   = 1.0        # segundos: segmentos de uma mensagem chegam em ms

    def __init__(self):
        self.buf: bytes = b""
        self.carry_since: float | None = None   # quando o carry atual começou

    def push(self, data: bytes):
        self.buf += data
        if len(self.buf) > 512 * 1024:
            self.buf = self.buf[-256 * 1024:]
            self.carry_since = None

    @staticmethod
    def _opens_a_value(buf: bytes, i: int) -> bool:
        """'{' em i abre um objeto JSON de verdade? Truncado logo após o opener conta como sim."""
        j = i + 1
        while j < len(buf) and buf[j] in (32, 9, 13, 10):   # espaco, tab, CR, LF
            j += 1
        if j >= len(buf):
            return True
        return buf[j] in b'"}'

    def drain(self) -> list[dict]:
        """Extrai todos os JSONs completos; deixa carry no buffer."""
        msgs: list[dict] = []
        buf = self.buf
        pos = 0
        carry_start: int | None = None
        scanned = 0
        # O carry antigo (sempre no início do buffer) já passou do prazo?
        give_up = (self.carry_since is not None
                   and time.monotonic() - self.carry_since > self.CARRY_TTL)

        while pos < len(buf) and scanned < self.SCAN_BUDGET:
            # Avança até o próximo '{'
            brace = buf.find(b'{', pos)
            if brace == -1:
                pos = len(buf)
                break

            scanned += brace - pos
            pos = brace

            # Byte de framing que por acaso é '{': não é mensagem, segue adiante
            if not self._opens_a_value(buf, pos):
                pos += 1
                continue

            # Balanceamento de chaves
            depth = 0; in_str = False; esc = False
            j = pos
            complete = False

            while j < len(buf) and scanned < self.SCAN_BUDGET:
                c = buf[j]
                scanned += 1
                if esc:
                    esc = False; j += 1; continue
                if c == ord('\\') and in_str:
                    esc = True; j += 1; continue
                if c == ord('"'):
                    in_str = not in_str; j += 1; continue
                if in_str:
                    j += 1; continue
                if c == ord('{'):
                    depth += 1
                elif c == ord('}'):
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(buf[pos:j+1])
                            if isinstance(obj, dict):
                                msgs.append(obj)
                        except:
                            pass
                        pos = j + 1
                        complete = True
                        break
                j += 1

            if not complete:
                if give_up:
                    # Carry vencido: pula este opener e lê o que veio atrás dele.
                    give_up = False
                    pos += 1
                    continue
                # JSON incompleto — este é o carry
                carry_start = pos
                break

        # Atualiza buffer: mantém carry ou descarta tudo processado
        if carry_start is not None:
            if carry_start != 0 or self.carry_since is None:
                self.carry_since = time.monotonic()   # carry novo
            self.buf = buf[carry_start:]
        else:
            self.buf = b""
            self.carry_since = None

        # Carry muito grande = dados corrompidos, descarta
        if len(self.buf) > self.CARRY_MAX:
            self.buf = b""
            self.carry_since = None

        return msgs

# ─── extração de formatos alternativos (base64, query string) ───────────────

def _b64_jsons(seg: bytes) -> list[dict]:
    out = []
    for m in re.finditer(rb"[A-Za-z0-9+/]{60,}={0,2}", seg):
        try:
            raw = base64.b64decode(m.group() + b"==")
            fb = FlowBuffer()
            fb.push(raw)
            out.extend(fb.drain())
        except: pass
    return out

def _query_payload(seg: bytes) -> list[dict]:
    try:
        s = seg.decode("utf-8", errors="replace")
        pairs = {}
        for part in s.split("&"):
            if "=" in part:
                k, _, v = part.partition("=")
                pairs[k.strip()] = v.strip()
        return [pairs] if pairs else []
    except: return []

# ─── rarity + nome ───────────────────────────────────────────────────────────

def _get_rarity(item: dict) -> str | None:
    for f in ITEM_RARITY:
        v = item.get(f)
        if v is None: continue
        try:
            n = int(v)
            r = RARITIES.get(n)
            if r: return r
        except: pass
        if isinstance(v, str) and v in RARITY_BY_NAME.values(): return v
    return None

def _get_name(item: dict, fingerprint) -> str | None:
    # 1. Nome explícito no packet (igual ao hs-tracker)
    name = _f(item, ["name","itemName","item_name","label"])
    if name: return str(name)

    # 2. Lookup por (item_type, item_id, weapon_type) — chave idêntica ao hs-tracker
    fp = str(fingerprint or "")
    slot_str = fp.rsplit("-", 1)[-1] if "-" in fp else ""
    try:
        item_type = int(slot_str)          # último segmento do fingerprint = type
    except:
        return None

    # Quando fingerprint presente, b = item_id; sem fingerprint, b = item_type
    item_id = _i(item, ["b"]) if fp else _i(item, ["id","itemId","item_id","gid"])

    # weapon_type: campo explícito, ou campo "j" quando type=3 (armas)
    weapon_type = _i(item, ["weapon_type","weaponType"])
    if weapon_type == 0 and item_type == 3:
        weapon_type = _i(item, ["j"])

    # Lookup com weapon_type; fallback sem (wt=0) como o hs-tracker faz
    entry = ITEM_DB.get((item_type, item_id, weapon_type))
    if entry is None and weapon_type != 0:
        entry = ITEM_DB.get((item_type, item_id, 0))

    if entry:
        log_debug(f"  [db-lookup] type={item_type} id={item_id} wt={weapon_type} → {entry[0]}")
        return entry[0]

    log_debug(f"  [db-miss] fp={fp} type={item_type} id={item_id} wt={weapon_type} item={json.dumps(item)[:200]}")
    return None

def _rarity_from_name(name: str | None) -> str | None:
    if not name: return None
    return RARITY_BY_NAME.get(name.lower())

# ─── processamento ───────────────────────────────────────────────────────────

def emit(drop: dict):
    emit_line(drop)

def process_messages(messages: list[dict], src_ip: str):
    for msg in messages:
        sources = item_sources(msg)
        if not sources: continue
        log_debug(f"item_sources: {len(sources)} candidatos de {src_ip}")
        for fp, item, ground in sources:
            c_val      = _i(item, ["c"])
            fp_type_v  = _fp_type(fp)
            named_flag = (c_val == 1)
            resource   = (fp_type_v in RESOURCE_TYPES) if fp_type_v is not None else False

            rarity = _get_rarity(item)

            # hs-tracker: plain_base && named_only → rarity = Null.
            # c==0 base items share item-ids with named gear (0..20 overlap);
            # trusting a journal-rarity claim from such a packet would produce
            # false positives on every pickup of a white sword.
            if "c" in item and c_val == 0 and rarity in JOURNAL_RARITIES and not resource:
                rarity = None

            # Odyssey items têm o campo 'h' e usam uma escala de raridade
            # diferente (d=7 = Angelic na escala sazonal, mas não é Angelic).
            # hs-tracker detecta isso e anula a raridade quando c != 1.
            if 'h' in item and not named_flag and rarity in JOURNAL_RARITIES:
                rarity = None

            # hs-tracker: name = if named_flag || worth_naming || resource { lookup }
            worth_naming = (rarity in JOURNAL_RARITIES)
            if named_flag or worth_naming or resource:
                name = _get_name(item, fp)
                # hs-tracker: packet `d` is unreliable for named items (inventory
                # syncs send d=9 regardless of actual rarity). The item tables are
                # the ground truth — always prefer DB rarity over packet rarity.
                db_rarity = _rarity_from_name(name) if name else None
                if db_rarity:
                    rarity = db_rarity
                elif not rarity:
                    pass  # no rarity from either source → skipped below
            else:
                name = _f(item, ["name", "itemName", "item_name", "label"])
                name = str(name) if name else None
                if not rarity:
                    rarity = _rarity_from_name(name)

            if not rarity:
                b_val = _i(item, ["b"])
                log_debug(f"  sem raridade: fp={fp} name={name} b={b_val} item={json.dumps(item)[:200]}")
                continue
            log_debug(f"  item detectado: fp={fp} name={name} rarity={rarity}")

            if _my_uid is not None:
                fp_acc = _fp_account(fp)
                if fp_acc is not None and fp_acc != _my_uid:
                    log_debug(f"  [skip foreign {'drop' if ground else 'item'}] fp_account={fp_acc} my_uid={_my_uid}")
                    continue

            ts = int(time.time() * 1000)
            fp_str = str(fp or "")

            if resource:
                # Runes/materiais: dedup simples, emite para ser filtrado em main.js
                ident = _identity(item, fp)
                if f"p:{ident}" in _seen_fp or ident in _told:
                    continue
                _seen_fp.add(f"p:{ident}")
                _told.add(ident)
                drop = {"type": "stat:resource", "name": name or "?", "rarity": rarity,
                        "ground": ground, "resource": True, "ts_ms": ts, "fp": fp_str}
                log_debug(f"  DROP (resource): {name} [{rarity}]")
                emit(drop)
            elif ground:
                # Item no chão — emite floor_drop, aguarda coleta
                ident = _try_floor(item, fp)
                if ident is None:
                    continue
                drop = {"type": "floor_drop", "name": name or "?", "rarity": rarity,
                        "ground": True, "resource": False, "ts_ms": ts, "fp": fp_str}
                log_debug(f"  FLOOR_DROP: {name} [{rarity}]")
                emit(drop)
            else:
                # Pickup (operations.add) — emite collected
                ident, had_floor = _try_collect(item, fp)
                if ident is None:
                    continue
                drop = {"type": "collected", "name": name or "?", "rarity": rarity,
                        "ground": False, "resource": False, "ts_ms": ts, "fp": fp_str,
                        "had_floor": had_floor}
                log_debug(f"  COLLECTED: {name} [{rarity}] had_floor={had_floor}")
                emit(drop)

_emitted_logins: set = set()
_my_uid: int | None = None
_my_char_name: str | None = None

def _fp_account(fp) -> int | None:
    if not fp: return None
    parts = str(fp).split("-")
    if len(parts) >= 2:
        try: return int(parts[1])
        except: return None
    return None

# ─── game stats detection ────────────────────────────────────────────────────

_CURRENCY_FIELDS  = ("currencyData", "currency_data")
_GOLD_PARTS       = ("GSS", "GSH", "GNS", "GNH", "GBP")
_XP_GUILD_FIELDS  = ("totalGuildXp", "total_guild_xp", "totalGuildExp", "total_guild_exp")
_XP_DIRECT_FIELDS = ("xp", "experienceGained", "experience_gained")
_KILL_FIELDS      = ("statisticTotalMonsterKills", "statistic_total_monster_kills",
                     "totalMonsterKills", "total_monster_kills")
_ACCOUNT_SIG      = frozenset({"name", "class", "heroLevel", "season", "hardcore"})
_ACCOUNT_SIG_ALT  = frozenset({"name", "class", "hero_level", "season", "hardcore"})
_STAT_PREFIX_RE   = re.compile(r'^statistic_?', re.IGNORECASE)
_NONALPHA_RE      = re.compile(r'[^a-z0-9]')

def _norm_tally(k: str) -> str:
    k = _STAT_PREFIX_RE.sub('', k)
    return _NONALPHA_RE.sub('', k.lower())

def _check_gold(msg: dict):
    for f in _CURRENCY_FIELDS:
        cd = msg.get(f)
        if isinstance(cd, dict):
            total = sum(int(cd.get(k, 0) or 0) for k in _GOLD_PARTS if k in cd)
            if total > 0:
                emit_line({"type": "stat:gold", "total": total})
            return
    ga = msg.get("goldAmount")
    if ga is not None:
        try:
            v = int(ga)
            if v > 0: emit_line({"type": "stat:gold", "total": v})
        except: pass

def _msg_first_int(msg: dict) -> int | None:
    """Extract first integer from message/msg/text fields (hs-tracker xp_gain approach)."""
    text = str(msg.get("message") or msg.get("msg") or msg.get("text") or "")
    digits = ""
    for c in text:
        if c.isdigit():
            digits += c
        elif digits:
            break
    if digits:
        try: return int(digits)
        except: pass
    return None

def _check_xp(msg: dict):
    keys = set(msg.keys())
    is_save = _ACCOUNT_SIG <= keys or _ACCOUNT_SIG_ALT <= keys
    if is_save:
        # Save packet: ler 'experience' diretamente (XP real do personagem)
        exp = msg.get("experience")
        if exp is not None:
            try:
                xp = int(exp)
                if xp > 0: emit_line({"type": "stat:xp", "total": xp})
            except: pass
        return  # nunca ler totalGuildXp do save packet

    # Pacotes de evento real-time com totalGuildXp: extrair XP do texto da mensagem
    # (hs-tracker faz isso antes de tentar o campo xp) ou do campo xp diretamente
    has_guild_xp = any(msg.get(f) is not None for f in _XP_GUILD_FIELDS)
    if has_guild_xp:
        xp_raw = _msg_first_int(msg)
        if xp_raw is None:
            for df in _XP_DIRECT_FIELDS:
                v = msg.get(df)
                if v is not None:
                    try: xp_raw = int(v); break
                    except: pass
        if xp_raw and xp_raw > 0:
            try:
                is_quest = "questId" in msg or "quest_id" in msg or "questID" in msg
                xp = xp_raw if is_quest else int(xp_raw / 0.15)
                if xp > 0: emit_line({"type": "stat:xp_gain", "gained": xp})
            except: pass
        return

    # Recompensas de quest / XP direto (sem totalGuildXp)
    for f in _XP_DIRECT_FIELDS:
        v = msg.get(f)
        if v is not None and ("status" in msg or "message" in msg):
            try:
                xp = int(v)
                if xp > 0: emit_line({"type": "stat:xp_gain", "gained": xp})
                return
            except: pass

def _check_tallies(msg: dict):
    tallies = {}
    kills_total = None
    for k, v in msg.items():
        if k in _KILL_FIELDS:
            try: kills_total = int(v)
            except: pass
        if k.lower().startswith("statistic"):
            norm = _norm_tally(k)
            try: tallies[norm] = int(v)
            except: pass
    if kills_total is not None:
        emit_line({"type": "stat:kills", "total": kills_total})
    if tallies:
        emit_line({"type": "stat:tallies", "tallies": tallies})

def _check_account(msg: dict):
    keys = set(msg.keys())

    # Social/lobby packet format: {bloodPact, uid, name, class, level, hc, season, ...}
    # Esses pacotes listam membros do Blood Pact com chaves diferentes do save-packet.
    # uid aqui é o account UID do personagem — podemos identificar o nosso.
    if ("bloodPact" in msg or "bloodPactId" in msg) and "uid" in msg and "name" in msg and "class" in msg:
        try:
            pkt_uid    = int(msg.get("uid") or 0)
            name       = str(msg.get("name") or "")
            blood_pact = int(msg.get("bloodPactId") or msg.get("bloodPact") or 0)
            season     = int(msg.get("season") or 0)
            level      = int(msg.get("level") or 0)
            hardcore   = bool(msg.get("hc") or msg.get("hardcore") or False)
            if name and blood_pact:
                is_me = (
                    (_my_uid is not None and pkt_uid == _my_uid) or
                    (_my_char_name is not None and name.lower() == _my_char_name.lower())
                )
                if is_me:
                    emit_line({"type": "stat:account", "name": name, "level": level,
                               "heroLevel": level, "mf": 0, "hardcore": hardcore,
                               "difficulty": 0, "bloodPact": blood_pact, "season": season})
                else:
                    # Outro membro do BP — emite evento separado para linking futuro
                    emit_line({"type": "stat:bp_member", "name": name, "uid": pkt_uid,
                               "bloodPact": blood_pact, "season": season})
        except: pass
        return

    # Save-packet clássico: {name, class, heroLevel, season, hardcore}
    if not (_ACCOUNT_SIG <= keys or _ACCOUNT_SIG_ALT <= keys):
        return
    if "accountUID" in msg or "unique_account_id" in msg or "uniqueAccountId" in msg:
        return  # login packet — already handled
    try:
        name       = str(msg.get("name") or "")
        level      = int(msg.get("level", 0) or 0)
        hlevel     = int(msg.get("heroLevel") or msg.get("hero_level") or 0)
        mf         = int(msg.get("mf") or msg.get("magicFind") or msg.get("magic_find") or 0)
        hardcore   = bool(msg.get("hardcore", False))
        diff       = int(msg.get("difficulty", 0) or 0)
        blood_pact = int(msg.get("blood_pact") or msg.get("bloodPact") or 0)
        season     = int(msg.get("season") or 0)
        if name:
            emit_line({"type": "stat:account", "name": name, "level": level,
                       "heroLevel": hlevel, "mf": mf, "hardcore": hardcore,
                       "difficulty": diff, "bloodPact": blood_pact, "season": season})
    except: pass

def _check_vitals_and_zone(msg: dict):
    gs = msg.get("game_state") or msg.get("gameState")
    if not isinstance(gs, str): return
    try:
        raw = base64.b64decode(gs + "==")
        fb = FlowBuffer()
        fb.push(raw)
        for dm in fb.drain():
            room = dm.get("room")
            if room: emit_line({"type": "stat:zone", "room": str(room)})
            mf    = dm.get("mf")
            level = dm.get("level")
            hlevel = dm.get("hlevel")
            sz    = dm.get("sz")
            if any(v is not None for v in [mf, level, hlevel, sz]):
                emit_line({"type": "stat:vitals", "mf": mf, "level": level,
                           "hlevel": hlevel, "sz": bool(sz)})
    except: pass

def _parse_effect_ids(v) -> list:
    """Parse buff/debuff IDs from list, pipe/comma-separated string, or int."""
    if v is None:
        return []
    if isinstance(v, list):
        out = []
        for item in v:
            try: out.append(int(item))
            except: pass
        return out
    if isinstance(v, (int, float)):
        return [int(v)]
    if isinstance(v, str):
        s = v.replace(',', '|')
        out = []
        for part in s.split('|'):
            try: out.append(int(part.strip()))
            except: pass
        return out
    return []

def _check_satanic(msg: dict):
    zone_name = msg.get("satanicZoneName") or msg.get("satanic_zone_name")
    if not zone_name: return
    raw_buffs = (msg.get("buffs") or msg.get("satanicZoneBuffs") or
                 msg.get("satanic_zone_buffs") or msg.get("zoneBuffs") or msg.get("zone_buffs"))
    raw_debuffs = (msg.get("debuffs") or msg.get("satanicZoneDebuffs") or
                   msg.get("satanic_zone_debuffs") or msg.get("zoneDebuffs") or msg.get("zone_debuffs"))
    emit_line({"type": "stat:satanic", "zone": str(zone_name),
               "buffs":   _parse_effect_ids(raw_buffs),
               "debuffs": _parse_effect_ids(raw_debuffs),
               "ts_ms": int(time.time() * 1000)})

def process_all(msgs: list[dict], src_ip: str):
    global _my_uid
    # Stats + debug scan roda em TODOS os pacotes — antes de qualquer filtro.
    # O filtro inventory_charms só se aplica ao processamento de itens.
    for msg in msgs:
        # DEBUG temporário: qualquer campo relacionado a blood_pact ou save-packet completo
        _bp = (msg.get("bloodPactId") or msg.get("blood_pact") or
               msg.get("bloodPact") or msg.get("bp") or msg.get("bloodpact"))
        _has_sig = _ACCOUNT_SIG <= set(msg.keys()) or _ACCOUNT_SIG_ALT <= set(msg.keys())
        if _bp or _has_sig:
            emit_line({"type": "debug:bp_scan",
                       "keys": sorted(msg.keys()),
                       "blood_pact": _bp,
                       "name": msg.get("name", ""),
                       "uid": msg.get("uid"),
                       "my_uid": _my_uid,
                       "season": msg.get("season"),
                       "sig_match": _has_sig})
        if "accountUID" in msg and "name" in msg:
            try:
                uid = int(msg["accountUID"])
                char = str(msg["name"]).strip()
                if char and uid and uid not in _emitted_logins:
                    _emitted_logins.add(uid)
                    _my_uid = uid
                    _my_char_name = char
                    emit_line({"type": "player_login", "charName": char, "accountUID": uid})
                    log_debug(f"PLAYER_LOGIN: {char} uid={uid}")
                    # bloodPactId está no login packet — emite stat:account direto
                    bp_id = (msg.get("bloodPactId") or msg.get("bloodPact") or
                             msg.get("blood_pact") or msg.get("bp") or 0)
                    try: bp_id = int(bp_id)
                    except: bp_id = 0
                    if bp_id:
                        emit_line({"type": "stat:account", "name": char,
                                   "level": int(msg.get("level") or 0),
                                   "heroLevel": int(msg.get("level") or 0),
                                   "mf": 0,
                                   "hardcore": bool(msg.get("hardcore") or msg.get("hc")),
                                   "difficulty": 0,
                                   "bloodPact": bp_id,
                                   "season": int(msg.get("season") or 0)})
            except: pass
        _check_gold(msg)
        _check_xp(msg)
        _check_tallies(msg)
        _check_account(msg)
        _check_vitals_and_zone(msg)
        _check_satanic(msg)
    # hs-tracker descarta inventory_charms (dump completo do inventário) e steam
    # apenas para detecção de itens — não para as checagens de stats acima.
    item_msgs = [m for m in msgs if 'inventory_charms' not in m and 'steam' not in m]
    process_messages(item_msgs, src_ip)

# ─── TCP flows (um FlowBuffer por fluxo) ────────────────────────────────────

_flows: dict[tuple, FlowBuffer] = defaultdict(FlowBuffer)

# ─── main ────────────────────────────────────────────────────────────────────

def main():
    try:
        from scapy.all import sniff
        from scapy.layers.inet import TCP, IP
    except ImportError:
        emit_line({"error": "scapy nao instalado"})
        sys.exit(1)
    from scapy.all import conf

    log_debug("=== Sniffer iniciado ===")

    # Heartbeat a cada 2s: é isso que o main.js usa para saber que o processo
    # está vivo e capturando. Silêncio de drops não significa nada.
    def _heartbeat():
        while True:
            emit_line({"type": "heartbeat", "packets": _stats["packets"],
                       "msgs": _stats["msgs"], "ts_ms": int(time.time() * 1000)})
            time.sleep(2)
    threading.Thread(target=_heartbeat, daemon=True).start()
    log_debug(f"ITEM_DB: {len(ITEM_DB)} itens, RARITY_BY_NAME: {len(RARITY_BY_NAME)} nomes")

    # Dedup de pacotes duplicados capturados em múltiplas interfaces
    _seen_seqs: dict[tuple, set] = defaultdict(set)

    def on_packet(pkt):
        try:
            if not pkt.haslayer(IP) or not pkt.haslayer(TCP): return
            _stats["packets"] += 1
            payload = bytes(pkt[TCP].payload)
            if len(payload) < 20: return

            src = pkt[IP].src; sp = pkt[TCP].sport
            dst = pkt[IP].dst; dp = pkt[TCP].dport
            key = (src, sp, dst, dp)

            # Mesmo pacote capturado em outra interface → ignorar
            seq = pkt[TCP].seq
            if seq in _seen_seqs[key]:
                return
            _seen_seqs[key].add(seq)
            # Limpar set se crescer demais (mantém só os últimos 256 seqs por fluxo)
            if len(_seen_seqs[key]) > 256:
                _seen_seqs[key] = set(list(_seen_seqs[key])[-128:])

            # FlowBuffer: reassembly com carry mechanism
            _flows[key].push(payload)
            msgs = _flows[key].drain()

            # Formatos alternativos no payload bruto (base64, query string)
            msgs.extend(_b64_jsons(payload))
            if b"=" in payload and b"&" in payload:
                msgs.extend(_query_payload(payload))

            if msgs:
                _stats["msgs"] += len(msgs)
                process_all(msgs, src)

        except Exception as e:
            log_debug(f"ERRO on_packet: {e}")

    # Todas as interfaces menos loopback, como o hs-tracker: com VPN ou split
    # tunnel o jogo pode aparecer em outro adaptador que não o da rota padrão.
    # Nenhuma cláusula de host no filtro: uma conexão nova (troca de área ou de
    # servidor) é capturada sem reiniciar nada. Duplicatas entre interfaces são
    # removidas em _seen_seqs.
    ifaces = []
    for i in conf.ifaces.values():
        net_name = str(getattr(i, "network_name", "") or "")
        ip = str(getattr(i, "ip", "") or "")
        if "Loopback" in net_name or "Loopback" in str(i.name) or ip.startswith("127."):
            continue
        ifaces.append(i)

    def run(iface):
        names = [str(i.name) for i in iface] if isinstance(iface, list) else [str(iface)]
        emit_line({"type": "info", "ifaces": names})
        log_debug(f"capturando em: {names}")
        sniff(iface=iface, filter="tcp and len > 30", prn=on_packet, store=False)

    try:
        try:
            run(ifaces if ifaces else conf.iface)
        except PermissionError:
            raise
        except Exception as e:
            # Alguma interface não abriu: cai para a interface padrão sozinha.
            log_debug(f"captura em todas as interfaces falhou ({e}); usando {conf.iface}")
            emit_line({"type": "info", "warn": f"multi-iface falhou ({str(e)[:80]}), usando interface padrão"})
            run(conf.iface)
    except PermissionError:
        log_debug("ERRO: permissao negada — execute como administrador")
        emit_line({"error": "permissao negada — execute como admin"})
        sys.exit(1)
    except Exception as e:
        log_debug(f"ERRO fatal: {e}")
        emit_line({"error": str(e)})
        sys.exit(1)

if __name__ == "__main__":
    main()
