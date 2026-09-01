"""
Constrói o banco de dados completo de itens do hs-tracker.exe.
Encontra TODOS os itens da tabela usando ponteiros VA reais.
"""
import struct, json

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

# Items conhecidos com suas raridades
KNOWN_ITEMS = {
    "Air Melon": "Angelic", "Earth Melon": "Angelic", "Fire Melon": "Angelic",
    "Water Melon": "Angelic", "Aurelion Fury": "Angelic", "Supreme Elemelon": "Angelic",
    "Commander's Sentry Blaster": "Angelic", "Divine Crackpipe": "Angelic",
    "Fury of Tarethiel": "Angelic", "Liquor Holster": "Angelic",
    "Lucifer's Crown": "Angelic", "Majorie's Belt": "Angelic",
    "Mask of the Celestial": "Angelic", "Reverse Card": "Angelic",
    "St. Aaron's Eternal Rage": "Angelic", "St. Ahto's Diamond Hands": "Angelic",
    "St. Amitiel's Truth": "Angelic", "St. Draxis Longsaw": "Angelic",
    "St. Draxis' Pigstick": "Angelic", "St. Gabriel's Retribution": "Angelic",
    "St. Hallgar's Bloodforged Aegis": "Angelic", "St. HouDeanii's Tiny Fire Rod": "Angelic",
    "St. Jupe's Plate of Command": "Angelic", "St. Neri's Rainbow Lance": "Angelic",
    "St. Nimo's Lightbringer": "Angelic", "St. Rexis Sundering Axe": "Angelic",
    "St. Soloyolo's Holy Bow": "Angelic", "St. Tomi's Vibrant Aura": "Angelic",
    "Storm Fury": "Angelic", "Tayrel's Chestplate": "Angelic",
    "The Almighty Nugget": "Angelic", "The Dawn Bringer": "Angelic",
    "Absolute Zero": "Unholy", "Annihilator": "Unholy", "Arcane Pumpkin": "Unholy",
    "Demonfire Accelerators": "Unholy", "DEVELOPRE BOOT": "Unholy",
    "Devil's Pact": "Unholy", "Forking Bolts": "Unholy", "Glock 22": "Unholy",
    "Goburin's Head": "Unholy", "Grand Arch Wizard's Mantle": "Unholy",
    "Lilith's Scorn": "Unholy", "Lilith's Wrath": "Unholy",
    "Marcher's of Hatred": "Unholy", "Overloaded Dice": "Unholy", "Peg Leg": "Unholy",
    "Rotten Pumpkin": "Unholy", "Soul Collector": "Unholy",
    "Stofflix Cooking Cleaver": "Unholy", "Stormslayer": "Unholy",
    "Nikita's KJ-33 Helmet": "Heroic", "Tarethiel's Ancient Wisdom": "Heroic",
    "Eden's Harvester": "Heroic", "Grimbone's Marchers": "Heroic",
    "Plague Bringer's Touch": "Heroic", "Arcanum Asphyxiators": "Heroic",
    "Glacier Talons": "Heroic", "Serpent's Embrace": "Heroic",
    "Tombstone": "Satanic", "Diablo": "Satanic", "Daisy": "Satanic",
    "Moonshard": "Satanic", "Sand Manipulator's Authority": "Satanic",
    "Rugal's Sash of Undertaking": "Satanic",
}

# Passo 1: Encontrar ptr_pos de cada item conhecido
print("Passo 1: Localizando itens no binário...")
anchor_entries = []  # (ptr_pos, h0, h1, h2, h3, name, rarity)

for name, rarity in KNOWN_ITEMS.items():
    str_bytes = name.encode("utf-8")
    pos = data.find(str_bytes)
    if pos == -1:
        continue

    va = file_to_va(pos)
    va_bytes = struct.pack('<Q', va)

    # Procurar este VA pointer
    search_start = 0
    while True:
        ptr_pos = data.find(va_bytes, search_start)
        if ptr_pos == -1:
            break

        # Verificar comprimento
        if ptr_pos + 16 <= len(data):
            length = struct.unpack_from('<Q', data, ptr_pos + 8)[0]
            if length == len(str_bytes) and ptr_pos >= 8:
                header = data[ptr_pos - 8 : ptr_pos]
                h0, h1, h2, h3 = header[0], header[1], header[2], header[3]
                anchor_entries.append((ptr_pos, h0, h1, h2, h3, name, rarity))
                break

        search_start = ptr_pos + 1

print(f"Itens âncora encontrados: {len(anchor_entries)}")

if not anchor_entries:
    print("ERRO: Nenhum item encontrado!")
    exit(1)

# Passo 2: Verificar o espaçamento entre entradas consecutivas
# Ordenar por ptr_pos
anchor_entries.sort(key=lambda x: x[0])

print("\nPasso 2: Verificando espaçamento da tabela...")
ptr_positions = [e[0] for e in anchor_entries]
spacings = [(ptr_positions[i+1] - ptr_positions[i]) for i in range(len(ptr_positions)-1)]

from collections import Counter
spacing_counts = Counter(spacings)
print(f"Espaçamentos mais comuns entre entradas: {spacing_counts.most_common(5)}")

