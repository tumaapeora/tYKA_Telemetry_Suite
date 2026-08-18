"""
Apollo Flight Operations Workspace - Web Edition
Porting da customtkinter/PyQt a Flask, pensato per essere aperto da browser
(anche su Android) mantenendo intatta la logica di rete UDP originale.

Modalita':
  1) AGC & LGC MONITOR       - sola visualizzazione (MET + DSKY AGC + DSKY LGC)
  2) AGC DSKY INTERATTIVO    - display + tastierino verso il Command Module
  3) LGC DSKY INTERATTIVO    - display + tastierino verso il Lunar Module
  4) RENDEZ-VOUS AUTOMATICO  - macro switch (invariata)
  5) POST-DOCKING AUTOMATICO - macro switch (invariata)
"""
import json
import os
import socket
import threading
import time
from dataclasses import asdict
from datetime import timedelta

from flask import Flask, jsonify, render_template, request

from ReentryUDP.DomainModels import (
    Craft,
    CommandModuleButtonID,
    CommandModuleSwitchID,
    DataPacket,
    LunarModuleButtonID,
    MessageType,
    Position,
)
from ReentryUDP.SessionLogger import SessionLogger

app = Flask(__name__)

# ================== SESSION LOGGER (un file nuovo a ogni avvio server) ==================
# Requisito 2: persistenza/tracciamento di sessione. Il file viene creato qui,
# al caricamento del modulo (quindi a ogni avvio del processo server, sia con
# `python app.py` sia con `flask run`), con il timestamp nel nome.
session = SessionLogger(log_dir=os.environ.get("APOLLO_LOG_DIR", "logs"))

# ================== CONFIGURAZIONE (override via variabili d'ambiente) ==================
MISSION_FILE = os.environ.get(
    "APOLLO_MISSION_FILE",
    r"//DESKTOP-E4EV1D8/Apollo/missionTiming.json",
)
AGC_FILE = os.environ.get(
    "APOLLO_AGC_FILE",
    r"//DESKTOP-E4EV1D8/Apollo/outputAGC.json",
)
LGC_FILE = os.environ.get(
    "APOLLO_LGC_FILE",
    r"//DESKTOP-E4EV1D8/Apollo/outputLGC.json",
)
DEST_IP = os.environ.get("APOLLO_DEST_IP", "192.168.1.103")
DEST_PORT = int(os.environ.get("APOLLO_DEST_PORT", "8051"))
DESTINAZIONE = (DEST_IP, DEST_PORT)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

session.log("server_start", {
    "mission_file": MISSION_FILE,
    "agc_file": AGC_FILE,
    "lgc_file": LGC_FILE,
    "destinazione_udp": f"{DEST_IP}:{DEST_PORT}",
    "log_file": session.filename,
})

# ================== MAPPA TASTI ==================
AGC_KEY_DICT = {
    "VERB": CommandModuleButtonID.AGCVerb,
    "NOUN": CommandModuleButtonID.AGCNoun,
    "CLR": CommandModuleButtonID.AGCClear,
    "PRO": CommandModuleButtonID.AGCPro,
    "KEY REL": CommandModuleButtonID.AGCKeyRel,
    "ENTR": CommandModuleButtonID.AGCEntr,
    "RSET": CommandModuleButtonID.AGCRset,
    "0": CommandModuleButtonID.AGC0,
    "1": CommandModuleButtonID.AGC1,
    "2": CommandModuleButtonID.AGC2,
    "3": CommandModuleButtonID.AGC3,
    "4": CommandModuleButtonID.AGC4,
    "5": CommandModuleButtonID.AGC5,
    "6": CommandModuleButtonID.AGC6,
    "7": CommandModuleButtonID.AGC7,
    "8": CommandModuleButtonID.AGC8,
    "9": CommandModuleButtonID.AGC9,
    "+": CommandModuleButtonID.AGCPluss,
    "-": CommandModuleButtonID.AGCMinus,
}

