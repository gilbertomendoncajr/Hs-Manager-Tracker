import re

DATA_WIN = r"C:\Program Files (x86)\Steam\steamapps\common\HeroSiege\bin\data.win"
with open(DATA_WIN, "rb") as f:
    data = f.read()

print(f"data.win: {len(data):,} bytes")

targets = [
    (b"Absolute Zero", "utf8 normal"),
    ("Lilith\u2019s Scorn".encode("utf-8"), "U+2019 apostrophe"),
    ("Lilith".encode("utf-8") + bytes([0xc2, 0xb4]) + b"s Scorn", "U+00B4 acute"),
    (b"Lilith's Scorn", "latin-1 apostrophe"),
    (b"Air Melon", "Air Melon"),
    (b"Storm Fury", "Storm Fury"),
]

for target, label in targets:
    pos = data.find(target)
    print(f"[{label}] {target[:30]!r}: pos={pos} ({pos:#x})")
    if pos != -1:
        ctx = data[max(0, pos-8):pos+len(target)+8]
        print(f"  ctx: {' '.join(f'{b:02x}' for b in ctx)}")
        printable = re.sub(b"[^\x20-\x7e]", b".", ctx)
        print(f"  txt: {printable.decode('ascii', errors='replace')}")

# Procurar qualquer string de 6+ chars que comece maiúscula no data.win
# para entender como os nomes de itens são armazenados
print("\n=== Buscando padrão de strings GML no STRG ===")
# O STRG tem: count(i32) + offsets[count](i32 each, abs file offset)
# cada string: length(i32) + bytes + 0x00
strg_pos = data.find(b"STRG")
strg_data_start = strg_pos + 8
count = int.from_bytes(data[strg_data_start:strg_data_start+4], "little")
print(f"STRG @ {strg_pos:#x}, count={count}")

# Ler primeiras 50 strings
print("Primeiras 50 strings:")
for i in range(50):
    off = int.from_bytes(data[strg_data_start+4+i*4:strg_data_start+4+i*4+4], "little")
    length = int.from_bytes(data[off:off+4], "little")
    if length > 200: continue
    s = data[off+4:off+4+length].decode("utf-8", errors="replace")
    print(f"  [{i}] '{s}'")

# Procurar strings próximas ao índice 1629 (Rare) e ver o que está ao redor
print("\nStrings 1620-1645 (próximas de raridades):")
for i in range(1620, 1646):
    off = int.from_bytes(data[strg_data_start+4+i*4:strg_data_start+4+i*4+4], "little")
    length = int.from_bytes(data[off:off+4], "little")
    if length > 500:
        print(f"  [{i}] (muito longa, len={length})")
        continue
    s = data[off+4:off+4+length].decode("utf-8", errors="replace")
    print(f"  [{i}] '{s}'")
