"""
Escaneia a tabela completa de itens do hs-tracker.exe.
Procura TODAS as entradas de 24 bytes na seção .rdata.
"""
import struct, re

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"

with open(EXE, "rb") as f:
    data = f.read()

IMAGE_BASE = 0x140000000
RDATA_VA   = 0x5a2000
RDATA_RAW  = 0x5a1200
RDATA_SIZE = 0x38d800

def va_to_file(va):
    return va - IMAGE_BASE - RDATA_VA + RDATA_RAW

def file_to_va(file_off):
    return IMAGE_BASE + file_off - RDATA_RAW + RDATA_VA

def read_string_at(file_off, max_len=200):
    if file_off < 0 or file_off + 4 >= len(data):
        return None
    length = struct.unpack_from('<Q', data, file_off - 8)[0] if file_off >= 8 else 0
    # Tentar ler como string direta
    try:
        s = data[file_off:file_off+max_len].split(b'\x00')[0].decode('utf-8')
        if s and s.isprintable() and len(s) > 1:
            return s[:max_len]
    except:
        pass
    return None

# Encontrar a tabela escaneando por entradas válidas
# Formato: [h0:1][h1:1][h2:1][h3:1][pad:4][ptr:8][len:8] = 24 bytes
# ptr deve apontar para um string válido em .rdata
# len deve corresponder ao comprimento da string

print("Escaneando tabela de itens...")

# Sabemos que a tabela contém entradas para os Melons em ~0x792800
# e para Aurelion Fury em ~0x78fd00
# Vamos achar o INÍCIO da tabela escaneando para trás a partir de 0x78fd00

known_entries = {}  # ptr_pos -> (h0, h1, h2, h3, string)

# Para cada item que conhecemos, o ptr_pos foi encontrado anteriormente
# Vamos reconstruir a tabela ao redor desses pontos

# Pontos de âncora conhecidos:
# Aurelion Fury (file_off=0x789a3c, len=13) → ptr at 0x78fd30
# Air Melon (file_off=0x78b96d, len=9) → ptr at 0x792830

anchor = 0x78fd30  # ptr position for Aurelion Fury (len=13 entry)

# Escanear a partir de um ponto anterior à âncora
# Cada entrada é 24 bytes, então a âncora está em entry_start + 8
# entry_start = anchor - 8 = 0x78fd28

# Determinar o início da tabela escaneando para trás
print("Buscando início da tabela...")

start = anchor - 8  # start of Aurelion Fury entry
# Ir para trás até encontrar uma entrada inválida

def is_valid_entry(pos):
    """Verifica se pos é o início de uma entrada válida de 24 bytes."""
    if pos + 24 > len(data):
        return False
    ptr = struct.unpack_from('<Q', data, pos + 8)[0]
    length = struct.unpack_from('<Q', data, pos + 16)[0]
    if length == 0 or length > 200:
        return False
    if ptr < IMAGE_BASE or ptr > IMAGE_BASE + 0x980000:
        return False
    file_off = va_to_file(ptr)
    if file_off < 0 or file_off + length > len(data):
        return False
    try:
        s = data[file_off:file_off+length].decode('utf-8')
        if not all(c.isprintable() or c == ' ' for c in s):
            return False
        return len(s) > 1
    except:
        return False

# Escanear para trás
table_start = start
while table_start >= 24:
    prev = table_start - 24
    if is_valid_entry(prev):
        table_start = prev
    else:
        break

print(f"Tabela começa em: {table_start:#x}")

# Escanear para frente da tabela
all_items = []
pos = table_start
while pos + 24 <= len(data):
    if not is_valid_entry(pos):
        # Tentar próxima entrada antes de desistir
        # (pode ter gaps)
        if not is_valid_entry(pos + 24):
            break
        pos += 24
        continue

    h0, h1, h2, h3 = data[pos], data[pos+1], data[pos+2], data[pos+3]
    ptr = struct.unpack_from('<Q', data, pos + 8)[0]
    length = struct.unpack_from('<Q', data, pos + 16)[0]
    file_off = va_to_file(ptr)

    try:
        name = data[file_off:file_off+length].decode('utf-8')
        if all(c.isprintable() or c == ' ' for c in name):
            all_items.append({
                'pos': pos, 'h0': h0, 'h1': h1, 'h2': h2, 'h3': h3,
                'ptr': ptr, 'length': length, 'name': name
            })
    except:
        pass

    pos += 24

print(f"Total de itens encontrados: {len(all_items)}")
print()

# Mostrar todos os itens organizados por (h3, h1) para ver o padrão
# Também mostrar as primeiras 200 entradas em ordem de posição na tabela
print("Primeiras 100 entradas (em ordem de posição na tabela):")
for i, item in enumerate(all_items[:100]):
    marker = ""
    rare_names = ["Storm Fury", "Glock 22", "Glacier Talons", "Stormslayer", "Absolute Zero",
                  "Lilith's Scorn", "Goburin's Head", "Soul Collector", "Air Melon"]
    if item['name'] in rare_names:
        marker = " ← RARO"
    print(f"  [{i:3d}] ({item['h3']:2},{item['h0']:2},{item['h1']:3}) {item['name']}{marker}")

# Mostrar quantidade por categoria h3
from collections import Counter
cat_counts = Counter(item['h3'] for item in all_items)
print(f"\nItens por categoria h3: {dict(sorted(cat_counts.items()))}")

# Índice de todos os items raros conhecidos na tabela
print("\n=== Posições dos itens raros na tabela ===")
RARE = {
    "Storm Fury", "Glock 22", "Glacier Talons", "Stormslayer", "Absolute Zero",
    "Lilith's Scorn", "Goburin's Head", "Soul Collector", "Air Melon",
    "Lucifer's Crown", "The Dawn Bringer", "Peg Leg", "Overloaded Dice",
    "Soul Collector", "Annihilator",
}
for i, item in enumerate(all_items):
    if item['name'] in RARE:
        print(f"  table_idx={i:3d}: ({item['h3']:2},{item['h0']:2},{item['h1']:3}) {item['name']}")

# Salvar o resultado completo
import json
out = {f"({i['h3']},{i['h0']},{i['h1']})": i['name'] for i in all_items}
with open("item_table_full.json", "w") as f:
    json.dump(out, f, indent=2)
print("\nTabela completa salva em item_table_full.json")

# Também exportar mapeamento para sniffer
# Mapear por (d, j) onde d=h3 e j=h1 (com h0 para desambiguar)
# Já que d=23 vimos nos pacotes, provavelmente d≠h3
# Mas tentemos com d=h3 e ver se j=0..16 aparecem
print("\n=== j=0..16 em h3=3 (hipótese d=23=h3=3) ===")
for item in all_items:
    if item['h3'] == 3 and item['h1'] <= 16:
        print(f"  j={item['h1']:3}, h0={item['h0']:2}: {item['name']}")
