# Apollo Flight Operations Workspace — Web Edition

Versione web (Flask + HTML/JS) del pannello di controllo, pensata per essere
aperta dal browser del telefono Android (o di qualsiasi altro dispositivo
sulla stessa rete), mantenendo intatta la logica di rete UDP originale.

## Struttura

```
apollo_web/
├── app.py                    # server Flask: telemetria, tasti, macro
├── ReentryUDP/
│   ├── __init__.py
│   └── DomainModels.py       # DataPacket, enum, ecc. (invariato)
├── templates/index.html      # UI: menu + 3 pagine
├── static/style.css          # tema DSKY (verde fosforo, pannelli rivettati)
├── static/app.js             # polling telemetria, tasti, macro
└── requirements.txt
```

## Struttura della console (interamente in italiano)

**A) CONTROLLO MISSIONE — telemetria e monitoraggio (nessun comando inviato)**
1. **MC-1 — PANNELLO COMPUTER (AGC & LGC)** — sola visualizzazione, MET + DSKY AGC/LGC affiancati.
2. **MC-2 — MAPPA ORBITALE** — ricostruisce l'orbita da Apogeo/Perigeo (V82E):
   - Switch **AGGANCIATI/SGANCIATI** e **TERRA/LUNA**.
   - **Fase iniziale (0-360°)**, animazione legata esattamente al periodo kepleriano.
   - **Tempo al Perigeo / Tempo all'Apogeo** calcolati in tempo reale dal vettore di stato corrente.
   - **LM sulla superficie**: se attivo (solo modalità sganciati), l'icona LM resta statica sulla superficie del corpo invece di orbitare.
   - Parsing corretto del decimale sui registri V82E, stato persistente tra le pagine.