LGC_KEY_DICT = {
    "VERB": LunarModuleButtonID.LGCVerb,
    "NOUN": LunarModuleButtonID.LGCNoun,
    "CLR": LunarModuleButtonID.LGCClr,
    "PRO": LunarModuleButtonID.LGCPro,
    "KEY REL": LunarModuleButtonID.LGCKeyRel,
    "ENTR": LunarModuleButtonID.LGCEntr,
    "RSET": LunarModuleButtonID.LGCRset,
    "0": LunarModuleButtonID.LGC0,
    "1": LunarModuleButtonID.LGC1,
    "2": LunarModuleButtonID.LGC2,
    "3": LunarModuleButtonID.LGC3,
    "4": LunarModuleButtonID.LGC4,
    "5": LunarModuleButtonID.LGC5,
    "6": LunarModuleButtonID.LGC6,
    "7": LunarModuleButtonID.LGC7,
    "8": LunarModuleButtonID.LGC8,
    "9": LunarModuleButtonID.LGC9,
    "+": LunarModuleButtonID.LGCPlus,
    "-": LunarModuleButtonID.LGCNeg,
}

# Craft e mappa tasti per ciascun "computer" pilotabile dal tastierino web
COMPUTERS = {
    "agc": {"craft": Craft.CommandModule, "keys": AGC_KEY_DICT},
    "lgc": {"craft": Craft.LunarModule, "keys": LGC_KEY_DICT},
}

RED_INDICATORS = {"OPR ERR", "RESTART", "TEMP"}
# Elenco indicatori DSKY (stesso schema chiave usato sia per AGC che per LGC:
# "Nome Label" -> campo "Illuminate" + Label senza spazi nel JSON esportato)
DSKY_INDICATORS = [
    "Comp Light", "Uplink Acty", "No Att", "Stby", "Key Rel", "Opr Err", "Temp",
    "Gimbal Lock", "Prog", "Restart", "Tracker", "Alt", "Vel",
]

# ================== STATO DEI LOG DELLE MACRO (in memoria) ==================
_state_lock = threading.Lock()
_macro_state = {
    "rndz": {"running": False, "log": ["[SYSTEM READY] - IN ATTESA DI ATTIVAZIONE"]},
    "sys2": {"running": False, "log": ["[SYSTEM READY] - IN ATTESA DI ATTIVAZIONE"]},
}


def _append_log(key, line):
    with _state_lock:
        _macro_state[key]["log"].append(line)
        _macro_state[key]["log"] = _macro_state[key]["log"][-8:]
    session.log("macro_step", {"macro": key, "line": line})


def _send_switch(switch_id, position):
    pkt = DataPacket(Craft.CommandModule, MessageType.SetSwitch, switch_id, position)
    payload = json.dumps(asdict(pkt)).encode()
    sock.sendto(payload, DESTINAZIONE)
    time.sleep(0.1)
    sock.sendto(payload, DESTINAZIONE)
    session.log("switch_sent", {"switch_id": switch_id, "position": position})


def _send_key(computer, key_name):
    """Invia una singola pressione tasto verso l'AGC o l'LGC (stessa logica
    di /api/keypress), riutilizzabile anche dalle macro automatiche."""
    cfg = COMPUTERS[computer]
    button_id = cfg["keys"][key_name]
    pkt = DataPacket(cfg["craft"], MessageType.PushButton, button_id, 0)
    sock.sendto(json.dumps(asdict(pkt)).encode(), DESTINAZIONE)
    session.log("keypress", {"computer": computer, "key": key_name})


# ================== UTILS ==================
def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def hhhmmss(seconds):
    seconds = int(seconds)
    td = timedelta(seconds=abs(seconds))
    h = td.days * 24 + td.seconds // 3600
    m = (td.seconds % 3600) // 60
    s = td.seconds % 60
    sign = "-" if seconds < 0 else "+"
    return f"{sign}{h:03}:{m:02}:{s:02}"


def build_dsky_payload(data):
    """Trasforma il JSON grezzo (AGC o LGC, stesso schema) nella struttura
    pronta per il display: prog/verb/noun, 3 registri, indicatori."""
    prog = (data.get("ProgramD1", "") + data.get("ProgramD2", "")) or "--"
    verb = (data.get("VerbD1", "") + data.get("VerbD2", "")) or "--"
    noun = (data.get("NounD1", "") + data.get("NounD2", "")) or "--"

    registers = []
    for i in range(3):
        sign = data.get(f"Register{i+1}Sign", " ")
        digits = "".join(data.get(f"Register{i+1}D{d}", " ") or " " for d in range(1, 6))
        registers.append(f"{sign}{digits}")

    indicators = {}
    for name in DSKY_INDICATORS:
        key = f"Illuminate{name.replace(' ', '')}"
        indicators[name] = bool(data.get(key, 0))

    return {
        "prog": prog,
        "verb": verb,
        "noun": noun,
        "registers": registers,
        "indicators": indicators,
    }


