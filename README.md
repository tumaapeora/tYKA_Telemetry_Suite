# Apollo Flight Operations Workspace — Web Edition

---

## 🇬🇧 ENGLISH

Web version (Flask + HTML/JS) of the flight operations control panel, designed to be accessed via browser on Android phones (or any device on the local network) while retaining the original UDP network architecture.

### ⚠️ Prerequisites & Configuration (Before Launch)

Before running the telemetry suite, you must configure the connection with **Reentry - An Orbital Simulator**:

1. **Simulator Configuration (*Reentry*):**
   * Open *Reentry - An Orbital Simulator*.
   * Go to settings and **enable Data Export**.
   * **Enable UDP access**.

2. **IP Address Configuration (`APOLLO_DEST_IP`):**
   * Open `demos/Apollo WebFinal/app.py` in a text editor.
   * Update `APOLLO_DEST_IP` (or the `DEST_IP` variable):
     * Use `127.0.0.1` if running Flask on the **same PC** as *Reentry*.
     * Use the specific local IP address if Flask runs on a **separate PC/Server** on your network.

3. **Reentry Export File Paths (`MISSION_FILE`, `AGC_FILE`, `LGC_FILE`):**
   * *Reentry* generates JSON telemetry files (`missionTiming.json`, `outputAGC.json`, `outputLGC.json`) inside your user profile directory (typically located at `%USERPROFILE%\AppData\LocalLow\Wilhelmsen Studios\Reentry\Apollo\` or `Documents\Wilhelmsen Studios\Reentry\Apollo\`).
   * In `app.py`, update the file path variables (or set the environment variables `APOLLO_MISSION_FILE`, `APOLLO_AGC_FILE`, and `APOLLO_LGC_FILE`) to match the exact location of the export folder on your machine.

---

### 🚀 Quick Start Guide

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
Navigate to the application folder:
Open terminal/command prompt and navigate to:

Bash
cd python/demos/"Apollo WebFinal"
Launch the Flask server:

Bash
python app.py
The server will listen on port 5001 (0.0.0.0:5001), making it accessible locally and across devices on the same local network.

Accessing Locally / Remote Devices (e.g., Android Smartphone):

On the same PC: Open browser to http://localhost:5001 or http://127.0.0.1:5001.

From another device (e.g., Android Phone):

Ensure the device is connected to the same Wi-Fi network.

Get your PC's local IP address (ipconfig on Windows).

Open browser on your device and go to http://<YOUR_PC_IP>:5001 (e.g., http://192.168.1.50:5001).

Project Structure
apollo_web/
├── app.py                    # Flask server: telemetry, keys, macros
├── ReentryUDP/
│   ├── __init__.py
│   └── DomainModels.py       # DataPacket, enums, etc.
├── templates/index.html      # UI: menu + control pages
├── static/style.css          # DSKY theme (phosphor green, riveted panels)
├── static/app.js             # Telemetry polling, keys, macros
└── requirements.txt
Console Layout
A) MISSION CONTROL — Telemetry & Monitoring (Read-Only)
MC-1 — COMPUTER PANEL (AGC & LGC): Side-by-side view of MET + AGC/LGC DSKY.

MC-2 — ORBITAL MAP: Keplerian orbit reconstruction from V82E with DOCKED/UNDOCKED, EARTH/MOON toggles, and static LM surface placement.

MC-3 — LAUNCH PHASE: Sequence lights P01/P02, P11 monitoring (V06N62), optional TFF display.

MC-4 — TRANS-STAGE BURN: Unified monitoring for TLI (P15), LOI-1, LOI-2, TEI (P30/P40), engine indicators, planned vs. actual ΔV, and burn duration tracking.

MC-5 — LM LUNAR DESCENT: Automatic detection of P63/P64/P66, timer from PDI to Contact Light, and 2D Altitude/Time charting.

MC-6 — LUNAR ASCENT & RENDEZVOUS:

P12 (Ascent, LGC): Engine light control, ΔV, and final orbital parameters.

CSI/TPI/TPF (P30/P41, LGC): RCS translation burn monitoring without main engine lights.

P79 (Final Approach): Live V16N54 feed and 2D proximity plot.

MC-7 — ATMOSPHERIC RE-ENTRY (P61-P67, AGC): Tracking splashdown targets, CM/SM separation, real-time G-load/Time graphs, bank angles, and final entry state (V16N67).

B) OPERATIONS — Interactive Controls & Automatic Macros
OP-1 — INTERACTIVE AGC DSKY: Keypad targeting Command Module.

OP-2 — INTERACTIVE LGC DSKY: Keypad targeting Lunar Module.

OP-3 — AUTOMATIC RENDEZVOUS: Macro switch panel.

OP-4 — AUTOMATIC POST-DOCKING: Macro switch panel.

State Sync & Logging
Single Source of Truth: Background telemetry caching thread updated every 0.5s served via /api/telemetry.

Shared Event Log: Endpoint /api/events with automatic event deduplication.

Persistent Session Logs: Automated JSONL logging saved to logs/session_YYYYMMDD_HHMMSS.jsonl (configurable via APOLLO_LOG_DIR).

🇮🇹 ITALIANO
Versione web (Flask + HTML/JS) del pannello di controllo, pensata per essere aperta dal browser del telefono Android (o di qualsiasi altro dispositivo sulla stessa rete), mantenendo intatta la logica di rete UDP originale.

⚠️ Requisiti preliminari e Configurazione (Prima dell'avvio)
Prima di poter avviare il programma di telemetria, è necessario configurare la connessione con il simulatore Reentry - An Orbital Simulator:

Configurazione Simulatore (Reentry):

Apri Reentry - An Orbital Simulator.

Vai nelle impostazioni e abilita l'uscita dei dati (Data Export).

Abilita l'accesso via UDP.

Configurazione IP (APOLLO_DEST_IP):

Apri il file demos/Apollo WebFinal/app.py con un editor di testo.

Modifica l'indirizzo IP impostando la variabile APOLLO_DEST_IP (o DEST_IP):

Usa 127.0.0.1 se stai eseguendo Flask sullo stesso PC di Reentry.

Usa l'IP locale del PC di Reentry se Flask è in esecuzione su un PC/Server separato.

Configurazione Percorsi File di Export (MISSION_FILE, AGC_FILE, LGC_FILE):

Reentry genera file JSON di stato (missionTiming.json, outputAGC.json, outputLGC.json) nella cartella utente locale (di norma situata in %USERPROFILE%\AppData\LocalLow\Wilhelmsen Studios\Reentry\Apollo\ oppure in Documenti\Wilhelmsen Studios\Reentry\Apollo\).

In app.py, aggiorna i percorsi di questi file (o imposta le variabili d'ambiente APOLLO_MISSION_FILE, APOLLO_AGC_FILE e APOLLO_LGC_FILE) facendoli puntare alla cartella di export effettiva del tuo computer.

🚀 Guida all'avvio rapido
Installa le dipendenze:

Bash
pip install -r requirements.txt
Naviga nella cartella corretta:
Apri il terminale/prompt dei comandi e spostati nella cartella dell'applicazione:

Bash
cd python/demos/"Apollo WebFinal"
Avvia il server Flask:

Bash
python app.py
Il server si avvierà sulla porta 5001 (0.0.0.0:5001), rendendolo accessibile localmente e da altri dispositivi sulla stessa rete.

Accesso Locale / da Dispositivi Remoti (es. Smartphone Android):

Sullo stesso PC: Apri il browser e naviga su http://localhost:5001 o http://127.0.0.1:5001.

Da un altro dispositivo (es. Telefono Android):

Assicurati che il dispositivo sia connesso alla stessa rete Wi-Fi del PC.

Individua l'IP locale del PC (ipconfig su Windows).

Apri il browser sul telefono e vai su http://<IP_DEL_TUO_PC>:5001 (es. http://192.168.1.50:5001).

Struttura del Progetto
apollo_web/
├── app.py                    # Server Flask: telemetria, tasti, macro
├── ReentryUDP/
│   ├── __init__.py
│   └── DomainModels.py       # DataPacket, enum, ecc.
├── templates/index.html      # UI: menu + pagine di controllo
├── static/style.css          # Tema DSKY (verde fosforo, pannelli rivettati)
├── static/app.js             # Polling telemetria, tasti, macro
└── requirements.txt
Struttura della Console
A) CONTROLLO MISSIONE — Telemetria e Monitoraggio (Sola visualizzazione)
MC-1 — PANNELLO COMPUTER (AGC & LGC): Visualizzazione affiancata MET + DSKY AGC/LGC.

MC-2 — MAPPA ORBITALE: Ricostruzione orbita da Apogeo/Perigeo (V82E) con supporto per switch AGGANCIATI/SGANCIATI, TERRA/LUNA, animazione kepleriana e posizionamento statico LM sulla superficie.

MC-3 — FASE DI LANCIO: Luci di sequenza P01/P02, monitor P11 (V06N62), richiamo V82E→V06N44 con TFF (MM:SS).

MC-4 — BURN TRANS-STADIO: Monitoraggio unificato TLI (P15), LOI-1, LOI-2, TEI (P30/P40) con gestione delle spie motore, calcolo ΔV pianificato/effettivo e durata accensione.

MC-5 — DISCESA LUNARE DEL LM: Riconoscimento automatico P63/P64/P66, cronometro da PDI a Contact Light, grafico 2D Altitudine/Tempo.

MC-6 — RISALITA LUNARE E RENDEZVOUS:

P12 (Risalita, LGC): Gestione spia motore, ΔV e parametri orbitali finali.

CSI/TPI/TPF (P30/P41, LGC): Tracciamento manovre RCS senza spia motore principale.

P79 (Avvicinamento finale): Visualizzazione live V16N54 e grafico 2D di prossimità.

MC-7 — RIENTRO ATMOSFERICO (P61-P67, AGC): Monitoraggio dati splashdown, separazione CM/SM, grafico live G-load/Tempo, bank angle e dati finali di posizione (V16N67).

B) OPERAZIONI — Comandi Interattivi e Sequenze Automatiche
OP-1 — AGC DSKY INTERATTIVO: Tastierino Command Module.

OP-2 — LGC DSKY INTERATTIVO: Tastierino Lunar Module.

OP-3 — RENDEZ-VOUS AUTOMATICO: Macro switch.

OP-4 — POST-DOCKING AUTOMATICO: Macro switch.

Sincronizzazione di Stato e Log
Single Source of Truth: Thread in background per la lettura della telemetria in cache ogni 0.5s via /api/telemetry.

Registro Eventi Condiviso: Endpoint /api/events con deduplicazione automatica.

Log di Sessione Persistente: Generazione automatica di file JSONL in logs/session_AAAAMMGG_HHMMSS.jsonl (configurabile tramite APOLLO_LOG_DIR).