3. **MC-3 — FASE DI LANCIO** — luci di sequenza semplificate P01/P02, monitor P11 (V06N62: velocità inerziale, rateo altezza, altezza sopra il pad), richiamo opzionale V82E→V06N44 con TFF in formato MM:SS.
4. **MC-4 — BURN TRANS-STADIO** — monitor unico per TLI (P15), LOI-1, LOI-2, TEI (P30/P40): riconoscimento automatico del Noun attivo. Per **LOI/TEI**: la spia motore si accende **4 secondi dopo la comparsa di V99N40** (richiesta GO), indipendentemente da cosa mostra il DSKY nel frattempo (tra T-35s e T-30s lo schermo va vuoto); si spegne quando compare V16N40, la cui comparsa stessa è il segnale di cutoff; ΔV pianificato con decimale (÷10, come V82E). Per **TLI**: la spia si accende quando il **timer alla riga 1 di V06N95 arriva esattamente a +00000** (non si usa più la variazione di Vg per l'accensione, per evitare falsi positivi da piccole oscillazioni pre-burn), e si spegne quando Vg (riga 2) smette di variare; il ΔV pianificato si legge su **V06N14 riga 1** (VI C/O) **senza decimale** (intero pieno, a differenza degli altri Noun di ΔV). In entrambi i casi: cattura ΔV effettivo (scarto tra pianificato e Vg finale), durata accensione, registro manovre completate.
5. **MC-5 — DISCESA LUNARE DEL LM** — riconoscimento automatico P63/P64/P66 (V06N61/62/63/64/60), cronometro dalla prima comparsa di P63 alla Contact Light, grafico 2D Altitudine/Tempo con cue card di riferimento (P63 aggiornata per PDI ~350 nmi, P64 invariata), timestamp MET di inizio PDI e Contact Light.
6. **MC-6 — RISALITA LUNARE E RENDEZVOUS**:
   - **P12 (risalita, LGC)** — usa lo stesso motore generico di monitoraggio manovra di TLI/LOI/TEI (spia motore, ΔV pianificato/effettivo, durata, registro manovre): V37E12E carica il programma, V06N33 (TIG), V06N76 (target insertion — VHF/Ḣ/crossrange, VHF usato come ΔV pianificato di riferimento), V50N25 (consenso 00203), V06N74 (countdown/assetto), **V99N74 lampeggiante** (richiesta GO accensione motore APS — la spia si accende ~4s dopo PROCEED, come per LOI/TEI), V06N94 (dati in volo, con badge di transizione Vertical Rise → Orbit Insertion quando Ḣ supera 45 ft/s in N94/R2), V16N77 (dati opzionali), **V16N85** (residui post-cutoff: qui segna il cutoff del motore APS — la durata si calcola dal tempo reale trascorso e il ΔV effettivo riportato è il ΔV target, dato che la guida chiude il motore esattamente al raggiungimento dell'inserimento; i residui restano visibili come riferimento per la rifinitura via RCS), V16N44 (parametri orbitali finali).
   - **CSI/TPI/TPF (P30/P41, solo LGC)** — architettura dedicata separata, **senza spia motore**: le tre manovre orbitali del rendezvous si eseguono via RCS (Translation Controller), non con un motore principale. Setup P30 con V06N33/N81/N42/N45, esecuzione P41 con V50N18/V16N18/V16N85: lo stato mostrato è "spinta RCS in corso" finché almeno un asse di V16N85 è diverso da zero, "manovra completata" quando tutti e tre tornano a ±00000 (ΔV effettivo riportato = magnitudo del residuo iniziale annullato, una stima indicativa e non un valore integrato nel tempo).
   - **P79** (avvicinamento finale): assetto V50/V06 N18, spia UPLINK ACTY, V16N54 live con grafico 2D di prossimità.
7. **MC-7 — RIENTRO ATMOSFERICO (P61-P67, solo AGC)** — riconoscimento automatico Verb/Noun sul DSKY del CM:
   - **P61 (V37E 61E)**: bersaglio di splashdown (N61: lat/lon, codice roll), predizione dinamica dopo PROCEED (N60: G max, V predicted a EI, Gamma EI), dati EMS di backup (N63: RTOGO, VIO, TFE) — catturati e conservati come riferimento per il resto del rientro.
   - **P62**: richiesta separazione CM/SM (V50N25, 00041 lampeggiante — spia dedicata, si spegne al passaggio all'assetto di rientro N22) e assetto di rientro (N22: roll/pitch/yaw).
   - **P63 → P64 → P67**: cronometro e grafico live G-load/Tempo che partono automaticamente al primo V06N64 (inizio P63, attesa 0.05G) e riconoscono l'ingresso in P64 (V06N74: bank angle comandato, velocità inerziale, G). In P67 il monitoraggio di guida resta su **V06N66** non lampeggiante (bank angle, crossrange error, downrange error), con linea di riferimento tratteggiata sul G max previsto dal P61. Il grafico e il cronometro si fermano solo quando compare **V16N67** lampeggiante (dati finali di posizione — Range to Target, Present Latitude, Present Longitude — con V < 1000 ft/s): **non V06N67**, che non esiste su questo display. A quel punto è possibile segnare manualmente con un pulsante l'apertura dei paracadute drogue (PROCEED), dopo aver portato SC CONTROL su SCS, dato che da lì in poi il controllo passa a manuale. Sono riconosciuti anche i tre display manuali richiamabili in P67 (V16N64E: G/velocità/RTOGO; V16N68E: bank/velocità/rateo di discesa; V16N74E: bank/velocità/drag), utili come sola visualizzazione informativa senza effetti sullo stato del pannello.

**B) OPERAZIONI — comandi interattivi e sequenze automatiche**
1. **OP-1 — AGC DSKY INTERATTIVO** — tastierino verso il Command Module.
2. **OP-2 — LGC DSKY INTERATTIVO** — tastierino verso il Lunar Module.
3. **OP-3 — RENDEZ-VOUS AUTOMATICO** — macro switch.
4. **OP-4 — POST-DOCKING AUTOMATICO** — macro switch.

> **Note importanti:**
> - I nomi dei tasti DSKY (VERB, NOUN, CLR, PRO, KEY REL, ENTR, RSET) sono
>   lasciati in inglese perché sono le etichette reali dei tasti fisici del
>   DSKY Apollo — non hanno mai avuto una versione italiana, tradurli
>   sarebbe meno fedele all'hardware originale.
> - I dati delle cue card (P63/P64) sono trascritti a mano dalle immagini
>   fornite. Verifica sempre con l'originale cartaceo in caso di dubbio.
> - Per i pannelli TLI/LOI/TEI i valori dei registri sono mostrati come
>   cifre grezze (nessuna scala/decimale presunta), tranne Vg e ΔV
>   pianificato/effettivo che usano il decimale (÷10, come V82E). Per
>   CSI/TPI/TPF (V16N85) i tre assi usano lo stesso parsing con decimale.
> - Per il P12 (risalita), il ΔV pianificato è letto da V06N76/R1 (VHF)
>   con lo stesso decimale ÷10; i residui post-cutoff (V16N85) restano
>   mostrati come cifre grezze, senza tentare un calcolo di ΔV effettivo
>   a partire da loro (vedi nota nella sezione MC-6 qui sopra).
> - Per il pannello di rientro atmosferico (MC-7, P61-P67) gli angoli
>   (roll/pitch/yaw, bank angle, gamma) e le distanze in nmi (RTOGO,
>   crossrange/downrange, range to splash/target) usano il decimale ÷10,
>   come gli altri pannelli. L'accelerazione G (N64/N74, G max su N60) e
>   Latitudine/Longitudine (N61, N67) usano invece ÷100 — **confermato da
>   riscontro diretto** (es. G max "00650" = 6.50G, non 65.0G; lat/lon
>   "03140"/"-03648" = 31.40°/-36.48°, non 314.0°/-364.8°). Se in futuro un
>   campo dovesse ancora risultare fuori scala, verifica sempre con il DSKY
>   reale ed eventualmente correggi la funzione di parsing in reentry.js.

## Sincronizzazione di stato e log di sessione (novità)

- **Stato globale condiviso (single source of truth):** il server non legge
  più i file del simulatore a ogni richiesta di ciascun client. Un thread di
  background li legge una volta ogni 0.5s, li mette in cache
  (`_telemetry_cache`) con un numero di sequenza (`seq`), e `/api/telemetry`
  restituisce sempre quell'unico snapshot: tutti i client vedono
  esattamente la stessa telemetria nello stesso istante.
- **Registro eventi di missione condiviso:** `POST /api/events` (dal
  browser) e `GET /api/events?since=<id>` spostano l'autorità del registro
  eventi (prima solo locale in `eventlog.js`) sul server, con
  deduplicazione automatica per evitare doppioni quando più client
  rilevano lo stesso evento.
- **Log di sessione persistente:** a ogni avvio del server viene creato un
  nuovo file `logs/session_AAAAMMGG_HHMMSS.jsonl` (una riga JSON per
  evento: avvio server, tasti premuti, switch inviati, step delle macro,
  eventi di missione, variazioni di telemetria). Cartella configurabile con
  la variabile d'ambiente `APOLLO_LOG_DIR`.

## Come si avvia (sul PC che ha accesso al simulatore/rete UDP)

1. Installa le dipendenze:
   ```
   pip install -r requirements.txt
   ```

2. (Opzionale) configura i percorsi/IP tramite variabili d'ambiente, se
   diversi dai default nello script originale:
   ```
   set APOLLO_MISSION_FILE=C:\Users\Nicolò\AppData\LocalLow\Wilhelmsen Studios\ReEntry\Export\Apollo\missionTiming.json
   set APOLLO_AGC_FILE=C:\Users\Nicolò\AppData\LocalLow\Wilhelmsen Studios\ReEntry\Export\Apollo\outputAGC.json
   set APOLLO_LGC_FILE=C:\Users\Nicolò\AppData\LocalLow\Wilhelmsen Studios\ReEntry\Export\Apollo\outputLGC.json
   set APOLLO_DEST_IP=192.168.1.105
   set APOLLO_DEST_PORT=8051
   ```
   (i valori di default in `app.py` sono già impostati su questi percorsi
   ReEntry, quindi normalmente non serve nemmeno configurarli)
   (su Linux/Mac usa `export` invece di `set`)

3. Avvia il server:
   ```
   python app.py
   ```
   Il server resta in ascolto su `0.0.0.0:5001`, quindi è raggiungibile da
   qualunque dispositivo sulla tua rete locale, non solo dal PC stesso.

## Come si apre dal telefono Android

1. Assicurati che il telefono sia sulla **stessa rete Wi-Fi** del PC che fa
   girare `app.py`.
2. Trova l'indirizzo IP locale del PC (es. `ipconfig` su Windows, cerca
   "Indirizzo IPv4", tipo `192.168.1.50`).
3. Sul telefono apri il browser e vai su:
   ```
   http://192.168.1.50:5001
   ```
   (sostituisci con l'IP reale del tuo PC)
4. Se vuoi, puoi "Aggiungere a schermata Home" dal menu del browser per
   avere un'icona simile a un'app.

## Note

- Il PC che esegue `app.py` deve avere accesso sia al file JSON di
  telemetria (`missionTiming.json`, `outputAGC.json`) sia alla rete UDP del
  simulatore: è lui che fa da ponte tra il telefono e il resto del sistema.
- Se in futuro vuoi un'app installabile vera e propria (icona, offline,
  notifiche) invece che una pagina aperta dal browser, si può trasformare
  questo stesso frontend in una PWA (basta aggiungere un manifest.json e un
  service worker) oppure wrapparlo con Capacitor/Cordova in un APK.
- Per usarla anche fuori casa servirebbe esporre il server oltre la rete
  locale (VPN verso casa, tunnel tipo Tailscale, ecc.) — evita di esporre
  Flask direttamente su internet così com'è, non ha autenticazione.