# ================== ROUTES ==================
@app.route("/")
def index():
    return render_template(
        "index.html",
        indicators=DSKY_INDICATORS,
        red_indicators=list(RED_INDICATORS),
        keys=list(AGC_KEY_DICT.keys()),
        dest_ip=DEST_IP,
        dest_port=DEST_PORT,
    )


def _build_telemetry_snapshot():
    mission = read_json(MISSION_FILE)
    agc = read_json(AGC_FILE)
    lgc = read_json(LGC_FILE)
    met_seconds = mission.get("METTotalSeconds", 0) if mission else 0
    return {
        "met": hhhmmss(met_seconds),
        "agc": build_dsky_payload(agc) if agc else None,
        "lgc": build_dsky_payload(lgc) if lgc else None,
    }


# ================== STATO GLOBALE CONDIVISO (Single Source of Truth) ==================
# Un unico thread legge periodicamente i file del simulatore e tiene in
# memoria l'ULTIMO snapshot valido, con un numero di sequenza (seq) che si
# incrementa solo quando qualcosa cambia davvero. Tutti i client leggono
# sempre lo stesso identico oggetto tramite /api/telemetry: non ci sono più
# letture concorrenti indipendenti dei file (che potrebbero, in teoria,
# osservare stati leggermente diversi se il simulatore scrive nel frattempo).
# Ogni cambiamento viene inoltre scritto in tempo reale sul file di sessione.
_telemetry_lock = threading.Lock()
_telemetry_cache = {"snapshot": _build_telemetry_snapshot(), "seq": 0}


def _telemetry_watcher(interval=0.5):
    while True:
        try:
            snap = _build_telemetry_snapshot()
            changed = False
            with _telemetry_lock:
                if snap != _telemetry_cache["snapshot"]:
                    _telemetry_cache["snapshot"] = snap
                    _telemetry_cache["seq"] += 1
                    changed = True
            if changed:
                session.log("telemetry", snap)
        except Exception as e:
            session.log("telemetry_error", {"error": str(e)})
        time.sleep(interval)


threading.Thread(target=_telemetry_watcher, daemon=True).start()


@app.route("/api/telemetry")
def api_telemetry():
    with _telemetry_lock:
        snap = _telemetry_cache["snapshot"]
        seq = _telemetry_cache["seq"]
    payload = dict(snap)
    payload["seq"] = seq
    return jsonify(payload)


# ================== EVENT LOG DI MISSIONE (autorità: il server) ==================
# I client rilevano localmente gli eventi (P12, PDI, cutoff motore, ecc.)
# analizzando la telemetria, ma non li tengono più solo per sé: li inviano
# qui col POST, e il server e' l'unico a decidere l'ordine/ID definitivo e a
# distribuirli con GET a tutti i client, cosi' ogni scheda del browser (e
# ogni dispositivo) mostra esattamente lo stesso registro eventi, anche se
# si connette a meta' sessione. Una "key" stabile (categoria+descrizione)
# evita che lo stesso evento, rilevato indipendentemente da piu' client,
# venga registrato più volte.
_event_lock = threading.Lock()
_event_state = {"events": [], "next_id": 1, "seen_keys": set()}
MAX_EVENTS = 500


def _add_event(category, description, details, key=None, met=None):
    with _event_lock:
        dedupe_key = key or f"{category}|{description}"
        if dedupe_key in _event_state["seen_keys"]:
            return None
        _event_state["seen_keys"].add(dedupe_key)
        ev = {
            "id": _event_state["next_id"],
            "category": category,
            "description": description,
            "details": details or "",
            "met": met or "",
            "wallClock": time.strftime("%H:%M:%S"),
        }
        _event_state["next_id"] += 1
        _event_state["events"].append(ev)
        if len(_event_state["events"]) > MAX_EVENTS:
            _event_state["events"] = _event_state["events"][-MAX_EVENTS:]
        return ev


