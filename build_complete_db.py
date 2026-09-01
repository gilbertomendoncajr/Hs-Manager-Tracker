"""
Constrói o ITEM_DB completo combinando:
1. RARITY_BY_NAME do items.rs do hs-tracker (GitHub)
2. Tabela binária do hs-tracker.exe (extração de VA pointers)

Resultado: sniffer_items.json com (h3, j) -> {name, rarity}
para todos os itens Angelic/Unholy/Heroic/Satanic.
"""
import struct, json, re, sys
from pathlib import Path
from urllib.request import urlopen

# ─── 1. Baixar e parsear RARITY_BY_NAME do items.rs ──────────────────────────
print("Passo 1: Baixando items.rs do GitHub...")
url = "https://raw.githubusercontent.com/Parazeya/hs-tracker/main/src-tauri/src/items.rs"
try:
    content = urlopen(url, timeout=15).read().decode("utf-8")
except Exception as e:
    # Tentar ler do arquivo local se já baixado
    local = Path(r"C:\Users\Soutc\AppData\Local\Temp\claude\items_rs.txt")
    if local.exists():
        print(f"  Usando arquivo local: {local}")
        content = local.read_text(encoding="utf-8")
    else:
        print(f"Erro ao baixar: {e}")
        sys.exit(1)

pattern = re.compile(r'\("([^"]+)",\s*"([^"]+)"\)')
rarity_by_name: dict[str, str] = {}
target_rarities = {"Angelic", "Unholy", "Heroic", "Satanic", "Set"}

for name_lower, rarity in pattern.findall(content):
    if rarity in target_rarities:
        rarity_by_name[name_lower] = rarity

print(f"  {len(rarity_by_name)} itens raros no RARITY_BY_NAME")
for r in sorted(target_rarities):
    c = sum(1 for v in rarity_by_name.values() if v == r)
    print(f"    {r}: {c}")

# ─── 2. Extrair tabela binária do hs-tracker.exe ─────────────────────────────
print("\nPasso 2: Extraindo tabela de itens do binário...")
EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"
with open(EXE, "rb") as f:
    data = f.read()

IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200

def file_to_va(file_off):
    return IMAGE_BASE + file_off + (RDATA_VA - RDATA_RAW)

def va_to_file(va):
    return va - IMAGE_BASE - (RDATA_VA - RDATA_RAW)

# Usar itens âncora conhecidos para encontrar a tabela
ANCHORS = [
    "Air Melon", "Storm Fury", "Lucifer's Crown", "Absolute Zero",
    "Grimbone's Marchers", "Tombstone", "St. Aaron's Eternal Rage",
    "Rugal's Sash of Undertaking", "Moonshard", "Annihilator",
]

anchor_positions = []
for name in ANCHORS:
    str_bytes = name.encode("utf-8")
    pos = data.find(str_bytes)
    if pos < 0:
        continue
    va = file_to_va(pos)
    va_bytes = struct.pack("<Q", va)
    ptr_pos = data.find(va_bytes)
    if ptr_pos < 0:
        continue
    length = struct.unpack_from("<Q", data, ptr_pos + 8)[0]
    if length == len(str_bytes) and ptr_pos >= 8:
        entry_pos = ptr_pos - 8
        anchor_positions.append(entry_pos)

anchor_positions.sort()
print(f"  {len(anchor_positions)} âncoras encontradas")

# Espaçamento é sempre 24 bytes (confirmado por análise anterior)
ENTRY_SIZE = 24

# Expandir para trás a partir da menor âncora
table_start = min(anchor_positions)
pos = table_start - ENTRY_SIZE
while pos >= 0:
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if not (1 <= length <= 150):
        break
    file_off = va_to_file(ptr)
    if not (0 <= file_off <= len(data) - length):
        break
    try:
        s = data[file_off:file_off+length].decode("utf-8")
        if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
            table_start = pos
            pos -= ENTRY_SIZE
        else:
            break
    except:
        break

# Expandir para frente a partir da maior âncora
table_end = max(anchor_positions) + ENTRY_SIZE
pos = table_end
while pos + ENTRY_SIZE <= len(data):
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if not (1 <= length <= 150):
        break
    file_off = va_to_file(ptr)
    if not (0 <= file_off <= len(data) - length):
        break
    try:
        s = data[file_off:file_off+length].decode("utf-8")
        if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
            table_end = pos + ENTRY_SIZE
            pos += ENTRY_SIZE
        else:
            break
    except:
        break

