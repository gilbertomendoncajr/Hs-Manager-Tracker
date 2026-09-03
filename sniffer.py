"""
hs-drop-logger sniffer — porta da lógica do hs-tracker (Rust):
https://github.com/Parazeya/hs-tracker

parser.rs  → extract_messages, item_sources, lies_on_floor, belongs_to_player
stats.rs   → RARITIES, seen_fingerprints, told, get_identity
sniffer.rs → filtro BPF dinâmico, deduplicação de pacotes

Reassembly: carry mechanism do hs-tracker — cada byte processado exatamente uma vez.
"""

import json, sys, re, base64, hashlib, time
from collections import defaultdict
from datetime import datetime

# ─── logging ────────────────────────────────────────────────────────────────

def log_debug(msg: str):
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    with open("sniffer_debug.txt", "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {msg}\n")

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

def _load_db():
    import os
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS
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
        log_debug(f"ITEM_DB: {len(ITEM_DB)} itens, RARITY_BY_NAME: {len(RARITY_BY_NAME)} nomes")
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

# ─── item_sources (parser.rs) ────────────────────────────────────────────────

def item_sources(d: dict) -> list[tuple]:
    if not isinstance(d, dict): return []
    if MARKET_FIELDS & d.keys(): return []

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
                c_val = _i(item, ["c"])
                d_val = _i(item, ["d"])
                is_journal = RARITIES.get(d_val) in JOURNAL_RARITIES
                if c_val != 1 and _fp_type(fp) != RELIC_TYPE and not is_journal:
                    log_debug(f"  [skip c={c_val} fp_type={_fp_type(fp)} d={d_val}] {fp}")
                    continue
                if _belongs_to_player(item):
                    log_debug(f"  [skip belongs_to_player] {fp}")
                    continue
                if not _lies_on_floor(item):
                    log_debug(f"  [skip not_on_floor] {fp}")
                    continue
                out.append((fp, item, True))
            return out

    wrapped = _f(d, ITEM_WRAPPER)
    if wrapped and isinstance(wrapped, dict):
        return [(None, wrapped, False)]

    if ITEM_NAMED_SIG & d.keys() and {"rarity","itemRarity","item_rarity","d"} & d.keys():
        return [(None, d, False)]

    return []

# ─── identidade + deduplicação (stats.rs) ───────────────────────────────────

_seen_fp: set[str] = set()
_told:    set[str] = set()

def _identity(item: dict, fingerprint) -> str:
    h  = str(_f(item, ["sh"]) or "")
    fp = fingerprint or _f(item, ["fingerprint","addedItemFingerprint"]) or ""
    seed      = _i(item, ["seed","a"])
    item_type = _i(item, ["type","itemType","item_type"])
    item_id   = _i(item, ["id","itemId","item_id"])
    # fp is the stable unique ID for ground items; sh can vary between retransmitted packets
    if fp: return str(fp)
    if h:  return f"h:{h}"
    if seed or item_type or item_id: return f"g:{seed}:{item_type}:{item_id}"
    return "c:" + hashlib.md5(json.dumps(item, sort_keys=True).encode()).hexdigest()[:16]

def _dedup_ok(item: dict, fingerprint, ground: bool) -> bool:
    global _seen_fp, _told
    ident = _identity(item, fingerprint)
    sighting = f"{'d' if ground else 'p'}:{ident}"
    if sighting in _seen_fp:
        log_debug(f"  [dedup sighting] {sighting}")
        return False
    _seen_fp.add(sighting)
    if ident in _told:
        log_debug(f"  [dedup told] {ident}")
        return False
    _told.add(ident)
    if len(_seen_fp) > 20000:
        _seen_fp.clear(); _told.clear()
    return True

# ─── FlowBuffer — carry mechanism (parser.rs Reassembler) ───────────────────

