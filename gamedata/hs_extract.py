"""Extrai item_key -> tier (e campos base) do Hero_Siege.exe (GameMaker YYC, x64).
Uso: python hs_extract.py [pasta_bin_do_jogo] [saida.json]
Depende de: numpy, capstone.  Nao usa Ghidra.  Roda em ~30 s.
"""
import struct, json, sys, os, collections
import numpy as np
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_MEM, X86_OP_IMM, X86_OP_REG, X86_REG_RIP, X86_REG_RSP, X86_REG_RBP

BIN = sys.argv[1] if len(sys.argv) > 1 else r"C:\Program Files (x86)\Steam\steamapps\common\HeroSiege\bin"
OUT = sys.argv[2] if len(sys.argv) > 2 else "items_tiers.json"
EXE = os.path.join(BIN, "Hero_Siege.exe"); CSV = os.path.join(BIN, "translationsItem.csv")
TIER_LETTER = {0: "D", 1: "C", 2: "B", 3: "A", 4: "S", 5: "SS", 6: "T6?"}

data = open(EXE, "rb").read()
pe = struct.unpack_from("<I", data, 0x3C)[0]; nsec = struct.unpack_from("<H", data, pe + 6)[0]; optsz = struct.unpack_from("<H", data, pe + 20)[0]
base = struct.unpack_from("<Q", data, pe + 24 + 24)[0]; secs = {}
for i in range(nsec):
    o = pe + 24 + optsz + 40 * i; name = data[o:o + 8].rstrip(b"\0").decode("latin1"); vs, va, rs, ro = struct.unpack_from("<IIII", data, o + 8)
    secs[name] = (base + va, vs, ro, rs)

def off(va):
    for n, (sva, vs, ro, rs) in secs.items():
        if sva <= va < sva + rs: return ro + (va - sva)

def q(va): return struct.unpack_from("<Q", data, off(va))[0]

def cstr(va, n=120):
    o = off(va)
    if o is None: return None
    e = data.find(b"\0", o, o + 400); return data[o:e].decode("latin1", errors="replace")[:n]

tb, _, toff, tsz = secs[".text"]; rb, _, rro, rrs = secs[".rdata"]; db, _, dro, drs = secs[".data"]
def in_text(v): return tb <= v < tb + tsz

