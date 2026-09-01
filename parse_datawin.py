"""
Parseia data.win do GameMaker Studio para encontrar o mapeamento
de item ID (j) -> nome do item.

O formato data.win tem chunks: FORM, STRG (strings), OBJT (objects), etc.
As strings são indexadas e os objetos as referenciam.
"""
import struct, sys, re

DATA_WIN = r"C:\Program Files (x86)\Steam\steamapps\common\HeroSiege\bin\data.win"

print("Carregando data.win...")
with open(DATA_WIN, "rb") as f:
    data = f.read()
print(f"Carregado: {len(data):,} bytes")

def read_chunk_info(data, offset):
    """Lê header de chunk GML: 4 bytes nome + 4 bytes tamanho."""
    name = data[offset:offset+4].decode('ascii', errors='replace')
    size = struct.unpack_from('<I', data, offset+4)[0]
    return name, size, offset+8

# Navegar pelos chunks do FORM
if data[:4] != b'FORM':
    print("ERRO: Não é um data.win válido (sem FORM header)")
    sys.exit(1)

form_size = struct.unpack_from('<I', data, 4)[0]
print(f"FORM size: {form_size:,}")

# Encontrar chunk STRG (string table)
print("\n=== Procurando chunks ===")
pos = 8
chunks = {}
while pos < len(data) - 8:
    try:
        name = data[pos:pos+4].decode('ascii', errors='replace')
        size = struct.unpack_from('<I', data, pos+4)[0]
        if name.isprintable() and name.strip() and size > 0 and size < len(data):
            if name not in chunks:
                chunks[name] = pos
                print(f"  {name} @ {pos:#010x}, size={size:,}")
        pos += 8 + size
        # Alinhar em 4 bytes
        if pos % 4 != 0:
            pos += 4 - (pos % 4)
    except Exception:
        pos += 4

# Processar chunk STRG
if 'STRG' not in chunks:
    print("ERRO: Chunk STRG não encontrado")
    # Tentar busca direta
    pos = data.find(b'STRG')
    if pos != -1:
        chunks['STRG'] = pos
        print(f"STRG encontrado via busca @ {pos:#x}")
    else:
        sys.exit(1)

strg_pos = chunks['STRG']
strg_size = struct.unpack_from('<I', data, strg_pos+4)[0]
strg_data = data[strg_pos+8:strg_pos+8+strg_size]

print(f"\nSTRG @ {strg_pos:#x}, size={strg_size:,}")

# Formato STRG: count (i32) + array de offsets (i32) + strings (pascal ou null-term)
count = struct.unpack_from('<I', strg_data, 0)[0]
print(f"Número de strings: {count:,}")

# Ler offsets
offsets = []
for i in range(min(count, 50000)):
    off = struct.unpack_from('<I', strg_data, 4 + i*4)[0]
    offsets.append(off)

# Ler strings (4 bytes length + data + null terminator)
strings = []
for i, off in enumerate(offsets):
    if off >= len(strg_data) - 4:
        break
    length = struct.unpack_from('<I', strg_data, off)[0]
    if length > 10000 or off + 4 + length > len(strg_data):
        continue
    s = strg_data[off+4:off+4+length].decode('utf-8', errors='replace')
    strings.append((i, off, s))

print(f"Strings lidas: {len(strings)}")

# Procurar item names conhecidos para achar seus índices
KNOWN_ITEMS = [
    "Absolute Zero", "Annihilator", "Stormslayer", "Glock 22",
    "Peg Leg", "Soul Collector", "Lilith's Scorn", "Air Melon",
    "Water Melon", "Fire Melon", "Earth Melon", "Reverse Card",
    "Storm Fury", "The Dawn Bringer", "Lucifer's Crown", "Moonshard",
    "Daisy", "Diablo", "Tombstone",
    # From runs.json
    "Eden's Harvester", "Grimbone's Marchers", "Tarethiel's Ancient Wisdom",
    "Rugal's Sash of Undertaking", "Arcanum Asphyxiators", "Glacier Talons",
    "Serpent's Embrace", "Plague Bringer's Touch",
]

print("\n=== Índices de itens conhecidos na tabela de strings ===")
found = {}
for idx, off, s in strings:
    for name in KNOWN_ITEMS:
        if s == name:
            print(f"  [{idx:5d}] '{s}'")
            found[name] = idx
            break

print(f"\nEncontrados: {len(found)}/{len(KNOWN_ITEMS)}")

# Verificar se os índices têm alguma relação com os valores j observados
# j values visto: 0, 3, 4, 5, 7, 8, 16
print("\nÍndices encontrados vs j values observados (0,3,4,5,7,8,16):")
for name, idx in sorted(found.items(), key=lambda x: x[1]):
    print(f"  string_idx={idx} → {name}")
