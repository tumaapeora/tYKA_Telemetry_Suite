// ==========================================================================
// REGISTRO EVENTI DI MISSIONE — ora sincronizzato col server (Single Source
// of Truth). Ogni modulo (launch.js, maneuvers.js, descent.js, ascent.js)
// continua a chiamare window.logEvent(categoria, descrizione, dettagli) nei
// momenti chiave, ma l'evento viene inviato al server con POST /api/events;
// il server assegna l'ID definitivo e lo distribuisce a tutti i client con
// GET /api/events. Così ogni scheda/dispositivo mostra sempre esattamente
// lo stesso registro, anche se si collega a metà sessione o se più client
// rilevano lo stesso evento in modo indipendente (il server deduplica sulla
// base della coppia categoria+descrizione).
// ==========================================================================
(function () {
  const CATEGORIES = ["LANCIO", "BURN", "DISCESA", "RISALITA", "RENDEZVOUS", "RIENTRO", "SISTEMA"];

  const state = {
    events: [], // {id, met, wallClock, category, description, details} - dal server
    filter: "TUTTI",
    lastMet: "+000:00:00",
    lastEventId: 0,
  };
  window.__eventLogState = state;

  async function logEvent(category, description, details) {
    // Non tocchiamo più state.events direttamente: lo facciamo solo quando
    // arriva la conferma dal server tramite pollEvents(), per evitare che
    // due client mostrino ordini/ID diversi per lo stesso evento.
    const key = `${category}|${description}`;
    try {
      await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description, details: details || "", key, met: state.lastMet }),
      });
    } catch (e) {
      // rete assente: l'evento non è andato a buon fine, non blocchiamo la UI.
    }
  }
  window.logEvent = logEvent;

  function renderLog() {
    const tbody = document.getElementById("eventlog-body");
    if (!tbody) return; // pagina non montata al momento, va bene: lo stato resta comunque salvato
    tbody.innerHTML = "";
    const visible = state.filter === "TUTTI" ? state.events : state.events.filter((e) => e.category === state.filter);
    if (visible.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="5" class="eventlog-empty">Nessun evento registrato per questo filtro.</td>`;
      tbody.appendChild(tr);
      return;
    }
    visible.forEach((ev) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="eventlog-met">${ev.met}</td>
        <td><span class="eventlog-cat eventlog-cat-${ev.category}">${ev.category}</span></td>
        <td>${ev.description}</td>
        <td class="eventlog-details">${ev.details}</td>
        <td class="eventlog-wall">${ev.wallClock}</td>`;
      tbody.appendChild(tr);
    });
  }

  function exportLog() {
    const lines = ["MET\tCategoria\tDescrizione\tDettagli\tOra locale"];
    // esporta sempre tutto (non solo il filtro corrente), più recenti in cima
    [...state.events].sort((a, b) => b.id - a.id).forEach((ev) => {
      lines.push(`${ev.met}\t${ev.category}\t${ev.description}\t${ev.details}\t${ev.wallClock}`);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mission_log_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clearLog() {
    // Il registro autorevole vive ora sul server (ed è già persistito nel
    // file di sessione), quindi qui puliamo solo la vista locale: al
    // prossimo giro di pollEvents() lo storico non ricompare perché
    // continuiamo a chiedere solo gli eventi con id > lastEventId.
    state.events = [];
    renderLog();
  }

  function handleTelemetry(data) {
    if (data && data.met) state.lastMet = data.met;
  }

  async function pollEvents() {
    try {
      const res = await fetch(`/api/events?since=${state.lastEventId}`);
      const data = await res.json();
      if (data.events && data.events.length) {
        // più recenti in cima, come nel comportamento originale
        for (const ev of data.events) state.events.unshift(ev);
        state.lastEventId = data.last_id;
        renderLog();
      }
    } catch (e) {
      // rete assente o server non raggiungibile: non blocchiamo la UI
    } finally {
      setTimeout(pollEvents, 1000);
    }
  }

  function init() {
    window.telemetryListeners = window.telemetryListeners || [];
    window.telemetryListeners.push(handleTelemetry);

    const filterWrap = document.getElementById("eventlog-filters");
    if (filterWrap) {
      ["TUTTI", ...CATEGORIES].forEach((cat) => {
        const btn = document.createElement("button");
        btn.className = "key-btn eventlog-filter-btn" + (cat === "TUTTI" ? " active" : "");
        btn.textContent = cat;
        btn.dataset.cat = cat;
        btn.addEventListener("click", () => {
          filterWrap.querySelectorAll(".eventlog-filter-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          state.filter = cat;
          renderLog();
        });
        filterWrap.appendChild(btn);
      });
    }

    const exportBtn = document.getElementById("eventlog-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", exportLog);
    const clearBtn = document.getElementById("eventlog-clear-btn");
    if (clearBtn) clearBtn.addEventListener("click", clearLog);

    renderLog();
    pollEvents();
    logEvent("SISTEMA", "Registro eventi inizializzato");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
