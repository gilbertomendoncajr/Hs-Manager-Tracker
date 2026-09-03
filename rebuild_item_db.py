"""
Reconstrói sniffer_items.json a partir do items.rs do hs-tracker upstream.
Chave correta: (item_type, item_id, weapon_type) — igual ao hs-tracker.
Packed: (type << 24) | (id << 8) | wt
"""
import re, json

RS_FILE = "items_upstream.rs"
OUT_FILE = "sniffer_items.json"

with open(RS_FILE, encoding="utf-8") as f:
    content = f.read()

# ── 1. Parse ITEMS array ────────────────────────────────────────────────────
items_block_m = re.search(
    r'static ITEMS: \[.*?\] = \[(.*?)\];',
    content, re.DOTALL
)
if not items_block_m:
    raise RuntimeError("ITEMS array not found")

item_entries = re.findall(r'\((\d+),\s*"([^"]+)"\)', items_block_m.group(1))
print(f"ITEMS entries found: {len(item_entries)}")

# ── 2. Parse RARITY_BY_NAME array ──────────────────────────────────────────
rarity_block_m = re.search(
    r'static RARITY_BY_NAME: \[.*?\] = \[(.*?)\];',
    content, re.DOTALL
)
if not rarity_block_m:
    raise RuntimeError("RARITY_BY_NAME not found")

rarity_by_name = {}
for name_lower, rarity in re.findall(
    r'\("([^"]+)",\s*"([^"]+)"\)', rarity_block_m.group(1)
):
    rarity_by_name[name_lower] = rarity

print(f"RARITY_BY_NAME entries: {len(rarity_by_name)}")

# ── 3. Build new ITEM_DB ────────────────────────────────────────────────────
# Key: "type,id,wt"   Value: [name, rarity]
db = {}
missing_rarity = []

for packed_str, name in item_entries:
    packed = int(packed_str)
    item_type  = (packed >> 24) & 0xFF
    item_id    = (packed >>  8) & 0xFFFF
    weapon_type = packed & 0xFF

    rarity = rarity_by_name.get(name.lower(), "")
    if not rarity:
        missing_rarity.append(name)

    key = f"{item_type},{item_id},{weapon_type}"
    db[key] = [name, rarity]

print(f"DB entries: {len(db)}")
print(f"Items without rarity: {len(missing_rarity)}")
if missing_rarity:
    print("  Sample:", missing_rarity[:5])

# ── 4. Verify key uniqueness ────────────────────────────────────────────────
assert len(db) == len(item_entries), "Collision in packed keys!"
print("Key uniqueness: OK — all keys are unique")

# ── 5. Check Glacier Talons & Genji's Sword ──────────────────────────────
for name_check in ["Glacier Talons", "Genji's Sword of Fate"]:
    found = [(k, v) for k, v in db.items() if v[0] == name_check]
    print(f"  {name_check}: key={found[0][0] if found else 'NOT FOUND'}")

# ── 6. Save ─────────────────────────────────────────────────────────────────
with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(db, f, ensure_ascii=False, indent=None, separators=(',', ':'))

print(f"\nSalvo em {OUT_FILE}")
