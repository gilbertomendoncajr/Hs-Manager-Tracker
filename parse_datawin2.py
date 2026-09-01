"""
Parseia data.win do GameMaker Studio (formato correto).
Os offsets no STRG são ABSOLUTOS (relativos ao início do arquivo).
"""
import struct, re

DATA_WIN = r"C:\Program Files (x86)\Steam\steamapps\common\HeroSiege\bin\data.win"

print("Carregando data.win...")
with open(DATA_WIN, "rb") as f:
    data = f.read()
print(f"Carregado: {len(data):,} bytes")

# Encontrar STRG chunk
strg_pos = data.find(b'STRG')
if strg_pos == -1:
    print("ERRO: STRG não encontrado")
    exit(1)

strg_size = struct.unpack_from('<I', data, strg_pos + 4)[0]
strg_data_start = strg_pos + 8
print(f"STRG @ {strg_pos:#x}, data @ {strg_data_start:#x}, size={strg_size:,}")

# Primeiro i32 = count
count = struct.unpack_from('<I', data, strg_data_start)[0]
print(f"Número de strings: {count:,}")

# Os offsets são ABSOLUTOS (do início do arquivo)
offsets = []
for i in range(min(count, 100000)):
    off = struct.unpack_from('<I', data, strg_data_start + 4 + i * 4)[0]
    offsets.append(off)

print(f"Primeiros offsets: {offsets[:5]}")
print(f"Primeiro offset em hex: {offsets[0]:#x}")

# Verificar formato: espera-se 4 bytes de comprimento + string + null
# Testar com o primeiro offset
off0 = offsets[0]
if off0 < len(data) - 4:
    length0 = struct.unpack_from('<I', data, off0)[0]
    s0 = data[off0+4:off0+4+length0].decode('utf-8', errors='replace')
    print(f"String[0] @ {off0:#x}: length={length0}, '{s0}'")

# Ler todas as strings
print("\nLendo strings...")
strings = {}
for i, off in enumerate(offsets):
    if off < 0 or off + 4 >= len(data):
        continue
    length = struct.unpack_from('<I', data, off)[0]
    if length > 10000 or off + 4 + length > len(data):
        continue
    try:
        s = data[off+4:off+4+length].decode('utf-8', errors='replace')
        strings[i] = s
    except Exception:
        pass

print(f"Strings lidas: {len(strings)}")

# Procurar itens conhecidos
KNOWN_ITEMS = [
    "Absolute Zero", "Annihilator", "Stormslayer", "Glock 22",
    "Peg Leg", "Soul Collector", "Lilith's Scorn", "Air Melon",
    "Water Melon", "Fire Melon", "Earth Melon", "Reverse Card",
    "Storm Fury", "The Dawn Bringer", "Lucifer's Crown", "Moonshard",
    "Daisy", "Diablo", "Tombstone",
    # From runs.json
    "Eden's Harvester", "Grimbone's Marchers", "Tarethiel's Ancient Wisdom",
    "Rugal's Sash of Undertaking", "Arcanum Asphyxiators", "Glacier Talons",
    "Serpent's Embrace", "Plague Bringer's Touch", "Nikita's KJ-33 Helmet",
    "Pillar of Niflheim", "Rendguard of Carnage", "Ice King's Crown",
]

print("\n=== Itens conhecidos na tabela de strings ===")
found_items = {}
for idx, s in strings.items():
    for name in KNOWN_ITEMS:
        if s == name:
            print(f"  [{idx:6d}] '{s}'")
            found_items[name] = idx

print(f"\nEncontrados: {len(found_items)}/{len(KNOWN_ITEMS)}")

# Se encontrou itens, verificar adjacências (itens de mesma rarity costumam estar juntos)
if found_items:
    print("\n=== Strings adjacentes a itens conhecidos ===")
    for name, idx in sorted(found_items.items(), key=lambda x: x[1]):
        before = [strings.get(idx-2), strings.get(idx-1)]
        after = [strings.get(idx+1), strings.get(idx+2)]
        print(f"  {idx}: {before} | [{name}] | {after}")

# Procurar padrão "Angelic" ou "Unholy" como valores de rarity
print("\n=== Strings com raridades ===")
rarities = ["Angelic", "Unholy", "Heroic", "Satanic", "Set", "Mythic", "Common", "Rare"]
for idx, s in strings.items():
    if s in rarities:
        print(f"  [{idx}] '{s}'")
