// ==========================================================================
// LM DESCENT TELEMETRY (Mission Control) — P63 / P64 / P66
// Riconosce automaticamente il programma attivo sul DSKY dell'LGC in base
// alla coppia Verb/Noun mostrata, e traccia un profilo di discesa 2D
// (Altitudine vs Tempo) confrontato con le cue card P63/P64/P66 fornite.
//
// NOTE SUI DATI DI RIFERIMENTO:
// Le tabelle sotto sono trascritte a mano dalle cue card caricate (versione
// con TFI esteso a tutte e tre le fasi, fino al touchdown a TFI 13:30). Il
// campo "dps" qui rappresenta il RESIDUO CARBURANTE stimato (%), non il
// throttle. Il valore tra parentesi nella P64 originale (limite massimo
// -HDOT) è riportato come "hdotMax" e non è usato nel confronto principale.
// Verifica sempre con l'originale in caso di dubbio.
// ==========================================================================
(function () {
  // ---------------- TABELLE CUE CARD (tutte indicizzate per TFI, secondi) ----------------
  const P63_TABLE = [
    { tfi: 0,   h: 50000, hdot: 2.0,   vi: 5560, dps: 99.0, note: "PDI Ignition – assetto orizzontale" },
    { tfi: 26,  h: 50400, hdot: -5.0,  vi: 5460, dps: 98.0, note: "Fine ullage, motore al 100%" },
    { tfi: 30,  h: 50500, hdot: -7.0,  vi: 5420, dps: 97.4, note: "Inizio spinta a pieno regime" },
    { tfi: 60,  h: 51000, hdot: -15.0, vi: 5350, dps: 93.1, note: "Lieve lofting, dissipazione VI" },
    { tfi: 90,  h: 51300, hdot: -7.0,  vi: 5180, dps: 88.9, note: "Ritorno graduale verso l'orizzontale" },
    { tfi: 120, h: 51500, hdot: 0.0,   vi: 5000, dps: 84.6, note: "Apogeo locale superato, inizia la discesa" },
    { tfi: 150, h: 50300, hdot: 18.0,  vi: 4780, dps: 80.3, note: "Rateo di discesa in aumento" },
    { tfi: 180, h: 48500, hdot: 35.0,  vi: 4550, dps: 76.0, note: "Acquisizione RADAR live" },
    { tfi: 210, h: 45500, hdot: 53.0,  vi: 4250, dps: 71.7, note: "Traiettoria nominale stabilizzata" },
    { tfi: 240, h: 42000, hdot: 70.0,  vi: 3950, dps: 67.4, note: "Discesa costante in affondata" },
    { tfi: 270, h: 38000, hdot: 83.0,  vi: 3600, dps: 63.1, note: "Fase centrale del burn di frenata" },
    { tfi: 300, h: 33500, hdot: 95.0,  vi: 3250, dps: 58.9, note: "Inizio Pitch-Up progressivo" },
    { tfi: 330, h: 29500, hdot: 93.0,  vi: 2850, dps: 54.6, note: "Riduzione graduale velocità orizzontale" },
    { tfi: 360, h: 25500, hdot: 90.0,  vi: 2450, dps: 50.3, note: "Decelerazione controllata" },
    { tfi: 390, h: 23500, hdot: 77.0,  vi: 2120, dps: 46.0, note: "Ottimizzazione traiettoria" },
    { tfi: 420, h: 21500, hdot: 65.0,  vi: 1800, dps: 41.7, note: "Punto di flesso (visibile in telemetria)" },
    { tfi: 450, h: 18000, hdot: 83.0,  vi: 1480, dps: 37.4, note: "Preparazione approccio finale" },
    { tfi: 480, h: 14500, hdot: 100.0, vi: 1150, dps: 33.1, note: "Drop aggressivo verso High Gate" },
    { tfi: 510, h: 12000, hdot: 93.0,  vi: 900,  dps: 28.9, note: "Frenata finale pre-visiva" },
    { tfi: 540, h: 9500,  hdot: 85.0,  vi: 650,  dps: 24.6, note: "Controllo manuale pronto per backup" },
    { tfi: 570, h: 8200,  hdot: 115.0, vi: 450,  dps: 20.3, note: "Prossimità High Gate" },
    { tfi: 585, h: 7500,  hdot: 130.0, vi: 350,  dps: 18.1, note: "HIGH GATE — il LGC passa a P64" },
  ];

  const P64_TABLE = [
    { tfi: 585, h: 7500, hdot: 130.0, dps: 18.1, hdotMax: 240.0, note: "Finestrino libero, identificazione target" },
    { tfi: 600, h: 7000, hdot: 151.0, dps: 17.8, hdotMax: 228.0, note: "Inizio discesa a pendenza costante" },
    { tfi: 630, h: 3200, hdot: 75.0,  dps: 17.3, hdotMax: 145.0, note: "Rallentamento progressivo" },
    { tfi: 660, h: 2000, hdot: 48.0,  dps: 16.7, hdotMax: 105.0, note: "Controllo manuale assetto abilitato" },
    { tfi: 690, h: 500,  hdot: 17.0,  dps: 16.2, hdotMax: 36.0,  note: "Prossimità Low Gate" },
    { tfi: 705, h: 400,  hdot: 14.0,  dps: 15.9, hdotMax: 29.0,  note: "LOW GATE — transizione manuale a P66" },
  ];

  const P66_TABLE = [
    { tfi: 705, h: 400, hdot: 14.0, dps: 15.9, note: "Ingresso in P66 — controllo ROD attivo" },
    { tfi: 720, h: 300, hdot: 12.0, dps: 15.6, note: "Annullare la velocità orizzontale" },
    { tfi: 750, h: 150, hdot: 3.0,  dps: 15.1, note: "Discesa perfettamente verticale" },
    { tfi: 780, h: 40,  hdot: 3.0,  dps: 14.5, note: "Riferimenti visivi fissi al suolo" },
    { tfi: 805, h: 5,   hdot: 1.5,  dps: 14.1, note: "LUCE DI CONTATTO (Contact Light)" },
    { tfi: 810, h: 0,   hdot: 0.0,  dps: 14.0, note: "TOUCHDOWN — motore OFF immediato" },
  ];

  // Curva di riferimento: ora tutte e tre le cue card hanno il TFI, quindi
  // basta concatenarle (i punti di giunzione P63→P64→P66 coincidono).
  function buildReferenceCurve() {
    const all = [...P63_TABLE, ...P64_TABLE, ...P66_TABLE];
    const pts = [];
    all.forEach((r) => {
      const last = pts[pts.length - 1];
      if (last && last.tSec === r.tfi) return; // salta il punto di giunzione duplicato
      pts.push({ tSec: r.tfi, h: r.h });
    });
    return pts;
  }
  const REFERENCE_CURVE = buildReferenceCurve();

  // Interpola (-HDOT, DPS residuo) attesi per una data altitudine, cercando
  // nella tabella combinata di tutte e tre le fasi.
  function expectedAtAltitude(h) {
    const all = [...P63_TABLE, ...P64_TABLE, ...P66_TABLE].map((r) => ({ h: r.h, hdot: r.hdot, dps: r.dps }));
    const sorted = [...all].sort((a, b) => b.h - a.h); // decrescente
    if (h >= sorted[0].h) return sorted[0];
    if (h <= sorted[sorted.length - 1].h) return sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      const hi = sorted[i], lo = sorted[i + 1];
      if (h <= hi.h && h >= lo.h) {
        const frac = (hi.h - h) / (hi.h - lo.h || 1);
        return {
          hdot: hi.hdot + (lo.hdot - hi.hdot) * frac,
          dps: hi.dps + (lo.dps - hi.dps) * frac,
        };
      }
    }
    return sorted[sorted.length - 1];
  }

  // ---------------- MODELLO CONSUMO DPS (carburante residuo, %) ----------------
  // Non c'è telemetria di throttle live nel gioco, quindi il consumo è
  // simulato con un modello continuo calibrato sui dati forniti:
  //  - 99.99% iniziale
  //  - primi 26s (~10% throttle): -1% in 26s
  //  - resto di P63 (~100% throttle): -1% ogni 7s
  //  - P64+P66: il consumo residuo rimasto dopo P63 viene "spalmato"
  //    linearmente sulla durata nominale di P64+P66 (225s da cue card) per
  //    atterrare nella finestra dichiarata 14-19% (bersaglio: 16.5%, punto
  //    medio) — è una stima calibrata, non una lettura reale.
  // Continuità garantita ai bordi P63→P64→P66 per costruzione (nessun salto).
  const DPS_START = 99.99;
  // Fattore che rallenta leggermente il consumo simulato rispetto alla prima
  // versione del modello (richiesto: il DPS deve scendere un po' più
  // lentamente). Si applica in modo uniforme sia alla fase P63 sia al taper
  // P64/P66, così la curva resta continua ai bordi.
  const DPS_RATE_FACTOR = 0.92;
  const RATE_LOW = (1 / 26) * DPS_RATE_FACTOR;   // %/s, primi 26s
  const RATE_FULL = (1 / 7) * DPS_RATE_FACTOR;   // %/s, resto di P63
  const TARGET_LANDING_DPS = 16.5; // punto medio di 14-19%
  const NOMINAL_P64_P66_DURATION = 225; // secondi (cue card: 120 + 105)

  function dpsAtEndOfP63Formula(t) {
    if (t < 26) return DPS_START - t * RATE_LOW;
    return DPS_START - 1.0 - (t - 26) * RATE_FULL;
  }

  function computeExpectedDps(tSec, p64StartTSec) {
    if (p64StartTSec === null || tSec < p64StartTSec) {
      return Math.max(0, dpsAtEndOfP63Formula(tSec));
    }
    const dpsAtP64Start = dpsAtEndOfP63Formula(p64StartTSec);
    const taperRate = ((dpsAtP64Start - TARGET_LANDING_DPS) / NOMINAL_P64_P66_DURATION) * DPS_RATE_FACTOR;
    const dps = dpsAtP64Start - taperRate * (tSec - p64StartTSec);
    return Math.max(TARGET_LANDING_DPS - 3, Math.min(dpsAtP64Start, dps));
  }

  // ---------------- PROGRAMMI (Verb/Noun -> significato registri) ----------------
  const PROGRAMS = {
    "6-61": { label: "P63 — FASE INIZIALE", r1: "TIME TO GO", r2: "TIME FROM IGNITION", r3: "CROSSRANGE DISTANCE", hasAlt: false },
    "6-62": { label: "P63 — VELOCITÀ", r1: "ABSOLUTE VELOCITY", r2: "TIG", r3: "ACCUMULATED ΔV", hasAlt: false },
    "6-63": { label: "P63/P64 — ALTITUDINE", r1: "DELTA ALTITUDE", r2: "ALTITUDE RATE (-HDOT)", r3: "COMPUTED ALTITUDE (H)", hasAlt: true },
    "6-64": { label: "P64 — LPD", r1: "LPD ANGLE", r2: "ALTITUDE RATE (-HDOT)", r3: "COMPUTED ALTITUDE (H)", hasAlt: true },
    "6-60": { label: "P66 — RATE OF DESCENT", r1: "FORWARD VELOCITY", r2: "ALTITUDE RATE", r3: "COMPUTED ALTITUDE", hasAlt: true },
  };

  // ---------------- STATO ----------------
  const state = {
    active: false,
    startTs: null,
    dataPoints: [], // {tSec, h, hdot}
    radarOnTSec: null,
    p64StartTSec: null,
    p66StartTSec: null,
    contactTSec: null,
    contactLit: false,
    lastProgramKey: null,
    pdiStartMet: null,
    contactMet: null,
  };
  window.__descentState = state;

  function fmtMMSS(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  // ---------------- CRONOMETRO REALE (1s reale = 1s mostrato) ----------------
  // Il cronometro NON viene più aggiornato solo quando arriva un nuovo
  // pacchetto di telemetria (il cui ritmo dipende dal polling lato client,
  // non garantito perfettamente regolare), ma da un proprio intervallo
  // indipendente. Il valore resta comunque calcolato come vero delta in ms
  // da performance.now(), quindi è sempre accurato al secondo reale anche
  // se il tick grafico è più frequente.
  let stopwatchTimer = null;
  function startStopwatchTicker() {
    stopStopwatchTicker();
    stopwatchTimer = setInterval(() => {
      if (!state.active || state.startTs === null) return;
      const tSec = (performance.now() - state.startTs) / 1000;
      setText("descent-stopwatch", fmtMMSS(tSec));
    }, 200);
  }
  function stopStopwatchTicker() {
    if (stopwatchTimer !== null) { clearInterval(stopwatchTimer); stopwatchTimer = null; }
  }

  function parseAltRegister(regString) {
    // Altitudine (R3): registro a 5 cifre, valore intero in piedi.
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * parseInt(digits, 10);
  }

  function parseHdotRegister(regString) {
    // -HDOT (R2): come tutti i registri DSKY qui, arriva come 5 cifre più
    // segno SENZA punto decimale (es. "-00910"), ma l'ultima cifra è in
    // realtà un decimale: "-00910" = -91.0 ft/s, non -910 ft/s. Senza questa
    // divisione per 10 il rateo di discesa mostrato risultava 10 volte più
    // alto di quello reale.
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return (sign * parseInt(digits, 10)) / 10;
  }

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  function resetState() {
    state.active = false;
    stopStopwatchTicker();
    state.startTs = null;
    state.dataPoints = [];
    state.radarOnTSec = null;
    state.p64StartTSec = null;
    state.p66StartTSec = null;
    state.contactTSec = null;
    state.contactLit = false;
    state.lastProgramKey = null;
    state.pdiStartMet = null;
    state.contactMet = null;
    setText("descent-program", "IN ATTESA DI P63 (V06N63)");
    setText("descent-stopwatch", "00:00");
    setText("descent-pdi-met", "--"); setText("descent-contact-met", "--");
    setText("descent-r1-label", "—"); setText("descent-r1-val", "--");
    setText("descent-r2-label", "—"); setText("descent-r2-val", "--");
    setText("descent-r3-label", "—"); setText("descent-r3-val", "--");
    setText("descent-cmp-h", "--"); setText("descent-cmp-hdot", "--");
    setText("descent-cmp-hdot-exp", "--"); setText("descent-cmp-delta", "--");
    setText("descent-cmp-dps-exp", "--");
    const light = document.getElementById("descent-contact-light");
    if (light) light.classList.remove("on");
    const radarBtn = document.getElementById("descent-radar-btn");
    if (radarBtn) { radarBtn.disabled = false; radarBtn.classList.remove("active"); }
    drawChart();
  }

  // ---------------- GESTIONE TELEMETRIA ----------------
  function handleTelemetry(data) {
    lastKnownMet = data.met;
    const lgc = data.lgc;
    if (!lgc) return;

    const verb = parseInt(lgc.verb, 10);
    const noun = parseInt(lgc.noun, 10);
    const key = `${verb}-${noun}`;
    const prog = PROGRAMS[key];

    if (!prog) {
      if (state.lastProgramKey !== null) setText("descent-program", "NESSUN PROGRAMMA P63/P64/P66 RICONOSCIUTO SUL DSKY LGC");
      state.lastProgramKey = null;
      return;
    }
    state.lastProgramKey = key;

    setText("descent-program", prog.label);
    setText("descent-r1-label", prog.r1); setText("descent-r1-val", lgc.registers[0]);
    setText("descent-r2-label", prog.r2); setText("descent-r2-val", lgc.registers[1]);
    setText("descent-r3-label", prog.r3); setText("descent-r3-val", lgc.registers[2]);

    if (!prog.hasAlt) return; // N61/N62: nessun dato di altitudine da tracciare

    const hVal = parseAltRegister(lgc.registers[2]);
    // Il DSKY di questo simulatore mostra -HDOT negativo in discesa, mentre
    // la cue card usa la convenzione positiva — invertiamo il segno per
    // confrontare i due valori nella stessa convenzione (vedi
    // parseHdotRegister per la scala corretta del registro).
    const hdotVal = -parseHdotRegister(lgc.registers[1]);
    if (isNaN(hVal)) return;

    // Avvio automatico al primo V06N63
    if (noun === 63 && !state.active && !state.contactLit) {
      state.active = true;
      state.startTs = performance.now();
      state.dataPoints = [];
      state.pdiStartMet = data.met;
      setText("descent-pdi-met", data.met);
      if (window.logEvent) window.logEvent("DISCESA", "Inizio PDI — V06N63 rilevato", `MET=${data.met}`);
      const radarBtn = document.getElementById("descent-radar-btn");
      if (radarBtn) { radarBtn.disabled = false; radarBtn.classList.remove("active"); }
      startStopwatchTicker();
    }
    if (!state.active) return;

    const tSec = (performance.now() - state.startTs) / 1000;

    if (noun === 64 && state.p64StartTSec === null) { state.p64StartTSec = tSec; if (window.logEvent) window.logEvent("DISCESA", "P64 avviato (V06N64) — fase LPD", `MET=${data.met}`); }
    if (noun === 60 && state.p66StartTSec === null) { state.p66StartTSec = tSec; if (window.logEvent) window.logEvent("DISCESA", "P66 avviato (V06N60) — Rate of Descent", `MET=${data.met}`); }

    state.dataPoints.push({ tSec, h: hVal, hdot: hdotVal });
    if (state.dataPoints.length > 2000) state.dataPoints.shift();

    setText("descent-stopwatch", fmtMMSS(tSec));

    // pannello di confronto
    const exp = expectedAtAltitude(hVal);
    setText("descent-cmp-h", `${hVal.toFixed(0)} ft`);
    setText("descent-cmp-hdot", `${hdotVal.toFixed(1)} ft/s`);
    setText("descent-cmp-hdot-exp", `${exp.hdot.toFixed(1)} ft/s`);
    setText("descent-cmp-dps-exp", `${computeExpectedDps(tSec, state.p64StartTSec).toFixed(1)} %`);
    const delta = hdotVal - exp.hdot;
    const deltaEl = document.getElementById("descent-cmp-delta");
    if (deltaEl) {
      deltaEl.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ft/s`;
      deltaEl.className = "big orbit-info-val " + (Math.abs(delta) > 15 ? "err-text" : "");
    }

    // Contact Light: R3 (computed altitude) < 50 ft
    if (!state.contactLit && hVal < 50) {
      state.contactLit = true;
      state.contactTSec = tSec;
      state.contactMet = data.met;
      setText("descent-contact-met", data.met);
      state.active = false; // ferma il cronometro / la raccolta dati
      stopStopwatchTicker();
      const light = document.getElementById("descent-contact-light");
      if (light) light.classList.add("on");
      setText("descent-program", "CONTACT LIGHT — TOUCHDOWN");
      if (window.logEvent) window.logEvent("DISCESA", "Contact Light — Touchdown", `MET=${data.met}, H=${hVal.toFixed(0)}ft`);
    }

    drawChart();
  }

  function markRadarOn() {
    if (!state.active || state.radarOnTSec !== null) return;
    state.radarOnTSec = (performance.now() - state.startTs) / 1000;
    const radarBtn = document.getElementById("descent-radar-btn");
    if (radarBtn) { radarBtn.disabled = true; radarBtn.classList.add("active"); }
    if (window.logEvent) window.logEvent("DISCESA", "Landing Radar ON (V57E inserito manualmente)", `T+${state.radarOnTSec.toFixed(0)}s dal PDI`);
    drawChart();
  }

  // ---------------- GRAFICO 2D ----------------
  const svgNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function drawChart() {
    const svg = document.getElementById("descent-svg");
    if (!svg) return;
    svg.innerHTML = "";
    const W = 640, H = 380, ML = 60, MR = 16, MT = 16, MB = 34;
    const plotW = W - ML - MR, plotH = H - MT - MB;

    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#010302" }));

    const maxT = Math.max(500, ...REFERENCE_CURVE.map((p) => p.tSec), ...state.dataPoints.map((p) => p.tSec)) * 1.05;
    const maxH = 52000;

    function X(t) { return ML + (t / maxT) * plotW; }
    function Y(h) { return MT + plotH - (h / maxH) * plotH; }

    // assi
    for (let h = 0; h <= maxH; h += 10000) {
      const y = Y(h);
      svg.appendChild(el("line", { x1: ML, y1: y, x2: W - MR, y2: y, stroke: "#1b1d20", "stroke-width": 1 }));
      const t = el("text", { x: ML - 6, y: y + 3, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
      t.textContent = h.toLocaleString("it-IT");
      svg.appendChild(t);
    }
    for (let t = 0; t <= maxT; t += 60) {
      const x = X(t);
      svg.appendChild(el("line", { x1: x, y1: MT, x2: x, y2: MT + plotH, stroke: "#1b1d20", "stroke-width": 1 }));
      const lbl = el("text", { x, y: H - MB + 14, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "middle" });
      lbl.textContent = fmtMMSS(t);
      svg.appendChild(lbl);
    }

    // curva di riferimento (cue card, tratteggiata)
    const refPath = REFERENCE_CURVE.map((p, i) => `${i === 0 ? "M" : "L"} ${X(p.tSec).toFixed(1)} ${Y(p.h).toFixed(1)}`).join(" ");
    svg.appendChild(el("path", { d: refPath, fill: "none", stroke: "#ffab24", "stroke-width": 1.5, "stroke-dasharray": "5 4", opacity: 0.8 }));

    // curva live
    if (state.dataPoints.length > 1) {
      const livePath = state.dataPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${X(p.tSec).toFixed(1)} ${Y(Math.max(0, p.h)).toFixed(1)}`).join(" ");
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
    marker(state.radarOnTSec, "#3d8bff", "RADAR");
    marker(state.p64StartTSec, "#ff9de2", "P64");
    marker(state.p66StartTSec, "#c792ff", "P66");
    marker(state.contactTSec, "#ff4d3d", "CONTACT");

    // legenda
    const legend = el("text", { x: W - MR, y: 14, fill: "#6c7076", "font-family": "Consolas", "font-size": 9, "text-anchor": "end" });
    legend.textContent = "— live   ---- cue card (stimata da TFI a valle di P64)";
    svg.appendChild(legend);
  }

  // ---------------- INIT ----------------
  let lastKnownMet = null;

  function initUndockingButton() {
    const btn = document.getElementById("descent-undocking-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const met = lastKnownMet || "--";
      setText("descent-undocking-met", met);
      if (window.logEvent) window.logEvent("DISCESA", "Undocking confermato — LM sganciato dal CSM", `MET=${met}`);
    });
  }

  function init() {
    document.getElementById("descent-radar-btn").addEventListener("click", markRadarOn);
    document.getElementById("descent-reset-btn").addEventListener("click", resetState);
    initUndockingButton();
    window.telemetryListeners.push(handleTelemetry);
    resetState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