@app.route("/api/events", methods=["GET"])
def api_events_get():
    """I client passano `since=<ultimo id ricevuto>` per un fetch incrementale."""
    since = request.args.get("since", 0, type=int)
    with _event_lock:
        events = [e for e in _event_state["events"] if e["id"] > since]
        last_id = _event_state["next_id"] - 1
    return jsonify({"events": events, "last_id": last_id})


@app.route("/api/events", methods=["POST"])
def api_events_post():
    body = request.get_json(silent=True) or {}
    category = body.get("category", "SISTEMA")
    description = body.get("description", "")
    details = body.get("details", "")
    key = body.get("key")
    met = body.get("met")
    ev = _add_event(category, description, details, key, met)
    if ev:
        session.log("mission_event", ev)
        return jsonify({"ok": True, "event": ev})
    return jsonify({"ok": True, "duplicate": True})


# ================== NOMI MANOVRE P30/P40 CONDIVISI (autorità: il server) ==================
# I nomi delle schede P30/P40 (LOI-1/LOI-2/TEI per una missione lunare,
# Circolarizzazione/RNDZ/... per un'orbita bassa terrestre, ecc.) dipendono
# dalla missione e restano modificabili/aggiungibili/rimovibili dall'utente
# esattamente come prima. La differenza e' che ora il server e' l'unica
# fonte di verita': ogni client fa polling e si allinea, cosi' se una
# postazione rinomina/aggiunge/rimuove una manovra, tutte le altre vedono
# lo stesso elenco - niente piu' nomi discordanti tra postazioni ne'
# duplicati nel log eventi dovuti a descrizioni diverse per lo stesso burn.
_burn_names_lock = threading.Lock()
_burn_names_state = {"names": ["LOI-1", "LOI-2", "TEI"], "version": 1}


@app.route("/api/burn-names", methods=["GET"])
def api_burn_names_get():
    with _burn_names_lock:
        return jsonify({
            "names": list(_burn_names_state["names"]),
            "version": _burn_names_state["version"],
        })


@app.route("/api/burn-names", methods=["POST"])
def api_burn_names_post():
    body = request.get_json(silent=True) or {}
    names = body.get("names")
    if not isinstance(names, list) or not names or not all(
        isinstance(n, str) and n.strip() for n in names
    ):
        return jsonify({"ok": False, "error": "names deve essere una lista non vuota di stringhe"}), 400
    cleaned = [n.strip() for n in names]
    with _burn_names_lock:
        _burn_names_state["names"] = cleaned
        _burn_names_state["version"] += 1
        payload = {"names": list(_burn_names_state["names"]), "version": _burn_names_state["version"]}
    session.log("burn_names_update", payload)
    return jsonify(payload)


@app.route("/api/keypress/<computer>", methods=["POST"])
def api_keypress(computer):
    if computer not in COMPUTERS:
        return jsonify({"ok": False, "error": f"Computer sconosciuto: {computer}"}), 404

    body = request.get_json(silent=True) or {}
    key_name = body.get("key")
    cfg = COMPUTERS[computer]
    if key_name not in cfg["keys"]:
        return jsonify({"ok": False, "error": f"Tasto sconosciuto: {key_name}"}), 400

    try:
        _send_key(computer, key_name)
        return jsonify({"ok": True, "key": key_name, "ts": time.strftime("%H:%M:%S")})
    except Exception as e:
        session.log("keypress_error", {"computer": computer, "key": key_name, "error": str(e)})
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/log/<name>")
def api_log(name):
    if name not in _macro_state:
        return jsonify({"error": "sequenza sconosciuta"}), 404
    with _state_lock:
        return jsonify(_macro_state[name])


