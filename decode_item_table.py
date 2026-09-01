"""
Decodifica a tabela de itens do hs-tracker.exe.
Formato de cada entrada (24 bytes):
  [8 bytes header: byte0=?, byte1=j_idx, byte2=?, byte3=d_val, ...]
  [8 bytes: VA pointer para string]
  [8 bytes: comprimento da string]
"""
import struct, re

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"

with open(EXE, "rb") as f:
    data = f.read()

# Parâmetros PE
IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200

def file_to_va(file_off):
    return IMAGE_BASE + file_off - RDATA_RAW + RDATA_VA

def va_to_file(va):
    return va - IMAGE_BASE - RDATA_VA + RDATA_RAW

# Encontrar todas as strings de itens raros
ITEM_DB_FULL = {
    # Angelic
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
    "St. Jupe's Plate of Command": "Angelic", "St. Mika's Zweihander": "Angelic",
    "St. Neri's Rainbow Lance": "Angelic", "St. Nimo's Lightbringer": "Angelic",
    "St. Rexis Sundering Axe": "Angelic", "St. Soloyolo's Holy Bow": "Angelic",
    "St. Tomi's Vibrant Aura": "Angelic", "Storm Fury": "Angelic",
    "Tayrel's Chestplate": "Angelic", "The Almighty Nugget": "Angelic",
    "The Dawn Bringer": "Angelic",
    # Unholy
    "Absolute Zero": "Unholy", "Annihilator": "Unholy", "Arcane Pumpkin": "Unholy",
    "Demonfire Accelerators": "Unholy", "DEVELOPRE BOOT": "Unholy",
    "Devil's Pact": "Unholy", "El Patron's Madness": "Unholy",
    "Forking Bolts": "Unholy", "Glock 22": "Unholy", "Goburin's Head": "Unholy",
    "Grand Arch Wizard's Mantle": "Unholy", "Lilith's Scorn": "Unholy",
    "Lilith's Wrath": "Unholy", "Marcher's of Hatred": "Unholy",
    "Overloaded Dice": "Unholy", "Peg Leg": "Unholy", "Rotten Pumpkin": "Unholy",
    "Soul Collector": "Unholy", "Stofflix Cooking Cleaver": "Unholy",
    "Stormslayer": "Unholy",
    # Heroic
    "Nikita's KJ-33 Helmet": "Heroic", "Tarethiel's Ancient Wisdom": "Heroic",
    "Eden's Harvester": "Heroic", "Grimbone's Marchers": "Heroic",
    "Plague Bringer's Touch": "Heroic", "Arcanum Asphyxiators": "Heroic",
    "Glacier Talons": "Heroic", "Serpent's Embrace": "Heroic",
    # Satanic
    "Tombstone": "Satanic", "Diablo": "Satanic", "Daisy": "Satanic",
    "Moonshard": "Satanic", "Sand Manipulator's Authority": "Satanic",
    "Rugal's Sash of Undertaking": "Satanic",
}

# Encontrar posições no arquivo
item_positions = {}
for name in ITEM_DB_FULL:
    pos = data.find(name.encode("utf-8"))
    if pos != -1:
        item_positions[name] = pos

print(f"Itens localizados no binário: {len(item_positions)}")

# Para cada item, calcular VA e procurar na tabela
results = []
for name, file_off in item_positions.items():
    va = file_to_va(file_off)
    va_bytes = struct.pack('<Q', va)

    # Procurar ponteiro no binário
    ptr_pos = data.find(va_bytes)
    if ptr_pos == -1:
        continue

    # O header fica 8 bytes antes do ponteiro
    if ptr_pos < 8:
        continue

    header = data[ptr_pos-8:ptr_pos]
    length = struct.unpack_from('<Q', data, ptr_pos+8)[0]

    # Verificar comprimento
    expected_len = len(name.encode("utf-8"))
    if length != expected_len:
        # Pode haver múltiplos ponteiros — procurar o correto
        search_pos = ptr_pos + 1
        while True:
            ptr_pos2 = data.find(va_bytes, search_pos)
            if ptr_pos2 == -1:
                break
            if ptr_pos2 >= 8:
                length2 = struct.unpack_from('<Q', data, ptr_pos2+8)[0]
                if length2 == expected_len:
                    ptr_pos = ptr_pos2
                    header = data[ptr_pos-8:ptr_pos]
                    length = length2
                    break
            search_pos = ptr_pos2 + 1

    rarity = ITEM_DB_FULL[name]

    # Extrair campos do header (8 bytes)
    h0, h1, h2, h3 = header[0], header[1], header[2], header[3]
    results.append({
        "name": name,
        "rarity": rarity,
        "file_off": file_off,
        "va": va,
        "ptr_pos": ptr_pos,
        "header": header.hex(),
        "h0": h0, "h1": h1, "h2": h2, "h3": h3,
        "length": length,
    })

print(f"\nEntradas com ponteiro encontrado: {len(results)}")
print("\n=== Mapeamento completo ===")
print(f"{'h0':>3} {'h1':>4} {'h2':>3} {'h3':>3} | {'Item':<40} {'Rarity'}")
print("-" * 80)
for r in sorted(results, key=lambda x: (x['h3'], x['h1'], x['h0'])):
    print(f"{r['h0']:3} {r['h1']:4} {r['h2']:3} {r['h3']:3} | {r['name']:<40} {r['rarity']}")

# Análise: ver se h1 é o j-index para itens de mesma categoria (h3)
print("\n=== Por categoria (h3) ===")
by_h3 = {}
for r in results:
    by_h3.setdefault(r['h3'], []).append(r)

for cat, items in sorted(by_h3.items()):
    print(f"\nCategoria h3={cat}:")
    for r in sorted(items, key=lambda x: x['h1']):
        print(f"  j={r['h1']:3}, h0={r['h0']}: {r['name']} ({r['rarity']})")
