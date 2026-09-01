"""
hs-drop-logger sniffer — port direto da lógica do hs-tracker (Rust):
https://github.com/Parazeya/hs-tracker

parser.rs  → extract_messages, item_sources, lies_on_floor, belongs_to_player
stats.rs   → RARITIES, seen_fingerprints, told, get_identity
sniffer.rs → filtro BPF dinâmico, deduplicação de pacotes
"""

import json, sys, re, base64, struct, hashlib, time
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

# ─── item DB (name + rarity fallback via sniffer_items.json) ────────────────

ITEM_DB: dict[tuple[int,int], list[tuple[str,str]]] = defaultdict(list)
RARITY_BY_NAME: dict[str,str] = {}

def _load_db():
    import os, sys
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
        n = 0
        for key, entries in db.items():
            h3, j = map(int, key.split(","))
            for e in entries:
                ITEM_DB[(h3, j)].append((e[0], e[1]))
                RARITY_BY_NAME[e[0].lower()] = e[1]
                n += 1
        log_debug(f"ITEM_DB: {n} itens carregados")
    except Exception as ex:
        log_debug(f"Erro ao carregar ITEM_DB: {ex}")

_load_db()

# ─── servidores HS ───────────────────────────────────────────────────────────

HS_IPS = {
    "172.105.246.129",  # REST API  panicartstudios.com
    "172.232.36.127",   # game server
    "194.195.242.141",  # game server regional
    "195.197.146.222",  # game server regional
    "139.177.176.8",    # game server
    "104.18.124.108",   # Cloudflare/CDN
}

# ─── campos (parser.rs constantes) ──────────────────────────────────────────

MARKET_FIELDS      = {"marketId","market_id","market_tokens","marketTokens",
                      "seller_name","sellerName","price"}
ITEM_WRAPPER       = ["addedItemObject","added_item_object"]
ITEM_SIG           = {"seed","a","itemId","item_id","gid"}
ITEM_NAMED_SIG     = {"seed","itemId","item_id","gid"}
ITEM_RARITY        = ["rarity","itemRarity","item_rarity","d"]
ITEM_DATA          = ["itemData","item_data"]
PICKUP             = ["pickup_add_data","pickupAddData"]
CLIENT_ENVELOPE    = {"identifier","checksum"}
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
    """
    Retorna [(fingerprint|None, item_dict, ground: bool)]
    Porta direta de item_sources() do parser.rs do hs-tracker.
    """
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
                if c_val != 1 and _fp_type(fp) != RELIC_TYPE:
                    log_debug(f"  [skip c={c_val} fp_type={_fp_type(fp)}] {fp}")
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
    if h:  return f"h:{h}"
    if fp: return str(fp)
    if seed or item_type or item_id: return f"g:{seed}:{item_type}:{item_id}"
    return ""

def _dedup_ok(item: dict, fingerprint, ground: bool) -> bool:
    global _seen_fp, _told
    ident = _identity(item, fingerprint)
    if ident:
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

# ─── extração de JSON do payload TCP (parser.rs extract_messages) ────────────

def _b64_jsons(seg: bytes) -> list[dict]:
    out = []
    for m in re.finditer(rb"[A-Za-z0-9+/]{60,}={0,2}", seg):
        try:
            raw = base64.b64decode(m.group() + b"==")
            for obj in _extract_json_values(raw):
                out.append(obj)
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

def _extract_json_values(buf: bytes) -> list[dict]:
    """Extrai todos os objetos JSON completos de buf usando balanceamento de chaves."""
    out = []
    i = 0
    while i < len(buf):
        if buf[i] == ord("{"):
            depth = 0; in_str = False; esc = False
            for j in range(i, len(buf)):
                c = buf[j]
                if esc:           esc = False; continue
                if c == ord("\\") and in_str: esc = True; continue
                if c == ord('"'): in_str = not in_str; continue
                if in_str:        continue
                if c == ord("{"): depth += 1
                elif c == ord("}"):
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(buf[i:j+1])
                            if isinstance(obj, dict): out.append(obj)
                        except: pass
                        i = j + 1
                        break
            else: break
        else: i += 1
    return out

def extract_messages(buf: bytes) -> list[dict]:
    """Porta de extract_messages() do parser.rs."""
    out = _extract_json_values(buf)
    for seg in re.split(rb"[\x00-\x1f\x7f]", buf):
        if len(seg) > 100:
            out.extend(_b64_jsons(seg))
        if b"=" in seg and b"&" in seg:
            out.extend(_query_payload(seg))
    return out

