"""
Analisa quais valores de h2 correspondem a quais raridades,
usando itens conhecidos do items.rs como referencia.
"""
import struct, re
from urllib.request import urlopen
from pathlib import Path
from collections import Counter

EXE = r'C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe'
with open(EXE, 'rb') as f:
    data = f.read()

IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200

def va_to_file(va): return va - IMAGE_BASE - (RDATA_VA - RDATA_RAW)
def file_to_va(fo): return IMAGE_BASE + fo + (RDATA_VA - RDATA_RAW)

ANCHORS = ["Air Melon", "Storm Fury", "Lucifer's Crown", "Absolute Zero"]
anchor_positions = []
for name in ANCHORS:
    sb = name.encode("utf-8")
    pos = data.find(sb)
    if pos < 0: continue
    va_bytes = struct.pack("<Q", file_to_va(pos))
    ptr_pos = data.find(va_bytes)
    if ptr_pos < 0: continue
    length = struct.unpack_from("<Q", data, ptr_pos + 8)[0]
    if length == len(sb) and ptr_pos >= 8:
        anchor_positions.append(ptr_pos - 8)

anchor_positions.sort()
ENTRY_SIZE = 24
table_start = min(anchor_positions)
pos = table_start - ENTRY_SIZE
while pos >= 0:
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if not (1 <= length <= 150): break
    fo = va_to_file(ptr)
    if not (0 <= fo <= len(data) - length): break
    try:
        s = data[fo:fo+length].decode("utf-8")
        if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
            table_start = pos; pos -= ENTRY_SIZE
        else: break
    except: break

table_end = max(anchor_positions) + ENTRY_SIZE
pos = table_end
while pos + ENTRY_SIZE <= len(data):
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if not (1 <= length <= 150): break
    fo = va_to_file(ptr)
    if not (0 <= fo <= len(data) - length): break
    try:
        s = data[fo:fo+length].decode("utf-8")
        if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
            table_end = pos + ENTRY_SIZE; pos += ENTRY_SIZE
        else: break
    except: break

# Carregar items.rs com TODAS as raridades
url = "https://raw.githubusercontent.com/Parazeya/hs-tracker/main/src-tauri/src/items.rs"
try:
    content = urlopen(url, timeout=10).read().decode("utf-8")
    print("items.rs baixado")
except Exception as e:
    print(f"Erro: {e}")
    content = ""

pattern = re.compile(r'\("([^"]+)",\s*"([^"]+)"\)')
rarity_by_name = {}
for nm, rar in pattern.findall(content):
    rarity_by_name[nm.lower()] = rar

print(f"Total itens no RARITY_BY_NAME: {len(rarity_by_name)}")

# Extrair todos os itens com h0, h1, h2, h3
all_items = []
pos = table_start
while pos + ENTRY_SIZE <= table_end:
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if 1 <= length <= 150:
        fo = va_to_file(ptr)
        if 0 <= fo <= len(data) - length:
            try:
                s = data[fo:fo+length].decode("utf-8")
                if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
                    h0 = data[pos]
                    h1 = data[pos + 1]
                    h2 = data[pos + 2]
                    h3 = data[pos + 3]
                    rar = rarity_by_name.get(s.lower(), None)
                    all_items.append((h0, h1, h2, h3, s, rar))
            except: pass
    pos += ENTRY_SIZE

print(f"Total itens extraidos: {len(all_items)}")

# Ver distribuicao de h2 por raridade (para itens conhecidos)
h2_by_rarity = {}
for h0, h1, h2, h3, name, rar in all_items:
    if rar is None: continue
    if rar not in h2_by_rarity:
        h2_by_rarity[rar] = Counter()
    h2_by_rarity[rar][h2] += 1

print("\n=== h2 por raridade (itens conhecidos no items.rs) ===")
for rar in sorted(h2_by_rarity):
    counts = h2_by_rarity[rar].most_common(5)
    print(f"  {rar}: {counts}")

# Ver h2 para "Thunder Caller's Robe"
print("\n=== Busca: 'thunder caller' no binario ===")
for h0, h1, h2, h3, name, rar in all_items:
    if "thunder caller" in name.lower():
        print(f"  h0={h0} h1={h1} h2={h2} h3={h3} name={name} rar_items_rs={rar}")

# Ver h2 para Heaven's Might (Satanic conhecido)
print("\n=== Heaven's Might (Satanic) ===")
for h0, h1, h2, h3, name, rar in all_items:
    if "heaven" in name.lower() and "might" in name.lower():
        print(f"  h0={h0} h1={h1} h2={h2} h3={h3} name={name} rar_items_rs={rar}")

# Distribuicao h2 para itens com raridade desconhecida (not in items.rs)
h2_unknown = Counter(h2 for _, _, h2, _, _, rar in all_items if rar is None)
print(f"\n=== h2 para itens NAO em items.rs ({sum(h2_unknown.values())} itens) ===")
for h2_val, count in sorted(h2_unknown.items()):
    print(f"  h2={h2_val}: {count} itens")

# Quais itens nao estao no items.rs mas tem h2 = valor Satanic?
print("\n=== Hipotese: h2=? para Satanic ===")
# Calcular h2 mais comum para Satanic
if "Satanic" in h2_by_rarity:
    sat_h2 = h2_by_rarity["Satanic"].most_common(1)[0][0]
    print(f"  h2 mais comum para Satanic: {sat_h2}")
    # Listar itens desconhecidos com mesmo h2
    missing_sat = [(h1, h3, name) for h0, h1, h2, h3, name, rar in all_items if h2 == sat_h2 and rar is None]
    print(f"  Itens nao em items.rs com h2={sat_h2}: {len(missing_sat)}")
    for h1, h3, name in sorted(missing_sat)[:20]:
        if "thunder" in name.lower() or h3 == 1:
            print(f"    h3={h3} h1={h1} {name}")
