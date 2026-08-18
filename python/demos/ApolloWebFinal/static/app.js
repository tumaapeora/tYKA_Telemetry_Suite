// ================== NAVIGAZIONE PAGINE ==================
const pages = document.querySelectorAll(".page");
const pageTitle = document.getElementById("page-title");

function showPage(id) {
  pages.forEach((p) => p.classList.add("hidden"));
  const target = document.getElementById(id);
  target.classList.remove("hidden");
  pageTitle.textContent = target.dataset.title;
}
window.showPage = showPage;

document.querySelectorAll("[data-page]").forEach((el) => {
  el.addEventListener("click", () => showPage(el.dataset.page));
});

// ================== HELPER: aggiorna un display DSKY dato un prefisso ==================
function updateDsky(prefix, data) {
  if (!data) return;
  const progEl = document.getElementById(`${prefix}-prog`);
  const verbEl = document.getElementById(`${prefix}-verb`);
  const nounEl = document.getElementById(`${prefix}-noun`);
  if (progEl) progEl.textContent = data.prog;
  if (verbEl) verbEl.textContent = data.verb;
  if (nounEl) nounEl.textContent = data.noun;

  data.registers.forEach((val, i) => {
    const el = document.getElementById(`${prefix}-reg-${i + 1}`);
    if (el) el.textContent = val;
  });

  const indContainer = document.getElementById(`${prefix}-indicators`);
  if (indContainer) {
    indContainer.querySelectorAll(".indicator").forEach((el) => {
      const on = !!data.indicators[el.dataset.name];
      el.classList.toggle("on", on);
    });
  }
}
window.updateDsky = updateDsky;

function setMet(id, met) {
  const el = document.getElementById(id);
  if (el) el.textContent = met;
}

// ================== TELEMETRIA (polling ogni 500ms, con pub/sub) ==================
// Altri moduli (orbit.js, descent.js) si registrano qui per ricevere ogni
// pacchetto di telemetria, senza dover fare ciascuno il proprio polling.
window.telemetryListeners = [];

async function pollTelemetry() {
  try {
    const res = await fetch("/api/telemetry");
    const data = await res.json();

    // Mode: monitor sola lettura (AGC + LGC)
    setMet("met-value-view", data.met);
    updateDsky("view-agc", data.agc);
    updateDsky("view-lgc", data.lgc);

    // Mode: AGC interattivo
    setMet("met-value-agc", data.met);
    updateDsky("agc", data.agc);

    // Mode: LGC interattivo
    setMet("met-value-lgc", data.met);
    updateDsky("lgc", data.lgc);

    window.telemetryListeners.forEach((fn) => {
      try { fn(data); } catch (e) { console.error(e); }
    });
  } catch (e) {
    // rete assente o server non raggiungibile: non blocchiamo la UI
  } finally {
    setTimeout(pollTelemetry, 500);
  }
}
pollTelemetry();

// ================== TASTIERINI (AGC e LGC) ==================
function setupKeypad(gridId, statusId) {
  const grid = document.getElementById(gridId);
  const statusEl = document.getElementById(statusId);
  const target = grid.dataset.target; // "agc" oppure "lgc"

  grid.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      try {
        const res = await fetch(`/api/keypress/${target}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const data = await res.json();
        if (data.ok) {
          statusEl.textContent = `TX MODULE (${target.toUpperCase()}) › COMMAND SENT: ${key} @ ${data.ts}`;
          statusEl.className = "status-bar ok";
        } else {
          statusEl.textContent = `TRANSMISSION ERROR: ${data.error}`;
          statusEl.className = "status-bar err";
        }
      } catch (e) {
        statusEl.textContent = `TRANSMISSION ERROR: ${e}`;
        statusEl.className = "status-bar err";
      }
    });
  });
}

setupKeypad("keypad-agc", "agc-status");
setupKeypad("keypad-lgc", "lgc-status");

// ================== SWITCH BERSAGLIO RENDEZ-VOUS (CSM-LM / CSM-SKYLAB) ==================
// Determina se la macro automatica deve limitarsi alla procedura standard
// (CSM-LM, invariata) o aggiungere il passo di inserimento V79E-PRO sull'AGC
// richiesto per l'aggancio con lo Skylab.
let rndzTarget = "lm";
(function setupRndzTargetSwitch() {
  const wrap = document.getElementById("rndz-target-select");
  const note = document.getElementById("rndz-target-note");
  if (!wrap || !note) return;
  wrap.querySelectorAll(".rndz-target-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".rndz-target-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      rndzTarget = btn.dataset.target;
      note.textContent = rndzTarget === "lm"
        ? "Procedura CSM-LM: al termine, la sequenza inserirà V79E-PRO sull'AGC (un tasto ogni mezzo secondo)."
        : "Procedura standard (nessun passo aggiuntivo sul AGC).";
    });
  });
})();

// ================== MACRO AUTOMATICHE (rendezvous / sys2) ==================
function setupMacro(name, fireBtnId, logId, getExtraBody) {
  const fireBtn = document.getElementById(fireBtnId);
  const logEl = document.getElementById(logId);
  let polling = null;

  async function pollLog() {
    try {
      const res = await fetch(`/api/log/${name}`);
      const data = await res.json();
      logEl.textContent = data.log.join("\n");
      fireBtn.disabled = data.running;
      if (!data.running && polling) {
        clearInterval(polling);
        polling = null;
      }
    } catch (e) {
      // ignora errori di rete transitori
    }
  }

  fireBtn.addEventListener("click", async () => {
    fireBtn.disabled = true;
    try {
      const extraBody = getExtraBody ? getExtraBody() : null;
      const res = await fetch(`/api/${name === "rndz" ? "rendezvous" : "sys2"}`, {
        method: "POST",
        headers: extraBody ? { "Content-Type": "application/json" } : undefined,
        body: extraBody ? JSON.stringify(extraBody) : undefined,
      });
      if (res.ok) {
        if (polling) clearInterval(polling);
        polling = setInterval(pollLog, 400);
        pollLog();
      } else {
        const data = await res.json();
        logEl.textContent += `\n[ERRORE] ${data.error}`;
        fireBtn.disabled = false;
      }
    } catch (e) {
      logEl.textContent += `\n[ERRORE] ${e}`;
      fireBtn.disabled = false;
    }
  });
}

setupMacro("rndz", "rndz-fire", "rndz-log", () => ({ target: rndzTarget }));
setupMacro("sys2", "sys2-fire", "sys2-log");
