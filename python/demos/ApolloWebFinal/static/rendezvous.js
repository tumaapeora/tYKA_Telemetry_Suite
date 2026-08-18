// ==========================================================================
// MANOVRE DI RENDEZVOUS — CSI / TPI / TPF (SOLO LGC)
// Architettura dedicata (diversa da TLI/LOI/TEI): qui il burn è un annullo
// di residui sui 3 assi via RCS (Translation Controller), NON un'accensione
// del motore principale — per questo qui non c'è nessuna "spia motore": la
// trovi invece sul P12 (ascent.js), unico programma della risalita che usa
// il motore APS. Qui si mostra solo lo stato della spinta RCS in corso.
//
//   Setup (P30, LGC):
//     V06N33 — TIG
//     V06N81 — ΔV previsto (X/Y/Z)
//     V06N42 — orbita stimata
//     V06N45 — countdown
//   Esecuzione (P41, LGC):
//     V50N18 — accetta automanovra
//     V16N18 — automanovra in corso
//     V16N85 — ΔV da annullare: R1=LATERALE (+destra/-sinistra),
//              R2=VERTICALE (+su/-giù), R3=ORIZZONTALE (+avanti/-indietro)
//
// Rilevamento spinta: si considera in corso finché almeno uno dei tre assi
// di V16N85 è diverso da zero; si considera completata (e si registra nel
// log) nell'istante in cui tutti e tre tornano a ±00000 — come suggerito,
// non si tenta un calcolo complesso del ΔV effettivo: la manovra è
// "riuscita" quando i tre registri del P41 sono azzerati, e come ΔV
// effettivo si riporta semplicemente la magnitudo del residuo iniziale
// annullato (indicativo, non un valore integrato nel tempo).
// ==========================================================================
(function () {
  const MANEUVERS = [
    { id: "csi", label: "CSI (P30/P41)" },
    { id: "tpi", label: "TPI (P30/P41)" },
    { id: "tpf", label: "TPF (P30/P41)" },
  ];

  function displayTable(label) {
    return {
      "30-6-33": { key: "30-6-33", label: `${label} — TIG MANOVRA (V06N33)`, r1: "ORE TIG", r2: "MINUTI TIG", r3: "SECONDI TIG", isTig: true },
      "30-6-81": { key: "30-6-81", label: `${label} — ΔV PREVISTO (V06N81)`, r1: "ΔVX", r2: "ΔVY", r3: "ΔVZ", isPlannedDv: true },
      "30-6-42": { key: "30-6-42", label: `${label} — ORBITA STIMATA (V06N42)`, r1: "APOGEO PREVISTO", r2: "PERIGEO PREVISTO", r3: "ΔV TOTALE" },
      "30-6-45": { key: "30-6-45", label: `${label} — COUNTDOWN (V06N45)`, r1: "TEMPO A TFI", r2: "—", r3: "—" },
      "41-50-18": { key: "41-50-18", label: `${label} — ACCETTA AUTOMANOVRA (V50N18)`, r1: "ROLL", r2: "PITCH", r3: "YAW" },
      "41-16-18": { key: "41-16-18", label: `${label} — AUTOMANOVRA IN CORSO (V16N18)`, r1: "ROLL", r2: "PITCH", r3: "YAW" },
      "41-16-85": { key: "41-16-85", label: `${label} — ΔV DA ANNULLARE VIA RCS (V16N85)`, r1: "LATERALE (+DESTRA / -SINISTRA)", r2: "VERTICALE (+SU / -GIÙ)", r3: "ORIZZONTALE (+AVANTI / -INDIETRO)", isResidual: true },
    };
  }

  function parseIntReg(regString) {
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * parseInt(digits, 10);
  }

  function metToSeconds(metStr) {
    if (!metStr) return null;
    const m = /^([+-])(\d+):(\d{2}):(\d{2})$/.exec(metStr.trim());
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + parseInt(m[4], 10));
  }

  function parseDvNumber(regString) {
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * (parseInt(digits, 10) / 10);
  }

  const prefix = "rdv";
  const state = {
    selectedId: MANEUVERS[0].id,
    tables: {},
    current: {},
    log: [],
  };
  MANEUVERS.forEach((m) => {
    state.tables[m.id] = displayTable(m.label);
    state.current[m.id] = blankCurrent();
  });
  window.__rendezvousState = state;

  function blankCurrent() {
    return { thrustOn: false, burnStartTs: null, dVPlanned: null, dVActual: null, cutoffDone: false, tigSec: null, residualPending: false };
  }

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  function renderLog() {
    const tbody = document.getElementById(`${prefix}-log-body`);
    if (!tbody) return;
    tbody.innerHTML = "";
    state.log.forEach((rec) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${rec.label}</td><td>${rec.met || "--"}</td>
        <td>${rec.dVPlanned !== null ? rec.dVPlanned.toFixed(1) : "--"}</td>
        <td>${rec.dVActual !== null ? rec.dVActual.toFixed(1) : "--"}</td>
        <td>${rec.durationSec !== null ? rec.durationSec.toFixed(1) : "--"}</td>`;
      tbody.appendChild(tr);
    });
  }

  function resetSelected() {
    state.current[state.selectedId] = blankCurrent();
    setText(`${prefix}-dv-planned`, "--"); setText(`${prefix}-dv-actual`, "--"); setText(`${prefix}-duration`, "--");
    setText(`${prefix}-engine-status`, "IN ATTESA");
    setText(`${prefix}-display-label`, "In attesa di dati...");
    setText(`${prefix}-r1-label`, "—"); setText(`${prefix}-r1-val`, "--");
    setText(`${prefix}-r2-label`, "—"); setText(`${prefix}-r2-val`, "--");
    setText(`${prefix}-r3-label`, "—"); setText(`${prefix}-r3-val`, "--");
  }

  function handleTelemetry(data) {
    const lgc = data.lgc; // CSI/TPI/TPF: sempre e solo LGC
    if (!lgc) return;

    const prog = lgc.prog.replace(/\s/g, "");
    const verb = parseInt(lgc.verb, 10);
    const noun = parseInt(lgc.noun, 10);
    const key = `${prog}-${verb}-${noun}`;
    const table = state.tables[state.selectedId];
    const entry = table[key];
    const cur = state.current[state.selectedId];
    const mLabel = MANEUVERS.find((m) => m.id === state.selectedId).label;

    if (!entry) {
      setText(`${prefix}-display-label`, "Nessun Noun della sequenza riconosciuto sul DSKY LGC corrente");
      return;
    }

    setText(`${prefix}-display-label`, entry.label);
    setText(`${prefix}-r1-label`, entry.r1); setText(`${prefix}-r1-val`, lgc.registers[0]);
    setText(`${prefix}-r2-label`, entry.r2); setText(`${prefix}-r2-val`, lgc.registers[1]);
    setText(`${prefix}-r3-label`, entry.r3); setText(`${prefix}-r3-val`, lgc.registers[2]);

    if (entry.isPlannedDv && cur.dVPlanned === null) {
      const x = parseDvNumber(lgc.registers[0]), y = parseDvNumber(lgc.registers[1]), z = parseDvNumber(lgc.registers[2]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        const mag = Math.sqrt(x * x + y * y + z * z);
        cur.dVPlanned = mag;
        setText(`${prefix}-dv-planned`, mag.toFixed(1));
      }
    }

    // Cattura il TIG (tempo di ignizione pianificato, in secondi di MET):
    // serve a distinguere "il residuo V16N85 è comparso ma non è ancora
    // il momento della spinta" da "la spinta è davvero in corso adesso".
    // Senza questo, il cronometro partiva troppo presto (non appena il
    // residuo diventava diverso da zero, anche prima del TIG), gonfiando
    // artificialmente la durata mostrata.
    if (entry.isTig) {
      const h = parseIntReg(lgc.registers[0]);
      const mnt = parseIntReg(lgc.registers[1]);
      const s = parseIntReg(lgc.registers[2]);
      if (!isNaN(h) && !isNaN(mnt) && !isNaN(s)) {
        cur.tigSec = h * 3600 + mnt * 60 + s;
      }
    }

    if (entry.isResidual) {
      const r1 = parseDvNumber(lgc.registers[0]);
      const r2 = parseDvNumber(lgc.registers[1]);
      const r3 = parseDvNumber(lgc.registers[2]);
      const allZero = r1 === 0 && r2 === 0 && r3 === 0;
      const metSec = metToSeconds(data.met);
      const tigReached = cur.tigSec !== null && metSec !== null && metSec >= cur.tigSec;

      cur.residualPending = !allZero && !cur.thrustOn && !cur.cutoffDone && !tigReached;

      if (!allZero && !cur.thrustOn && !cur.cutoffDone && tigReached) {
        cur.thrustOn = true;
        cur.burnStartTs = performance.now();
        cur.initialResidualMag = Math.sqrt(r1 * r1 + r2 * r2 + r3 * r3);
        if (window.logEvent) window.logEvent("RENDEZVOUS", `${mLabel}: spinta RCS IN CORSO (TIG raggiunto, residuo ΔV rilevato)`, entry.label);
      }

      if (cur.thrustOn && allZero && !cur.cutoffDone) {
        cur.thrustOn = false;
        cur.cutoffDone = true;
        const durationSec = cur.burnStartTs ? (performance.now() - cur.burnStartTs) / 1000 : null;
        cur.dVActual = cur.initialResidualMag !== undefined ? cur.initialResidualMag : null;
        setText(`${prefix}-dv-actual`, cur.dVActual !== null ? cur.dVActual.toFixed(1) : "--");
        setText(`${prefix}-duration`, durationSec !== null ? `${durationSec.toFixed(1)} s` : "--");
        state.log.unshift({ label: mLabel, dVPlanned: cur.dVPlanned, dVActual: cur.dVActual, durationSec, met: data.met });
        state.log = state.log.slice(0, 12);
        renderLog();
        if (window.logEvent) {
          window.logEvent(
            "RENDEZVOUS",
            `${mLabel}: manovra COMPLETATA (tutti gli assi a ±00000)`,
            `ΔV pianificato=${cur.dVPlanned !== null ? cur.dVPlanned.toFixed(1) : "--"}, ΔV effettivo (residuo annullato)=${cur.dVActual !== null ? cur.dVActual.toFixed(1) : "--"}, durata=${durationSec !== null ? durationSec.toFixed(1) + "s" : "--"}`
          );
        }
      }
    }

    setText(`${prefix}-engine-status`, cur.thrustOn ? "SPINTA RCS IN CORSO" : (cur.cutoffDone ? "MANOVRA COMPLETATA" : (cur.residualPending ? "ATTESA DEL BURN (TIG NON ANCORA RAGGIUNTO)" : "IN ATTESA")));
  }

  function init() {
    const wrap = document.getElementById(`${prefix}-type-select`);
    if (!wrap) return;

    MANEUVERS.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "key-btn burn-type-btn" + (m.id === state.selectedId ? " active" : "");
      btn.textContent = m.label;
      btn.dataset.id = m.id;
      btn.addEventListener("click", () => {
        wrap.querySelectorAll(".burn-type-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.selectedId = m.id;
        resetSelected();
      });
      wrap.appendChild(btn);
    });

    const resetBtn = document.getElementById(`${prefix}-reset-btn`);
    if (resetBtn) resetBtn.addEventListener("click", resetSelected);

    window.telemetryListeners = window.telemetryListeners || [];
    window.telemetryListeners.push(handleTelemetry);
    resetSelected();
    renderLog();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
