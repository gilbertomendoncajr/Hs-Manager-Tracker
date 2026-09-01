"""
Procura estruturas de dados de itens no hs-tracker.exe.
Tenta extrair o mapeamento j->nome.
"""
import re, zipfile, io, os

EXE = r"C:\Users\Soutc\AppData\Local\HS Tracker\hs-tracker.exe"

with open(EXE, "rb") as f:
    data = f.read()

print(f"Binário: {len(data):,} bytes")

# 1) Procurar arquivo ZIP embutido (Tauri empacota assets como zip)
print("\n=== Buscando ZIPs embutidos ===")
pk_offsets = []
idx = 0
while True:
    pos = data.find(b'PK\x03\x04', idx)
    if pos == -1:
        break
    pk_offsets.append(pos)
    idx = pos + 1

print(f"Encontrados {len(pk_offsets)} cabeçalhos ZIP em: {pk_offsets[:10]}")

for offset in pk_offsets[:5]:
    try:
        buf = io.BytesIO(data[offset:])
        zf = zipfile.ZipFile(buf)
        names = zf.namelist()
        print(f"  ZIP @ {offset:#x}: {len(names)} arquivos → {names[:10]}")
        # Procurar arquivos JS/HTML dentro
        for name in names:
            if name.endswith(('.js', '.html', '.json')):
                content = zf.read(name).decode('utf-8', errors='replace')
                # Procurar padrão de item DB
                if 'itemData' in content or 'angelic' in content.lower() or 'unholy' in content.lower():
                    print(f"    ** CANDIDATO: {name} ({len(content)} chars)")
                    print(f"    Início: {content[:300]}")
        zf.close()
    except Exception as e:
        pass  # Não é um ZIP válido neste offset

# 2) Procurar padrões JavaScript de arrays/objetos de itens
print("\n=== Buscando padrões JS de item DB ===")
patterns = [
    rb'"j"\s*:\s*\d+',
    rb'itemId\s*[:=]\s*\d+',
    rb'item_id\s*[:=]\s*\d+',
    rb'"Absolute Zero"',
    rb'Absolute Zero',
]
for pat in patterns:
    matches = list(re.finditer(pat, data))
    print(f"Pattern {pat!r}: {len(matches)} ocorrências")
    for m in matches[:3]:
        ctx = data[max(0,m.start()-40):m.end()+80]
        printable = re.sub(b'[^\x20-\x7e]', b'.', ctx)
        print(f"  @ {m.start():#x}: {printable.decode('ascii', errors='replace')}")

# 3) Procurar JSON arrays com item names
print("\n=== Buscando JSON arrays com nomes de itens ===")
# Procurar por padrão: [...,"Absolute Zero",...]
# ou {name:"Absolute Zero",...}
json_patterns = [
    rb'"name"\s*:\s*"[A-Z][a-z]',
    rb'"items"\s*:\s*\[',
    rb'"angelic"\s*:\s*\[',
    rb'"Angelic"\s*:\s*\[',
]
for pat in json_patterns:
    matches = list(re.finditer(pat, data))
    if matches:
        print(f"Pattern {pat!r}: {len(matches)} ocorrências")
        for m in matches[:2]:
            ctx = data[m.start():m.start()+500]
            printable = re.sub(b'[^\x20-\x7e\x09\x0a\x0d]', b'.', ctx)
            print(f"  @ {m.start():#x}: {printable[:300].decode('ascii', errors='replace')}")

# 4) Procurar strings longas legíveis (possível JSON embutido)
print("\n=== Strings ASCII longas (>200 chars) ===")
long_strings = re.findall(rb'[\x20-\x7e]{200,}', data)
item_related = [s for s in long_strings if b'Absolute' in s or b'Unholy' in s or b'Angelic' in s]
print(f"Total strings longas: {len(long_strings)}, relacionadas a itens: {len(item_related)}")
for s in item_related[:5]:
    print(f"  {s[:300].decode('ascii', errors='replace')}")
    print()
