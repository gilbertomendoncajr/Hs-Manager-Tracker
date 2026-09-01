"""
Captura pacotes dos servidores do Hero Siege e salva payload legivel.
Rodar como administrador: python capture.py
"""
import re
import json
import datetime
from scapy.all import sniff, IP, TCP, UDP, Raw

# IPs dos servidores Hero Siege (observados no HS Tracker)
HS_NETS = [
    "104.18.", "139.177.", "172.105.", "194.195.", "195.197.",
    "172.232.", "172.104.", "172.233.", "172.235.", "172.238.",
    "143.42.", "192.53.", "198.58.", "45.79.",
]

output_file = "capture_output.txt"
packet_count = 0

def is_hs_ip(ip):
    return any(ip.startswith(net) for net in HS_NETS)

def extract_readable(data: bytes) -> str:
    """Extrai strings ASCII legíveis com 4+ caracteres do payload."""
    strings = re.findall(rb'[ -~]{4,}', data)
    return [s.decode('ascii', errors='ignore') for s in strings]

def handle_packet(pkt):
    global packet_count
    if not pkt.haslayer(IP):
        return

    src = pkt[IP].src
    dst = pkt[IP].dst

    if not (is_hs_ip(src) or is_hs_ip(dst)):
        return

    if not pkt.haslayer(Raw):
        return

    payload = bytes(pkt[Raw])
    if len(payload) < 8:
        return

    readable = extract_readable(payload)
    if not readable:
        return

    proto = "TCP" if pkt.haslayer(TCP) else "UDP"
    sport = pkt[TCP].sport if pkt.haslayer(TCP) else pkt[UDP].sport if pkt.haslayer(UDP) else 0
    dport = pkt[TCP].dport if pkt.haslayer(TCP) else pkt[UDP].dport if pkt.haslayer(UDP) else 0

    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    line = f"[{ts}] {proto} {src}:{sport} -> {dst}:{dport} | {' | '.join(readable)}"

    print(line)
    with open(output_file, "a", encoding="utf-8") as f:
        f.write(line + "\n")

    packet_count += 1

print("=" * 60)
print("HS Drop Logger — Captura de pacotes")
print("Aguardando tráfego dos servidores do Hero Siege...")
print(f"Saída gravada em: {output_file}")
print("Ctrl+C para parar")
print("=" * 60)

sniff(filter="tcp or udp", prn=handle_packet, store=False)
