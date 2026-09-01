import struct, re, json
from pathlib import Path

EXE = r'C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe'
with open(EXE, 'rb') as f:
    data = f.read()

IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200

def va_to_file(va):
    return va - IMAGE_BASE - (RDATA_VA - RDATA_RAW)
def file_to_va(file_off):
    return IMAGE_BASE + file_off + (RDATA_VA - RDATA_RAW)

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

# Carregar raridades do items.rs local
from urllib.request import urlopen
url = "https://raw.githubusercontent.com/Parazeya/hs-tracker/main/src-tauri/src/items.rs"
try:
    content = urlopen(url, timeout=10).read().decode("utf-8")
    print("items.rs baixado")
except Exception as e:
    local = Path(r"C:\Users\Soutc\AppData\Local\Temp\claude\items_rs.txt")
    if local.exists():
        content = local.read_text(encoding="utf-8")
        print("items.rs local")
    else:
        print(f"Erro: {e}")
        content = ""

pattern = re.compile(r'\("([^"]+)",\s*"([^"]+)"\)')
rarity_by_name = {}
target = {"Angelic", "Unholy", "Heroic", "Satanic"}
for nm, rar in pattern.findall(content):
    if rar in target:
        rarity_by_name[nm.lower()] = rar

# Extrair chests
chests = []
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
                    h1 = data[pos + 1]
                    h3 = data[pos + 3]
                    if h3 == 1:
                        rar = rarity_by_name.get(s.lower(), "other")
                        chests.append((h1, s, rar))
            except: pass
    pos += ENTRY_SIZE

chests.sort()
print(f"\nTotal chests no binario: {len(chests)}")
print("h1  rarity       name")
for h1, name, rar in chests[:30]:
    marker = " <---" if "thunder caller" in name.lower() or "heaven" in name.lower() else ""
    print(f"{h1:3}  {rar:10}  {name}{marker}")

rare = [(h1, n, r) for h1, n, r in chests if r != "other"]
print(f"\nRaros (Angelic/Unholy/Heroic/Satanic): {len(rare)}")
for h1, name, rar in rare[:20]:
    print(f"  h1={h1:3}  {rar:10}  {name}")