# ─── TCP stream buffer (reassembly simplificado) ─────────────────────────────

_streams: dict[tuple, bytes] = defaultdict(bytes)
_MAX_STREAM = 256 * 1024  # 256 KB (parser.rs MAX_SPAN)

# deduplicação de pacotes (sniffer.rs fresh_messages — janela 10s)
_pkt_hashes: list[tuple[int, float]] = []

def _is_fresh(payload: bytes) -> bool:
    global _pkt_hashes
    h = hash(payload)
    now = time.time()
    _pkt_hashes = [(hh, t) for hh, t in _pkt_hashes if now - t < 10]
    if any(hh == h for hh, _ in _pkt_hashes):
        return False
    _pkt_hashes.append((h, now))
    return True

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
    name = _f(item, ["name","itemName","item_name","label"])
    if name: return str(name)
    # fallback: chave fingerprint formato "99-account-ts-SLOT" → slot=h3
    # b = base item index (h1 no binário, coincide com tier do item)
    fp = str(fingerprint or "")
    slot_str = fp.rsplit("-", 1)[-1] if "-" in fp else ""
    b_val = _i(item, ["b"])
    try:
        h3 = int(slot_str)
        entries = ITEM_DB.get((h3, b_val), [])
        if entries: return entries[0][0]
    except: pass
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
            log_debug(f"  item detectado: fp={fp} name={name} rarity={rarity} fields={json.dumps(item)[:200]}")

            if rarity not in JOURNAL_RARITIES:
                log_debug(f"  raridade comum ignorada: {rarity} name={name}")
                continue

            if not _dedup_ok(item, fp, ground):
                continue

            tier = _i(item, ["tier","n","b"])
            drop = {
                "name":   name or "?",
                "rarity": rarity,
                "tier":   tier,
                "ground": ground,
                "ts_ms":  int(time.time() * 1000),
                "fp":     str(fp or ""),
            }
            log_debug(f"  DROP: {name} [{rarity}] T{tier} ground={ground}")
            emit(drop)

_emitted_logins: set = set()

def process_buf(buf: bytes, src_ip: str):
    if not _is_fresh(buf): return
    msgs = extract_messages(buf)
    if not msgs: return

    for msg in msgs:
        # Detectar packet de login: tem "name" + "accountUID" (campo exclusivo do login)
        if "accountUID" in msg and "name" in msg:
            uid = int(msg["accountUID"])
            char = str(msg["name"]).strip()
            if char and uid and uid not in _emitted_logins:
                _emitted_logins.add(uid)
                print(json.dumps({"type": "player_login", "charName": char, "accountUID": uid}), flush=True)
                log_debug(f"PLAYER_LOGIN: {char} uid={uid}")

    process_messages(msgs, src_ip)

# ─── main ────────────────────────────────────────────────────────────────────

def main():
    try:
        from scapy.all import sniff
        from scapy.layers.inet import TCP, IP
    except ImportError:
        print(json.dumps({"error": "scapy nao instalado"}), flush=True)
        sys.exit(1)

    log_debug("=== Sniffer iniciado (hs-tracker port) ===")
    log_debug(f"ITEM_DB: {sum(len(v) for v in ITEM_DB.values())} itens, "
              f"RARITY_BY_NAME: {len(RARITY_BY_NAME)} nomes")

    filter_str = (
        "tcp and len > 30 and ("
        "net 104.18.124.0/24 or "
        "net 139.177.176.0/24 or "
        "host 172.105.246.129 or "
        "host 172.232.36.127 or "
        "net 194.195.242.0/24 or "
        "net 195.197.146.0/24)"
    )

    def on_packet(pkt):
        try:
            if not pkt.haslayer(IP) or not pkt.haslayer(TCP): return
            src = pkt[IP].src; dst = pkt[IP].dst
            if src not in HS_IPS and dst not in HS_IPS: return

            payload = bytes(pkt[TCP].payload)
            if len(payload) < 20: return

            sp = pkt[TCP].sport; dp = pkt[TCP].dport
            key = (src, sp, dst, dp)

            # Tentar payload isolado primeiro
            process_buf(payload, src)

            # Acumular no stream buffer para fragmentos
            _streams[key] += payload
            if len(_streams[key]) > _MAX_STREAM:
                _streams[key] = _streams[key][-_MAX_STREAM:]
            if len(_streams[key]) > len(payload):
                process_buf(_streams[key], src)

        except Exception as e:
            log_debug(f"ERRO on_packet: {e}")

    try:
        sniff(filter=filter_str, prn=on_packet, store=False)
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
