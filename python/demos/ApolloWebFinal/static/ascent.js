// ==========================================================================
// SEZIONE 4: RISALITA LUNARE E RENDEZVOUS
// - P12 (LGC): risalita, usa il MOTORE GENERICO di maneuvers.js (la stessa
//   architettura di TLI/LOI/TEI): V99N74 lampeggiante = richiesta GO,
//   accensione APS ~4s dopo (come da convenzione già usata per P30/P40),
//   cutoff rilevato all'ingresso in N85 (residui). La spia motore vive QUI
//   (P12), non nella sezione CSI/TPI/TPF: le tre manovre orbitali del
//   rendezvous si fanno via RCS, non con un motore principale.
// - CSI/TPI/TPF: gestite da rendezvous.js (architettura dedicata, nessuna
//   spia motore — solo stato "spinta RCS in corso / manovra completata").
// - P79 (AGC): avvicinamento finale, V50/V06 N18, spia UPLINK ACTY, N54 live
//   + grafico 2D di prossimità (stile coerente con la pagina Orbite).
// ==========================================================================
(function () {
  const flags = { pitchoverLogged: false, p79Logged: false };

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  // ---------------- P12 ASCENT (LGC) — motore generico ----------------
  const P12_TABLE = {
    "12-21-33": { label: "P12 — TIG RISALITA (N33)", r1: "ORE TIG", r2: "MINUTI TIG", r3: "SECONDI TIG" },
    "12-6-76":  { label: "P12 — TARGET INSERTION (N76)", r1: "VELOCITÀ DOWNRANGE DESIDERATA (VHF)", r2: "VELOCITÀ RADIALE DESIDERATA (Ḣ)", r3: "DISTANZA CROSSRANGE DA ELIMINARE", isPlannedDv: "r1" },
    "12-50-25": { label: "P12 — CONSENSO/ARMAMENTO (N25, lampeggiante, atteso 00203)", r1: "CODICE VERIFICA", r2: "—", r3: "—" },
    "12-6-74":  { label: "P12 — COUNTDOWN E ASSETTO (N74)", r1: "TEMPO A TFI", r2: "ANGOLO YAW", r3: "ANGOLO PITCH" },
    "12-99-74": { label: "P12 — ABILITAZIONE ACCENSIONE APS (V99N74, lampeggiante — premi PROCEED)", r1: "TEMPO A TFI", r2: "ANGOLO YAW", r3: "ANGOLO PITCH", isGoRequest: true },
    "12-6-94":  { label: "P12 — IN VOLO (N94)", r1: "VELOCITÀ DA GUADAGNARE ASSE X (VGX)", r2: "VELOCITÀ VERTICALE (ALTITUDE RATE)", r3: "ALTITUDINE CALCOLATA (H)", isInFlightSnapshot: true },
    "12-16-77": { label: "P12 — DATI OPZIONALI (N77)", r1: "TEMPO A SPEGNIMENTO (TG)", r2: "VELOCITÀ DA GUADAGNARE ASSE Y (VGY)", r3: "VELOCITÀ INERZIALE TOTALE (VI)" },
    "12-16-85": { label: "P12 — RESIDUI POST-CUTOFF (V16N85 LAMPEGGIANTE — PREMI PROCEED)", r1: "RESIDUO X", r2: "RESIDUO Y", r3: "RESIDUO Z", isAscentCutoff: true },
    "12-16-44": { label: "P12 — PARAMETRI ORBITALI FINALI (Routine 30, V82→V16N44)", r1: "ALTITUDINE APOCENTRO (Ha)", r2: "ALTITUDINE PERICENTRO (Hp)", r3: "TEMPO A CADUTA LIBERA (TFF)" },
  };

  function initP12Monitor() {
    if (!window.createManeuverMonitor) return;
    // Un solo "tipo" fisso (nessuna scheda personalizzabile, a differenza di
    // LOI-1/LOI-2/TEI): il P12 è sempre lo stesso programma di risalita.
    // defaultCraft="lgc" con allowCraftSwitch=false: legge sempre l'LGC,
    // senza mostrare (né permettere di cambiare) il selettore AGC/LGC.
    window.createManeuverMonitor(
      "p12",
      [{ id: "p12", label: "P12 — RISALITA (LGC)", table: P12_TABLE }],
      false,
      "RISALITA",
      null,
      "lgc"
    );
  }

  // ---------------- Badge transizione traiettoria (Vertical Rise -> Orbit Insertion) ----------------
  // Non fa parte del motore generico: osserva in parallelo lo stesso N94
  // (Ḣ in R2) solo per aggiornare il badge di fase, senza toccare lo stato
  // di accensione/cutoff gestito da maneuvers.js.
  function handleTrajectoryBadge(data) {
    const lgc = data.lgc;
    if (!lgc) return;
    const prog = lgc.prog.replace(/\s/g, "");
    const verb = parseInt(lgc.verb, 10);
    const noun = parseInt(lgc.noun, 10);
    if (prog !== "12" || verb !== 6 || noun !== 94) return;

    const hdot = parseFloat(lgc.registers[1].replace(/\s/g, ""));
    const badge = document.getElementById("ascent-traj-badge");
    if (!badge || isNaN(hdot)) return;
    if (Math.abs(hdot) > 45) {
      badge.textContent = "ORBIT INSERTION PHASE (PITCHOVER ATTIVO)";
      badge.className = "big orbit-info-val accent";
      if (!flags.pitchoverLogged) { flags.pitchoverLogged = true; if (window.logEvent) window.logEvent("RISALITA", "Pitchover — transizione a Orbit Insertion Phase", `MET=${data.met}, Ḣ=${hdot}`); }
    } else {
      badge.textContent = "VERTICAL RISE PHASE (+X VERTICALE)";
      badge.className = "big orbit-info-val";
    }
  }

  // ---------------- P79 PROXIMITY (AGC) ----------------
  const proxData = []; // {tSec, range, rangeRate, estimated}
  let proxStartMetSec = null;
  const NMI_PER_FT = 1 / 6076.11549;
  const MAX_EXTRAPOLATION_SEC = 600; // oltre, la stima viene sospesa
  const prox = { lastMetSec: null, lastRange: null, lastRangeRate: null };

  function metToSeconds(metStr) {
    if (!metStr) return null;
    const m = /^([+-])(\d+):(\d{2}):(\d{2})$/.exec(metStr.trim());
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + parseInt(m[4], 10));
  }

  function setLosStatus(text, cls) {
    const el = document.getElementById("ascent-los-status");
    if (el) { el.textContent = text; el.className = "tiny " + (cls || ""); }
  }

  function drawProxChart() {
    const svg = document.getElementById("ascent-prox-svg");
    if (!svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      const n = document.createElementNS(svgNS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }
    svg.innerHTML = "";
    const W = 600, H = 260, ML = 55, MR = 14, MT = 14, MB = 28;
    const plotW = W - ML - MR, plotH = H - MT - MB;
    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#010302" }));

    if (proxData.length < 2) return;
    const maxT = Math.max(60, ...proxData.map((p) => p.tSec));
    const maxR = Math.max(1, ...proxData.map((p) => p.range)) * 1.1;
    const X = (t) => ML + (t / maxT) * plotW;
    const Y = (r) => MT + plotH - (r / maxR) * plotH;

    for (let i = 0; i <= 4; i++) {
      const r = (maxR / 4) * i;
      const y = Y(r);
      svg.appendChild(el("line", { x1: ML, y1: y, x2: W - MR, y2: y, stroke: "#1b1d20" }));
      const t = el("text", { x: ML - 6, y: y + 3, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
      t.textContent = r.toFixed(1);
      svg.appendChild(t);
    }

    // Disegna la curva a segmenti contigui: tratto continuo per i dati reali,
    // tratteggiato per i tratti stimati in dead-reckoning (segnale perso),
    // così si vede sempre a colpo d'occhio quale parte è "vera" telemetria.
    let i = 0;
    while (i < proxData.length - 1) {
      let j = i;
      const estimated = proxData[i].estimated;
      while (j < proxData.length - 1 && proxData[j + 1].estimated === estimated) j++;
      const seg = proxData.slice(i, j + 1);
      if (seg.length >= 2) {
        const d = seg.map((p, k) => `${k === 0 ? "M" : "L"} ${X(p.tSec).toFixed(1)} ${Y(p.range).toFixed(1)}`).join(" ");
        svg.appendChild(el("path", {
          d, fill: "none",
          stroke: estimated ? "#ffab24" : "#20ff8a",
          "stroke-width": 2,
          "stroke-dasharray": estimated ? "5 4" : "none",
        }));
      }
      i = j > i ? j : i + 1;
    }

    const lbl = el("text", { x: W - MR, y: 14, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
    lbl.textContent = "Range (nmi) vs tempo (MET) — tratteggio ambra = stima da segnale perso";
    svg.appendChild(lbl);
  }

  function addProxPoint(metSec, range, rangeRate, estimated) {
    if (proxStartMetSec === null) proxStartMetSec = metSec;
    const tSec = metSec - proxStartMetSec;
    proxData.push({ tSec, range, rangeRate, estimated: !!estimated });
    if (proxData.length > 2000) proxData.shift();
    drawProxChart();
  }

  function handleP79(data) {
    const agc = data.agc;
    if (!agc) return;
    const prog = agc.prog.replace(/\s/g, "");
    const verb = parseInt(agc.verb, 10);
    const noun = parseInt(agc.noun, 10);
    const p79Active = prog === "79" || prog === "20";

    setText("ascent-p79-status", p79Active ? `P79 ATTIVO (Programma ${prog} — Routine R61/P20)` : "P79 NON ATTIVO (attesa V37E 79E)");
    if (p79Active && !flags.p79Logged) { flags.p79Logged = true; if (window.logEvent) window.logEvent("RENDEZVOUS", "P79 avviato — avvicinamento finale", `MET=${data.met}, Programma=${prog}`); }

    // spia UPLINK ACTY: riusiamo l'indicatore già letto in telemetria AGC
    const uplinkOn = !!(agc.indicators && agc.indicators["Uplink Acty"]);
    const light = document.getElementById("ascent-uplink-light");
    if (light) light.classList.toggle("on", uplinkOn);
    setText("ascent-uplink-note", uplinkOn ? "ACCESA — in attesa di V58E per abilitare l'automanovra" : "spenta");

    if (verb === 50 && noun === 18) {
      setText("ascent-att-status", "V50N18 LAMPEGGIANTE — ERRORE PUNTAMENTO > 10°, ATTENDI PROCEED");
      setText("ascent-att-r1", agc.registers[0]); setText("ascent-att-r2", agc.registers[1]); setText("ascent-att-r3", agc.registers[2]);
    } else if (verb === 6 && noun === 18) {
      setText("ascent-att-status", "V06N18 FISSO — ROTAZIONE CSM IN CORSO VERSO IL BERSAGLIO");
      setText("ascent-att-r1", agc.registers[0]); setText("ascent-att-r2", agc.registers[1]); setText("ascent-att-r3", agc.registers[2]);
    } else {
      setText("ascent-att-status", "—");
    }

    const metSec = metToSeconds(data.met);
    const isRangeReading = verb === 6 && noun === 54;

    if (isRangeReading) {
      const range = parseFloat(agc.registers[0].replace(/\s/g, ""));
      const rangeRate = parseFloat(agc.registers[1].replace(/\s/g, ""));
      setText("ascent-n54-range", agc.registers[0]);
      setText("ascent-n54-rate", agc.registers[1]);
      setText("ascent-n54-theta", agc.registers[2]);
      if (!isNaN(rangeRate)) {
        // FIX: la convenzione precedente (rate<0 = avvicinamento) era
        // invertita rispetto a quanto osservato in gioco — con rate
        // positivo ci si avvicina, con rate negativo ci si allontana.
        setText("ascent-n54-trend", rangeRate > 0 ? "AVVICINAMENTO" : rangeRate < 0 ? "ALLONTANAMENTO" : "STAZIONARIO");
      }
      if (!isNaN(range) && metSec !== null) {
        prox.lastMetSec = metSec;
        prox.lastRange = range;
        if (!isNaN(rangeRate)) prox.lastRangeRate = rangeRate;
        setLosStatus("SEGNALE V16N54 ATTIVO — dati diretti", "accent");
        addProxPoint(metSec, range, rangeRate, false);
      }
      return;
    }

    // Nessuna lettura V16N54 in questo campione. Se il CSM ha perso di vista
    // il LM (tipicamente durante un timescale in gioco nei tempi morti), il
    // grafico smetterebbe di avanzare finché non si riacquisisce il segnale.
    // Continuiamo invece a stimarlo per dead-reckoning, propagando l'ultimo
    // range noto col rateo di chiusura degli ultimi secondi validi. Il
    // delta usato è quello del MET (non del tempo reale): se il gioco
    // accelera il tempo simulato, il MET salta in avanti di più, e quindi
    // anche la stima avanza della stessa quantità — niente di più preciso
    // è possibile senza rifare qui la meccanica orbitale completa, ma su
    // buchi di segnale brevi/moderati il rateo costante è un'ottima
    // approssimazione. Oltre MAX_EXTRAPOLATION_SEC di MET la stima viene
    // sospesa per non produrre valori inventati su vuoti troppo lunghi.
    if (!p79Active || prox.lastMetSec === null || prox.lastRangeRate === null || metSec === null) return;

    const dt = metSec - prox.lastMetSec;
    if (dt <= 0) return; // MET non ancora avanzato rispetto all'ultimo campione

    if (dt > MAX_EXTRAPOLATION_SEC) {
      setLosStatus(`SEGNALE V16N54 PERSO DA TROPPO TEMPO (>${MAX_EXTRAPOLATION_SEC}s di MET) — stima sospesa, in attesa di riacquisizione`, "err-text");
      return;
    }

    const estRange = Math.max(0, prox.lastRange - prox.lastRangeRate * dt * NMI_PER_FT);
    prox.lastRange = estRange;
    prox.lastMetSec = metSec;
    setLosStatus(`SEGNALE V16N54 PERSO — range stimato dall'ultimo rateo noto (${prox.lastRangeRate.toFixed(1)} ft/s)`, "warn-text");
    addProxPoint(metSec, estRange, prox.lastRangeRate, true);
  }

  function handleTelemetry(data) {
    lastKnownMet = data.met;
    handleTrajectoryBadge(data);
    handleP79(data);
  }

  let lastKnownMet = null;

  function initDockingButton() {
    const btn = document.getElementById("ascent-docking-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const met = lastKnownMet || "--";
      setText("ascent-docking-met", met);
      if (window.logEvent) window.logEvent("RENDEZVOUS", "Docking confermato — LM agganciato al CSM", `MET=${met}`);
    });
  }

  function init() {
    // P12 (spia motore APS inclusa) è gestito dal motore generico di
    // maneuvers.js/burns-style; CSI/TPI/TPF sono gestite da rendezvous.js
    // (architettura dedicata, solo LGC, nessuna spia motore).
    initP12Monitor();
    initDockingButton();
    window.telemetryListeners.push(handleTelemetry);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