class FlowBuffer:
    """
    Porta do Reassembler do hs-tracker:
    - Acumula payloads TCP por fluxo
    - drain() extrai JSONs completos e mantém carry (JSON incompleto no fim)
    - Cada byte processado exatamente uma vez → sem ghost detections
    """
    SCAN_BUDGET = 5_000_000  # anti-quadrático para dados corrompidos
    CARRY_MAX   = 64 * 1024  # descarta carry > 64KB (mensagem perdida)

    def __init__(self):
        self.buf: bytes = b""

    def push(self, data: bytes):
        self.buf += data
        if len(self.buf) > 512 * 1024:
            self.buf = self.buf[-256 * 1024:]

    def drain(self) -> list[dict]:
        """Extrai todos os JSONs completos; deixa carry no buffer."""
        msgs: list[dict] = []
        buf = self.buf
        pos = 0
        carry_start: int | None = None
        scanned = 0

        while pos < len(buf) and scanned < self.SCAN_BUDGET:
            # Avança até o próximo '{'
            brace = buf.find(b'{', pos)
            if brace == -1:
                pos = len(buf)
                break

            scanned += brace - pos
            pos = brace

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
                # JSON incompleto — este é o carry
                carry_start = pos
                break

        # Atualiza buffer: mantém carry ou descarta tudo processado
        if carry_start is not None:
            self.buf = buf[carry_start:]
        else:
            self.buf = b""

        # Carry muito grande = dados corrompidos, descarta
        if len(self.buf) > self.CARRY_MAX:
            self.buf = b""

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
    print(json.dumps(drop, ensure_ascii=False), flush=True)

def process_messages(messages: list[dict], src_ip: str):
    for msg in messages:
        sources = item_sources(msg)
        if not sources: continue
        log_debug(f"item_sources: {len(sources)} candidatos de {src_ip}")
        for fp, item, ground in sources:
            rarity = _get_rarity(item)
            if not rarity:
                name = _get_name(item, fp)
                rarity = _rarity_from_name(name)
            else:
                name = _get_name(item, fp)

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

            if rarity not in JOURNAL_RARITIES:
                log_debug(f"  raridade comum ignorada: {rarity} name={name}")
                continue

            if not _dedup_ok(item, fp, ground):
                continue

            drop = {
                "name":   name or "?",
                "rarity": rarity,
                "ground": ground,
                "ts_ms":  int(time.time() * 1000),
                "fp":     str(fp or ""),
            }
            log_debug(f"  DROP: {name} [{rarity}] ground={ground}")
            emit(drop)

_emitted_logins: set = set()
_my_uid: int | None = None

def _fp_account(fp) -> int | None:
    if not fp: return None
    parts = str(fp).split("-")
    if len(parts) >= 2:
        try: return int(parts[1])
        except: return None
    return None

def process_all(msgs: list[dict], src_ip: str):
    global _my_uid
    for msg in msgs:
        if "accountUID" in msg and "name" in msg:
            uid = int(msg["accountUID"])
            char = str(msg["name"]).strip()
            if char and uid and uid not in _emitted_logins:
                _emitted_logins.add(uid)
                _my_uid = uid
                print(json.dumps({"type": "player_login", "charName": char, "accountUID": uid}), flush=True)
                log_debug(f"PLAYER_LOGIN: {char} uid={uid}")
    process_messages(msgs, src_ip)

# ─── TCP flows (um FlowBuffer por fluxo) ────────────────────────────────────

_flows: dict[tuple, FlowBuffer] = defaultdict(FlowBuffer)

# ─── main ────────────────────────────────────────────────────────────────────

def main():
    try:
        from scapy.all import sniff
        from scapy.layers.inet import TCP, IP
    except ImportError:
        print(json.dumps({"error": "scapy nao instalado"}), flush=True)
        sys.exit(1)

    log_debug("=== Sniffer iniciado ===")
    log_debug(f"ITEM_DB: {len(ITEM_DB)} itens, RARITY_BY_NAME: {len(RARITY_BY_NAME)} nomes")

    def on_packet(pkt):
        try:
            if not pkt.haslayer(IP) or not pkt.haslayer(TCP): return
            payload = bytes(pkt[TCP].payload)
            if len(payload) < 20: return

            src = pkt[IP].src; sp = pkt[TCP].sport
            dst = pkt[IP].dst; dp = pkt[TCP].dport
            key = (src, sp, dst, dp)

            # FlowBuffer: reassembly com carry mechanism
            _flows[key].push(payload)
            msgs = _flows[key].drain()

            # Formatos alternativos no payload bruto (base64, query string)
            msgs.extend(_b64_jsons(payload))
            if b"=" in payload and b"&" in payload:
                msgs.extend(_query_payload(payload))

            if msgs:
                process_all(msgs, src)

        except Exception as e:
            log_debug(f"ERRO on_packet: {e}")

    try:
        sniff(filter="tcp and len > 30", prn=on_packet, store=False)
    except PermissionError:
        log_debug("ERRO: permissao negada — execute como administrador")
        print(json.dumps({"error": "permissao negada — execute como admin"}), flush=True)
        sys.exit(1)
    except Exception as e:
        log_debug(f"ERRO fatal: {e}")
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
