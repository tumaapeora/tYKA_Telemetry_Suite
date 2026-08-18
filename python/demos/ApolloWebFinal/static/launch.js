// ==========================================================================
// SEZIONE 1: FASE DI LANCIO (dalla Terra)
// - Luci di sequenza semplificate per P01/P02 (basate sul campo "prog" AGC:
//   la telemetria non espone i singoli passi interni al programma, quindi
//   questa è una rappresentazione semplificata "programma attivo", non una
//   sequenza dettagliata passo-passo).
// - Monitoraggio principale P11 (Liftoff): V06N62 non lampeggiante.
// - Richiamo opzionale via V82E: V16N44 lampeggiante (Apogeo/Perigeo/TFF).
// ==========================================================================
(function () {
  const flags = { p01Logged: false, p02Logged: false, liftoffLogged: false, v82Logged: false };

  function setText(id, txt) {
    const e = document.getElementById(id);
    if (e) e.textContent = txt;
  }

  function log(desc, details) {
    if (window.logEvent) window.logEvent("LANCIO", desc, details || "");
  }

  // Formatta un registro TFF (formato AGC "XXbXX": min nelle prime 2 cifre,
  // sec nelle ultime 2, cifra centrale è un separatore/non usata).
  function formatTFF(regString) {
    if (!regString) return "--:--";
    const body = regString.replace(/^[+\-]\s*/, "");
    if (body.length < 5) return "--:--";
    const min = body.slice(0, 2).replace(/\s/g, "").padStart(2, "0");
    const sec = body.slice(3, 5).replace(/\s/g, "").padStart(2, "0");
    return `${min}:${sec}`;
  }

  function handleTelemetry(data) {
    const agc = data.agc;
    if (!agc) return;

    // luci sequenza P01/P02 (semplificate)
    const prog = agc.prog.replace(/\s/g, "");
    const p01Light = document.getElementById("launch-light-p01");
    const p02Light = document.getElementById("launch-light-p02");
    if (p01Light) p01Light.classList.toggle("on", prog === "01");
    if (p02Light) p02Light.classList.toggle("on", prog === "02");
    if (prog === "01" && !flags.p01Logged) { flags.p01Logged = true; log("Programma P01 attivato"); }
    if (prog === "02" && !flags.p02Logged) { flags.p02Logged = true; log("Programma P02 attivato"); }

    const verb = parseInt(agc.verb, 10);
    const noun = parseInt(agc.noun, 10);

    if (verb === 6 && noun === 62) {
      setText("launch-p11-status", "P11 — LIFTOFF: MONITORAGGIO ATTIVO (V06N62)");
      setText("launch-p11-r1", agc.registers[0]);
      setText("launch-p11-r2", agc.registers[1]);
      setText("launch-p11-r3", agc.registers[2]);
      if (!flags.liftoffLogged) {
        flags.liftoffLogged = true;
        log("Liftoff rilevato — monitoraggio P11 (V06N62) attivo", `V=${agc.registers[0]} ft/s, Ḣ=${agc.registers[1]} ft/s, H=${agc.registers[2]} nmi`);
      }
    } else {
      setText("launch-p11-status", "IN ATTESA DI V06N62 (LIFTOFF / V75E)");
    }

    if (verb === 16 && noun === 44) {
      setText("launch-v82-status", "V82E ATTIVO — V16N44 LAMPEGGIANTE");
      setText("launch-v82-apogee", `${agc.registers[0]} nmi`);
      setText("launch-v82-perigee", `${agc.registers[1]} nmi`);
      setText("launch-v82-tff", formatTFF(agc.registers[2]));
      if (!flags.v82Logged) {
        flags.v82Logged = true;
        log("Richiamo V82E — parametri orbitali letti", `Apogeo=${agc.registers[0]} nmi, Perigeo=${agc.registers[1]} nmi, TFF=${formatTFF(agc.registers[2])}`);
      }
    } else {
      setText("launch-v82-status", "RICHIAMABILE MANUALMENTE (V82E)");
      flags.v82Logged = false; // permette di ri-loggare un nuovo richiamo successivo
    }
  }

  function init() {
    window.telemetryListeners.push(handleTelemetry);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