# Encontrar o espaçamento dominante (esperamos 24)
dominant_spacing = spacing_counts.most_common(1)[0][0]
print(f"Espaçamento dominante: {dominant_spacing} bytes")

# Passo 3: Escanear a tabela completa
# Encontrar início e fim da tabela
# O ptr_pos está at entry_start + 8, então entry_start = ptr_pos - 8
entry_positions = [p - 8 for p in ptr_positions]
table_start = min(entry_positions)
table_end = max(entry_positions) + 24

print(f"\nPasso 3: Escaneando tabela de {table_start:#x} a {table_end:#x}...")

# Ir para trás a partir do menor item conhecido
pos = table_start - dominant_spacing
while pos >= 0:
    if pos + 24 > len(data):
        break
    ptr = struct.unpack_from('<Q', data, pos + 8)[0]
    length = struct.unpack_from('<Q', data, pos + 16)[0]
    if length == 0 or length > 150:
        break
    file_off = va_to_file(ptr)
    if file_off < 0 or file_off + length > len(data):
        break
    try:
        s = data[file_off:file_off+length].decode('utf-8')
        if all((c.isprintable() or c == ' ') and ord(c) < 128 for c in s) and len(s) > 1:
            table_start = pos
            pos -= dominant_spacing
        else:
            break
    except:
        break

# Ir para frente a partir do maior item conhecido
pos = max(entry_positions) + dominant_spacing
while pos + 24 <= len(data):
    ptr = struct.unpack_from('<Q', data, pos + 8)[0]
    length = struct.unpack_from('<Q', data, pos + 16)[0]
    if length == 0 or length > 150:
        break
    file_off = va_to_file(ptr)
    if file_off < 0 or file_off + length > len(data):
        break
    try:
        s = data[file_off:file_off+length].decode('utf-8')
        if all((c.isprintable() or c == ' ') and ord(c) < 128 for c in s) and len(s) > 1:
            table_end = pos + 24
            pos += dominant_spacing
        else:
            break
    except:
        break

print(f"Tabela expandida: {table_start:#x} a {table_end:#x}")

# Ler TODAS as entradas da tabela
all_items = []
pos = table_start
while pos + 24 <= table_end:
    ptr = struct.unpack_from('<Q', data, pos + 8)[0]
    length = struct.unpack_from('<Q', data, pos + 16)[0]
    if 1 <= length <= 150:
        file_off = va_to_file(ptr)
        if 0 <= file_off and file_off + length <= len(data):
            try:
                s = data[file_off:file_off+length].decode('utf-8')
                if all((c.isprintable() or c == ' ') and ord(c) < 128 for c in s) and len(s) > 1:
                    h0, h1, h2, h3 = data[pos], data[pos+1], data[pos+2], data[pos+3]
                    known_rarity = KNOWN_ITEMS.get(s, None)
                    all_items.append({
                        'pos': pos, 'h0': h0, 'h1': h1, 'h2': h2, 'h3': h3,
                        'name': s, 'rarity': known_rarity or '?'
                    })
            except:
                pass
    pos += dominant_spacing

print(f"Total de itens na tabela: {len(all_items)}")

# Passo 4: Mostrar todos os itens por categoria (h3)
print("\n=== Todos os itens organizados por categoria (h3) ===")
by_h3 = {}
for item in all_items:
    by_h3.setdefault(item['h3'], []).append(item)

for cat, items in sorted(by_h3.items()):
    print(f"\nCategoria h3={cat} ({len(items)} itens):")
    for item in sorted(items, key=lambda x: x['h1']):
        marker = ""
        if item['rarity'] not in ('?', None):
            marker = f" [{item['rarity']}]"
        print(f"  j={item['h1']:3}, h0={item['h0']:3}: {item['name']}{marker}")

# Passo 5: Mostrar apenas itens com j=0..20 de h3 3 e 4 para validar hipótese d=23
print("\n=== Items com j <= 20 (para comparar com j's vistos nos pacotes: 0,1,4,5,7,8,16) ===")
targets = {0, 1, 4, 5, 7, 8, 16}
for item in all_items:
    if item['h1'] in targets:
        print(f"  h3={item['h3']:2}, j={item['h1']:3}, h0={item['h0']:3}: {item['name']} [{item['rarity']}]")

# Passo 6: Salvar lookup dict para o sniffer
# Formato: (h3, h1) -> (name, rarity)
lookup = {}
for item in all_items:
    key = f"{item['h3']},{item['h1']}"
    if item['rarity'] not in ('?', None):
        lookup[key] = {"name": item['name'], "rarity": item['rarity']}

with open("item_db.json", "w") as f:
    json.dump(lookup, f, indent=2)
print(f"\nLookup salvo em item_db.json ({len(lookup)} itens raros)")

# Mostrar os primeiros 30 itens âncora com seus ptr_pos
print("\n=== Âncoras (ptr_pos em ordem) ===")
for e in anchor_entries[:30]:
    ptr_pos, h0, h1, h2, h3, name, rarity = e
    entry_pos = ptr_pos - 8
    print(f"  entry@{entry_pos:#x}  ptr@{ptr_pos:#x}  ({h3},{h0},{h1}): {name}")
