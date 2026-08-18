import json
import time
import sys
import os
import socket
from datetime import timedelta
from threading import Thread

# Preserva gli import e i percorsi nativi di ReentryUDP sul tuo PC Windows
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ReentryUDP.DomainModels import *
from dataclasses import asdict

DEFAULT_MISSION_FILE = r"C:/Users/Nicolò/AppData/LocalLow/Wilhelmsen Studios/ReEntry/Export/Apollo/missionTiming.json"
DEFAULT_AGC_FILE     = r"C:/Users/Nicolò/AppData/LocalLow/Wilhelmsen Studios/ReEntry/Export/Apollo/outputAGC.json"
DEFAULT_LGC_FILE     = r"C:/Users/Nicolò/AppData/LocalLow/Wilhelmsen Studios/ReEntry/Export/Apollo/outputLGC.json"

PORTA_IN_TELEFONO = 8052
PORTA_OUT_REENTRY = 8051

# Socket di invio a Reentry
sock_reentry = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
dest_reentry = ('localhost', PORTA_OUT_REENTRY)

KEY_MAPPING = {
    'VERB': CommandModuleButtonID.AGCVerb, 'NOUN': CommandModuleButtonID.AGCNoun,
    'CLR': CommandModuleButtonID.AGCClear, 'PRO': CommandModuleButtonID.AGCPro,
    'KEY REL': CommandModuleButtonID.AGCKeyRel, 'ENTR': CommandModuleButtonID.AGCEntr,
    'RSET': CommandModuleButtonID.AGCRset, '0': CommandModuleButtonID.AGC0,
    '1': CommandModuleButtonID.AGC1, '2': CommandModuleButtonID.AGC2,
    '3': CommandModuleButtonID.AGC3, '4': CommandModuleButtonID.AGC4,
    '5': CommandModuleButtonID.AGC5, '6': CommandModuleButtonID.AGC6,
    '7': CommandModuleButtonID.AGC7, '8': CommandModuleButtonID.AGC8,
    '9': CommandModuleButtonID.AGC9, '+': CommandModuleButtonID.AGCPluss,
    '-': CommandModuleButtonID.AGCMinus
}

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def hhhmmss(seconds):
    seconds = int(seconds)
    td = timedelta(seconds=abs(seconds))
    h = td.days * 24 + td.seconds // 3600
    m = (td.seconds % 3600) // 60
    s = td.seconds % 60
    sign = "-" if seconds < 0 else "+"
    return f"{sign}{h:03}:{m:02}:{s:02}"

def ricevi_comandi_apk():
    """ Riceve i comandi dall'APK e compila i DataPacket usando ReentryUDP """
    sock_apk = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_apk.bind(('0.0.0.0', PORTA_IN_TELEFONO))
    print(f"[PC SERVER] In ascolto dei comandi dall'APK sulla porta {PORTA_IN_TELEFONO}...")

    while True:
        try:
            data, addr = sock_apk.recvfrom(1024)
            key_name = data.decode('utf-8')
            if key_name in KEY_MAPPING:
                button_enum_id = KEY_MAPPING[key_name]
                
                # CREAZIONE PACCHETTO IDENTICA AL TUO CODICE DI BASE
                packet_agc = DataPacket(Craft.CommandModule, MessageType.PushButton, button_enum_id, 0)
                packet_json = json.dumps(asdict(packet_agc))
                
                sock_reentry.sendto(packet_json.encode('utf-8'), dest_reentry)
                print(f"[PC SERVER] Inoltrato a Reentry: {key_name} -> {packet_json}")
                time.sleep(0.1)
        except Exception as e:
            print(f"Errore ricezione comando: {e}")

def invia_telemetria_apk():
    """ Invia i dati estratti dai JSON verso il telefono in broadcast """
    sock_out = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock_out.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    dest_broadcast = ('255.255.255.255', 8053)
    print("[PC SERVER] Ciclo trasmissione telemetria all'APK avviato.")

    while True:
        mission = read_json(DEFAULT_MISSION_FILE)
        agc = read_json(DEFAULT_AGC_FILE)
        lgc = read_json(DEFAULT_LGC_FILE)
        
        met_str = "MET +000:00:00"
        if mission:
            met_str = f"MET {hhhmmss(mission.get('METTotalSeconds', 0))}"

        payload = {
            "met": met_str,
            "agc": agc,
            "lgc": lgc
        }
        try:
            sock_out.sendto(json.dumps(payload).encode('utf-8'), dest_broadcast)
        except:
            pass
        time.sleep(0.5)

if __name__ == "__main__":
    Thread(target=ricevi_comandi_apk, daemon=True).start()
    invia_telemetria_apk()