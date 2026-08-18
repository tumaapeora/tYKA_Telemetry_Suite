// ==========================================================================
// RIENTRO ATMOSFERICO (Mission Control) — Serie P61-P67 (solo AGC)
// Riconosce automaticamente il programma attivo sul DSKY del CM in base alla
// coppia Verb/Noun mostrata, cattura i dati di predizione del P61 (bersaglio
// di splashdown, G max, EMS), traccia la separazione CM/SM (P62) e disegna
// un profilo live G-load/Tempo dall'inizio del P63 (V06N64) fino al termine
// della guida in P67. In P67 il monitoraggio di guida (bank/crossrange/
// downrange) resta su V06N66 non lampeggiante, mentre il display finale di
// posizione è su V16N67 lampeggiante (richiesta di PROCEED per il
// dispiegamento dei paracadute drogue) — NON V06N67. Sono inoltre
// riconosciuti i tre display manuali richiamabili in P67 (V16N64E, V16N68E,
// V16N74E).
//
// NOTE SULLA SCALA DEI REGISTRI:
// Come per gli altri pannelli (vedi descent.js/orbit.js/maneuvers.js), i
// registri arrivano come 5 cifre + segno SENZA punto decimale. Per i campi
// "grandi" (angoli, nmi) si usa la convenzione ÷10 già adottata altrove
// (V82E, ΔV, gimbal). Per l'accelerazione G (che deve discriminare la soglia
// 0.05G) e per Latitudine/Longitudine si usa invece ÷100 — calibrato da
// riscontro diretto (es. "00650" = 6.50G, "03140"/"−03648" = 31.40°/-36.48°):
// se in futuro un campo dovesse risultare ancora fuori scala, verifica
// sempre con il DSKY reale ed eventualmente correggi qui.
// ==========================================================================
(function () {
  // ---------------- PROGRAMMI (Verb/Noun -> significato registri) ----------------
  const PROGRAMS = {
    // P61 — Entry Preparation
    "6-61": { label: "P61 — PUNTO DI IMPATTO PREVISTO", r1: "LATITUDINE SPLASHDOWN", r2: "LONGITUDINE SPLASHDOWN", r3: "CODICE ROLL (+1 HEADS UP / -1 HEADS DOWN)", kind: "n61" },
    "6-60": { label: "P61 — PREDIZIONE DINAMICA DI RIENTRO", r1: "G MAX PREVISTO", r2: "V PREDICTED (EI, 400000 FT)", r3: "GAMMA EI", kind: "n60" },
    "6-63": { label: "P61 — DATI EMS (BACKUP MANUALE)", r1: "RTOGO", r2: "VIO", r3: "TFE", kind: "n63" },
    // P62 — CM/SM Separation
    "50-25": { label: "P62 — RICHIESTA SEPARAZIONE CM/SM (PROCEED PER CONFERMARE)", r1: "CODICE", r2: "—", r3: "—", kind: "sep" },
    "6-22": { label: "P62 — ASSETTO DI RIENTRO (GIMBAL)", r1: "ROLL", r2: "PITCH", r3: "YAW", kind: "n22" },
    // P63 — Entry Initialization (attesa 0.05G)
    "6-64": { label: "P63 — MONITORAGGIO ATMOSFERICO INIZIALE", r1: "DRAG ACCELERATION (G)", r2: "VELOCITÀ INERZIALE", r3: "RANGE TO SPLASH", kind: "n64" },
    // P64 — Post 0.05G, guida attiva
    "6-74": { label: "P64 — GUIDA ATTIVA (POST 0.05G)", r1: "COMMANDED BANK ANGLE (β)", r2: "VELOCITÀ INERZIALE", r3: "DRAG ACCELERATION (G)", kind: "n74" },
    // P67 — Entry Final Phase: monitoraggio di guida continuo (non lampeggiante)
    "6-66": { label: "P67 — MONITORAGGIO ERRORI TRAIETTORIA (V06N66)", r1: "COMMANDED BANK ANGLE (β)", r2: "CROSSRANGE ERROR (+ = SUD)", r3: "DOWNRANGE ERROR (+ = OVERSHOOT)", kind: "n66" },
    // P67 — Display finale di posizione: LAMPEGGIANTE, verb 16 (non verb 06!)
    "16-67": { label: "P67 — DATI FINALI DI POSIZIONE (V16N67 LAMPEGGIANTE, V < 1000 FT/S)", r1: "RANGE TO TARGET", r2: "PRESENT LATITUDE", r3: "PRESENT LONGITUDE", kind: "n67" },
    // P67 — Display manuali opzionali (richiamati dall'equipaggio con V16 NxxE)
    "16-64": { label: "P67 — DISPLAY MANUALE (V16N64E): G / VELOCITÀ / RTOGO", r1: "DECELERAZIONE (G)", r2: "VELOCITÀ INERZIALE (VI)", r3: "RTOGO", kind: "n64" },
    "16-68": { label: "P67 — DISPLAY MANUALE (V16N68E): BANK / VELOCITÀ / RATEO DISCESA", r1: "COMMANDED BANK ANGLE", r2: "VELOCITÀ INERZIALE", r3: "ALTITUDE RATE (RATEO DI DISCESA)", kind: "n68" },
    "16-74": { label: "P67 — DISPLAY MANUALE (V16N74E): BANK / VELOCITÀ / DRAG", r1: "COMMANDED BANK ANGLE (β)", r2: "VELOCITÀ INERZIALE", r3: "DRAG ACCELERATION (G)", kind: "n74" },
  };

  // ---------------- PARSING REGISTRI ----------------
  function parseRegRaw(regString) {
    // Intero grezzo, nessuna scala (es. codice roll, velocità in ft/s).
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * parseInt(digits, 10);
  }

  function parseRegDec10(regString) {
    // ÷10: angoli (gimbal, bank angle, gamma), range in nmi (RTOGO,
    // crossrange/downrange, range to splash/target) — come V82E/ΔV.
    const v = parseRegRaw(regString);
    return isNaN(v) ? NaN : v / 10;
  }

  function parseRegDec100(regString) {
    // ÷100: accelerazione G e Latitudine/Longitudine (vedi nota di scala in
    // testa al file — calibrato da riscontro diretto, non solo assunto).
    const v = parseRegRaw(regString);
    return isNaN(v) ? NaN : v / 100;
  }

  function parseAgcTimeRegister(regString) {
    // Formato MMSS (es. "+00615" -> 6 min 15 s), come TFE/TFI altrove.
    if (!regString) return 0;
    const trimmed = regString.replace(/\s+/g, "");
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return 0;
    if (digits.length >= 4) {
      const sec = parseInt(digits.slice(-2), 10) || 0;
      const min = parseInt(digits.slice(0, 2), 10) || 0;
      return min * 60 + sec;
    }
    return parseInt(digits, 10) || 0;
  }

  function fmtMMSS(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  // ---------------- STATO ----------------
  const state = {
    lastProgramKey: null,
    // dati di predizione P61, catturati una sola volta e conservati come
    // riferimento per il resto del rientro (le pagine N61/N60/N63 spariscono
    // dopo la separazione)
    predicted: { lat: null, lon: null, rollCode: null, gMax: null, vPred: null, gammaEI: null, rtogo: null, vio: null, tfeSec: null },
    // separazione CM/SM
    sepPending: false,
    sepConfirmedMet: null,
    // profilo live G/Tempo, dall'inizio del P63 (V06N64)
    active: false,
    startTs: null,
    entryMet: null,
    dataPoints: [], // {tSec, g, v}
    p64StartTSec: null,
    p67StartTSec: null,
    guidanceEndedTSec: null,
    guidanceEndedMet: null,
    drogueLogged: false,
  };
  window.__reentryState = state;

  // ---------------- CRONOMETRO ----------------
  let stopwatchTimer = null;
  function startStopwatchTicker() {
    stopStopwatchTicker();
    stopwatchTimer = setInterval(() => {
      if (!state.active || state.startTs === null) return;
      const tSec = (performance.now() - state.startTs) / 1000;
      setText("reentry-stopwatch", fmtMMSS(tSec));
    }, 200);
  }
  function stopStopwatchTicker() {
    if (stopwatchTimer !== null) { clearInterval(stopwatchTimer); stopwatchTimer = null; }
  }

  function resetState() {
    state.lastProgramKey = null;
    state.predicted = { lat: null, lon: null, rollCode: null, gMax: null, vPred: null, gammaEI: null, rtogo: null, vio: null, tfeSec: null };
    state.sepPending = false;
    state.sepConfirmedMet = null;
    state.active = false;
    stopStopwatchTicker();
    state.startTs = null;
    state.entryMet = null;
    state.dataPoints = [];
    state.p64StartTSec = null;
    state.p67StartTSec = null;
    state.guidanceEndedTSec = null;
    state.guidanceEndedMet = null;
    state.drogueLogged = false;

    setText("reentry-program", "IN ATTESA DI UN PROGRAMMA P61-P67 SUL DSKY AGC");
    setText("reentry-stopwatch", "00:00");
    setText("reentry-entry-met", "--");
    setText("reentry-final-met", "--");
    setText("reentry-r1-label", "—"); setText("reentry-r1-val", "--");
    setText("reentry-r2-label", "—"); setText("reentry-r2-val", "--");
    setText("reentry-r3-label", "—"); setText("reentry-r3-val", "--");

    setText("reentry-pred-lat", "--"); setText("reentry-pred-lon", "--"); setText("reentry-pred-roll", "--");
    setText("reentry-pred-gmax", "--"); setText("reentry-pred-vpred", "--"); setText("reentry-pred-gamma", "--");
    setText("reentry-pred-rtogo", "--"); setText("reentry-pred-vio", "--"); setText("reentry-pred-tfe", "--");

    setText("reentry-cmp-g", "--"); setText("reentry-cmp-gmax-exp", "--"); setText("reentry-cmp-v", "--");

    const sepLight = document.getElementById("reentry-sep-light");
    if (sepLight) sepLight.classList.remove("on");
    const drogueLight = document.getElementById("reentry-drogue-light");
    if (drogueLight) drogueLight.classList.remove("on");
    const drogueBtn = document.getElementById("reentry-drogue-btn");
    if (drogueBtn) drogueBtn.disabled = true;

    drawChart();
  }

  // ---------------- GESTIONE TELEMETRIA ----------------
  function handleTelemetry(data) {
    const agc = data.agc;
    if (!agc) return;

    const verb = parseInt(agc.verb, 10);
    const noun = parseInt(agc.noun, 10);
    const key = `${verb}-${noun}`;
    let prog = PROGRAMS[key];

    // V50N25 non è esclusivo del P62: lo stesso Verb/Noun compare anche nel
    // P40 (durante il burn SPS), dove R1 mostra "+00204" lampeggiante invece
    // di "+00041". Solo il codice 00041 è davvero la richiesta di
    // separazione CM/SM del P62: se il registro è diverso, non è il nostro
    // programma e va ignorato (niente etichetta P62, niente evento in log).
    if (prog && key === "50-25") {
      const sepCode = parseRegRaw(agc.registers[0]);
      if (sepCode !== 41) {
        prog = null;
      }
    }

    if (!prog) {
      if (state.lastProgramKey !== null) setText("reentry-program", "NESSUN PROGRAMMA P61-P67 RICONOSCIUTO SUL DSKY AGC");
      state.lastProgramKey = key === state.lastProgramKey ? state.lastProgramKey : null;
      return;
    }

    const isNewProgram = state.lastProgramKey !== key;
    state.lastProgramKey = key;

    setText("reentry-program", prog.label);
    setText("reentry-r1-label", prog.r1); setText("reentry-r1-val", agc.registers[0]);
    setText("reentry-r2-label", prog.r2); setText("reentry-r2-val", agc.registers[1]);
    setText("reentry-r3-label", prog.r3); setText("reentry-r3-val", agc.registers[2]);

    switch (prog.kind) {
      case "n61": {
        state.predicted.lat = parseRegDec100(agc.registers[0]);
        state.predicted.lon = parseRegDec100(agc.registers[1]);
        state.predicted.rollCode = parseRegRaw(agc.registers[2]);
        setText("reentry-pred-lat", isNaN(state.predicted.lat) ? "--" : `${state.predicted.lat.toFixed(2)}°`);
        setText("reentry-pred-lon", isNaN(state.predicted.lon) ? "--" : `${state.predicted.lon.toFixed(2)}°`);
        setText("reentry-pred-roll", isNaN(state.predicted.rollCode) ? "--" : (state.predicted.rollCode >= 0 ? "+1 (HEADS UP)" : "-1 (HEADS DOWN)"));
        if (isNewProgram && window.logEvent) window.logEvent("RIENTRO", "P61 — bersaglio di splashdown ricevuto (V06N61)", `MET=${data.met}`);
        break;
      }
      case "n60": {
        state.predicted.gMax = parseRegDec100(agc.registers[0]);
        state.predicted.vPred = parseRegRaw(agc.registers[1]);
        state.predicted.gammaEI = parseRegDec10(agc.registers[2]);
        setText("reentry-pred-gmax", isNaN(state.predicted.gMax) ? "--" : `${state.predicted.gMax.toFixed(2)} G`);
        setText("reentry-pred-vpred", isNaN(state.predicted.vPred) ? "--" : `${state.predicted.vPred.toLocaleString("it-IT")} ft/s`);
        setText("reentry-pred-gamma", isNaN(state.predicted.gammaEI) ? "--" : `${state.predicted.gammaEI.toFixed(1)}°`);
        if (isNewProgram && window.logEvent) window.logEvent("RIENTRO", "P61 — predizione dinamica ricevuta (V06N60, dopo PROCEED)", `MET=${data.met}, G MAX=${isNaN(state.predicted.gMax) ? "?" : state.predicted.gMax.toFixed(2)}`);
        break;
      }
      case "n63": {
        state.predicted.rtogo = parseRegDec10(agc.registers[0]);
        state.predicted.vio = parseRegRaw(agc.registers[1]);
        state.predicted.tfeSec = parseAgcTimeRegister(agc.registers[2]);
        setText("reentry-pred-rtogo", isNaN(state.predicted.rtogo) ? "--" : `${state.predicted.rtogo.toFixed(1)} nmi`);
        setText("reentry-pred-vio", isNaN(state.predicted.vio) ? "--" : `${state.predicted.vio.toLocaleString("it-IT")} ft/s`);
        setText("reentry-pred-tfe", fmtMMSS(state.predicted.tfeSec));
        if (isNewProgram && window.logEvent) window.logEvent("RIENTRO", "P61 — dati EMS di backup ricevuti (V06N63)", `MET=${data.met}`);
        break;
      }
      case "sep": {
        if (!state.sepPending) {
          state.sepPending = true;
          const sepLight = document.getElementById("reentry-sep-light");
          if (sepLight) sepLight.classList.add("on");
          if (window.logEvent) window.logEvent("RIENTRO", "P62 — richiesta separazione CM/SM (V50N25, 00041 lampeggiante)", `MET=${data.met}`);
        }
        break;
      }
      case "n22": {
        // uscita dallo stato "separazione in attesa" non appena il DSKY passa
        // all'assetto di rientro: significa che PROCEED è stato premuto.
        if (state.sepPending) {
          state.sepPending = false;
          state.sepConfirmedMet = data.met;
          const sepLight = document.getElementById("reentry-sep-light");
          if (sepLight) sepLight.classList.remove("on");
          if (window.logEvent) window.logEvent("RIENTRO", "P62 — separazione CM/SM confermata", `MET=${data.met}`);
        }
        break;
      }
      case "n64": {
        // Avvio automatico del profilo live SOLO al primo V06N64 (inizio
        // P63 vero e proprio). Se lo stesso N64 viene invece richiamato
        // manualmente in V16 durante il P67 ("16-64"), non è un nuovo
        // inizio P63: si registra comunque il campione ma non si riavvia
        // il cronometro né si duplica l'evento di log.
        const isAutoP63Start = key === "6-64";
        if (isAutoP63Start && !state.active && state.guidanceEndedTSec === null) {
          state.active = true;
          state.startTs = performance.now();
          state.entryMet = data.met;
          state.dataPoints = [];
          setText("reentry-entry-met", data.met);
          if (window.logEvent) window.logEvent("RIENTRO", "P63 avviato — inizio monitoraggio atmosferico (V06N64)", `MET=${data.met}`);
          startStopwatchTicker();
        }
        recordSample("n64", agc);
        break;
      }
      case "n74": {
        const isAutoP64Start = key === "6-74";
        if (isAutoP64Start && isNewProgram && state.p64StartTSec === null && state.active) {
          state.p64StartTSec = (performance.now() - state.startTs) / 1000;
          if (window.logEvent) window.logEvent("RIENTRO", "P64 avviato — guida attiva post 0.05G (V06N74)", `MET=${data.met}`);
        }
        recordSample("n74", agc);
        break;
      }
      case "n66": {
        if (isNewProgram && state.p67StartTSec === null && state.active) {
          state.p67StartTSec = (performance.now() - state.startTs) / 1000;
          if (window.logEvent) window.logEvent("RIENTRO", "P67 avviato — fase finale, monitoraggio errori (V06N66)", `MET=${data.met}`);
        }
        break;
      }
      case "n68": {
        // Display manuale opzionale (V16N68E): solo informativo, nessun
        // effetto sullo stato/grafico.
        if (isNewProgram && window.logEvent) window.logEvent("RIENTRO", "P67 — display manuale richiamato (V16N68E: bank/velocità/rateo discesa)", `MET=${data.met}`);
        break;
      }
      case "n67": {
        if (state.active) {
          state.active = false;
          stopStopwatchTicker();
          state.guidanceEndedTSec = (performance.now() - state.startTs) / 1000;
          state.guidanceEndedMet = data.met;
          setText("reentry-final-met", data.met);
          setText("reentry-program", "GUIDA TERMINATA (V < 1000 FT/S) — SC CONTROL SU SCS, PROCEED PER DROGUE");
          const drogueBtn = document.getElementById("reentry-drogue-btn");
          if (drogueBtn) drogueBtn.disabled = false;
          if (window.logEvent) window.logEvent("RIENTRO", "P67 — guida terminata, dati finali (V16N67 lampeggiante)", `MET=${data.met}`);
        }
        drawChart();
        break;
      }
    }
  }

  function recordSample(kind, agc) {
    if (!state.active) return;
    const tSec = (performance.now() - state.startTs) / 1000;
    // N64 (P63 / display manuale V16N64E): G in R1. N74 (P64 / display
    // manuale V16N74E): G in R3. In entrambi, la velocità inerziale è
    // sempre in R2.
    if (kind !== "n64" && kind !== "n74") return;
    const gVal = parseRegDec100(kind === "n64" ? agc.registers[0] : agc.registers[2]);
    const vVal = parseRegRaw(agc.registers[1]);

    if (!isNaN(gVal)) {
      state.dataPoints.push({ tSec, g: gVal, v: vVal });
      if (state.dataPoints.length > 3000) state.dataPoints.shift();

      setText("reentry-cmp-g", `${gVal.toFixed(2)} G`);
      setText("reentry-cmp-gmax-exp", state.predicted.gMax === null || isNaN(state.predicted.gMax) ? "--" : `${state.predicted.gMax.toFixed(2)} G`);
      setText("reentry-cmp-v", isNaN(vVal) ? "--" : `${vVal.toLocaleString("it-IT")} ft/s`);
    }
    drawChart();
  }

  function markDrogueDeploy() {
    if (state.drogueLogged) return;
    state.drogueLogged = true;
    const light = document.getElementById("reentry-drogue-light");
    if (light) light.classList.add("on");
    const drogueBtn = document.getElementById("reentry-drogue-btn");
    if (drogueBtn) drogueBtn.disabled = true;
    if (window.logEvent) window.logEvent("RIENTRO", "PROCEED premuto — dispiegamento paracadute drogue autorizzato (SC CONTROL su SCS)", `T+${state.guidanceEndedTSec === null ? "?" : state.guidanceEndedTSec.toFixed(0)}s dall'EI`);
  }

  // ---------------- GRAFICO 2D (G-load / Tempo) ----------------
  const svgNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function drawChart() {
    const svg = document.getElementById("reentry-svg");
    if (!svg) return;
    svg.innerHTML = "";
    const W = 640, H = 380, ML = 46, MR = 16, MT = 16, MB = 34;
    const plotW = W - ML - MR, plotH = H - MT - MB;

    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#010302" }));

    const maxT = Math.max(120, ...state.dataPoints.map((p) => p.tSec)) * 1.05;
    const maxG = Math.max(2, state.predicted.gMax || 0, ...state.dataPoints.map((p) => p.g)) * 1.15;

    function X(t) { return ML + (t / maxT) * plotW; }
    function Y(g) { return MT + plotH - (g / maxG) * plotH; }

    // assi
    const gStep = maxG > 6 ? 1 : 0.5;
    for (let g = 0; g <= maxG; g += gStep) {
      const y = Y(g);
      svg.appendChild(el("line", { x1: ML, y1: y, x2: W - MR, y2: y, stroke: "#1b1d20", "stroke-width": 1 }));
      const t = el("text", { x: ML - 6, y: y + 3, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
      t.textContent = g.toFixed(1);
      svg.appendChild(t);
    }
    const tStep = maxT > 600 ? 120 : 60;
    for (let t = 0; t <= maxT; t += tStep) {
      const x = X(t);
      svg.appendChild(el("line", { x1: x, y1: MT, x2: x, y2: MT + plotH, stroke: "#1b1d20", "stroke-width": 1 }));
      const lbl = el("text", { x, y: H - MB + 14, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "middle" });
      lbl.textContent = fmtMMSS(t);
      svg.appendChild(lbl);
    }

    // linea di riferimento G MAX previsto (P61, N60)
    if (state.predicted.gMax !== null && !isNaN(state.predicted.gMax)) {
      const y = Y(state.predicted.gMax);
      svg.appendChild(el("line", { x1: ML, y1: y, x2: W - MR, y2: y, stroke: "#ffab24", "stroke-width": 1.5, "stroke-dasharray": "5 4", opacity: 0.8 }));
      const lbl = el("text", { x: W - MR, y: y - 4, fill: "#ffab24", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
      lbl.textContent = `G MAX PREVISTO (${state.predicted.gMax.toFixed(2)}G)`;
      svg.appendChild(lbl);
    }

    // curva live G(t)
    if (state.dataPoints.length > 1) {
      const livePath = state.dataPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${X(p.tSec).toFixed(1)} ${Y(Math.max(0, p.g)).toFixed(1)}`).join(" ");
      svg.appendChild(el("path", { d: livePath, fill: "none", stroke: "#20ff8a", "stroke-width": 2 }));
    }

    // marker verticali
    function marker(tSec, color, label) {
      if (tSec === null) return;
      const x = X(tSec);
      svg.appendChild(el("line", { x1: x, y1: MT, x2: x, y2: MT + plotH, stroke: color, "stroke-width": 1.2, "stroke-dasharray": "2 2" }));
      const t = el("text", { x, y: MT + 10, fill: color, "font-family": "Consolas", "font-size": 9, "text-anchor": "middle" });
      t.textContent = label;
      svg.appendChild(t);
    }
    marker(0, "#3d8bff", "EI / P63");
    marker(state.p64StartTSec, "#ff9de2", "P64");
    marker(state.p67StartTSec, "#c792ff", "P67");
    marker(state.guidanceEndedTSec, "#ff4d3d", "V<1000");

    const legend = el("text", { x: W - MR, y: H - 6, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
    legend.textContent = "— G-load live   ---- G max previsto (P61/N60)";
    svg.appendChild(legend);
  }

  // ---------------- INIT ----------------
  function init() {
    const drogueBtn = document.getElementById("reentry-drogue-btn");
    if (drogueBtn) drogueBtn.addEventListener("click", markDrogueDeploy);
    const resetBtn = document.getElementById("reentry-reset-btn");
    if (resetBtn) resetBtn.addEventListener("click", resetState);
    window.telemetryListeners.push(handleTelemetry);
    resetState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
