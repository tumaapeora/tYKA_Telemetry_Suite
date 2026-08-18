"""
SessionLogger
=============
Crea, a ogni avvio del server, un nuovo file di log dedicato alla sessione
(nome con timestamp) e vi scrive in tempo reale - un evento per riga, in
formato JSON Lines (.jsonl) - tutto cio' che accade: avvio server, comandi
tastiera/switch inviati via UDP, step delle macro automatiche, eventi di
missione (rilevati dai client) e variazioni della telemetria.

Il formato JSONL e' scelto perche':
  - ogni riga e' un JSON valido indipendente -> il file e' leggibile anche
    se il processo viene interrotto a meta' scrittura;
  - e' facile da "tail -f" o da ricaricare per un futuro replay/debug;
  - non richiede di riscrivere l'intero file a ogni append (a differenza
    di un unico oggetto JSON), quindi resta efficiente per sessioni lunghe.

Uso:
    from ReentryUDP.SessionLogger import SessionLogger
    session = SessionLogger()          # crea logs/session_20260731_153000.jsonl
    session.log("server_start", {...})
    session.log("keypress", {...})
"""
import json
import os
import threading
from datetime import datetime


class SessionLogger:
    def __init__(self, log_dir="logs", prefix="session"):
        self._lock = threading.Lock()
        self._seq = 0
        os.makedirs(log_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = os.path.join(log_dir, f"{prefix}_{timestamp}.jsonl")

        # buffering=1 => line-buffered: ogni "\n" forza già uno flush lato
        # libreria; il flush() + fsync() espliciti in log() garantiscono che
        # il dato sia sul disco anche in caso di crash improvviso del processo.
        self._fh = open(self.filename, "a", encoding="utf-8", buffering=1)

    def log(self, event_type: str, data: dict | None = None) -> dict:
        """Scrive un evento sul file di sessione (thread-safe) e lo ritorna."""
        with self._lock:
            self._seq += 1
            entry = {
                "seq": self._seq,
                "ts": datetime.now().isoformat(timespec="milliseconds"),
                "type": event_type,
                "data": data if data is not None else {},
            }
            self._fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            self._fh.flush()
            try:
                os.fsync(self._fh.fileno())
            except OSError:
                # alcuni filesystem di rete (es. share SMB) non supportano
                # fsync: non e' un errore fatale, il flush() ha già inviato
                # i dati al livello OS.
                pass
            return entry

    def close(self):
        with self._lock:
            if not self._fh.closed:
                self._fh.close()