print(f"  Tabela: {table_start:#x} – {table_end:#x}")

# Ler todas as entradas
all_items = []
pos = table_start
while pos + ENTRY_SIZE <= table_end:
    ptr = struct.unpack_from("<Q", data, pos + 8)[0]
    length = struct.unpack_from("<Q", data, pos + 16)[0]
    if 1 <= length <= 150:
        file_off = va_to_file(ptr)
        if 0 <= file_off <= len(data) - length:
            try:
                s = data[file_off:file_off+length].decode("utf-8")
                if all(0x20 <= ord(c) <= 0x7e for c in s) and len(s) > 1:
                    h0 = data[pos]      # weapon subtype / slot subtype
                    h1 = data[pos + 1]  # j = item index na categoria
                    h2 = data[pos + 2]  # desconhecido
                    h3 = data[pos + 3]  # equipment category (slot)
                    all_items.append((h3, h1, h0, s))
            except:
                pass
    pos += ENTRY_SIZE

print(f"  {len(all_items)} itens extraídos do binário")

# ─── 3. Cruzar com RARITY_BY_NAME ────────────────────────────────────────────
print("\nPasso 3: Cruzando nomes com raridades...")

# item_db: (h3, j) → [(name, rarity), ...]
# Para armas (h3=3), mesmo j pode ter vários itens (diferentes h0)
item_db: dict[tuple[int,int], list[tuple[str,str]]] = {}
matched = 0
unmatched_rare = []

for h3, j, h0, name in all_items:
    rarity = rarity_by_name.get(name.lower())
    if rarity is None:
        continue  # ignorar Common/Superior/Mythic
    matched += 1
    key = (h3, j)
    if key not in item_db:
        item_db[key] = []
    if (name, rarity) not in item_db[key]:
        item_db[key].append((name, rarity))

print(f"  {matched} itens mapeados para {len(item_db)} chaves (h3,j)")

# Verificar itens do RARITY_BY_NAME sem match no binário
binary_names_lower = {name.lower() for _, _, _, name in all_items}
for name_lower, rarity in rarity_by_name.items():
    if name_lower not in binary_names_lower:
        unmatched_rare.append((rarity, name_lower))

if unmatched_rare:
    print(f"\n  {len(unmatched_rare)} itens raros no RARITY_BY_NAME sem match no binário:")
    for r, n in sorted(unmatched_rare)[:20]:
        print(f"    [{r}] {n}")

# ─── 4. Gerar sniffer_items.json ─────────────────────────────────────────────
print("\nPasso 4: Salvando sniffer_items.json...")
output = {}
for (h3, j), entries in sorted(item_db.items()):
    output[f"{h3},{j}"] = entries

out_path = Path(__file__).parent / "sniffer_items.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"  Salvo: {out_path}")
print(f"  {len(output)} chaves (h3,j)")

# Resumo por raridade
from collections import Counter
all_rarities = Counter(r for entries in output.values() for _, r in entries)
print("\nResumo:")
for r, c in sorted(all_rarities.items(), key=lambda x: -x[1]):
    print(f"  {r}: {c} itens")

# ─── 5. Gerar _RAW para sniffer.py ───────────────────────────────────────────
print("\nPasso 5: Gerando bloco _RAW para sniffer.py...")
lines = ["_RAW = ["]
cat_names = {0:"Capacetes", 1:"Peitorais", 2:"Botas", 3:"Armas",
             4:"Luvas", 5:"Colar", 6:"Escudo", 7:"Anel",
             8:"Cinto", 10:"Acessório"}

for h3 in sorted({k[0] for k in item_db}):
    cat = cat_names.get(h3, f"h3={h3}")
    lines.append(f"    # h3={h3} {cat}")
    for j in sorted({k[1] for k in item_db if k[0] == h3}):
        for name, rarity in item_db.get((h3, j), []):
            name_esc = name.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'    ({h3:2}, {j:3}, "{name_esc}", "{rarity}"),')
lines.append("]")

raw_path = Path(__file__).parent / "sniffer_items_raw.py"
with open(raw_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"  Salvo: {raw_path}")
