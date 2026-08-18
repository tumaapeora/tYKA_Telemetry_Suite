// ==========================================================================
// MOTORE GENERICO DI MONITORAGGIO BURN — fabbrica riutilizzabile.
// ==========================================================================
(function () {
  const TLI_TABLE = {
    "15-21-33": { label: "TLI (P15) — CARICAMENTO ORARIO TB6 (N33)", r1: "ORE", r2: "MINUTI", r3: "SECONDI" },
    "15-6-14":  { label: "TLI (P15) — VELOCITÀ RICHIESTA CUTOFF (V06N14)", r1: "VELOCITÀ RICHIESTA CUTOFF (VI C/O)", r2: "—", r3: "—", isPlannedDvRaw: true },
    "15-6-95":  { label: "TLI (P15) — SPINTA IN CORSO (N95)", r1: "TEMPO A TFI / TFC", r2: "VELOCITÀ DA GUADAGNARE (Vg)", r3: "VELOCITÀ INERZIALE (VMAG)", isTliBurn: true },
    "15-16-95": { label: "TLI (P15) — CUTOFF (N95 LAMPEGGIANTE)", r1: "TEMPO A TFC (BLOCCATO)", r2: "VELOCITÀ Vg (RESIDUA)", r3: "VELOCITÀ INERZIALE (FINALE)", isTliCutoff: true },
  };

  function p30p40Table(progSetup, progBurn, label) {
    const nn = progBurn === "41" ? "N41" : "N40";
    return {
      [`${progSetup}-21-33`]: { label: `${label} — TIG MANOVRA (N33)`, r1: "ORE TIG", r2: "MINUTI TIG", r3: "SECONDI TIG" },
      [`${progSetup}-21-81`]: { label: `${label} — ΔV LOCALE VERTICALE (N81)`, r1: "ΔVX", r2: "ΔVY", r3: "ΔVZ", isPlannedDv: "vector" },
      [`${progSetup}-6-42`]:  { label: `${label} — VERIFICA STIME (N42)`, r1: "APOGEO PREVISTO", r2: "PERIGEO PREVISTO", r3: "ΔV TOTALE PIANIFICATO", isPlannedDv: "r3" },
      [`${progSetup}-6-45`]:  { label: `${label} — PARAMETRI DI CHIUSURA (N45)`, r1: "TEMPO A TFI", r2: "ANGOLO GIMBAL (MGA)", r3: "—" },
      [`${progBurn}-6-18`]:   { label: `${label} — ASSETTO FDAI DESIDERATO (N18)`, r1: "ROLL", r2: "PITCH", r3: "YAW" },
      [`${progBurn}-50-25`]:  { label: `${label} — TEST UGELLI (N25)`, r1: "CODICE VERIFICA", r2: "—", r3: "—" },
      [`${progBurn}-6-40`]:   { label: `${label} — COUNTDOWN / ULLAGE (${nn})`, r1: "TEMPO A TFI", r2: "VELOCITÀ Vg", r3: "ΔV ACCUMULATO (ΔVM)" },
      [`${progBurn}-99-40`]:  { label: `${label} — RICHIESTA GO ACCENSIONE (${nn}, lampeggiante)`, r1: "TEMPO A TFI", r2: "VELOCITÀ Vg", r3: "ΔV ACCUMULATO (ΔVM)", isGoRequest: true },
      [`${progBurn}-16-40`]:  { label: `${label} — CUTOFF (${nn})`, r1: "TEMPO A TFI", r2: "VELOCITÀ Vg (FINALE)", r3: "ΔV ACCUMULATO FINALE", isBurnCutoff: true },
      [`${progBurn}-6-85`]:   { label: `${label} — RESIDUI POST-CUTOFF (N85)`, r1: "RESIDUO ASSE X", r2: "RESIDUO ASSE Y", r3: "RESIDUO ASSE Z" },
    };
  }

  function parseRegNumber(regString) {
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * parseInt(digits, 10);
  }

  function parseDvNumber(regString) {
    if (!regString) return NaN;
    const trimmed = regString.replace(/\s+/g, "");
    const sign = trimmed[0] === "-" ? -1 : 1;
    const digits = trimmed.replace(/[+\-]/g, "");
    if (!digits || isNaN(digits)) return NaN;
    return sign * (parseInt(digits, 10) / 10);
  }

  // Conversione AGC MMSS
  function parseAgcTimeRegister(regString) {
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

  function createManeuverMonitor(prefix, maneuverTypes, allowCraftSwitch, logCategory, customOpts, defaultCraft) {
    logCategory = logCategory || "BURN";
    const opts = customOpts || null;
    const state = {
      selectedId: maneuverTypes[0].id,
      selectedCraft: defaultCraft || "agc",
      current: {},
      log: [],
    };
    maneuverTypes.forEach((m) => { state.current[m.id] = blankCurrent(); });
    window[`__maneuverState_${prefix}`] = state;

    function blankCurrent() {
      return { 
        engineOn: false, 
        burnStartTs: null, 
        dVPlanned: null, 
        dVActual: null, 
        cutoffDone: false, 
        lastR2: null, 
        lastChangeTs: null, 
        goRequestTs: null,
        hasStartedCountdown: false,
        lastSnapshot: null
      };
    }

    function setText(id, txt) {
      const e = document.getElementById(id);
      if (e) e.textContent = txt;
    }

    function craftUsesLGC(maneuverId) {
      return state.selectedCraft === "lgc";
    }

    function handleTelemetry(data) {
      const m = maneuverTypes.find((x) => x.id === state.selectedId);
      if (!m) return;
      const src = craftUsesLGC(m.id) ? data.lgc : data.agc;
      if (!src) return;

      const prog = src.prog.replace(/\s/g, "");
      const verb = parseInt(src.verb, 10);
      const noun = parseInt(src.noun, 10);
      const key = `${prog}-${verb}-${noun}`;
      const entry = m.table[key];
      const cur = state.current[m.id];

      // ACCENSIONE MANOVRE STANDARD P30/P40 (4s dopo V99)
      if (entry && entry.isGoRequest && cur.goRequestTs === null) {
        cur.goRequestTs = performance.now();
      }
      if (cur.goRequestTs !== null && !cur.engineOn && !cur.cutoffDone && (performance.now() - cur.goRequestTs) >= 4000) {
        cur.engineOn = true;
        cur.burnStartTs = cur.goRequestTs + 4000;
        if (window.logEvent) window.logEvent(logCategory, `${m.label}: motore ACCESO (4s dopo richiesta GO)`, m.label);
        setText(`${prefix}-engine-status`, "ACCESO");
        const lightNow = document.getElementById(`${prefix}-engine-light`);
        if (lightNow) lightNow.classList.add("on");
      }

      if (!entry) {
        setText(`${prefix}-display-label`, "Nessun Noun della sequenza riconosciuto sul DSKY corrente");
        return;
      }

      // ISTANTANEA "IN VOLO" (P12/risalita LGC)
      if (entry.isInFlightSnapshot) {
        cur.lastSnapshot = { r1: src.registers[0], r2: src.registers[1], r3: src.registers[2], met: data.met };
      }

      setText(`${prefix}-display-label`, entry.label);
      setText(`${prefix}-r1-label`, entry.r1); setText(`${prefix}-r1-val`, src.registers[0]);
      setText(`${prefix}-r2-label`, entry.r2); setText(`${prefix}-r2-val`, src.registers[1]);
      setText(`${prefix}-r3-label`, entry.r3); setText(`${prefix}-r3-val`, src.registers[2]);

      // ESTRAZIONE dV PIANIFICATO MANOVRE STANDARD
      if (entry.isPlannedDv === "r3" && cur.dVPlanned === null) {
        const v = parseDvNumber(src.registers[2]);
        if (!isNaN(v)) { cur.dVPlanned = v; setText(`${prefix}-dv-planned`, v.toFixed(1)); }
      }
      if (entry.isPlannedDv === "r1" && cur.dVPlanned === null) {
        const v = parseDvNumber(src.registers[0]);
        if (!isNaN(v) && v !== 0) { cur.dVPlanned = v; setText(`${prefix}-dv-planned`, v.toFixed(1)); }
      }
      if (entry.isPlannedDv === "vector" && cur.dVPlanned === null) {
        const x = parseDvNumber(src.registers[0]), y = parseDvNumber(src.registers[1]), z = parseDvNumber(src.registers[2]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          const mag = Math.sqrt(x * x + y * y + z * z);
          cur.dVPlanned = mag; setText(`${prefix}-dv-planned`, mag.toFixed(1));
        }
      }

      // ESTRAZIONE dV PIANIFICATO TLI (V06N14 R1)
      if (entry.isPlannedDvRaw && cur.dVPlanned === null) {
        const v = parseRegNumber(src.registers[0]);
        if (!isNaN(v) && v > 0) { 
          cur.dVPlanned = v; 
          setText(`${prefix}-dv-planned`, `${v}`); 
        }
      }

      // ---------------------------------------------------------
      // MONITORAGGIO SPINTA E TIMING TLI (P15)
      // ---------------------------------------------------------
      if (entry.isTliBurn) {
        const r1val = parseRegNumber(src.registers[0]);
        const r1raw = src.registers[0];
        const r2raw = src.registers[1];
        const now = performance.now();

        // Segna che il countdown è attivo se R1 è maggiore di 5 secondi
        if (!isNaN(r1val) && r1val > 5) {
          cur.hasStartedCountdown = true;
        }

        // ACCENSIONE TLI: R1 arriva a 00000
        if (cur.hasStartedCountdown && r1val === 0 && !cur.engineOn && !cur.cutoffDone) {
          cur.engineOn = true;
          cur.burnStartTs = now;
          cur.lastChangeTs = now;
          cur.lastR2 = r2raw;
          if (window.logEvent) window.logEvent(logCategory, `${m.label}: motore ACCESO (R1=00000)`, entry.label);
          setText(`${prefix}-engine-status`, "ACCESO");
          const lightNow = document.getElementById(`${prefix}-engine-light`);
          if (lightNow) lightNow.classList.add("on");
        }

        // DURANTE IL BURN TLI
        if (cur.engineOn && !cur.cutoffDone) {
          const r1Seconds = parseAgcTimeRegister(r1raw);
          const durationSec = r1Seconds > 0 ? r1Seconds : (now - cur.burnStartTs) / 1000;
          setText(`${prefix}-duration`, `${durationSec.toFixed(1)} s`);

          if (r2raw !== cur.lastR2) {
            cur.lastChangeTs = now;
            cur.lastR2 = r2raw;
          }

          // Cutoff automatico per assestamento Vg
          const totalElapsed = (now - cur.burnStartTs) / 1000;
          if (totalElapsed > 10 && (now - cur.lastChangeTs) >= 2500) {
            finalizeCutoff(r1raw, r2raw, true);
          }
        }
      }

      // CUTOFF UFFICIALE TLI (V16N95 Lampeggiante)
      if (entry.isTliCutoff && cur.engineOn && !cur.cutoffDone) {
        finalizeCutoff(src.registers[0], src.registers[1], true);
      }

      // CUTOFF MANOVRE STANDARD (P40/P41)
      if (entry.isBurnCutoff && cur.engineOn && !cur.cutoffDone) {
        finalizeCutoff(src.registers[0], src.registers[1], false);
      }

      // CUTOFF P12 (RISALITA LGC)
      if (entry.isAscentCutoff && cur.engineOn && !cur.cutoffDone) {
        cur.engineOn = false;
        cur.cutoffDone = true;
        const durationSec = cur.burnStartTs ? (performance.now() - cur.burnStartTs) / 1000 : 0;

        const snap = cur.lastSnapshot;
        const vgxFinal = snap ? parseDvNumber(snap.r1) : NaN;
        if (cur.dVPlanned !== null && !isNaN(vgxFinal)) {
          cur.dVActual = cur.dVPlanned + vgxFinal;
        } else {
          cur.dVActual = cur.dVPlanned;
        }

        setText(`${prefix}-dv-actual`, cur.dVActual !== null ? cur.dVActual.toFixed(1) : "--");
        setText(`${prefix}-duration`, `${durationSec.toFixed(1)} s`);

        state.log.unshift({ id: m.id, label: m.label, dVPlanned: cur.dVPlanned, dVActual: cur.dVActual, durationSec, met: data.met });
        state.log = state.log.slice(0, 12);
        renderLog();

        if (window.logEvent) {
          const snapTxt = snap
            ? `dati di fine accensione da ultimo V06N94: VGX=${snap.r1}, Ḣ=${snap.r2} ft/s, H=${snap.r3} ft (MET=${snap.met})`
            : "nessuna lettura V06N94 catturata prima del cutoff";
          window.logEvent(
            logCategory,
            `${m.label}: cutoff / motore APS SPENTO (target insertion raggiunto)`,
            `ΔV pianificato=${cur.dVPlanned !== null ? cur.dVPlanned.toFixed(1) : "--"} ft/s, ΔV effettivo=${cur.dVActual !== null ? cur.dVActual.toFixed(1) : "--"} ft/s, durata=${durationSec.toFixed(1)}s, ${snapTxt} — residui rimanenti da annullare via RCS visibili sopra (V16N85)`
          );
        }

        setText(`${prefix}-engine-status`, "SPENTO");
        const light = document.getElementById(`${prefix}-engine-light`);
        if (light) light.classList.remove("on");
      }

      // FINALIZZATORE CUTOFF CON DIFFERENZIAZIONE MANOVRE
      function finalizeCutoff(r1raw, r2raw, isTli = false) {
        if (cur.cutoffDone) return;
        cur.engineOn = false;
        cur.cutoffDone = true;
        
        const vgFinal = isTli ? parseRegNumber(r2raw) : parseDvNumber(r2raw);
        
        const r1Seconds = parseAgcTimeRegister(r1raw);
        const durationSec = r1Seconds > 0 ? r1Seconds : (cur.burnStartTs ? (performance.now() - cur.burnStartTs) / 1000 : 0);
        
        // DIFFERENZIAZIONE:
        // TLI (P15): pianificato - vgFinal
        // P30/P40:   pianificato + vgFinal
        if (cur.dVPlanned !== null && !isNaN(vgFinal)) {
          cur.dVActual = isTli ? (cur.dVPlanned - vgFinal) : (cur.dVPlanned + vgFinal);
        } else {
          cur.dVActual = null;
        }
        
        const dvFmt = (val) => isTli ? `${Math.round(val)}` : val.toFixed(1);

        setText(`${prefix}-dv-actual`, cur.dVActual !== null ? dvFmt(cur.dVActual) : "--");
        setText(`${prefix}-duration`, `${durationSec.toFixed(1)} s`);
        
        state.log.unshift({ 
          id: m.id, 
          label: m.label, 
          dVPlanned: cur.dVPlanned, 
          dVActual: cur.dVActual, 
          durationSec, 
          met: data.met,
          isTli 
        });
        state.log = state.log.slice(0, 12);
        renderLog();
        
        if (window.logEvent) {
          window.logEvent(
            logCategory,
            `${m.label}: cutoff / motore SPENTO`,
            `ΔV pianificato=${cur.dVPlanned !== null ? dvFmt(cur.dVPlanned) : "--"}, ΔV effettivo=${cur.dVActual !== null ? dvFmt(cur.dVActual) : "--"}, durata=${durationSec.toFixed(1)}s`
          );
        }

        setText(`${prefix}-engine-status`, "SPENTO");
        const light = document.getElementById(`${prefix}-engine-light`);
        if (light) light.classList.remove("on");
      }
    }

    function renderLog() {
      const tbody = document.getElementById(`${prefix}-log-body`);
      if (!tbody) return;
      tbody.innerHTML = "";
      state.log.forEach((rec) => {
        const dvFmt = (val) => val !== null ? (rec.isTli ? `${Math.round(val)}` : val.toFixed(1)) : "--";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${rec.label}</td><td>${rec.met || "--"}</td>
          <td>${dvFmt(rec.dVPlanned)}</td>
          <td>${dvFmt(rec.dVActual)}</td>
          <td>${rec.durationSec !== null ? rec.durationSec.toFixed(1) : "--"}</td>`;
        tbody.appendChild(tr);
      });
    }

    function resetSelected() {
      const m = maneuverTypes.find((x) => x.id === state.selectedId);
      state.current[m.id] = blankCurrent();
      setText(`${prefix}-dv-planned`, "--"); setText(`${prefix}-dv-actual`, "--"); setText(`${prefix}-duration`, "--");
      setText(`${prefix}-engine-status`, "SPENTO");
      setText(`${prefix}-display-label`, "In attesa di dati...");
      setText(`${prefix}-r1-label`, "—"); setText(`${prefix}-r1-val`, "--");
      setText(`${prefix}-r2-label`, "—"); setText(`${prefix}-r2-val`, "--");
      setText(`${prefix}-r3-label`, "—"); setText(`${prefix}-r3-val`, "--");
      const light = document.getElementById(`${prefix}-engine-light`);
      if (light) light.classList.remove("on");
    }

    function customCount() {
      return maneuverTypes.filter((m) => opts && opts.isCustom(m)).length;
    }

    function notifyNamesChange() {
      if (opts && opts.onNamesChange) {
        opts.onNamesChange(maneuverTypes.filter((m) => opts.isCustom(m)).map((m) => m.label));
      }
    }

    function selectManeuver(id) {
      state.selectedId = id;
      renderTabs();
      resetSelected();
    }

    function renameSlot(id) {
      const m = maneuverTypes.find((x) => x.id === id);
      if (!m || !opts) return;
      const newLabel = prompt("Nuovo nome per questa manovra:", m.label);
      if (newLabel === null) return;
      const trimmed = newLabel.trim();
      if (!trimmed) return;
      m.label = trimmed;
      m.table = opts.makeTable(trimmed);
      renderTabs();
      if (state.selectedId === id) resetSelected();
      notifyNamesChange();
    }

    function addSlot() {
      if (!opts) return;
      const max = opts.maxCustom || 8;
      if (customCount() >= max) { alert(`Numero massimo di manovre raggiunto (${max}).`); return; }
      const newLabel = prompt("Nome della nuova manovra (es. Circ, RNDZ, LOI-3...):", "");
      if (newLabel === null) return;
      const trimmed = newLabel.trim();
      if (!trimmed) return;
      const id = `${prefix}_custom_${Date.now()}`;
      const m = { id, label: trimmed, table: opts.makeTable(trimmed), custom: true };
      maneuverTypes.push(m);
      state.current[id] = blankCurrent();
      selectManeuver(id);
      notifyNamesChange();
    }

    function removeSlot(id) {
      if (!opts) return;
      const min = opts.minCustom || 1;
      if (customCount() <= min) { alert(`Deve restare almeno ${min === 1 ? "una manovra" : min + " manovre"} di questo tipo.`); return; }
      const m = maneuverTypes.find((x) => x.id === id);
      if (!m) return;
      if (!confirm(`Rimuovere "${m.label}"? Lo storico di questa sessione per questa manovra andrà perso.`)) return;
      maneuverTypes = maneuverTypes.filter((x) => x.id !== id);
      delete state.current[m.id];
      if (state.selectedId === id) state.selectedId = maneuverTypes[0].id;
      renderTabs();
      resetSelected();
      notifyNamesChange();
    }

    function syncCustomNames(labels) {
      if (!opts || !Array.isArray(labels) || !labels.length) return;

      const customEntries = maneuverTypes.filter((m) => opts.isCustom(m));
      let changed = false;

      labels.forEach((label, i) => {
        if (i < customEntries.length) {
          const m = customEntries[i];
          if (m.label !== label) {
            m.label = label;
            m.table = opts.makeTable(label);
            changed = true;
          }
        } else {
          const id = `${prefix}_custom_srv_${i}_${Date.now()}`;
          const m = { id, label, table: opts.makeTable(label), custom: true };
          maneuverTypes.push(m);
          state.current[id] = blankCurrent();
          changed = true;
        }
      });

      if (customEntries.length > labels.length) {
        customEntries.slice(labels.length).forEach((m) => {
          maneuverTypes = maneuverTypes.filter((x) => x.id !== m.id);
          delete state.current[m.id];
        });
        changed = true;
      }

      if (!maneuverTypes.find((x) => x.id === state.selectedId)) {
        state.selectedId = maneuverTypes[0].id;
        resetSelected();
      }

      if (changed) renderTabs();
    }

    if (opts && opts.registerSync) opts.registerSync(syncCustomNames);

    let wrap = null;

    function renderTabs() {
      if (!wrap) return;
      wrap.innerHTML = "";
      maneuverTypes.forEach((m) => {
        const isCustom = !!(opts && opts.isCustom(m));
        const group = document.createElement(isCustom ? "span" : "button");
        if (isCustom) {
          group.className = "burn-tab-group";
        }
        const btn = isCustom ? document.createElement("button") : group;
        btn.className = "key-btn burn-type-btn" + (m.id === state.selectedId ? " active" : "");
        btn.textContent = m.label;
        btn.dataset.id = m.id;
        btn.addEventListener("click", () => selectManeuver(m.id));
        if (isCustom) group.appendChild(btn);

        if (isCustom) {
          const editBtn = document.createElement("button");
          editBtn.className = "burn-tab-edit-btn";
          editBtn.title = "Rinomina manovra";
          editBtn.textContent = "\u270E";
          editBtn.addEventListener("click", (ev) => { ev.stopPropagation(); renameSlot(m.id); });
          group.appendChild(editBtn);

          const delBtn = document.createElement("button");
          delBtn.className = "burn-tab-del-btn";
          delBtn.title = "Rimuovi manovra";
          delBtn.textContent = "\u2715";
          delBtn.addEventListener("click", (ev) => { ev.stopPropagation(); removeSlot(m.id); });
          group.appendChild(delBtn);
        }

        wrap.appendChild(group);
      });

      if (opts) {
        const addBtn = document.createElement("button");
        addBtn.className = "key-btn burn-type-add-btn";
        addBtn.textContent = "+ NUOVA MANOVRA";
        addBtn.addEventListener("click", addSlot);
        wrap.appendChild(addBtn);
      }
    }

    function init() {
      wrap = document.getElementById(`${prefix}-type-select`);
      if (!wrap) return;

      renderTabs();

      if (allowCraftSwitch) {
        document.querySelectorAll(`#${prefix}-craft-select .burn-craft-btn`).forEach((btn) => {
          btn.addEventListener("click", () => {
            document.querySelectorAll(`#${prefix}-craft-select .burn-craft-btn`).forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.selectedCraft = btn.dataset.craft;
          });
        });
      }

      const resetBtn = document.getElementById(`${prefix}-reset-btn`);
      if (resetBtn) resetBtn.addEventListener("click", resetSelected);

      window.telemetryListeners.push(handleTelemetry);
      resetSelected();
      renderLog();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    return state;
  }

  window.MANEUVER_TABLES = { TLI_TABLE, p30p40Table };
  window.createManeuverMonitor = createManeuverMonitor;
})();