# .pdata -> fim de cada funcao
pva, pvs, pro, prs = secs[".pdata"]; ent = np.frombuffer(data, dtype="<u4", count=(prs // 12) * 3, offset=pro).reshape(-1, 3); ent = ent[ent[:, 0] > 0]
fbeg = (ent[:, 0] + base).astype(np.int64); fend = (ent[:, 1] + base).astype(np.int64); o_ = np.argsort(fbeg); fbeg, fend = fbeg[o_], fend[o_]
def func_end(va):
    i = np.searchsorted(fbeg, va, side="right") - 1
    return int(fend[i]) if i >= 0 and fbeg[i] <= va < fend[i] else None

# 1) Constantes de string: tabela .CRT$XCU de inicializadores -> stubs (sub rsp,28; lea rdx,str; lea rcx,global; call YYCreateString; ...)
def find_init_table():
    qs = np.frombuffer(data, dtype="<u8", count=rrs // 8, offset=rro); ist = (qs >= tb) & (qs < tb + tsz)
    d = np.diff(np.concatenate(([0], ist.astype(np.int8), [0]))); starts = np.nonzero(d == 1)[0]; ends = np.nonzero(d == -1)[0]
    k = int(np.argmax(ends - starts)); return rb + 8 * int(starts[k]), rb + 8 * int(ends[k])

tlo, thi = find_init_table()
cnt = collections.Counter(); stubs = []
for a in range(tlo, thi, 8):
    f = q(a); o = off(f)
    if data[o:o + 4] != b"\x48\x83\xec\x28": continue
    p = o + 4; rdx = rcx = call = None
    for _ in range(3):
        if data[p:p + 3] == b"\x48\x8d\x15": rdx = f + (p - o) + 7 + struct.unpack_from("<i", data, p + 3)[0]; p += 7
        elif data[p:p + 3] == b"\x48\x8d\x0d": rcx = f + (p - o) + 7 + struct.unpack_from("<i", data, p + 3)[0]; p += 7
        elif data[p] == 0xE8: call = f + (p - o) + 5 + struct.unpack_from("<i", data, p + 1)[0]; break
        else: break
    if call and rdx and rcx: cnt[call] += 1; stubs.append((call, rcx, rdx))
(YYCREATESTRING, _), = cnt.most_common(1)
string_globals = {rcx: cstr(rdx) for call, rcx, rdx in stubs if call == YYCREATESTRING}

# 2) Tabela de scripts GML: entradas de 24 bytes {nome(.rdata "gml_..."), func(.text), extra(.data)}
def entry_ok(a):
    try: n, f, d = q(a), q(a + 8), q(a + 16)
    except Exception: return None
    if rb <= n < rb + rrs and in_text(f) and db <= d < db + drs:
        s = cstr(n, 200)
        if s and s.startswith("gml_"): return s, f

seed = None; sp = data.find(b"\0gml_Script_LoadSatanicDropTier\0")
while sp != -1 and seed is None:
    nameva = rb + (sp + 1 - rro); hit = data.find(struct.pack("<Q", nameva), dro, dro + drs)
    if hit != -1 and entry_ok(db + (hit - dro)): seed = db + (hit - dro)
    sp = data.find(b"\0gml_Script_LoadSatanicDropTier\0", sp + 1)
if seed is None: raise SystemExit("tabela de scripts GML nao encontrada")
lo = seed
while entry_ok(lo - 24): lo -= 24
hi = seed
while entry_ok(hi + 24): hi += 24
scripts = {}
for a in range(lo, hi + 24, 24):
    e = entry_ok(a)
    if e: scripts[e[0]] = e[1]

# 3) Helpers do runtime, reconhecidos estruturalmente numa funcao de referencia
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True
def disasm_func(name):
    fva = scripts[name]; fe = func_end(fva); o = off(fva); return list(md.disasm(data[o:o + (fe - fva)], fva))

REF = "gml_Script_DefineItemUniqueBoots"
ref_ins = disasm_func(REF)
getvar_c = collections.Counter(); set_c = collections.Counter(); ctor_c = collections.defaultdict(collections.Counter)
for i, x in enumerate(ref_ins):
    if x.mnemonic != "call" or x.operands[0].type != X86_OP_IMM: continue
    t = x.operands[0].imm; prev = [f"{y.mnemonic} {y.op_str}" for y in ref_ins[max(0, i - 4):i]]
    if any(m.startswith("mov edx, dword ptr [rip") for m in prev) and any(m.startswith("mov rcx, qword ptr [rsp") for m in prev): getvar_c[t] += 1
    if any(m.startswith("mov r9, ") for m in prev) and any(m.startswith("mov r8, ") for m in prev) and any(m.startswith("mov rdx, qword ptr [rsp") for m in prev): set_c[t] += 1
    p1, p2, p3 = ref_ins[i - 1], ref_ins[i - 2], ref_ins[i - 3]
    if p1.mnemonic == "lea" and p1.op_str.startswith("rcx, [rsp"):
        if p2.mnemonic == "mov" and p2.op_str.startswith("edx, ") and p2.operands[1].type == X86_OP_IMM:
            ctor_c[t]["int"] += 1
            if p3.mnemonic == "mov" and p3.op_str.startswith("r8b"): ctor_c[t]["ref"] += 1
        elif p2.mnemonic == "xor" and p2.op_str == "edx, edx": ctor_c[t]["int"] += 1
        elif p2.mnemonic == "lea" and p2.op_str.startswith("rdx, [rip"): ctor_c[t]["copy"] += 1
GETVAR = getvar_c.most_common(1)[0][0]; SETCALL = set_c.most_common(1)[0][0]
CTORS = {}
for t, c in ctor_c.items():
    if c["ref"] and c["ref"] >= c["int"] * 0.5: CTORS[t] = "ref"
    elif c["copy"] > c["int"]: CTORS[t] = "copy"
    elif c["int"]: CTORS[t] = "int"

# 4) Decodificacao linha a linha (cada linha GML grava o numero da linha num slot fixo do frame)
def find_line_slot(ins):
    c = collections.defaultdict(set)
    for x in ins:
        ops = x.operands
        if x.mnemonic == "mov" and len(ops) == 2 and ops[0].type == X86_OP_MEM and ops[0].size == 4 and ops[1].type == X86_OP_IMM and ops[0].mem.base in (X86_REG_RSP, X86_REG_RBP) and ops[0].mem.index == 0:
            c[(ops[0].mem.base, ops[0].mem.disp)].add(ops[1].imm)
    return max(c.items(), key=lambda kv: len(kv[1]))[0] if c else None

def decode(name):
    ins = disasm_func(name); slot = find_line_slot(ins); cur = None; regs = {}; out = []
    for x in ins:
        ops = x.operands
        if slot and x.mnemonic == "mov" and len(ops) == 2 and ops[0].type == X86_OP_MEM and (ops[0].mem.base, ops[0].mem.disp) == slot and ops[1].type == X86_OP_IMM and ops[0].size == 4:
            if cur: out.append(cur)
            cur = {"line": ops[1].imm, "var": None, "ctors": [], "sets": 0, "extra": []}; regs = {}; continue
        if cur is None: continue
        if x.mnemonic == "xor" and len(ops) == 2 and ops[0].type == X86_OP_REG and ops[1].type == X86_OP_REG and ops[0].reg == ops[1].reg:
            regs[x.reg_name(ops[0].reg)] = ("imm", 0); continue
        if x.mnemonic in ("mov", "lea") and len(ops) == 2 and ops[0].type == X86_OP_REG:
            r = x.reg_name(ops[0].reg)
            if ops[1].type == X86_OP_IMM: regs[r] = ("imm", ops[1].imm)
            elif ops[1].type == X86_OP_MEM and ops[1].mem.base == X86_REG_RIP: regs[r] = ("rip", x.address + x.size + ops[1].mem.disp)
            else: regs[r] = ("?", None)
        if x.mnemonic == "call" and ops[0].type == X86_OP_IMM:
            t = ops[0].imm
            if t == GETVAR:
                v = regs.get("edx"); cur["var"] = v[1] if v and v[0] == "rip" else None
            elif t in CTORS:
                k = CTORS[t]; a = regs.get("rdx" if k == "copy" else "edx"); arg = None
                if k == "int": arg = a[1] if a and a[0] == "imm" else None
                elif k == "ref": arg = ("sprite_ref", a[1]) if a and a[0] == "imm" else None
                elif k == "copy": arg = string_globals.get(a[1]) if a and a[0] == "rip" else None
                cur["ctors"].append((k, arg))
            elif t == SETCALL: cur["sets"] += 1
            else:
                a = regs.get("edx")
                if a and a[0] == "imm" and cur["var"] is not None: cur["extra"].append(a[1])
    if cur: out.append(cur)
    return out

DELIM_VAR = None
def items_of(name):
    global DELIM_VAR
    rows = decode(name)
    if DELIM_VAR is None:
        c = collections.Counter(r["var"] for r in rows if r["sets"] == 0 and r["var"] and r["extra"])
        DELIM_VAR = c.most_common(1)[0][0] if c else None
    items = []; seg = None; ordn = 0
    def close(seg, uid):
        nonlocal ordn
        if seg and 28 in seg["f"]: seg["ord"] = ordn; seg["uid"] = uid; ordn += 1; items.append(seg)
    for r in rows:
        if r["var"] == DELIM_VAR and r["sets"] == 0:
            ints = [a for k, a in r["ctors"] if k == "int" and isinstance(a, int)] + r["extra"]
            close(seg, ints[0] if ints else None); seg = None; continue
        ok = r["sets"] == 1 and len(r["ctors"]) == 2 and r["ctors"][1][0] == "int" and isinstance(r["ctors"][1][1], int)
        if ok:
            if seg is None: seg = {"line": r["line"], "f": {}}
            seg["f"][r["ctors"][1][1]] = r["ctors"][0][1]
    close(seg, None); return items

# 5) Nomes de exibicao do CSV (pipe; secoes [Nome])
names = {}; secn = {}; cursec = None
for line in open(CSV, encoding="utf-8-sig", errors="replace"):
    p = line.rstrip("\r\n").split("|")
    if not p or not p[0]: continue
    if p[0].startswith("["): cursec = p[0].strip("[]"); continue
    names[p[0].strip()] = p[1].strip(); secn[p[0].strip()] = cursec

result = {"source": os.path.abspath(EXE), "exe_size": len(data), "yycreatestring": hex(YYCREATESTRING), "getvar": hex(GETVAR), "setcall": hex(SETCALL),
          "scripts_found": len(scripts), "string_constants": len(string_globals), "tier_scale": TIER_LETTER, "items": []}
funcs = sorted(k for k in scripts if k.startswith("gml_Script_DefineItemUnique") or k.startswith("gml_Script_DefineItemNormal") or k == "gml_Script_DefineItemRunewords")
for fn in funcs:
    try: its = items_of(fn)
    except Exception as ex: print("skip", fn, ex); continue
    for it in its:
        f = it["f"]; key = f[28]; tier = f.get(32)
        result["items"].append({
            "item_key": key, "display_name": names.get(key), "csv_section": secn.get(key),
            "define_func": fn.replace("gml_Script_", ""), "ordinal_in_func": it["ord"],
            "tier": tier if isinstance(tier, int) else None, "tier_letter": TIER_LETTER.get(tier) if isinstance(tier, int) else None,
            "level": f.get(1), "rarity_code": f.get(27), "field2": f.get(2), "lore_key": f.get(29),
            "sprite_ref": (hex(f[11][1]) if isinstance(f.get(11), tuple) else None), "uid_candidate": it["uid"],
            "raw_fields": {str(k): (v if not isinstance(v, tuple) else list(v)) for k, v in sorted(f.items())},
        })
json.dump(result, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
c = collections.Counter(i["tier_letter"] for i in result["items"])
print(f"YYCreateString={YYCREATESTRING:x} GETVAR={GETVAR:x} SETCALL={SETCALL:x} CTORS={ {hex(k): v for k, v in CTORS.items()} } DELIM_VAR={hex(DELIM_VAR) if DELIM_VAR else None}")
print(f"scripts={len(scripts)} strings={len(string_globals)} items={len(result['items'])} tiers={dict(c)} -> {OUT}")
