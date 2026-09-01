import struct

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"
with open(EXE, "rb") as f:
    data = f.read()

IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200

def file_to_va(file_off):
    return IMAGE_BASE + file_off + (RDATA_VA - RDATA_RAW)

SEARCH_ITEMS = [
    ("Ice King's Crown", "Satanic"),
    ("Judge, Jury & Executioner", "Satanic"),
    ("Sand Manipulator's Authority", "Satanic"),
    ("Rugal's Sash of Undertaking", "Satanic"),
    ("St. Aaron's Eternal Rage", "Angelic"),
    ("Lilith's Scorn", "Unholy"),
    ("St. Hallgar's Bloodforged Aegis", "Angelic"),
    ("St. Jupe's Plate of Command", "Angelic"),
    ("Tayrel's Chestplate", "Angelic"),
    ("Majorie's Belt", "Angelic"),
    ("Lucifer's Crown", "Angelic"),
    ("Goburin's Head", "Unholy"),
    ("Annihilator", "Unholy"),
    ("Grand Arch Wizard's Mantle", "Unholy"),
    ("Devil's Pact", "Unholy"),
    ("Serpent's Embrace", "Heroic"),
    ("Grimbone's Marchers", "Heroic"),
    ("Nikita's KJ-33 Helmet", "Heroic"),
    ("Plague Bringer's Touch", "Heroic"),
    ("Eden's Harvester", "Heroic"),
    ("Tarethiel's Ancient Wisdom", "Heroic"),
    ("Arcanist's Wrath", "Heroic"),
]

for name, rarity in SEARCH_ITEMS:
    str_bytes = name.encode("utf-8")
    pos = data.find(str_bytes)
    if pos == -1:
        print(f"NAO ENCONTRADO: {name}")
        continue
    va = file_to_va(pos)
    va_bytes = struct.pack("<Q", va)
    ptr_pos = data.find(va_bytes)
    if ptr_pos == -1:
        print(f"SEM PONTEIRO: {name}")
        continue
    length = struct.unpack_from("<Q", data, ptr_pos + 8)[0]
    if length == len(str_bytes) and ptr_pos >= 8:
        header = data[ptr_pos - 8 : ptr_pos]
        h0, h1, h2, h3 = header[0], header[1], header[2], header[3]
        print(f"({h3},{h1}) {rarity}: {name}  [h0={h0}]")
    else:
        print(f"LEN MISMATCH: {name} expected={len(str_bytes)} got={length}")