def _run_rendezvous_macro(target="lm"):
    key = "rndz"
    try:
        _append_log(key, f"--- INIZIO SEQUENZA AUTOMATICA CONFIGURAZIONE RENDEZ-VOUS (BERSAGLIO: {'CSM-LM' if target != 'skylab' else 'CSM-SKYLAB'}) ---")

        _append_log(key, "⚙️ Retract Probe off (Retract -> Middle)")
        _send_switch(CommandModuleSwitchID.DockingProbeRetractPrim, Position.Middle)
        time.sleep(0.5)

        _append_log(key, "💡 Attivazione luci Rendezvous (ExtLightRNDZ -> DOWN)")
        _send_switch(CommandModuleSwitchID.ExtLightRNDZ, Position.Down)

        _append_log(key, "💡 Attivazione luci Rendezvous (ExtLightRUNEVA -> UP)")
        _send_switch(CommandModuleSwitchID.ExtLightRUNEVA, Position.Up)

        _append_log(key, "💡 Attivazione Docking Probe (DockingProbe -> UP)")
        _send_switch(CommandModuleSwitchID.DockingProbeExtend, Position.Up)

        _append_log(key, "💡 Attivazione EMS (Switch -> Backup/VHF)")
        _send_switch(CommandModuleSwitchID.EMSSetting, Position.Down)

        # Procedura CSM-LM: rispetto alla procedura CSM-Skylab (invariata sopra),
        # va inserito sull'AGC il comando V79E-PRO. I tasti vanno inviati uno
        # alla volta con un intervallo di almeno mezzo secondo l'uno dall'altro
        # (V, poi 7, poi 9, poi ENTR, poi PRO), non come pressione simultanea.
        if target == "lm":
            _append_log(key, "--- PROCEDURA AGGIUNTIVA CSM-LM: INSERIMENTO V79E-PRO SU AGC ---")
            v79e_keys = [
                ("VERB", "V"),
                ("7", "7"),
                ("9", "9"),
                ("ENTR", "ENTR (V79E)"),
                ("PRO", "PRO"),
            ]
            for key_name, display in v79e_keys:
                time.sleep(0.5)
                _send_key("agc", key_name)
                _append_log(key, f"⌨️ AGC ‹{display}› inviato")

        _append_log(key, "--- OPERAZIONE COMPLETATA CON SUCCESSO ---")
    finally:
        with _state_lock:
            _macro_state[key]["running"] = False


def _run_system2_macro():
    key = "sys2"
    try:
        _append_log(key, "--- INIZIO PROCEDURA AUTOMATICA POST-DOCKING ---")

        _append_log(key, "⚙️ Retracting Scopes (Retract -> UP)")
        _send_switch(CommandModuleSwitchID.DockingProbeRetractPrim, Position.Up)
        time.sleep(0.5)

        _append_log(key, "💡 Retract Docking Probe (DockingProbe -> Down)")
        _send_switch(CommandModuleSwitchID.DockingProbeExtend, Position.Down)

        _append_log(key, "💡 Spegnimento luci Rendezvous (ExtLightRNDZ -> Middle)")
        _send_switch(CommandModuleSwitchID.ExtLightRNDZ, Position.Middle)

        _append_log(key, "💡 Attivazione luci Rendezvous (ExtLightRUNEVA -> UP)")
        _send_switch(CommandModuleSwitchID.ExtLightRUNEVA, Position.Down)

        _append_log(key, "--- OPERAZIONE COMPLETATA CON SUCCESSO ---")
    finally:
        with _state_lock:
            _macro_state[key]["running"] = False


@app.route("/api/rendezvous", methods=["POST"])
def api_rendezvous():
    body = request.get_json(silent=True) or {}
    target = body.get("target", "lm")
    if target not in ("lm", "skylab"):
        target = "lm"
    with _state_lock:
        if _macro_state["rndz"]["running"]:
            return jsonify({"ok": False, "error": "Sequenza già in esecuzione"}), 409
        _macro_state["rndz"]["running"] = True
    threading.Thread(target=_run_rendezvous_macro, args=(target,), daemon=True).start()
    return jsonify({"ok": True})


@app.route("/api/sys2", methods=["POST"])
def api_sys2():
    with _state_lock:
        if _macro_state["sys2"]["running"]:
            return jsonify({"ok": False, "error": "Sequenza già in esecuzione"}), 409
        _macro_state["sys2"]["running"] = True
    threading.Thread(target=_run_system2_macro, daemon=True).start()
    return jsonify({"ok": True})


if __name__ == "__main__":
    # host 0.0.0.0 => raggiungibile da altri dispositivi sulla stessa rete (es. il telefono Android)
    app.run(host="0.0.0.0", port=5001, debug=False)
