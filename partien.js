/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Partienverwaltung (Server)

   Der Server spielt nicht mit: Er kennt die Regeln nicht und
   rechnet nichts. Er sammelt nur Befehle und veroeffentlicht
   sie fuenfmal je Sekunde als Runde. Weil jeder Browser
   dieselbe Simulation aus derselben Saat rechnet, genuegt das
   fuer eine gleiche Sicht bei allen — und es bleibt wenig zu
   uebertragen, auch bei acht Spielern und tausend Einheiten.

   Uebertragen wird per Langabfrage: Anfragen werden offen
   gehalten, bis es etwas Neues gibt oder die Zeit ablaeuft.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* Laenge einer Befehlsrunde — muss zu RUNDE_TAKTE × TAKT_MS im
   Regelwerk passen (2 × 100 ms). */
export const RUNDE_MS = 200;
/* So lange wird eine Langabfrage offen gehalten. */
const WARTE_MS = 25000;
/* Ohne Lebenszeichen gilt ein Spieler als verschwunden. */
const WEG_MS = 40000;
/* Nach dieser Zeit ohne Spieler wird eine Partie geraeumt. */
const RAEUM_MS = 120000;

export class Partien {
  constructor(datenPfad) {
    this.datenPfad = datenPfad;
    this.replayPfad = path.join(datenPfad, 'replays');
    fs.mkdirSync(this.replayPfad, { recursive: true });
    this.spieler = new Map();     // token → { id, name, partie, letzterKontakt }
    this.partien = new Map();     // id → Partie
    this.lobbyV = 1;
    this.lobbyWarter = [];
    this.naechsteId = 1;
    setInterval(() => this.aufraeumen(), 5000).unref?.();
  }

  /* ─────────────── Spieler ─────────────── */

