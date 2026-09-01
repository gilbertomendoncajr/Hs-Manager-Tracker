"""
Extrai ZIPs embutidos do hs-tracker.exe (Tauri bundle).
"""
import zipfile, io, os, re

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"
OUT = r"C:\Users\Soutc\hs-drop-logger\hs-tracker-assets"

with open(EXE, "rb") as f:
    data = f.read()

os.makedirs(OUT, exist_ok=True)

pk_offsets = []
idx = 0
while True:
    pos = data.find(b'PK\x03\x04', idx)
    if pos == -1:
        break
    pk_offsets.append(pos)
    idx = pos + 1

print(f"ZIPs candidatos: {pk_offsets}")

for offset in pk_offsets:
    try:
        buf = io.BytesIO(data[offset:])
        zf = zipfile.ZipFile(buf)
        names = zf.namelist()
        print(f"\nZIP @ {offset:#x}: {len(names)} arquivos")
        for name in names:
            print(f"  {name}")
            # Extrair todos os arquivos
            dest = os.path.join(OUT, f"zip_{offset:08x}", name.replace('/', os.sep))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            try:
                with open(dest, 'wb') as out_f:
                    out_f.write(zf.read(name))
            except Exception as ex:
                print(f"    Erro ao extrair {name}: {ex}")
        zf.close()
        print(f"  → Extraído em {OUT}/zip_{offset:08x}/")
    except Exception as e:
        print(f"  @ {offset:#x}: não é ZIP válido ({e})")

# Busca adicional: procurar strings JSON longas com item IDs
# Formato: [[0,"Item Name"],[1,"Item Name2"],...]  ou similar
print("\n=== Buscando arrays numérico+string ===")
patterns = [
    rb'\[\s*\d+\s*,\s*"[A-Z]',
    rb'\{\s*"id"\s*:\s*\d+\s*,\s*"name"',
    rb'\d+\s*:\s*"[A-Z][a-z]',
]
for pat in patterns:
    m = re.search(pat, data)
    if m:
        ctx = data[m.start():m.start()+500]
        print(f"Pattern {pat!r} @ {m.start():#x}:")
        print(re.sub(b'[^\x20-\x7e]', b'.', ctx).decode('ascii', errors='replace'))
    else:
        print(f"Pattern {pat!r}: não encontrado")

# Procurar o padrão de strings concatenadas e seus offsets
# Para entender a indexação
print("\n=== Verificando contexto ao redor de 'Absolute Zero' ===")
pos = data.find(b'Absolute Zero')
if pos != -1:
    before = data[max(0, pos-200):pos]
    after = data[pos:pos+500]
    # Mostrar como hex + ascii
    def hexdump(b, offset=0):
        for i in range(0, len(b), 16):
            chunk = b[i:i+16]
            hex_part = ' '.join(f'{c:02x}' for c in chunk)
            asc_part = ''.join(chr(c) if 32 <= c < 127 else '.' for c in chunk)
            print(f"  {offset+i:08x}: {hex_part:<48}  {asc_part}")
    print("Bytes ANTES de 'Absolute Zero':")
    hexdump(before[-64:], pos-64)
    print("Bytes na posição e DEPOIS:")
    hexdump(after[:128], pos)
