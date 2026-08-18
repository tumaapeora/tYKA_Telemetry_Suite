// ==========================================================================
// SEZIONE 2: CONTROLLO DEI BURN TRANS-STADIO
// - TLI (P15) resta una scheda fissa: struttura Verb/Noun diversa (TB6, N95...).
// - Le manovre P30/P40 (storicamente LOI-1/LOI-2/TEI) sono invece un pool di
//   schede PERSONALIZZABILI: stessa identica logica di rilevamento (valida
//   sia per missioni lunari che per orbite terrestri), ma il nome di ognuna
//   e' a discrezione di chi usa la webapp - rinominabile, aggiungibile,
//   rimovibile (es. LOI-1, LOI-2, TEI, Circ, RNDZ, DOI, Fasing...).
//
// I nomi sono condivisi tra tutti i client tramite il server (/api/burn-names),
// perche' variano a seconda della missione e devono essere IDENTICI su tutte
// le postazioni: se una rinomina/aggiunge/rimuove una manovra, tutte le altre
// si allineano via polling, evitando sia nomi discordanti a schermo sia
// duplicati nel log eventi (che oggi deduplica su categoria+descrizione, e
// la descrizione include il nome della manovra). localStorage resta come
// cache di fallback per l'avvio quando il server non e' raggiungibile.
// ==========================================================================
(function () {
  const STORAGE_KEY = "apollo_burn_p3040_names";
  const DEFAULT_NAMES = ["LOI-1", "LOI-2", "TEI"];
  const API_URL = "/api/burn-names";
  const POLL_MS = 2000;

  let lastVersion = null;
  let syncFn = null;

  function loadNamesLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) { /* localStorage non disponibile: si parte dai nomi di default */ }
    return DEFAULT_NAMES.slice();
  }

  function saveNamesLocal(names) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(names)); } catch (e) { /* ignorato */ }
  }

  // Chiamata quando l'UTENTE DI QUESTO CLIENT rinomina/aggiunge/rimuove una
  // manovra: propaga l'elenco completo al server, che diventa la versione
  // valida per tutti.
  async function pushNames(names) {
    saveNamesLocal(names);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const data = await res.json();
      if (data && typeof data.version === "number") lastVersion = data.version;
    } catch (e) {
      // rete assente: resta comunque salvato in locale, si allineera' col
      // server al ritorno della rete tramite il prossimo giro di polling
    }
  }

  // Interroga il server per vedere se un ALTRO client ha cambiato i nomi nel
  // frattempo; se si', aggiorna questo client senza perdere lo stato dei
  // burn in corso (vedi syncCustomNames in maneuvers.js).
  async function pollNames() {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      if (data && Array.isArray(data.names) && typeof data.version === "number" && data.version !== lastVersion) {
        lastVersion = data.version;
        saveNamesLocal(data.names);
        if (syncFn) syncFn(data.names);
      }
    } catch (e) {
      // rete assente: si riprova al giro successivo
    } finally {
      setTimeout(pollNames, POLL_MS);
    }
  }

  async function fetchInitialNames() {
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      if (data && Array.isArray(data.names) && data.names.length) {
        lastVersion = data.version;
        saveNamesLocal(data.names);
        return data.names;
      }
    } catch (e) { /* server non raggiungibile: si parte dalla cache locale */ }
    return loadNamesLocal();
  }

  async function init() {
    if (!window.createManeuverMonitor || !window.MANEUVER_TABLES) return;
    const { TLI_TABLE, p30p40Table } = window.MANEUVER_TABLES;
    const makeTable = (label) => p30p40Table("30", "40", label);

    const initialNames = await fetchInitialNames();

    const types = [
      { id: "tli", label: "TLI (P15)", table: TLI_TABLE },
      ...initialNames.map((label, i) => ({
        id: `p3040_${i}`,
        label,
        table: makeTable(label),
        custom: true,
      })),
    ];

    window.createManeuverMonitor("burn", types, false, "BURN", {
      isCustom: (m) => !!m.custom,
      makeTable,
      onNamesChange: pushNames,
      registerSync: (fn) => { syncFn = fn; },
      minCustom: 1,
      maxCustom: 8,
    });

    pollNames();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
