// ==========================================================================
// ORBIT VISUALIZER (Mission Control)
// Ricostruisce orbita/e ellittiche schematiche da Apogeo/Perigeo (V82E).
// - Switch DOCKED/UNDOCKED: se agganciati, un'unica orbita (CSM+LM); se
//   sganciati, due orbite indipendenti (CSM da AGC, LM da LGC).
// - Switch TERRA/LUNA: valido in entrambi i casi, l'AGC funziona sia in
//   orbita terrestre che lunare.
// - Fase iniziale (0-360°): 0 = punto più vicino (periastro), 180 = punto
//   più lontano (apoastro).
// - Lo stato vive in variabili di modulo, quindi sopravvive alla
//   navigazione tra pagine (la pagina resta nel DOM, solo nascosta).
// ==========================================================================
(function () {
  const NMI_TO_KM = 1.852;

  const BODIES = {
    earth: { name: "TERRA", mu: 398600.4418, radius: 6378.137 },
    moon: { name: "LUNA", mu: 4902.800066, radius: 1737.4 },
  };

  const COLORS = { csm: "#20ff8a", lm: "#ffab24" };

  // ---------------- STATO PERSISTENTE (di modulo) ----------------
  const state = {
    dock: "docked", // "docked" | "undocked"
    bodyKey: "earth",
    accel: 200, // secondi simulati per secondo reale
    playing: true,
    startRealTs: null, // performance.now() dell'ultimo (ri)avvio
    accumSimSeconds: 0, // secondi simulati accumulati prima dell'ultima pausa
    orbits: { docked: null, csm: null, lm: null }, // risultati computeOrbit()
    phaseFrac: { docked: 0, csm: 0, lm: 0 }, // frazione [0,1) di fase iniziale
    lmLanded: false, // se true, l'LM (sganciato) è statico sulla superficie, non orbita
  };
  window.__orbitState = state; // utile per debug in console

  let frame = null; // {cx, cy, scale} del canvas corrente
  let rafHandle = null;

  const svgNS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function fmtDuration(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const days = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return days > 0 ? `${days}g ${hms}` : hms;
  }

  function solveKepler(M, e) {
    M = Math.atan2(Math.sin(M), Math.cos(M));
    let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
    for (let i = 0; i < 50; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-9) break;
    }
    return E;
  }

  // Un registro V82E (R1=Apogeo, R2=Perigeo) ha l'ultima cifra dopo la
  // virgola: 5 cifre totali -> XXXX.X nmi.
  function parseV82Register(regString) {
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    const intVal = parseInt(digits, 10);
    return sign * (intVal / 10);
  }
  window.__parseV82Register = parseV82Register;

  function computeOrbit(apogeeNmi, perigeeNmi, bodyKey) {
    const body = BODIES[bodyKey];
    const rApo = body.radius + apogeeNmi * NMI_TO_KM;
    const rPeri = body.radius + perigeeNmi * NMI_TO_KM;
    const a = (rApo + rPeri) / 2;
    const e = (rApo - rPeri) / (rApo + rPeri);
    const b = a * Math.sqrt(1 - e * e);
    const c = a * e;
    const T = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / body.mu);
    return { a, e, b, c, T, radius: body.radius, bodyName: body.name };
  }

  // ---------------- RENDER SVG ----------------
  function renderScene() {
    const svg = document.getElementById("orbit-svg");
    svg.innerHTML = "";
    const W = 600, H = 420, MARGIN = 40;
    const cx = W / 2, cy = H / 2;

    svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#010302" }));
    for (let i = 0; i < 40; i++) {
      svg.appendChild(el("circle", {
        cx: Math.random() * W, cy: Math.random() * H, r: Math.random() * 1.1, fill: "#2a2f33",
      }));
    }

    const showLmLanded = state.dock === "undocked" && state.lmLanded && state.orbits.lm;

    const activeOrbits = state.dock === "docked"
      ? [{ key: "docked", o: state.orbits.docked, color: "#e8e8e8", label: "CSM+LM" }]
      : [
          state.orbits.csm ? { key: "csm", o: state.orbits.csm, color: COLORS.csm, label: "CSM" } : null,
          (state.orbits.lm && !state.lmLanded) ? { key: "lm", o: state.orbits.lm, color: COLORS.lm, label: "LM" } : null,
        ].filter(Boolean);

    if (activeOrbits.length === 0 && !showLmLanded) return null;

    // scala comune: la piu' grande fra tutte le orbite/il corpo deve entrare nel canvas
    const refOrbits = activeOrbits.length ? activeOrbits : [{ o: state.orbits.lm }];
    const maxA = Math.max(...refOrbits.map((x) => x.o.a));
    const maxB = Math.max(...refOrbits.map((x) => x.o.b));
    const scale = Math.min((W / 2 - MARGIN) / maxA, (H / 2 - MARGIN) / maxB);

    // corpo centrale: raggio comune (stesso corpo per tutte le orbite attive)
    const bodyRadiusKm = refOrbits[0].o.radius;
    const bodyPxRadius = Math.max(bodyRadiusKm * scale, 7);
    svg.appendChild(el("circle", { cx, cy, r: bodyPxRadius, fill: state.bodyKey === "earth" ? "#3d8bff" : "#b8b8b8", opacity: 0.9 }));
    const bodyLabel = el("text", { x: cx, y: cy + bodyPxRadius + 14, fill: "#c7cbd1", "font-family": "Consolas", "font-size": 11, "text-anchor": "middle" });
    bodyLabel.textContent = BODIES[state.bodyKey].name;
    svg.appendChild(bodyLabel);

    if (showLmLanded) {
      // icona statica sulla superficie (punto fisso, non orbita)
      const lx = cx, ly = cy - bodyPxRadius - 8;
      svg.appendChild(el("rect", { x: lx - 5, y: ly - 5, width: 10, height: 10, fill: COLORS.lm, stroke: "#000", "stroke-width": 1 }));
      const lmLbl = el("text", { x: lx, y: ly - 10, fill: COLORS.lm, "font-family": "Consolas", "font-size": 10, "font-weight": "bold", "text-anchor": "middle" });
      lmLbl.textContent = "LM (SULLA SUPERFICIE)";
      svg.appendChild(lmLbl);
    }

    activeOrbits.forEach(({ key, o, color, label }) => {
      // Il corpo centrale (disegnato sopra, fisso in cx,cy) e' un FUOCO
      // dell'ellisse, non il suo centro geometrico: il centro dell'ellisse va
      // quindi spostato di "c" (distanza focale) dal corpo, verso l'apogeo,
      // cosi' che il vertice piu' vicino al corpo sia davvero il perigeo e
      // quello piu' lontano l'apogeo. Senza questo spostamento il corpo
      // risulterebbe sempre disegnato al centro esatto dell'ellisse, e
      // l'eccentricita' (l'indizio visivo piu' forte di un'orbita ellittica)
      // sparirebbe quasi del tutto a schermo.
      const orbitCx = cx - o.c * scale;
      svg.appendChild(el("ellipse", {
        cx: orbitCx, cy, rx: o.a * scale, ry: o.b * scale,
        fill: "none", stroke: color, "stroke-width": 1.5, "stroke-dasharray": "4 3", opacity: 0.85,
      }));
      const periX = cx + o.a * (1 - o.e) * scale; // vertice piu' vicino al corpo (fuoco in cx)
      svg.appendChild(el("circle", { cx: periX, cy: cy, r: 2.5, fill: color, opacity: 0.6 }));
      const marker = el("circle", { id: `orbit-capsule-${key}`, cx: periX, cy, r: 5, fill: "#ffffff", stroke: color, "stroke-width": 1.8 });
      svg.appendChild(marker);
      const lbl = el("text", { x: periX, y: cy - 10, fill: color, "font-family": "Consolas", "font-size": 10, "font-weight": "bold", "text-anchor": "middle" });
      lbl.textContent = label;
      svg.appendChild(lbl);
    });

    return { cx, cy, scale };
  }

  function positionMarker(key, o, phaseFrac0, simSecondsElapsed, idPrefix) {
    if (!o) return;
    const capsule = document.getElementById(`orbit-capsule-${key}`);
    const frac = (((phaseFrac0 + simSecondsElapsed / o.T) % 1) + 1) % 1;
    if (capsule && frame) {
      const M = 2 * Math.PI * frac;
      const E = solveKepler(M, o.e);
      // Posizione relativa al CENTRO dell'ellisse (formula standard a*cosE, b*sinE);
      // il centro e' spostato di -c rispetto al corpo/fuoco (vedi renderScene),
      // quindi va riapplicato lo stesso spostamento qui per restare coerenti.
      const x = -o.c + o.a * Math.cos(E);
      const y = o.b * Math.sin(E);
      capsule.setAttribute("cx", frame.cx + x * frame.scale);
      capsule.setAttribute("cy", frame.cy + y * frame.scale);
    }
    if (idPrefix) {
      const ttPeri = (1 - frac) * o.T;
      const ttApo = (frac < 0.5 ? (0.5 - frac) : (1.5 - frac)) * o.T;
      setText(`${idPrefix}-ttperi`, fmtDuration(ttPeri));
      setText(`${idPrefix}-ttapo`, fmtDuration(ttApo));
    }
    return frac * o.T;
  }

  // ---------------- ANIMAZIONE ----------------
  function currentSimSeconds() {
    if (!state.playing || state.startRealTs === null) return state.accumSimSeconds;
    const elapsedReal = (performance.now() - state.startRealTs) / 1000;
    return state.accumSimSeconds + elapsedReal * state.accel;
  }

  function animLoop() {
    const simSeconds = currentSimSeconds();

    if (state.dock === "docked" && state.orbits.docked) {
      const s = positionMarker("docked", state.orbits.docked, state.phaseFrac.docked, simSeconds, "orbit-d");
      setText("orbit-d-simtime", fmtDuration(s));
    } else {
      if (state.orbits.csm) setText("orbit-u-csm-simtime", fmtDuration(positionMarker("csm", state.orbits.csm, state.phaseFrac.csm, simSeconds, "orbit-u-csm")));
      if (state.orbits.lm && !state.lmLanded) {
        setText("orbit-u-lm-simtime", fmtDuration(positionMarker("lm", state.orbits.lm, state.phaseFrac.lm, simSeconds, "orbit-u-lm")));
      } else if (state.orbits.lm && state.lmLanded) {
        setText("orbit-u-lm-simtime", "LM SULLA SUPERFICIE");
        setText("orbit-u-lm-ttperi", "—"); setText("orbit-u-lm-ttapo", "—");
      }
    }
    rafHandle = requestAnimationFrame(animLoop);
  }

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  function ensureAnimRunning() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = requestAnimationFrame(animLoop);
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    state.startRealTs = performance.now();
    setText("orbit-play-btn", null);
    const btn = document.getElementById("orbit-play-btn");
    if (btn) btn.innerHTML = "&#9208; PAUSA";
  }

  function pause() {
    if (!state.playing) return;
    state.accumSimSeconds = currentSimSeconds();
    state.playing = false;
    state.startRealTs = null;
    const btn = document.getElementById("orbit-play-btn");
    if (btn) btn.innerHTML = "&#9654; PLAY";
  }

  // ---------------- INFO PANEL ----------------
  function updateInfo(prefix, o) {
    if (!o) return;
    setText(`${prefix}-sma`, `${o.a.toFixed(1)} km (${(o.a / NMI_TO_KM).toFixed(1)} nmi)`);
    setText(`${prefix}-ecc`, o.e.toFixed(4));
    setText(`${prefix}-period`, fmtDuration(o.T));
  }

  // ---------------- AZIONI UI ----------------
  function setStatus(msg, isErr) {
    const s = document.getElementById("orbit-status");
    if (!s) return;
    s.textContent = msg;
    s.className = "status-bar " + (isErr ? "err" : "ok");
  }

  function readPair(apoId, periId) {
    const apo = parseFloat(document.getElementById(apoId).value);
    const peri = parseFloat(document.getElementById(periId).value);
    return { apo, peri, valid: !isNaN(apo) && !isNaN(peri) && apo >= peri };
  }

  function drawFromInputs() {
    if (state.dock === "docked") {
      const { apo, peri, valid } = readPair("orbit-d-apogee", "orbit-d-perigee");
      if (!valid) { setStatus("Valori CSM+LM non validi (Apogeo ≥ Perigeo, numeri).", true); return; }
      state.orbits.docked = computeOrbit(apo, peri, state.bodyKey);
      state.phaseFrac.docked = (parseFloat(document.getElementById("orbit-d-phase").value) || 0) / 360;
      updateInfo("orbit-d", state.orbits.docked);
      setText("orbit-d-body", BODIES[state.bodyKey].name);
    } else {
      const csm = readPair("orbit-u-csm-apogee", "orbit-u-csm-perigee");
      const lm = readPair("orbit-u-lm-apogee", "orbit-u-lm-perigee");
      if (!csm.valid && !lm.valid) { setStatus("Inserisci almeno un'orbita valida (CSM o LM).", true); return; }
      if (csm.valid) {
        state.orbits.csm = computeOrbit(csm.apo, csm.peri, state.bodyKey);
        state.phaseFrac.csm = (parseFloat(document.getElementById("orbit-u-csm-phase").value) || 0) / 360;
        updateInfo("orbit-u-csm", state.orbits.csm);
      } else { state.orbits.csm = null; }
      if (lm.valid) {
        state.orbits.lm = computeOrbit(lm.apo, lm.peri, state.bodyKey);
        state.phaseFrac.lm = (parseFloat(document.getElementById("orbit-u-lm-phase").value) || 0) / 360;
        updateInfo("orbit-u-lm", state.orbits.lm);
      } else { state.orbits.lm = null; }
    }

    frame = renderScene();
    state.accumSimSeconds = 0;
    state.startRealTs = state.playing ? performance.now() : null;
    ensureAnimRunning();
    setStatus(`Orbita ricostruita — ${BODIES[state.bodyKey].name}, modalità ${state.dock === "docked" ? "AGGANCIATI" : "SGANCIATI"}.`, false);
  }

  async function fillFromTelemetry(source, apoId, periId) {
    try {
      const res = await fetch("/api/telemetry");
      const data = await res.json();
      const src = source === "agc" ? data.agc : data.lgc;
      if (!src || !src.registers || src.registers.length < 2) {
        setStatus(`Nessuna telemetria disponibile da ${source.toUpperCase()} al momento.`, true);
        return;
      }
      const apo = parseV82Register(src.registers[0]);
      const peri = parseV82Register(src.registers[1]);
      if (isNaN(apo) || isNaN(peri)) {
        setStatus("Impossibile interpretare i registri correnti come numeri.", true);
        return;
      }
      document.getElementById(apoId).value = apo.toFixed(1);
      document.getElementById(periId).value = peri.toFixed(1);
      setStatus(`Valori compilati da ${source.toUpperCase()} R1/R2 (decimale già considerato).`, false);
    } catch (e) {
      setStatus(`Errore nel leggere la telemetria: ${e}`, true);
    }
  }

  // ---------------- WIRING UI ----------------
  function switchDockUI() {
    const dockedBlock = document.getElementById("orbit-craft-docked");
    const undockedBlock = document.getElementById("orbit-craft-undocked");
    const infoDocked = document.getElementById("orbit-info-docked");
    const infoUndocked = document.getElementById("orbit-info-undocked");
    if (state.dock === "docked") {
      dockedBlock.classList.remove("hidden");
      undockedBlock.classList.add("hidden");
      infoDocked.classList.remove("hidden");
      infoUndocked.classList.add("hidden");
    } else {
      dockedBlock.classList.add("hidden");
      undockedBlock.classList.remove("hidden");
      infoDocked.classList.add("hidden");
      infoUndocked.classList.remove("hidden");
    }
  }

  function init() {
    document.querySelectorAll(".orbit-dock-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".orbit-dock-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.dock = btn.dataset.dock;
        switchDockUI();
      });
    });

    document.querySelectorAll(".orbit-body-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".orbit-body-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.bodyKey = btn.dataset.body;
      });
    });

    document.getElementById("orbit-draw-btn").addEventListener("click", drawFromInputs);
    document.getElementById("orbit-d-fill-agc-btn").addEventListener("click", () => fillFromTelemetry("agc", "orbit-d-apogee", "orbit-d-perigee"));
    document.getElementById("orbit-d-fill-lgc-btn").addEventListener("click", () => fillFromTelemetry("lgc", "orbit-d-apogee", "orbit-d-perigee"));
    document.getElementById("orbit-u-csm-fill-btn").addEventListener("click", () => fillFromTelemetry("agc", "orbit-u-csm-apogee", "orbit-u-csm-perigee"));
    document.getElementById("orbit-u-lm-fill-btn").addEventListener("click", () => fillFromTelemetry("lgc", "orbit-u-lm-apogee", "orbit-u-lm-perigee"));

    // cambi di fase: applicati immediatamente, senza dover ridisegnare la forma dell'orbita
    const phaseHandlers = [
      ["orbit-d-phase", "docked"],
      ["orbit-u-csm-phase", "csm"],
      ["orbit-u-lm-phase", "lm"],
    ];
    phaseHandlers.forEach(([id, key]) => {
      const input = document.getElementById(id);
      input.addEventListener("change", () => {
        if (!state.orbits[key]) return;
        // ricalcola l'accumulo cosi' che la nuova fase si applichi da "adesso"
        const simNow = currentSimSeconds();
        const prevFrac = (((state.phaseFrac[key] + simNow / state.orbits[key].T) % 1) + 1) % 1;
        state.phaseFrac[key] = (parseFloat(input.value) || 0) / 360;
        state.accumSimSeconds = 0;
        state.startRealTs = state.playing ? performance.now() : null;
      });
    });

    const accelInput = document.getElementById("orbit-accel");
    accelInput.addEventListener("change", () => {
      const simNow = currentSimSeconds();
      state.accumSimSeconds = simNow;
      state.startRealTs = state.playing ? performance.now() : null;
      state.accel = Math.max(0.01, parseFloat(accelInput.value) || 1);
    });

    document.getElementById("orbit-play-btn").addEventListener("click", () => {
      if (state.playing) pause(); else play();
    });

    const lmLandedBtn = document.getElementById("orbit-lm-landed-btn");
    if (lmLandedBtn) {
      lmLandedBtn.addEventListener("click", () => {
        state.lmLanded = !state.lmLanded;
        lmLandedBtn.classList.toggle("active", state.lmLanded);
        lmLandedBtn.textContent = state.lmLanded ? "LM SULLA SUPERFICIE (ATTIVO)" : "SEGNA LM SULLA SUPERFICIE LUNARE";
        frame = renderScene();
      });
    }

    switchDockUI();
    ensureAnimRunning(); // il loop gira sempre, cosi' lo stato resta sincronizzato anche prima del primo disegno
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
