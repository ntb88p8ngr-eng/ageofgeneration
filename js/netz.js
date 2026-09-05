/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Netzwerk

   Uebertragen werden nur Befehle, nie Spielstaende: die Karte
   entsteht bei jedem aus derselben Saat, und die Simulation
   rechnet ueberall gleich. Der Server sammelt die Befehle und
   veroeffentlicht sie fuenfmal je Sekunde als Runde. Wer eine
   Runde hat, rechnet sie — dadurch bleiben alle im Gleichschritt.

   Uebertragungsweg ist die Langabfrage: eine gewoehnliche
   Anfrage, die der Server offen haelt, bis es etwas Neues gibt.
   Das kommt ohne WebSocket aus und laeuft durch jeden Proxy.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const SITZUNG = 'aog:sitzung';

export class Netz {
  constructor() {
    this.token = null;
    this.spielerId = null;
    this.name = null;
    this.partieId = null;
    this.abbruch = new Set();
    try {
      const alt = JSON.parse(sessionStorage.getItem(SITZUNG) || 'null');
      if (alt) { this.token = alt.token; this.name = alt.name; }
    } catch (e) {}
  }

  async ruf(pfad, daten, langsam) {
    const steuer = new AbortController();
    this.abbruch.add(steuer);
    try {
      const antwort = await fetch('api/' + pfad, {
        method: daten ? 'POST' : 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' },
                               this.token ? { 'X-Sitzung': this.token } : {}),
        body: daten ? JSON.stringify(daten) : undefined,
        signal: steuer.signal,
        cache: 'no-store'
      });
      const text = await antwort.text();
      let inhalt = {};
      try { inhalt = text ? JSON.parse(text) : {}; } catch (e) { inhalt = { fehler: 'Antwort unlesbar' }; }
      if (!antwort.ok) throw new Error(inhalt.fehler || ('HTTP ' + antwort.status));
      return inhalt;
    } finally {
      this.abbruch.delete(steuer);
    }
  }

  /** Alle offenen Langabfragen beenden (z. B. beim Verlassen). */
  alleAbbrechen() {
    for (const s of this.abbruch) { try { s.abort(); } catch (e) {} }
    this.abbruch.clear();
  }

  async erreichbar() {
    try { await this.ruf('gesundheit'); return true; } catch (e) { return false; }
  }

  async anmelden(name) {
    const a = await this.ruf('anmelden', { name });
    this.token = a.token; this.name = a.name;
    try { sessionStorage.setItem(SITZUNG, JSON.stringify({ token: a.token, name: a.name })); } catch (e) {}
    return a;
  }

  lobby(seit) { return this.ruf('lobby?v=' + (seit | 0)); }
  erstellen(einstellungen) { return this.ruf('partie/erstellen', einstellungen); }
  beitreten(id, alsZuschauer) { return this.ruf('partie/beitreten', { id, zuschauer: !!alsZuschauer }); }
  platz(feld, wert) { return this.ruf('partie/platz', { feld, wert }); }
  bereit(b) { return this.ruf('partie/bereit', { bereit: !!b }); }
  starten() { return this.ruf('partie/starten', {}); }
  verlassen() { return this.ruf('partie/verlassen', {}); }
  chat(text) { return this.ruf('partie/chat', { text }); }
  einstellung(feld, wert) { return this.ruf('partie/einstellung', { feld, wert }); }

  raum(id, seit) { return this.ruf('partie/zustand?id=' + encodeURIComponent(id) + '&v=' + (seit | 0)); }
  befehle(runde, liste) { return this.ruf('partie/befehle', { runde, befehle: liste }); }
  runden(ab) { return this.ruf('partie/runden?ab=' + (ab | 0)); }
  pruefsumme(runde, summe) { return this.ruf('partie/pruefsumme', { runde, summe }); }

  replays() { return this.ruf('replays'); }
  replay(id) { return this.ruf('replay?id=' + encodeURIComponent(id)); }
  replaySichern(daten) { return this.ruf('replay/sichern', daten); }
}
