"""
Extrai o banco de dados de itens do hs-tracker.exe.
Estratégia: encontrar o bloco de strings e a tabela de ponteiros/offsets.
"""
import struct, re, os

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"

with open(EXE, "rb") as f:
    data = f.read()

print(f"Binário: {len(data):,} bytes")

# 1) Encontrar TODOS os itens conhecidos e suas posições
# Usar a lista completa do settings.json + runs.json
ALL_KNOWN = [
    # Angelic
    "Air Melon", "Earth Melon", "Fire Melon", "Water Melon",
    "Aurelion Fury", "Commander's Sentry Blaster", "Divine Crackpipe",
    "Fury of Tarethiel", "Liquor Holster", "Lucifer's Crown", "Majorie's Belt",
    "Mask of the Celestial", "Reverse Card", "St. Aaron's Eternal Rage",
    "St. Ahto's Diamond Hands", "St. Amitiel's Truth", "St. Draxis Longsaw",
    "St. Draxis' Pigstick", "St. Gabriel's Retribution", "St. Hallgar's Bloodforged Aegis",
    "St. HouDeanii's Tiny Fire Rod", "St. Jupe's Plate of Command", "St. Mika's Zweihander",
    "St. Neri's Rainbow Lance", "St. Nimo's Lightbringer", "St. Rexis Sundering Axe",
    "St. Soloyolo's Holy Bow", "St. Tomi's Vibrant Aura", "Storm Fury",
    "Supreme Elemelon", "Tayrel's Chestplate", "The Almighty Nugget", "The Dawn Bringer",
    # Unholy
    "Absolute Zero", "Annihilator", "Arcane Pumpkin", "Demonfire Accelerators",
    "DEVELOPRE BOOT", "Devil's Pact", "El Patron's Madness", "Forking Bolts",
    "Glock 22", "Goburin's Head", "Grand Arch Wizard's Mantle", "Lilith's Scorn",
    "Lilith's Wrath", "Marcher's of Hatred", "Overloaded Dice", "Peg Leg",
    "Rotten Pumpkin", "Soul Collector", "Stofflix Cooking Cleaver", "Stormslayer",
    # Heroic (from runs.json)
    "Nikita's KJ-33 Helmet", "Tarethiel's Ancient Wisdom", "Eden's Harvester",
    "Grimbone's Marchers", "Plague Bringer's Touch", "Arcanum Asphyxiators",
    "Glacier Talons", "Serpent's Embrace",
    # Satanic (some)
    "Tombstone", "Diablo", "Daisy", "Moonshard",
    "Sand Manipulator's Authority", "Rugal's Sash of Undertaking",
]

# Encontrar todas as ocorrências
found = {}
for name in ALL_KNOWN:
    pos = data.find(name.encode("utf-8"))
    if pos == -1:
        # Tentar com apostrofo especial
        for apos in [b"\xc2\xb4", b"\xe2\x80\x99", b"\xb4"]:
            alt = name.encode("utf-8").replace(b"'", apos)
            pos2 = data.find(alt)
            if pos2 != -1:
                pos = pos2
                break
    if pos != -1:
        found[name] = pos

print(f"\nItens encontrados: {len(found)}/{len(ALL_KNOWN)}")
if not found:
    print("NENHUM encontrado — verificar encoding")
else:
    print("\nPosições (ordenadas):")
    for name, pos in sorted(found.items(), key=lambda x: x[1]):
        print(f"  {pos:#010x}: {name}")

# 2) Verificar se há null bytes separando as strings no bloco
# Pegar o trecho do bloco de itens
if found:
    min_pos = min(found.values())
    max_pos = max(found.values())
    block = data[min_pos-200:max_pos+100]
    null_count = block.count(b"\x00")
    print(f"\nNull bytes no bloco ({min_pos-200:#x}-{max_pos+100:#x}): {null_count}")

    # Ver o que está antes do primeiro item
    pre = data[min_pos-50:min_pos]
    print(f"\nBytes antes do primeiro item (pos {min_pos:#x}):")
    print("  hex:", ' '.join(f'{b:02x}' for b in pre))
    printable = re.sub(b"[^\x20-\x7e]", b".", pre)
    print("  txt:", printable.decode("ascii", errors="replace"))

# 3) Procurar a tabela de ponteiros que aponta para os itens
# Em PE de 64 bits, ponteiros são 8 bytes
# Base image típica do Rust: 0x140000000
# Mas na seção relativa ao arquivo, seria offset relativo
# Tentando com RVA (Relative Virtual Address)

# Primeiro, precisamos do image base e do layout de seções
# Lendo PE header
if data[:2] == b'MZ':
    pe_offset = struct.unpack_from('<I', data, 0x3C)[0]
    sig = data[pe_offset:pe_offset+4]
    if sig == b'PE\x00\x00':
        machine = struct.unpack_from('<H', data, pe_offset+4)[0]
        num_sections = struct.unpack_from('<H', data, pe_offset+6)[0]
        opt_header_size = struct.unpack_from('<H', data, pe_offset+20)[0]
        opt_magic = struct.unpack_from('<H', data, pe_offset+24)[0]

        if opt_magic == 0x20B:  # PE32+
            image_base = struct.unpack_from('<Q', data, pe_offset+24+24)[0]
            print(f"\nPE32+ encontrado")
            print(f"Image base: {image_base:#x}")
            print(f"Número de seções: {num_sections}")

            # Ler seções
            sect_offset = pe_offset + 24 + opt_header_size
            sections = []
            for i in range(num_sections):
                off = sect_offset + i * 40
                name = data[off:off+8].rstrip(b'\x00').decode('ascii', errors='replace')
                virt_size = struct.unpack_from('<I', data, off+8)[0]
                virt_addr = struct.unpack_from('<I', data, off+12)[0]
                raw_size = struct.unpack_from('<I', data, off+16)[0]
                raw_offset = struct.unpack_from('<I', data, off+20)[0]
                sections.append((name, virt_addr, virt_size, raw_offset, raw_size))
                print(f"  Section {name}: VA={virt_addr:#x}, raw={raw_offset:#x}, size={raw_size:#x}")

            # Para cada item encontrado, calcular seu VA e procurar ponteiros
            if found and sections:
                print("\nProcurando ponteiros para itens:")
                # Encontrar qual seção contém os itens
                first_item_pos = min(found.values())
                item_section = None
                for sect in sections:
                    name, va, vsz, raw, rsz = sect
                    if raw <= first_item_pos < raw + rsz:
                        item_section = sect
                        break

                if item_section:
                    sect_name, sect_va, sect_vsz, sect_raw, sect_rsz = item_section
                    print(f"Itens estão em seção: {sect_name}, VA base={image_base + sect_va:#x}")

                    for iname, ipos in list(found.items())[:5]:
                        # Calcular VA do item
                        va = image_base + sect_va + (ipos - sect_raw)
                        va_bytes = struct.pack('<Q', va)

                        # Procurar este ponteiro no binário
                        ptr_pos = data.find(va_bytes)
                        if ptr_pos != -1:
                            print(f"  {iname}: VA={va:#x}, ptr encontrado em {ptr_pos:#x}")
                            # Ver contexto ao redor do ponteiro
                            ctx = data[ptr_pos-32:ptr_pos+32]
                            print(f"    hex: {' '.join(f'{b:02x}' for b in ctx)}")
                        else:
                            print(f"  {iname}: VA={va:#x}, ptr NÃO encontrado")
