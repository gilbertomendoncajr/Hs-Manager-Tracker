"""
Extrai nomes de itens e contexto binário do hs-tracker.exe.
Procura cada nome conhecido e mostra os bytes adjacentes.
"""
import struct, re, json

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"

KNOWN = [
    "Absolute Zero", "Annihilator", "Stormslayer", "Glock 22",
    "Peg Leg", "Soul Collector", "Lilith's Scorn", "Lilith's Wrath",
    "Forking Bolts", "Overloaded Dice", "Rotten Pumpkin",
    "Air Melon", "Water Melon", "Fire Melon", "Earth Melon",
    "Reverse Card", "Storm Fury", "The Dawn Bringer",
    "Lucifer's Crown", "Moonshard", "Daisy", "Diablo", "Tombstone",
    "Rugal's Sash of Undertaking", "Tarethiel's Ancient Wisdom",
    "Arcanum Asphyxiators", "Sand Manipulator's Authority",
    "Glacier Talons", "Serpent's Embrace",
]

with open(EXE, "rb") as f:
    data = f.read()

print(f"Binário carregado: {len(data):,} bytes\n")

results = []

for name in KNOWN:
    encoded = name.encode("utf-8")
    idx = 0
    while True:
        pos = data.find(encoded, idx)
        if pos == -1:
            break
        # Contexto: 20 bytes antes e 40 bytes depois
        before = data[max(0, pos-20):pos]
        after  = data[pos+len(encoded):pos+len(encoded)+40]

        # Bytes antes como hex (procurar possíveis IDs)
        hex_before = ' '.join(f'{b:02x}' for b in before[-8:])
        hex_after  = ' '.join(f'{b:02x}' for b in after[:8])

        # Tentar ler um int16 e int32 logo antes do nome
        i16 = struct.unpack_from('<H', data, pos-2)[0] if pos >= 2 else None
        i32 = struct.unpack_from('<I', data, pos-4)[0] if pos >= 4 else None

        results.append({
            "name": name,
            "pos": pos,
            "hex_before": hex_before,
            "hex_after": hex_after,
            "i16_before": i16,
            "i32_before": i32,
        })

        idx = pos + 1

for r in results:
    print(f"[{r['pos']:08x}] {r['name']}")
    print(f"  antes(8B): {r['hex_before']}")
    print(f"  depois(8B): {r['hex_after']}")
    print(f"  i16 antes: {r['i16_before']}  |  i32 antes: {r['i32_before']}")
    print()

# Verificar padrão: todos os i16 antes são o mesmo valor?
by_name = {}
for r in results:
    by_name.setdefault(r['name'], []).append(r)

print("\n=== Resumo por item ===")
for name, entries in by_name.items():
    ids = [e['i16_before'] for e in entries]
    print(f"{name}: i16={ids}")