  anmelden(name) {
    const token = crypto.randomBytes(16).toString('hex');
    const sauber = String(name || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Feldherr';
    const s = { token, id: this.naechsteId++, name: sauber, partie: null, letzterKontakt: Date.now() };
    this.spieler.set(token, s);
    return { token, id: s.id, name: s.name };
  }

  spielerVon(token) {
    const s = this.spieler.get(token);
    if (s) s.letzterKontakt = Date.now();
    return s || null;
  }

  /* ─────────────── Lobby ─────────────── */

  lobbyListe() {
    const raus = [];
    for (const p of this.partien.values()) {
      if (p.beendet) continue;
      raus.push({
        id: p.id, name: p.name, karte: p.karte,
        plaetze: p.plaetze.length,
        belegt: p.plaetze.filter(x => x.token || x.ki).length,
        gestartet: p.gestartet,
        zuschauer: p.zuschauer.length,
        dauer: p.gestartet ? Math.round((Date.now() - p.begonnen) / 1000) : 0
      });
    }
    return raus;
  }

  lobbyAendern() {
    this.lobbyV++;
    for (const w of this.lobbyWarter.splice(0)) w();
  }

  wartenLobby(version) {
    if (version !== this.lobbyV) return Promise.resolve();
    return new Promise(loesen => {
      const w = () => { clearTimeout(uhr); loesen(); };
      const uhr = setTimeout(() => {
        const i = this.lobbyWarter.indexOf(w);
        if (i >= 0) this.lobbyWarter.splice(i, 1);
        loesen();
      }, WARTE_MS);
      this.lobbyWarter.push(w);
    });
  }

  /* ─────────────── Partie eroeffnen und betreten ─────────────── */

  erstellen(s, o) {
    if (s.partie) this.verlassen(s);
    const id = crypto.randomBytes(6).toString('hex');
    const anzahl = Math.max(2, Math.min(9, Number(o.plaetze) || 4));
    const p = {
      id,
      name: String(o.name || (s.name + 's Partie')).slice(0, 40),
      wirt: s.token,
      karte: {
        art: erlaubt(o.karte && o.karte.art, ['ebene', 'seen', 'hochland', 'waelder', 'kueste'], 'ebene'),
        groesse: erlaubt(o.karte && o.karte.groesse, ['klein', 'mittel', 'gross', 'riesig', 'gewaltig'], 'mittel'),
        wasser: erlaubt(Number(o.karte && o.karte.wasser), [0, 1, 2, 3], 0),
        berge: erlaubt(Number(o.karte && o.karte.berge), [0, 1, 2, 3], 1),
        rohstoffe: erlaubt(Number(o.karte && o.karte.rohstoffe), [0, 1, 2], 1)
      },
      bevGrenze: erlaubt(Number(o.bevGrenze), [50, 100, 200], 100),
      startgut: erlaubt(o.startgut, ['normal', 'reich'], 'normal'),
      saat: (crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1,
      plaetze: [],
      zuschauer: [],
      chat: [],
      gestartet: false, beendet: false, begonnen: 0,
      runden: [], offen: [], uhr: null,
      v: 1, warter: [], rundenWarter: [],
      pruefsummen: new Map(),
      letzteTat: Date.now()
    };
    for (let i = 0; i < anzahl; i++) {
      p.plaetze.push({ token: null, name: null, volk: ['franken', 'briten', 'byzantiner', 'mongolen'][i % 4],
                       team: i + 1, ki: null, zu: false, bereit: false });
    }
    p.plaetze[0].token = s.token;
    p.plaetze[0].name = s.name;
    p.plaetze[0].team = 1;
    /* Die uebrigen Plaetze stehen zunaechst auf „Rechner normal“,
       damit eine Partie auch allein sofort spielbar ist. */
    for (let i = 1; i < anzahl; i++) { p.plaetze[i].ki = 'normal'; p.plaetze[i].team = i + 1; }
    this.partien.set(id, p);
    s.partie = id;
    this.lobbyAendern();
    return p;
  }

  beitreten(s, id, alsZuschauer) {
    const p = this.partien.get(id);
    if (!p || p.beendet) throw new Fehler('Partie gibt es nicht mehr');
    if (s.partie && s.partie !== id) this.verlassen(s);
    if (p.gestartet || alsZuschauer) {
      if (!p.zuschauer.includes(s.token)) p.zuschauer.push(s.token);
      s.partie = id;
      this.aendern(p);
      return p;
    }
    let platz = p.plaetze.find(x => x.token === s.token);
    if (!platz) {
      platz = p.plaetze.find(x => !x.token && !x.zu);
      if (!platz) throw new Fehler('Kein Platz mehr frei');
      platz.token = s.token;
      platz.name = s.name;
      platz.ki = null;
      platz.bereit = false;
    }
    s.partie = id;
    this.aendern(p);
    this.lobbyAendern();
    return p;
  }

  meine(s) {
    if (!s.partie) return null;
    return this.partien.get(s.partie) || null;
  }

  platz(s, feld, wert) {
    const p = this.meine(s);
    if (!p || p.gestartet) return;
    const nummer = Number(wert.platz);
    const pl = p.plaetze[nummer];
    if (!pl) return;
    const binWirt = p.wirt === s.token;
    const meiner = pl.token === s.token;
    if (!meiner && !binWirt) return;
    if (feld === 'volk') pl.volk = erlaubt(wert.wert, ['franken', 'briten', 'byzantiner', 'mongolen'], pl.volk);
    else if (feld === 'team') pl.team = Math.max(1, Math.min(p.plaetze.length, Number(wert.wert) || 1));
    else if (feld === 'art' && binWirt && !meiner) {
      const w = String(wert.wert || '');
      if (w === 'zu') { pl.zu = true; pl.ki = null; this.werfen(p, pl); }
      else if (w === '') { pl.zu = false; pl.ki = null; }
      else if (['leicht', 'normal', 'schwer'].includes(w)) { pl.zu = false; pl.ki = w; this.werfen(p, pl); }
    }
    this.aendern(p);
  }

  werfen(p, pl) {
    if (!pl.token) return;
    const s = this.spieler.get(pl.token);
    if (s) s.partie = null;
    pl.token = null; pl.name = null; pl.bereit = false;
  }

  einstellung(s, feld, wert) {
    const p = this.meine(s);
    if (!p || p.gestartet || p.wirt !== s.token) return;
    if (feld === 'kartenart') {
      p.karte.art = erlaubt(wert, ['ebene', 'seen', 'hochland', 'waelder', 'kueste'], p.karte.art);
      /* Die Kartenart setzt Wasser und Berge neu vor. */
      const vorgabe = { ebene: [0, 1], seen: [2, 1], hochland: [1, 3], waelder: [1, 1], kueste: [3, 1] }[p.karte.art];
      if (vorgabe) { p.karte.wasser = vorgabe[0]; p.karte.berge = vorgabe[1]; }
    }
    if (feld === 'kartengroesse') p.karte.groesse = erlaubt(wert, ['klein', 'mittel', 'gross', 'riesig', 'gewaltig'], p.karte.groesse);
    if (feld === 'wasser') p.karte.wasser = erlaubt(Number(wert), [0, 1, 2, 3], p.karte.wasser);
    if (feld === 'berge') p.karte.berge = erlaubt(Number(wert), [0, 1, 2, 3], p.karte.berge);
    if (feld === 'rohstoffe') p.karte.rohstoffe = erlaubt(Number(wert), [0, 1, 2], p.karte.rohstoffe);
    if (feld === 'bevGrenze') p.bevGrenze = erlaubt(Number(wert), [50, 100, 200], p.bevGrenze);
    if (feld === 'startgut') p.startgut = erlaubt(wert, ['normal', 'reich'], p.startgut);
    this.aendern(p);
    this.lobbyAendern();
  }

  bereit(s, b) {
    const p = this.meine(s);
    if (!p || p.gestartet) return;
    const pl = p.plaetze.find(x => x.token === s.token);
    if (pl) pl.bereit = !!b;
    this.aendern(p);
  }

  chat(s, text) {
    const p = this.meine(s);
    if (!p) return;
    p.chat.push({ name: s.name, text: String(text).slice(0, 200) });
    if (p.chat.length > 60) p.chat.shift();
    this.aendern(p);
  }

  /* ─────────────── Start und Rundentakt ─────────────── */

  starten(s) {
    const p = this.meine(s);
    if (!p || p.gestartet) return;
    if (p.wirt !== s.token) throw new Fehler('Nur der Wirt kann starten');
    const aktive = p.plaetze.filter(x => !x.zu && (x.token || x.ki));
    if (aktive.length < 2) throw new Fehler('Es braucht mindestens zwei Teilnehmer');
    const menschen = p.plaetze.filter(x => x.token);
    if (menschen.some(x => !x.bereit && x.token !== p.wirt)) throw new Fehler('Nicht alle sind bereit');
    p.gestartet = true;
    p.begonnen = Date.now();
    /* Ab jetzt laeuft die Uhr: jede Runde wird veroeffentlicht,
       ob Befehle da sind oder nicht. Wer hinterherhinkt, holt auf. */
    p.uhr = setInterval(() => this.rundeVeroeffentlichen(p), RUNDE_MS);
    if (p.uhr.unref) p.uhr.unref();
    this.aendern(p);
    this.lobbyAendern();
  }

  rundeVeroeffentlichen(p) {
    p.runden.push(p.offen);
    p.offen = [];
    for (const w of p.rundenWarter.splice(0)) w();
    /* Ist niemand mehr da, wird die Partie geschlossen. */
    const jetzt = Date.now();
    const lebend = p.plaetze.some(x => x.token && this.lebt(x.token, jetzt))
                || p.zuschauer.some(t => this.lebt(t, jetzt));
    if (!lebend && jetzt - p.letzteTat > RAEUM_MS) this.beenden(p);
  }

  lebt(token, jetzt) {
    const s = this.spieler.get(token);
    return !!s && (jetzt - s.letzterKontakt) < WEG_MS;
  }

  befehle(s, liste) {
    const p = this.meine(s);
    if (!p || !p.gestartet || p.beendet) return;
    const nummer = p.plaetze.findIndex(x => x.token === s.token);
    if (nummer < 0) return;             // Zuschauer duerfen nichts
    /* Die Spielernummer setzt der Server — niemand befiehlt fuer andere. */
    const aktive = p.plaetze.filter(x => !x.zu);
    const simNummer = aktive.findIndex(x => x.token === s.token);
    for (const c of (liste || []).slice(0, 60)) {
      if (!c || typeof c.a !== 'string') continue;
      c.s = simNummer;
      p.offen.push(c);
    }
    p.letzteTat = Date.now();
  }

  runden(s, ab) {
    const p = this.meine(s);
    if (!p) throw new Fehler('Du bist in keiner Partie');
    return { p, ab: Math.max(0, ab | 0) };
  }

  wartenRunden(p) {
    return new Promise(loesen => {
      const w = () => { clearTimeout(uhr); loesen(); };
      const uhr = setTimeout(() => {
        const i = p.rundenWarter.indexOf(w);
        if (i >= 0) p.rundenWarter.splice(i, 1);
        loesen();
      }, 8000);
      p.rundenWarter.push(w);
    });
  }

  pruefsumme(s, runde, summe) {
    const p = this.meine(s);
    if (!p) return { gleich: true };
    let eintrag = p.pruefsummen.get(runde);
    if (!eintrag) { eintrag = new Map(); p.pruefsummen.set(runde, eintrag); }
    eintrag.set(s.token, summe);
    const werte = [...eintrag.values()];
    const gleich = werte.every(w => w === werte[0]);
    if (!gleich && !p.desyncGemeldet) {
      p.desyncGemeldet = true;
      console.warn('[aog] Pruefsummen weichen ab in Partie ' + p.id + ' bei Runde ' + runde);
    }
    /* Alte Eintraege wegwerfen. */
    if (p.pruefsummen.size > 40) {
      const aelteste = Math.min(...p.pruefsummen.keys());
      p.pruefsummen.delete(aelteste);
    }
    return { gleich };
  }

  verlassen(s) {
    const p = this.meine(s);
    s.partie = null;
    if (!p) return;
    const pl = p.plaetze.find(x => x.token === s.token);
    if (pl) { pl.token = null; pl.name = null; pl.bereit = false; if (p.gestartet) pl.weg = true; }
    const zi = p.zuschauer.indexOf(s.token);
    if (zi >= 0) p.zuschauer.splice(zi, 1);
    if (p.wirt === s.token) {
      const naechster = p.plaetze.find(x => x.token);
      if (naechster) p.wirt = naechster.token;
      else if (!p.gestartet) this.beenden(p);
    }
    this.aendern(p);
    this.lobbyAendern();
  }

  beenden(p) {
    if (p.beendet) return;
    p.beendet = true;
    if (p.uhr) clearInterval(p.uhr);
    if (p.gestartet && p.runden.length > 30) this.replaySchreibenAusPartie(p);
    this.partien.delete(p.id);
    this.aendern(p);
    this.lobbyAendern();
  }

  aufraeumen() {
    const jetzt = Date.now();
    for (const [token, s] of this.spieler) {
      if (jetzt - s.letzterKontakt > WEG_MS * 6) {
        if (s.partie) this.verlassen(s);
        this.spieler.delete(token);
      }
    }
    for (const p of [...this.partien.values()]) {
      const jemand = p.plaetze.some(x => x.token && this.lebt(x.token, jetzt))
                  || p.zuschauer.some(t => this.lebt(t, jetzt));
      if (!jemand && jetzt - p.letzteTat > RAEUM_MS) this.beenden(p);
    }
  }

  /* ─────────────── Sicht auf den Warteraum ─────────────── */

  sicht(p, s) {
    return {
      id: p.id, name: p.name, karte: p.karte, saat: p.saat,
      bevGrenze: p.bevGrenze, startgut: p.startgut,
      gestartet: p.gestartet, beendet: p.beendet,
      wirtToken: p.wirt === s.token,
      chat: p.chat.slice(-40),
      zuschauer: p.zuschauer.length,
      plaetze: p.plaetze.map(x => ({
        name: x.name, volk: x.volk, team: x.team, ki: x.ki, zu: x.zu,
        bereit: x.bereit, weg: !!x.weg, ich: x.token === s.token
      }))
    };
  }

  aendern(p) {
    p.v++;
    p.letzteTat = Date.now();
    for (const w of p.warter.splice(0)) w();
  }

  wartenRaum(p, version) {
    if (version !== p.v) return Promise.resolve();
    return new Promise(loesen => {
      const w = () => { clearTimeout(uhr); loesen(); };
      const uhr = setTimeout(() => {
        const i = p.warter.indexOf(w);
        if (i >= 0) p.warter.splice(i, 1);
        loesen();
      }, WARTE_MS);
      p.warter.push(w);
    });
  }

  /* ─────────────── Aufzeichnungen ─────────────── */

  replaySchreibenAusPartie(p) {
    const aktive = p.plaetze.filter(x => !x.zu);
    const daten = {
      name: p.name,
      zeit: p.begonnen,
      aufbau: {
        saat: p.saat, karte: p.karte, bevGrenze: p.bevGrenze, startgut: p.startgut,
        spieler: aktive.map((x, i) => ({
          name: x.name || ('Rechner ' + (i + 1)), volk: x.volk,
          team: (x.team || 1) - 1, farbe: i, ki: x.ki || null
        }))
      },
      runden: p.runden
    };
    this.replaySchreiben(daten);
  }

  replaySchreiben(daten) {
    if (!daten || !daten.aufbau || !Array.isArray(daten.runden)) throw new Fehler('Aufzeichnung unvollstaendig');
    if (daten.runden.length > 200000) throw new Fehler('Aufzeichnung zu lang');
    const id = crypto.randomBytes(6).toString('hex');
    const eintrag = {
      id,
      name: String(daten.name || 'Partie').slice(0, 60),
      zeit: Number(daten.zeit) || Date.now(),
      dauer: Math.round(daten.runden.length * RUNDE_MS / 1000),
      spieler: (daten.aufbau.spieler || []).map(s => String(s.name).slice(0, 20)),
      aufbau: daten.aufbau,
      runden: daten.runden
    };
    const text = JSON.stringify(eintrag);
    if (text.length > 40 * 1024 * 1024) throw new Fehler('Aufzeichnung zu gross');
    fs.writeFileSync(path.join(this.replayPfad, id + '.json'), text);
    this.replaysAufraeumen();
    return { id };
  }

  replayListe() {
    const raus = [];
    for (const datei of fs.readdirSync(this.replayPfad)) {
      if (!datei.endsWith('.json')) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(this.replayPfad, datei), 'utf8'));
        raus.push({ id: d.id, name: d.name, zeit: d.zeit, dauer: d.dauer, spieler: d.spieler || [] });
      } catch (e) { /* kaputte Datei ueberspringen */ }
    }
    raus.sort((a, b) => b.zeit - a.zeit);
    return raus.slice(0, 60);
  }

  replayLesen(id) {
    if (!/^[0-9a-f]{6,32}$/.test(String(id))) throw new Fehler('Unbekannte Aufzeichnung');
    const pfad = path.join(this.replayPfad, id + '.json');
    if (!fs.existsSync(pfad)) throw new Fehler('Unbekannte Aufzeichnung');
    return JSON.parse(fs.readFileSync(pfad, 'utf8'));
  }

  replaysAufraeumen() {
    const dateien = fs.readdirSync(this.replayPfad).filter(d => d.endsWith('.json'))
      .map(d => ({ d, t: fs.statSync(path.join(this.replayPfad, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const alt of dateien.slice(80)) {
      try { fs.unlinkSync(path.join(this.replayPfad, alt.d)); } catch (e) {}
    }
  }
}

export class Fehler extends Error {}

function erlaubt(wert, liste, ersatz) {
  return liste.includes(wert) ? wert : ersatz;
}
