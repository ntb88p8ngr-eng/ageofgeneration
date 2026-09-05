/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Simulation

   Das eigentliche Spiel. Wichtigste Eigenschaft: Sie laeuft
   auf jedem Rechner gleich. Deshalb

     * nur ganze Zahlen (Positionen in Fixpunkt, 1024 = 1 Kachel),
     * keine Winkelfunktionen, kein Math.random,
     * feste Reihenfolge bei allem, was durchlaufen wird,
     * keine Abhaengigkeit von Bildrate oder Uhrzeit.

   Der Netzwerkteil schickt deshalb nur Befehle hin und her,
   nie Spielstaende. Zur Sicherheit rechnet jede Runde eine
   Pruefsumme mit; laufen zwei Rechner auseinander, faellt es
   sofort auf.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import {
  FP, TAKTE_PRO_S, RUNDE_TAKTE, tempoFP, takte,
  ROHSTOFFE, ZEITALTER, VOELKER, GEBAEUDE, EINHEITEN, TECHS, STUFEN_WIRKUNG,
  VORKOMMEN, SAMMELTEMPO, TRAGKRAFT, HANDEL, BODEN,
  kosten as kostenVon, aufstiegKosten, spezialEinheit
} from './regeln.js';
import { Zufall, iwurzel, abstand2, klemme, summe32 } from './zufall.js';
import { erzeugeKarte, VORKOMMEN_LISTE, begehbar, idx, drin } from './karte.js';
import { Pfadfinder, GESPERRT } from './pfad.js';
import { KI } from './ki.js';

/* Zustaende einer Einheit. */
export const ZUSTAND = {
  ruhig: 0, gehen: 1, sammeln: 2, zurueck: 3, bauen: 4,
  angreifen: 5, folgen: 6, heilen: 7, bekehren: 8, reparieren: 9, tot: 10
};

export const HALTUNG = { aggressiv: 0, defensiv: 1, stellung: 2, passiv: 3 };

/* Wie oft bestimmte Arbeiten anfallen (in Takten). */
const ZIELSUCHE_TAKT = 5;
const SICHT_TAKT = 5;
const SIEG_TAKT = 20;
const PFADE_PRO_TAKT = 20;
/* So weit verfolgt eine Einheit ein selbst gewaehltes Ziel (in Fixpunkt). */
const VERFOLGUNG = 12 * FP;

export class Sim {
  /**
   * @param {object} aufbau
   *   saat        Zahl — bestimmt Karte und alle Zufaelle
   *   karte       { groesse, art }
   *   spieler     [{ name, volk, team, farbe, ki }]
   *   bevGrenze   Bevoelkerungsgrenze (Standard 100)
   *   startgut    'wenig' | 'normal' | 'reich'
   */
  constructor(aufbau) {
    this.aufbau = aufbau;
    this.takt = 0;
    this.runde = 0;
    this.naechsteId = 1;
    this.zufall = new Zufall((aufbau.saat | 0) ^ 0x5eed);
    this.vorbei = false;
    this.sieger = null;      // Team-Nummer oder null
    this.ereignisse = [];    // fuer Ton und Meldungen, wird je Takt geleert

    this.karte = erzeugeKarte({
      saat: aufbau.saat,
      groesse: aufbau.karte ? aufbau.karte.groesse : 'mittel',
      art: aufbau.karte ? aufbau.karte.art : 'ebene',
      plaetze: aufbau.spieler.length
    });
    const n = this.karte.breite * this.karte.hoehe;

    /* Statisches Hindernisgitter fuer die Wegsuche. */
    this.sperre = new Uint8Array(n);
    this.belegt = new Int32Array(n);   // Gebaeude-Nummer + 1 je Kachel
    this.hindernisAufbauen();
    this.pfadfinder = new Pfadfinder(this.karte.breite, this.karte.hoehe);
    this.pfadWarteschlange = [];

    /* Entitaeten. Reihenfolge = Erzeugungsreihenfolge, nie umsortieren! */
    this.einheiten = [];
    this.gebaeude = [];
    this.geschosse = [];
    this.nachId = new Map();

    /* Spieler */
    const startgut = { wenig: [200, 200, 100, 200], normal: [200, 200, 100, 200],
                       reich: [1000, 1000, 800, 800] }[aufbau.startgut || 'normal'];
    this.spieler = aufbau.spieler.map((p, i) => ({
      id: i, name: p.name || ('Spieler ' + (i + 1)),
      volk: VOELKER[p.volk] ? p.volk : 'franken',
      team: p.team == null ? i : p.team,
      farbe: p.farbe == null ? i : p.farbe,
      ki: p.ki || null,
      besiegt: false, aufgegeben: false,
      zeitalter: 0, aufstieg: null,
      rohstoffe: { nahrung: startgut[0], holz: startgut[1], gold: startgut[2], stein: startgut[3] },
      bev: 0, bevRaum: 0, bevGrenze: aufbau.bevGrenze || 100,
      techs: {}, stufen: {},
      preise: { nahrung: HANDEL.startpreis, holz: HANDEL.startpreis, stein: HANDEL.startpreis },
      erkundet: new Uint8Array(n), sichtbar: new Uint8Array(n),
      werteCache: new Map(),
      statistik: { gesammelt: { nahrung: 0, holz: 0, gold: 0, stein: 0 },
                   getoetet: 0, verloren: 0, gebaut: 0, einheiten: 0 },
      kiZustand: null
    }));
    for (const p of this.spieler) if (p.ki) p.kiZustand = KI.anfang(this, p);

    this.startaufstellung();
    this.sichtErneuern();
  }

  /* ─────────────── Nachschlagen ─────────────── */

  ent(id) { return this.nachId.get(id) || null; }
  lebt(e) { return !!e && !e.tot; }
  verbuendet(a, b) {
    if (a === b) return true;
    const pa = this.spieler[a], pb = this.spieler[b];
    return !!pa && !!pb && pa.team === pb.team;
  }
  kachelIdx(x, y) { return y * this.karte.breite + x; }
  /** Fixpunkt → Kachel */
  kx(e) { return (e.x / FP) | 0; }
  ky(e) { return (e.y / FP) | 0; }

  /* ─────────────── Werte mit Boni und Technologien ───────────────
     Ein Ritter der Franken ist ein anderer als ein Ritter der
     Briten. Statt das ueberall auszurechnen, gibt es diese
     Stelle — mit Zwischenspeicher, weil sie oft gefragt wird. */

  werte(spielerId, typ) {
    const p = this.spieler[spielerId];
    const c = p.werteCache.get(typ);
    if (c) return c;
    const def = EINHEITEN[typ];
    if (!def) return null;
    const v = VOELKER[p.volk];
    const w = {
      typ, name: def.name, klasse: def.klasse,
      hp: def.hp, tempo: def.tempo, sicht: def.sicht, bev: def.bev,
      ruestungNah: def.ruestung.nah, ruestungFern: def.ruestung.fern,
      schaden: def.angriff ? def.angriff.schaden : 0,
      reichweite: def.angriff ? def.angriff.reichweite : 0,
      angriffTempo: def.angriff ? def.angriff.tempo : 0,
      flugzeit: def.angriff && def.angriff.flugzeit || 0,
      flaeche: def.angriff && def.angriff.flaeche || 0,
      fern: !!(def.angriff && def.angriff.art === 'fern'),
      bonus: Object.assign({}, def.bonus || {}),
      heilt: def.heilt || null, bekehrt: def.bekehrt || null,
      kannBauen: !!def.kannBauen, kannSammeln: !!def.kannSammeln
    };

    /* Ausbaustufen (Milizionaer → Langschwert …) */
    if (def.stufen) for (const s of def.stufen) {
      if (!p.techs[s]) continue;
      const w2 = STUFEN_WIRKUNG[s];
      if (!w2) continue;
      w.name = w2.name;
      w.hp += w2.hp || 0;
      w.schaden += w2.schaden || 0;
      w.reichweite += w2.reichweite || 0;
      w.ruestungNah += w2.ruestungNah || 0;
      if (w2.bonus) for (const k in w2.bonus) w.bonus[k] = (w.bonus[k] || 0) + w2.bonus[k];
    }
    /* Schmiede-Technologien */
    let angriffPlus = 0, ruestungPlus = 0;
    for (const t in p.techs) {
      const tech = TECHS[t];
      if (!tech || !tech.wirkung) continue;
      if (tech.wirkung.angriff) angriffPlus += tech.wirkung.angriff;
      if (tech.wirkung.ruestung) ruestungPlus += tech.wirkung.ruestung;
      if (tech.wirkung.dorfTempo && def.klasse === 'dorf') w.tempo = w.tempo * tech.wirkung.dorfTempo / 100;
      if (tech.wirkung.moenchHP && def.klasse === 'moench') w.hp = Math.round(w.hp * tech.wirkung.moenchHP / 100);
    }
    if (def.klasse !== 'dorf' && def.angriff) w.schaden += angriffPlus;
    if (def.klasse !== 'belagerung') { w.ruestungNah += ruestungPlus; w.ruestungFern += ruestungPlus; }

    /* Volksboni */
    for (const b of v.boni) {
      if (b.art === 'einheitHP' && def.klasse === b.klasse) w.hp = Math.round(w.hp * b.faktor / 100);
      if (b.art === 'tempo' && def.klasse === b.klasse) w.tempo = w.tempo * b.faktor / 100;
      if (b.art === 'reichweite' && def.klasse === b.klasse && p.zeitalter >= (b.abZeitalter || 0)) w.reichweite += b.wert;
      if (b.art === 'sicht' && b.einheiten.indexOf(typ) >= 0) w.sicht += b.wert;
    }

    /* In Fixpunkt umrechnen — ab hier rechnet die Simulation. */
    w.tempoFP = tempoFP(w.tempo);
    w.reichweiteFP = Math.round(w.reichweite * FP);
    w.reichweite2 = w.reichweiteFP * w.reichweiteFP;
    w.sichtFP = w.sicht * FP;
    w.angriffTakte = w.angriffTempo ? takte(w.angriffTempo) : 0;
    w.flugTakte = w.flugzeit ? takte(w.flugzeit) : 0;
    w.flaecheFP = Math.round(w.flaeche * FP);
    p.werteCache.set(typ, w);
    return w;
  }

  gebaeudeWerte(spielerId, typ) {
    const p = this.spieler[spielerId];
    const schluessel = 'B:' + typ;
    const c = p.werteCache.get(schluessel);
    if (c) return c;
    const def = GEBAEUDE[typ];
    const v = VOELKER[p.volk];
    const w = {
      typ, name: def.name, groesse: def.groesse,
      hp: def.hp, sicht: def.sicht, bev: def.bev || 0,
      ruestungNah: def.ruestung.nah, ruestungFern: def.ruestung.fern,
      bauzeit: def.bauzeit,
      waffe: def.waffe ? Object.assign({}, def.waffe) : null
    };
    for (const b of v.boni) {
      if (b.art === 'gebaeudeHP') w.hp = Math.round(w.hp * b.faktor / 100);
      if (b.art === 'bautempo' && b.bau === typ) w.bauzeit = Math.round(w.bauzeit * 100 / b.faktor);
    }
    if (p.techs.mauerwerk) w.hp = Math.round(w.hp * TECHS.mauerwerk.wirkung.gebaeudeHP / 100);
    if (w.waffe && p.techs.wehrturm && (typ === 'turm')) {
      w.waffe.schaden += TECHS.wehrturm.wirkung.turmSchaden;
      w.waffe.reichweite += TECHS.wehrturm.wirkung.turmReichweite;
    }
    if (w.waffe) {
      w.waffe.reichweiteFP = Math.round(w.waffe.reichweite * FP);
      w.waffe.reichweite2 = w.waffe.reichweiteFP * w.waffe.reichweiteFP;
      w.waffe.takte = takte(w.waffe.tempo);
    }
    w.bauTakte = takte(w.bauzeit);
    w.sichtFP = w.sicht * FP;
    p.werteCache.set(schluessel, w);
    return w;
  }

  werteVerwerfen(spielerId) {
    this.spieler[spielerId].werteCache.clear();
    /* Trefferpunkte bestehender Einheiten mitziehen (z. B. nach einer Stufe). */
    for (const e of this.einheiten) {
      if (e.tot || e.spieler !== spielerId) continue;
      const w = this.werte(spielerId, e.typ);
      if (w.hp !== e.hpMax) { const d = w.hp - e.hpMax; e.hpMax = w.hp; e.hp = Math.min(w.hp, e.hp + Math.max(0, d)); }
    }
    for (const g of this.gebaeude) {
      if (g.tot || g.spieler !== spielerId) continue;
      const w = this.gebaeudeWerte(spielerId, g.typ);
      if (w.hp !== g.hpMax) { const d = w.hp - g.hpMax; g.hpMax = w.hp; g.hp = Math.min(w.hp, g.hp + Math.max(0, d)); }
    }
  }

  /* ─────────────── Hindernisse ─────────────── */

  hindernisAufbauen() {
    const k = this.karte;
    for (let y = 0; y < k.hoehe; y++) for (let x = 0; x < k.breite; x++) {
      const i = y * k.breite + x;
      this.sperre[i] = begehbar(k, x, y) ? 0 : GESPERRT;
    }
  }

  sperreSetzen(x, y) {
    const i = this.kachelIdx(x, y);
    const frei = begehbar(this.karte, x, y) && !this.belegt[i];
    this.sperre[i] = frei ? 0 : GESPERRT;
  }

  /* ─────────────── Aufstellung ───────────────
     Jeder beginnt mit Dorfzentrum, drei Dorfbewohnern und
     einem Spaeher — wie in der Standardaufstellung des Vorbilds. */

  startaufstellung() {
    /* Verbuendete stehen nebeneinander: Startplaetze werden nach
       Team vergeben, nicht nach Spielernummer. */
    const nachTeam = this.spieler.map((p, i) => ({ i, team: p.team }))
      .sort((a, b) => a.team - b.team || a.i - b.i);
    nachTeam.forEach((eintrag, platz) => {
      const p = this.spieler[eintrag.i];
      const s = this.karte.start[platz % this.karte.start.length];
      p.startX = s.x; p.startY = s.y;
      const tc = this.gebaeudeSetzen(p.id, 'dorfzentrum', s.x - 2, s.y - 2, true);
      if (tc) { tc.treffpunkt = { x: (s.x + 3) * FP, y: (s.y + 3) * FP }; }
      for (let d = 0; d < 3; d++) {
        this.einheitSetzen(p.id, 'dorfbewohner', (s.x + 3 + d) * FP + FP / 2, (s.y + 3) * FP + FP / 2);
      }
      this.einheitSetzen(p.id, 'spaeher', (s.x - 3) * FP, (s.y + 3) * FP);
    });
  }

  /* ─────────────── Entitaeten erzeugen ─────────────── */

  einheitSetzen(spielerId, typ, x, y) {
    const w = this.werte(spielerId, typ);
    if (!w) return null;
    const e = {
      id: this.naechsteId++, art: 'einheit', typ, spieler: spielerId,
      x: x | 0, y: y | 0, altX: x | 0, altY: y | 0,
      hp: w.hp, hpMax: w.hp, richtung: 0, zustand: ZUSTAND.ruhig,
      haltung: HALTUNG.aggressiv,
      pfad: null, pfadI: 0, zielX: x | 0, zielY: y | 0,
      befehl: null, folge: [],           // Warteschlange weiterer Befehle
      zielId: 0, angriffRest: 0, ladung: 0, ladungArt: null, sammelRest: 0,
      quelleI: -1, abgabeId: 0, bauId: 0, bekehrRest: 0, ruheRest: 0,
      steckRest: 0, warteRest: 0, bauVersuche: 0, tot: false, neu: true
    };
    this.einheiten.push(e);
    this.nachId.set(e.id, e);
    const p = this.spieler[spielerId];
    p.bev += w.bev;
    p.statistik.einheiten++;
    return e;
  }

  /** Prueft, ob dort gebaut werden darf. */
  bauplatzFrei(spielerId, typ, kx, ky, ignoriereSicht) {
    const def = GEBAEUDE[typ];
    if (!def) return false;
    const g = def.groesse;
    const k = this.karte;
    for (let y = ky; y < ky + g; y++) for (let x = kx; x < kx + g; x++) {
      if (!drin(k, x, y)) return false;
      const i = y * k.breite + x;
      if (k.boden[i] === BODEN.wasser || k.boden[i] === BODEN.fels) return false;
      if (k.vorkommen[i]) return false;
      if (this.belegt[i]) return false;
      if (!ignoriereSicht && !this.spieler[spielerId].erkundet[i]) return false;
    }
    /* Es muss auch jemand hinkommen koennen: mindestens drei freie
       Felder rund um den Bauplatz. Sonst steht das Gebaeude in einer
       Waldluecke und niemand kann es je fertigstellen. */
    let frei = 0;
    for (let y = ky - 1; y <= ky + g; y++) {
      for (let x = kx - 1; x <= kx + g; x++) {
        if (x > kx - 1 && x < kx + g && y > ky - 1 && y < ky + g) continue;
        if (!drin(k, x, y)) continue;
        const j = y * k.breite + x;
        if (this.belegt[j]) continue;
        if (k.boden[j] === BODEN.wasser || k.boden[j] === BODEN.fels) continue;
        if (k.vorkommen[j] === 1 || k.vorkommen[j] === 5 || k.vorkommen[j] === 6) continue;
        frei++;
      }
    }
    if (frei < 3) return false;

    /* Flaches Gelaende verlangt: kein Bau ueber Hangkanten. */
    const h0 = k.hoehen[ky * k.breite + kx];
    for (let y = ky; y < ky + g; y++) for (let x = kx; x < kx + g; x++) {
      if (Math.abs(k.hoehen[y * k.breite + x] - h0) > 1) return false;
    }
    return true;
  }

  gebaeudeSetzen(spielerId, typ, kx, ky, fertig) {
    const w = this.gebaeudeWerte(spielerId, typ);
    const def = GEBAEUDE[typ];
    const g = def.groesse;
    const b = {
      id: this.naechsteId++, art: 'gebaeude', typ, spieler: spielerId,
      kx, ky, groesse: g,
      x: kx * FP + (g * FP) / 2, y: ky * FP + (g * FP) / 2,
      hpMax: w.hp, hp: fertig ? w.hp : 1,
      fertig: !!fertig, bauFortschritt: fertig ? w.bauTakte * 10 : 0, bauGesamt: w.bauTakte * 10,
      warteschlange: [], forschung: null, treffpunkt: null,
      vorrat: def.vorrat || 0, angriffRest: 0, bauer: 0,
      tot: false, neu: true
    };
    this.gebaeude.push(b);
    this.nachId.set(b.id, b);
    for (let y = ky; y < ky + g; y++) for (let x = kx; x < kx + g; x++) {
      const i = y * this.karte.breite + x;
      this.belegt[i] = b.id;
      this.sperre[i] = GESPERRT;
    }
    if (fertig) this.gebaeudeFertig(b);
    return b;
  }

  gebaeudeFertig(b) {
    b.fertig = true;
    b.hp = b.hpMax;
    const w = this.gebaeudeWerte(b.spieler, b.typ);
    if (w.bev) this.spieler[b.spieler].bevRaum += w.bev;
    this.spieler[b.spieler].statistik.gebaut++;
    this.ereignisse.push({ art: 'gebaeudeFertig', id: b.id, spieler: b.spieler, typ: b.typ });
  }

  /* ─────────────── Entfernen ─────────────── */

  einheitTot(e, taeter) {
    if (e.tot) return;
    e.tot = true; e.zustand = ZUSTAND.tot;
    const w = this.werte(e.spieler, e.typ);
    const p = this.spieler[e.spieler];
    p.bev -= w.bev;
    p.statistik.verloren++;
    if (taeter != null && this.spieler[taeter]) this.spieler[taeter].statistik.getoetet++;
    this.ereignisse.push({ art: 'einheitTot', id: e.id, spieler: e.spieler, typ: e.typ, x: e.x, y: e.y });
  }

  gebaeudeWeg(b, taeter) {
    if (b.tot) return;
    b.tot = true;
    const w = this.gebaeudeWerte(b.spieler, b.typ);
    if (b.fertig && w.bev) this.spieler[b.spieler].bevRaum -= w.bev;
    /* Warteschlange erstatten */
    for (const auftrag of b.warteschlange) this.erstatten(b.spieler, auftrag.kosten);
    b.warteschlange.length = 0;
    for (let y = b.ky; y < b.ky + b.groesse; y++) for (let x = b.kx; x < b.kx + b.groesse; x++) {
      const i = y * this.karte.breite + x;
      if (this.belegt[i] === b.id) { this.belegt[i] = 0; this.sperreSetzen(x, y); }
    }
    this.ereignisse.push({ art: 'gebaeudeWeg', id: b.id, spieler: b.spieler, typ: b.typ, x: b.x, y: b.y });
  }

  /* ─────────────── Rohstoffe ─────────────── */

  kannZahlen(spielerId, k) {
    if (!k) return true;
    const r = this.spieler[spielerId].rohstoffe;
    for (const art of ROHSTOFFE) if (k[art] && r[art] < k[art]) return false;
    return true;
  }
  zahlen(spielerId, k) {
    if (!k) return;
    const r = this.spieler[spielerId].rohstoffe;
    for (const art of ROHSTOFFE) if (k[art]) r[art] -= k[art];
  }
  erstatten(spielerId, k) {
    if (!k) return;
    const r = this.spieler[spielerId].rohstoffe;
    for (const art of ROHSTOFFE) if (k[art]) r[art] += k[art];
  }
  fehlenderRohstoff(spielerId, k) {
    const r = this.spieler[spielerId].rohstoffe;
    for (const art of ROHSTOFFE) if (k[art] && r[art] < k[art]) return art;
    return null;
  }

  /* ═══════════════ Befehle ═══════════════
     Befehle kommen vom eigenen Rechner oder ueber das Netz.
     Sie werden nur zu Rundenbeginn eingespielt — dadurch sehen
     alle Rechner dieselbe Reihenfolge. */

  befehlAusfuehren(c) {
    const p = this.spieler[c.s];
    if (!p || p.besiegt || this.vorbei) return;
    switch (c.a) {
      case 'gehen':       return this.cmdGehen(p, c);
      case 'angriff':     return this.cmdAngriff(p, c);
      case 'sammeln':     return this.cmdSammeln(p, c);
      case 'bauen':       return this.cmdBauen(p, c);
      case 'reparieren':  return this.cmdReparieren(p, c);
      case 'stopp':       return this.cmdStopp(p, c);
      case 'haltung':     return this.cmdHaltung(p, c);
      case 'ausbilden':   return this.cmdAusbilden(p, c);
      case 'forschen':    return this.cmdForschen(p, c);
      case 'zeitalter':   return this.cmdZeitalter(p, c);
      case 'abbrechen':   return this.cmdAbbrechen(p, c);
      case 'treffpunkt':  return this.cmdTreffpunkt(p, c);
      case 'abreissen':   return this.cmdAbreissen(p, c);
      case 'handel':      return this.cmdHandel(p, c);
      case 'heilen':      return this.cmdHeilen(p, c);
      case 'bekehren':    return this.cmdBekehren(p, c);
      case 'aufgeben':    return this.cmdAufgeben(p, c);
    }
  }

  /** Eigene, lebende Einheiten aus einer Nummernliste. */
  meineEinheiten(p, ids) {
    const raus = [];
    if (!ids) return raus;
    for (const id of ids) {
      const e = this.nachId.get(id);
      if (e && !e.tot && e.art === 'einheit' && e.spieler === p.id) raus.push(e);
    }
    return raus;
  }
  meineGebaeude(p, ids) {
    const raus = [];
    if (!ids) return raus;
    for (const id of ids) {
      const b = this.nachId.get(id);
      if (b && !b.tot && b.art === 'gebaeude' && b.spieler === p.id) raus.push(b);
    }
    return raus;
  }

  cmdGehen(p, c) {
    const liste = this.meineEinheiten(p, c.ids);
    if (!liste.length) return;
    /* Mehrere Einheiten bekommen versetzte Ziele, sonst draengeln
       sie sich auf einer Kachel. Der Versatz ist ein Ring-Muster. */
    const ziele = this.formation(c.x | 0, c.y | 0, liste.length);
    liste.forEach((e, i) => {
      const z = ziele[i];
      const b = { art: 'gehen', x: z.x, y: z.y };
      if (c.anhaengen) e.folge.push(b); else this.befehlSetzen(e, b);
    });
    this.ereignisse.push({ art: 'befehl', spieler: p.id, x: c.x, y: c.y, gehen: true });
  }

  /** Zielpunkte im Ring um einen Punkt — feste Reihenfolge, also determinsitisch. */
  formation(x, y, anzahl) {
    const raus = [{ x, y }];
    if (anzahl <= 1) return raus;
    const schritt = Math.round(FP * 0.9);
    let ring = 1;
    while (raus.length < anzahl) {
      for (let dy = -ring; dy <= ring && raus.length < anzahl; dy++) {
        for (let dx = -ring; dx <= ring && raus.length < anzahl; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          raus.push({ x: x + dx * schritt, y: y + dy * schritt });
        }
      }
      ring++;
      if (ring > 12) break;
    }
    while (raus.length < anzahl) raus.push({ x, y });
    return raus;
  }

  cmdAngriff(p, c) {
    const ziel = this.nachId.get(c.ziel);
    if (!ziel || ziel.tot) return;
    for (const e of this.meineEinheiten(p, c.ids)) {
      const w = this.werte(e.spieler, e.typ);
      if (!w.schaden) continue;
      const b = { art: 'angriff', ziel: ziel.id };
      if (c.anhaengen) e.folge.push(b); else this.befehlSetzen(e, b);
    }
  }

  cmdSammeln(p, c) {
    const k = this.karte;
    for (const e of this.meineEinheiten(p, c.ids)) {
      const w = this.werte(e.spieler, e.typ);
      if (!w.kannSammeln) continue;
      let b = null;
      if (c.ziel) {
        const g = this.nachId.get(c.ziel);
        if (g && !g.tot && g.art === 'gebaeude' && g.spieler === p.id && GEBAEUDE[g.typ].acker) {
          b = { art: 'ackern', ziel: g.id };
        }
      } else if (drin(k, c.kx, c.ky) && k.vorkommen[this.kachelIdx(c.kx, c.ky)]) {
        b = { art: 'sammeln', kx: c.kx, ky: c.ky };
      }
      if (!b) continue;
      if (c.anhaengen) e.folge.push(b); else this.befehlSetzen(e, b);
    }
  }

  cmdBauen(p, c) {
    const def = GEBAEUDE[c.typ];
    if (!def || def.zeitalter > p.zeitalter) return;
    if (def.braucht && !this.hatGebaeude(p.id, def.braucht)) return;
    const bauer = this.meineEinheiten(p, c.ids).filter(e => this.werte(e.spieler, e.typ).kannBauen);
    if (!bauer.length) return;
    /* Mauern koennen in einer Reihe gezogen werden. */
    const stellen = c.reihe && def.kette ? c.reihe : [{ kx: c.kx, ky: c.ky }];
    let ersteBaustelle = null;
    for (const st of stellen) {
      if (!this.bauplatzFrei(p.id, c.typ, st.kx, st.ky)) continue;
      const k = kostenVon('gebaeude', c.typ, p.volk);
      if (!this.kannZahlen(p.id, k)) {
        this.ereignisse.push({ art: 'fehlt', spieler: p.id, rohstoff: this.fehlenderRohstoff(p.id, k) });
        break;
      }
      this.zahlen(p.id, k);
      const b = this.gebaeudeSetzen(p.id, c.typ, st.kx, st.ky, false);
      b.kosten = k;
      if (!ersteBaustelle) ersteBaustelle = b;
      if (stellen.length > 1) continue;   // Mauerreihe: Bauern gehen zur ersten Stelle
    }
    if (!ersteBaustelle) return;
    bauer.forEach((e, i) => {
      const b = { art: 'bauen', ziel: ersteBaustelle.id };
      if (c.anhaengen) e.folge.push(b); else this.befehlSetzen(e, b);
    });
  }

  /** An einer schon stehenden Baustelle mithelfen. */
  cmdWeiterbauen(p, c) {
    const b = this.nachId.get(c.ziel);
    if (!b || b.tot || b.art !== 'gebaeude' || !this.verbuendet(p.id, b.spieler)) return;
    if (b.fertig) return this.cmdReparieren(p, c);
    for (const e of this.meineEinheiten(p, c.ids)) {
      if (!this.werte(e.spieler, e.typ).kannBauen) continue;
      const auftrag = { art: 'bauen', ziel: b.id };
      if (c.anhaengen) e.folge.push(auftrag); else this.befehlSetzen(e, auftrag);
    }
  }

  cmdReparieren(p, c) {
    const ziel = this.nachId.get(c.ziel);
    if (!ziel || ziel.tot || ziel.art !== 'gebaeude' || !this.verbuendet(p.id, ziel.spieler)) return;
    for (const e of this.meineEinheiten(p, c.ids)) {
      if (!this.werte(e.spieler, e.typ).kannBauen) continue;
      this.befehlSetzen(e, { art: 'reparieren', ziel: ziel.id });
    }
  }

  cmdStopp(p, c) {
    for (const e of this.meineEinheiten(p, c.ids)) {
      e.folge.length = 0;
      this.befehlSetzen(e, null);
    }
  }

  cmdHaltung(p, c) {
    const h = klemme(c.h | 0, 0, 3);
    for (const e of this.meineEinheiten(p, c.ids)) e.haltung = h;
  }

  cmdAusbilden(p, c) {
    const b = this.nachId.get(c.g);
    if (!b || b.tot || b.spieler !== p.id || !b.fertig) return;
    let typ = c.typ;
    if (typ === 'spezial') typ = spezialEinheit(p.volk);
    const def = EINHEITEN[typ];
    if (!def) return;
    const gdef = GEBAEUDE[b.typ];
    const erlaubt = (gdef.produziert || []).some(t => t === c.typ || t === typ);
    if (!erlaubt) return;
    if (def.zeitalter > p.zeitalter) return;
    const anzahl = klemme(c.anzahl || 1, 1, 20);
    for (let i = 0; i < anzahl; i++) {
      if (b.warteschlange.length >= 15) break;
      const k = kostenVon('einheit', typ, p.volk);
      if (!this.kannZahlen(p.id, k)) {
        this.ereignisse.push({ art: 'fehlt', spieler: p.id, rohstoff: this.fehlenderRohstoff(p.id, k) });
        break;
      }
      this.zahlen(p.id, k);
      b.warteschlange.push({ art: 'einheit', typ, rest: takte(def.zeit), gesamt: takte(def.zeit), kosten: k });
    }
  }

  cmdForschen(p, c) {
    const b = this.nachId.get(c.g);
    if (!b || b.tot || b.spieler !== p.id || !b.fertig) return;
    const tech = TECHS[c.tech];
    if (!tech || p.techs[c.tech]) return;
    if ((GEBAEUDE[b.typ].forscht || []).indexOf(c.tech) < 0) return;
    if (tech.zeitalter > p.zeitalter) return;
    if (tech.braucht && !p.techs[tech.braucht]) return;
    if (b.warteschlange.some(a => a.art === 'tech' && a.typ === c.tech)) return;
    if (this.laeuftTech(p.id, c.tech)) return;
    if (!this.kannZahlen(p.id, tech.kosten)) {
      this.ereignisse.push({ art: 'fehlt', spieler: p.id, rohstoff: this.fehlenderRohstoff(p.id, tech.kosten) });
      return;
    }
    this.zahlen(p.id, tech.kosten);
    b.warteschlange.push({ art: 'tech', typ: c.tech, rest: takte(tech.zeit), gesamt: takte(tech.zeit), kosten: tech.kosten });
  }

  laeuftTech(spielerId, tech) {
    for (const b of this.gebaeude) {
      if (b.tot || b.spieler !== spielerId) continue;
      if (b.warteschlange.some(a => a.art === 'tech' && a.typ === tech)) return true;
    }
    return false;
  }

  cmdZeitalter(p, c) {
    const b = this.nachId.get(c.g);
    if (!b || b.tot || b.spieler !== p.id || b.typ !== 'dorfzentrum' || !b.fertig) return;
    if (p.zeitalter >= ZEITALTER.length - 1 || p.aufstieg) return;
    const z = ZEITALTER[p.zeitalter + 1];
    if (this.gebaeudeZahl(p.id, p.zeitalter) < z.braucht) {
      this.ereignisse.push({ art: 'meldung', spieler: p.id, text: 'Es fehlen Gebaeude aus dem laufenden Zeitalter.' });
      return;
    }
    const k = aufstiegKosten(p.zeitalter, p.volk);
    if (!this.kannZahlen(p.id, k)) {
      this.ereignisse.push({ art: 'fehlt', spieler: p.id, rohstoff: this.fehlenderRohstoff(p.id, k) });
      return;
    }
    this.zahlen(p.id, k);
    b.warteschlange.push({ art: 'zeitalter', typ: 'zeitalter', rest: takte(z.dauer), gesamt: takte(z.dauer), kosten: k });
    p.aufstieg = { gebaeude: b.id };
  }

  /** Wieviele fertige Gebaeude aus diesem Zeitalter (oder frueher) stehen? */
  gebaeudeZahl(spielerId, zeitalter) {
    let n = 0;
    for (const b of this.gebaeude) {
      if (b.tot || b.spieler !== spielerId || !b.fertig) continue;
      const def = GEBAEUDE[b.typ];
      if (def.kette || def.durchlass || def.acker) continue;   // Mauern und Farmen zaehlen nicht
      if (def.zeitalter <= zeitalter) n++;
    }
    return n;
  }

  hatGebaeude(spielerId, typ) {
    for (const b of this.gebaeude) if (!b.tot && b.spieler === spielerId && b.typ === typ && b.fertig) return true;
    return false;
  }

  cmdAbbrechen(p, c) {
    const b = this.nachId.get(c.g);
    if (!b || b.tot || b.spieler !== p.id) return;
    const i = c.i == null ? b.warteschlange.length - 1 : c.i;
    if (i < 0 || i >= b.warteschlange.length) return;
    const auftrag = b.warteschlange.splice(i, 1)[0];
    this.erstatten(p.id, auftrag.kosten);
    if (auftrag.art === 'zeitalter') p.aufstieg = null;
  }

  cmdTreffpunkt(p, c) {
    for (const b of this.meineGebaeude(p, [c.g])) {
      b.treffpunkt = (c.x == null) ? null : { x: c.x | 0, y: c.y | 0, ziel: c.ziel || 0 };
    }
  }

  cmdAbreissen(p, c) {
    for (const b of this.meineGebaeude(p, c.ids)) {
      /* Beim Abreissen gibt es die Haelfte der Kosten zurueck, wenn
         das Gebaeude noch im Bau ist. */
      if (!b.fertig && b.kosten) {
        const halb = {};
        for (const r of ROHSTOFFE) if (b.kosten[r]) halb[r] = Math.floor(b.kosten[r] / 2);
        this.erstatten(p.id, halb);
      }
      this.gebaeudeWeg(b, null);
    }
  }

  cmdHandel(p, c) {
    if (!this.hatGebaeude(p.id, 'markt')) return;
    const r = c.r;
    if (r !== 'nahrung' && r !== 'holz' && r !== 'stein') return;
    const menge = 100;
    if (c.kaufen) {
      const preis = p.preise[r];
      if (p.rohstoffe.gold < preis) return;
      p.rohstoffe.gold -= preis;
      p.rohstoffe[r] += menge;
      p.preise[r] = klemme(preis + HANDEL.schritt, HANDEL.minpreis, HANDEL.maxpreis);
    } else {
      if (p.rohstoffe[r] < menge) return;
      const preis = Math.round(p.preise[r] * (100 - HANDEL.gebuehr) / 100);
      p.rohstoffe[r] -= menge;
      p.rohstoffe.gold += preis;
      p.preise[r] = klemme(p.preise[r] - HANDEL.schritt, HANDEL.minpreis, HANDEL.maxpreis);
    }
  }

  cmdHeilen(p, c) {
    const ziel = this.nachId.get(c.ziel);
    if (!ziel || ziel.tot || ziel.art !== 'einheit' || !this.verbuendet(p.id, ziel.spieler)) return;
    for (const e of this.meineEinheiten(p, c.ids)) {
      if (!this.werte(e.spieler, e.typ).heilt) continue;
      this.befehlSetzen(e, { art: 'heilen', ziel: ziel.id });
    }
  }

  cmdBekehren(p, c) {
    const ziel = this.nachId.get(c.ziel);
    if (!ziel || ziel.tot || this.verbuendet(p.id, ziel.spieler)) return;
    for (const e of this.meineEinheiten(p, c.ids)) {
      if (!this.werte(e.spieler, e.typ).bekehrt) continue;
      this.befehlSetzen(e, { art: 'bekehren', ziel: ziel.id });
    }
  }

  cmdAufgeben(p) {
    p.aufgegeben = true;
    this.spielerBesiegen(p, 'aufgegeben');
  }

  /* ═══════════════ Befehl auf eine Einheit setzen ═══════════════ */

  befehlSetzen(e, b) {
    e.befehl = b;
    e.zielId = 0; e.quelleI = -1; e.bauId = 0; e.pfad = null; e.pfadI = 0;
    e.bekehrRest = 0; e.steckRest = 0;
    if (!b) { e.zustand = ZUSTAND.ruhig; e.zielX = e.x; e.zielY = e.y; return; }
    switch (b.art) {
      case 'gehen':
        e.zustand = ZUSTAND.gehen;
        this.wegSuchen(e, b.x, b.y);
        break;
      case 'angriff': {
        const z = this.nachId.get(b.ziel);
        if (!z || z.tot) { this.befehlSetzen(e, null); return; }
        e.zielId = z.id; e.zustand = ZUSTAND.angreifen;
        break;
      }
      case 'sammeln':
        e.quelleI = this.kachelIdx(b.kx, b.ky);
        e.zustand = ZUSTAND.sammeln;
        this.zurQuelle(e, b.kx, b.ky);
        break;
      case 'ackern': {
        const g = this.nachId.get(b.ziel);
        if (!g || g.tot) { this.befehlSetzen(e, null); return; }
        e.zielId = g.id; e.zustand = ZUSTAND.sammeln;
        this.zumGebaeude(e, g);
        break;
      }
      case 'bauen': case 'reparieren': {
        const g = this.nachId.get(b.ziel);
        if (!g || g.tot) { this.befehlSetzen(e, null); return; }
        e.bauId = g.id;
        e.zustand = b.art === 'bauen' ? ZUSTAND.bauen : ZUSTAND.reparieren;
        this.zumGebaeude(e, g);
        break;
      }
      case 'heilen': case 'bekehren': {
        const z = this.nachId.get(b.ziel);
        if (!z || z.tot) { this.befehlSetzen(e, null); return; }
        e.zielId = z.id;
        e.zustand = b.art === 'heilen' ? ZUSTAND.heilen : ZUSTAND.bekehren;
        break;
      }
    }
  }

  /** Naechsten Befehl aus der Warteschlange holen. */
  befehlFertig(e) {
    if (e.folge.length) this.befehlSetzen(e, e.folge.shift());
    else this.befehlSetzen(e, null);
  }

  /* ─────────────── Anlaufpunkte ───────────────
     Wer zu einem Gebaeude oder einer Quelle will, laeuft nicht
     auf deren Mitte — dort steht ja etwas. Er bekommt ein freies
     Nachbarfeld zugewiesen und geht genau dorthin. Ohne das
     bleiben Einheiten hinter Waeldern stehen, weil die Suche
     „nah genug“ meldet, obwohl kein Weg hinfuehrt. */

  /** Freies Feld am Rand eines Gebaeudes, moeglichst nah an der Einheit. */
  randKachel(e, b) {
    const g = b.groesse;
    let bestes = null, bestD = Infinity;
    for (let y = b.ky - 1; y <= b.ky + g; y++) {
      for (let x = b.kx - 1; x <= b.kx + g; x++) {
        const amRand = (x === b.kx - 1 || x === b.kx + g || y === b.ky - 1 || y === b.ky + g);
        if (!amRand) continue;
        if (!drin(this.karte, x, y)) continue;
        if (this.sperre[y * this.karte.breite + x] === GESPERRT) continue;
        const d = abstand2(e.x, e.y, x * FP + FP / 2, y * FP + FP / 2);
        if (d < bestD) { bestD = d; bestes = [x, y]; }
      }
    }
    return bestes;
  }

  /** Freies Feld neben einer Rohstoffkachel. */
  nachbarKachel(e, kx, ky) {
    let bestes = null, bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = kx + dx, y = ky + dy;
      if (!drin(this.karte, x, y)) continue;
      if (this.sperre[y * this.karte.breite + x] === GESPERRT) continue;
      const d = abstand2(e.x, e.y, x * FP + FP / 2, y * FP + FP / 2);
      if (d < bestD) { bestD = d; bestes = [x, y]; }
    }
    return bestes;
  }

  /** Steht die Einheit direkt am Gebaeude (Ring rundherum)? */
  amGebaeude(e, b) {
    const kx = this.kx(e), ky = this.ky(e);
    return kx >= b.kx - 1 && kx <= b.kx + b.groesse &&
           ky >= b.ky - 1 && ky <= b.ky + b.groesse;
  }

  /** Steht die Einheit neben der Kachel? */
  anKachel(e, kx, ky) {
    return Math.abs(this.kx(e) - kx) <= 1 && Math.abs(this.ky(e) - ky) <= 1;
  }

  /** Schickt eine Einheit an den Rand eines Gebaeudes. */
  zumGebaeude(e, b) {
    const feld = this.randKachel(e, b);
    if (feld) this.wegSuchen(e, feld[0] * FP + FP / 2, feld[1] * FP + FP / 2, 0);
    else this.wegSuchen(e, b.x, b.y, Math.ceil(b.groesse / 2) + 1);
  }

  /** Schickt eine Einheit neben eine Rohstoffkachel. */
  zurQuelle(e, kx, ky) {
    const feld = this.nachbarKachel(e, kx, ky);
    if (feld) this.wegSuchen(e, feld[0] * FP + FP / 2, feld[1] * FP + FP / 2, 0);
    else this.wegSuchen(e, kx * FP + FP / 2, ky * FP + FP / 2, 1);
  }

  /* ═══════════════ Wegsuche ═══════════════
     Suchen kosten Rechenzeit, deshalb kommen sie in eine
     Warteschlange und werden je Takt nur begrenzt abgearbeitet.
     Die Reihenfolge ist die Eintragsreihenfolge — gleich auf
     jedem Rechner. */

  wegSuchen(e, zx, zy, naheGenug) {
    e.zielX = zx | 0; e.zielY = zy | 0;
    e.pfadNahe = naheGenug || 0;
    /* Steht die Einheit schon in der Schlange, wird nicht noch einmal
       angestellt — sonst verstopfen ein paar hundert Soldaten die Suche
       fuer alle anderen. Der alte Weg bleibt so lange gueltig; die
       Einheit laeuft weiter, statt stehenzubleiben. */
    if (e.wartetAufWeg) return;
    e.wartetAufWeg = true;
    this.pfadWarteschlange.push(e.id);
  }

  pfadeAbarbeiten() {
    let n = 0;
    /* Bei grossem Andrang wird die Suche kuerzer gehalten, damit alle
       drankommen: lieber ein grober Weg fuer jeden als ein perfekter
       fuer einen. */
    this.knotenBudget = this.pfadWarteschlange.length > 60 ? 1200 : 4500;
    while (this.pfadWarteschlange.length && n < PFADE_PRO_TAKT) {
      const id = this.pfadWarteschlange.shift();
      const e = this.nachId.get(id);
      if (!e || e.tot || !e.wartetAufWeg) continue;
      n++;
      this.wegBerechnen(e);
    }
  }

  wegBerechnen(e) {
    e.wartetAufWeg = false;
    const sx = this.kx(e), sy = this.ky(e);
    const zx = (e.zielX / FP) | 0, zy = (e.zielY / FP) | 0;
    if (sx === zx && sy === zy) { e.pfad = null; e.pfadI = 0; return; }
    const team = this.spieler[e.spieler].team;
    const tore = this.toreOeffnen(team);
    const weg = this.pfadfinder.suche(this.sperre, sx, sy, zx, zy, {
      maxKnoten: this.knotenBudget || 4500,
      naheGenug: e.pfadNahe || 0,
      zielSperreEgal: true
    });
    this.toreSchliessen(tore);
    if (!weg || !weg.length) { e.pfad = null; e.pfadI = 0; return; }
    e.pfad = this.pfadfinder.glaetten(this.sperre, weg, sx, sy);
    e.pfadI = 0;
  }

  /** Eigene Tore sind fuer das eigene Team keine Sperre. */
  toreOeffnen(team) {
    const geaendert = [];
    for (const b of this.gebaeude) {
      if (b.tot || !b.fertig) continue;
      if (!GEBAEUDE[b.typ].durchlass) continue;
      if (this.spieler[b.spieler].team !== team) continue;
      const i = this.kachelIdx(b.kx, b.ky);
      if (this.sperre[i] === GESPERRT) { this.sperre[i] = 0; geaendert.push(i); }
    }
    return geaendert;
  }
  toreSchliessen(liste) { for (const i of liste) this.sperre[i] = GESPERRT; }

  /* ═══════════════ Bewegung ═══════════════ */

  bewegen(e, w) {
    /* Ziel des naechsten Wegpunktes bestimmen. */
    let zx, zy;
    if (e.pfad && e.pfadI < e.pfad.length) {
      const k = e.pfad[e.pfadI];
      zx = (k % this.karte.breite) * FP + FP / 2;
      zy = ((k / this.karte.breite) | 0) * FP + FP / 2;
    } else {
      zx = e.zielX; zy = e.zielY;
    }
    const dx = zx - e.x, dy = zy - e.y;
    const d2 = dx * dx + dy * dy;
    const tempo = w.tempoFP;
    if (d2 <= tempo * tempo) {
      e.x = zx; e.y = zy;
      if (e.pfad && e.pfadI < e.pfad.length) { e.pfadI++; return false; }
      return true;                       // angekommen
    }
    const d = iwurzel(d2);
    const nx = e.x + Math.round(dx * tempo / d);
    const ny = e.y + Math.round(dy * tempo / d);
    if (this.begehbarFP(nx, ny, e)) {
      e.x = nx; e.y = ny;
      e.steckRest = 0;
    } else {
      /* Steckt fest: einmal seitlich ausweichen, sonst neu suchen. */
      const ax = e.x + Math.round(dy * tempo / d), ay = e.y - Math.round(dx * tempo / d);
      const bx = e.x - Math.round(dy * tempo / d), by = e.y + Math.round(dx * tempo / d);
      if (this.begehbarFP(ax, ay, e)) { e.x = ax; e.y = ay; }
      else if (this.begehbarFP(bx, by, e)) { e.x = bx; e.y = by; }
      else if (++e.steckRest > 6) {
        e.steckRest = 0;
        this.wegSuchen(e, e.zielX, e.zielY, e.pfadNahe);
      }
    }
    /* Blickrichtung nur fuer die Anzeige — 16 Sektoren, ganzzahlig. */
    e.richtung = richtungAus(dx, dy);
    return false;
  }

  begehbarFP(x, y, e) {
    const kx = (x / FP) | 0, ky = (y / FP) | 0;
    if (!drin(this.karte, kx, ky)) return false;
    const i = ky * this.karte.breite + kx;
    if (this.sperre[i] !== GESPERRT) return true;
    /* Eigene Tore und das eigene Bauziel duerfen betreten werden. */
    const bId = this.belegt[i];
    if (bId) {
      const b = this.nachId.get(bId);
      if (b && !b.tot) {
        if (GEBAEUDE[b.typ].durchlass && this.verbuendet(e.spieler, b.spieler)) return true;
        if (b.id === e.bauId) return true;
      }
    }
    return false;
  }

  /* ═══════════════ Ein Simulationsschritt ═══════════════ */

  /** Befehle einer Runde einspielen (ohne zu rechnen). */
  befehleAnwenden(befehle) {
    if (!befehle) return;
    for (const c of befehle) this.befehlAusfuehren(c);
  }

  /** Fuehrt eine Netzwerkrunde vollstaendig aus — fuer Tests und
      Aufzeichnungen. Die Darstellung ruft stattdessen befehleAnwenden()
      und takten() einzeln auf, damit jede Bewegung weich bleibt. */
  rundeAusfuehren(befehle) {
    this.befehleAnwenden(befehle);
    for (let i = 0; i < RUNDE_TAKTE; i++) this.takten();
    this.runde++;
  }

  takten() {
    if (this.vorbei) return;
    this.ereignisse.length = 0;
    this.takt++;

    for (const e of this.einheiten) { e.altX = e.x; e.altY = e.y; }

    this.gitterBauen();
    this.pfadeAbarbeiten();

    for (const e of this.einheiten) if (!e.tot) this.einheitTakt(e);
    this.abstossen();
    for (const b of this.gebaeude) if (!b.tot) this.gebaeudeTakt(b);
    this.geschosseTakt();

    /* KI denkt seltener als die Simulation rechnet — das genuegt
       und kostet weniger. Der Takt entscheidet, wer dran ist. */
    for (const p of this.spieler) {
      if (p.ki && !p.besiegt && (this.takt % 5) === (p.id % 5)) KI.takt(this, p);
    }

    if (this.takt % SICHT_TAKT === 0) this.sichtErneuern();
    if (this.takt % SIEG_TAKT === 0) this.siegPruefen();
    this.aufraeumen();
  }

  aufraeumen() {
    if (this.einheiten.some(e => e.tot)) {
      for (const e of this.einheiten) if (e.tot) this.nachId.delete(e.id);
      this.einheiten = this.einheiten.filter(e => !e.tot);
    }
    if (this.gebaeude.some(b => b.tot)) {
      for (const b of this.gebaeude) if (b.tot) this.nachId.delete(b.id);
      this.gebaeude = this.gebaeude.filter(b => !b.tot);
    }
  }

  /* ─────────────── Raster fuer die Nachbarsuche ───────────────
     Ohne das muesste jede Einheit jede andere pruefen. */

  gitterBauen() {
    const zw = 4;   // Kacheln je Zelle
    this.zw = zw;
    this.zb = Math.ceil(this.karte.breite / zw);
    this.zh = Math.ceil(this.karte.hoehe / zw);
    if (!this.zellen || this.zellen.length !== this.zb * this.zh) {
      this.zellen = new Array(this.zb * this.zh);
      for (let i = 0; i < this.zellen.length; i++) this.zellen[i] = [];
    } else {
      for (let i = 0; i < this.zellen.length; i++) this.zellen[i].length = 0;
    }
    for (const e of this.einheiten) {
      if (e.tot) continue;
      const zx = klemme((e.x / (FP * zw)) | 0, 0, this.zb - 1);
      const zy = klemme((e.y / (FP * zw)) | 0, 0, this.zh - 1);
      this.zellen[zy * this.zb + zx].push(e);
    }
    for (const b of this.gebaeude) {
      if (b.tot) continue;
      const zx = klemme((b.x / (FP * zw)) | 0, 0, this.zb - 1);
      const zy = klemme((b.y / (FP * zw)) | 0, 0, this.zh - 1);
      this.zellen[zy * this.zb + zx].push(b);
    }
  }

  /** Ruft rueckwaerts fuer alles im Umkreis auf (feste Reihenfolge). */
  imUmkreis(x, y, rFP, fn) {
    const zw = this.zw * FP;
    const x0 = klemme(((x - rFP) / zw) | 0, 0, this.zb - 1);
    const x1 = klemme(((x + rFP) / zw) | 0, 0, this.zb - 1);
    const y0 = klemme(((y - rFP) / zw) | 0, 0, this.zh - 1);
    const y1 = klemme(((y + rFP) / zw) | 0, 0, this.zh - 1);
    for (let zy = y0; zy <= y1; zy++) for (let zx = x0; zx <= x1; zx++) {
      const zelle = this.zellen[zy * this.zb + zx];
      for (let i = 0; i < zelle.length; i++) {
        const e = zelle[i];
        if (e.tot) continue;
        if (fn(e) === false) return;
      }
    }
  }

  /* ─────────────── Einheiten ─────────────── */

  einheitTakt(e) {
    const w = this.werte(e.spieler, e.typ);
    if (e.angriffRest > 0) e.angriffRest--;
    if (e.ruheRest > 0) e.ruheRest--;

    switch (e.zustand) {
      case ZUSTAND.ruhig:      this.ruhigTakt(e, w); break;
      case ZUSTAND.gehen:      this.gehenTakt(e, w); break;
      case ZUSTAND.sammeln:    this.sammelnTakt(e, w); break;
      case ZUSTAND.zurueck:    this.zurueckTakt(e, w); break;
      case ZUSTAND.bauen:
      case ZUSTAND.reparieren: this.bauenTakt(e, w); break;
      case ZUSTAND.angreifen:  this.angreifenTakt(e, w); break;
      case ZUSTAND.heilen:     this.heilenTakt(e, w); break;
      case ZUSTAND.bekehren:   this.bekehrenTakt(e, w); break;
    }
  }

  ruhigTakt(e, w) {
    if (e.folge.length) { this.befehlFertig(e); return; }
    if (w.schaden && !w.kannSammeln && e.haltung !== HALTUNG.passiv && (this.takt % ZIELSUCHE_TAKT) === (e.id % ZIELSUCHE_TAKT)) {
      const ziel = this.zielSuchen(e, w, w.sichtFP);
      if (ziel) { e.zielId = ziel.id; e.zustand = ZUSTAND.angreifen; e.wache = { x: e.x, y: e.y }; }
    }
    /* Moenche heilen von selbst, was in der Naehe blutet. */
    if (w.heilt && (this.takt % ZIELSUCHE_TAKT) === 0) {
      let bestes = null, bestD = Infinity;
      const r = w.heilt.reichweite * FP;
      this.imUmkreis(e.x, e.y, r, (o) => {
        if (o.art !== 'einheit' || o === e || !this.verbuendet(e.spieler, o.spieler)) return;
        if (o.hp >= o.hpMax) return;
        const d = abstand2(e.x, e.y, o.x, o.y);
        if (d < bestD && d <= r * r) { bestD = d; bestes = o; }
      });
      if (bestes) { e.zielId = bestes.id; e.zustand = ZUSTAND.heilen; }
    }
  }

  gehenTakt(e, w) {
    if (e.wartetAufWeg && !e.pfad) return;
    if (this.bewegen(e, w)) { this.befehlFertig(e); return; }
    /* Unterwegs angegriffene Einheiten wehren sich nur, wenn sie
       angriffslustig sind — sonst laufen sie weiter. */
    if (w.schaden && e.haltung === HALTUNG.aggressiv && (this.takt % (ZIELSUCHE_TAKT * 2)) === (e.id % (ZIELSUCHE_TAKT * 2))) {
      const ziel = this.zielSuchen(e, w, Math.round(w.sichtFP * 0.7));
      if (ziel) {
        const alt = e.befehl;
        e.folge.unshift(alt);
        this.befehlSetzen(e, { art: 'angriff', ziel: ziel.id });
      }
    }
  }

  /* ── Sammeln ── */

  sammelnTakt(e, w) {
    if (e.wartetAufWeg && !e.pfad) return;
    /* Farm? */
    if (e.zielId) {
      const farm = this.nachId.get(e.zielId);
      if (!farm || farm.tot) { this.quelleErsetzen(e, w, 'nahrung'); return; }
      if (!farm.fertig) { if (this.bewegen(e, w)) e.zielX = e.x; return; }
      if (!this.amGebaeude(e, farm)) {
        if (this.bewegen(e, w) || ++e.warteRest > 120) { e.warteRest = 0; this.zumGebaeude(e, farm); }
        return;
      }
      e.warteRest = 0;
      this.ernten(e, w, 'acker', farm);
      return;
    }
    /* Kachelvorkommen */
    const i = e.quelleI;
    if (i < 0 || !this.karte.vorkommen[i] || this.karte.menge[i] <= 0) {
      this.quelleErsetzen(e, w, e.ladungArt);
      return;
    }
    const qkx = i % this.karte.breite, qky = (i / this.karte.breite) | 0;
    if (!this.anKachel(e, qkx, qky)) {
      if (this.bewegen(e, w) || ++e.warteRest > 120) { e.warteRest = 0; this.zurQuelle(e, qkx, qky); }
      return;
    }
    e.warteRest = 0;
    const art = VORKOMMEN_LISTE[this.karte.vorkommen[i] - 1];
    this.ernten(e, w, art, null, i);
  }

  /** Holt Rohstoff aus Quelle oder Farm und schickt bei voller Ladung zur Abgabe. */
  ernten(e, w, quelle, farm, kachel) {
    const p = this.spieler[e.spieler];
    const rohstoff = quelle === 'acker' ? 'nahrung' : VORKOMMEN[quelle].rohstoff;
    if (e.ladungArt && e.ladungArt !== rohstoff) { e.ladung = 0; }
    e.ladungArt = rohstoff;
    e.zustand = ZUSTAND.sammeln;

    /* Rate in Hundertsteln je Takt, damit ohne Bruchrechnung. */
    let rate = Math.round(SAMMELTEMPO[quelle] * 100 / TAKTE_PRO_S);
    const v = VOELKER[p.volk];
    for (const b of v.boni) {
      if (b.art === 'sammeltempo' && b.quelle === quelle) rate = Math.round(rate * b.faktor / 100);
      if (b.art === 'ertrag' && b.rohstoff === rohstoff && (quelle === 'schaf' || quelle === 'beere')) {
        rate = Math.round(rate * b.faktor / 100);
      }
    }
    if (p.techs.pflug && quelle === 'acker') rate = Math.round(rate * TECHS.pflug.wirkung.sammelNahrung / 100);

    e.sammelRest += rate;
    const ganz = (e.sammelRest / 100) | 0;
    if (ganz > 0) {
      e.sammelRest -= ganz * 100;
      let menge = ganz;
      if (farm) {
        menge = Math.min(menge, farm.vorrat);
        farm.vorrat -= menge;
        if (farm.vorrat <= 0) { this.gebaeudeWeg(farm, null); this.ereignisse.push({ art: 'farmLeer', spieler: e.spieler, x: farm.x, y: farm.y }); }
      } else {
        menge = Math.min(menge, this.karte.menge[kachel]);
        this.karte.menge[kachel] -= menge;
        if (this.karte.menge[kachel] <= 0) {
          const warBaum = this.karte.vorkommen[kachel] === 1;
          this.karte.vorkommen[kachel] = 0;
          const kx = kachel % this.karte.breite, ky = (kachel / this.karte.breite) | 0;
          this.sperreSetzen(kx, ky);
          this.ereignisse.push({ art: 'quelleLeer', kachel, baum: warBaum });
        }
      }
      e.ladung += menge;
    }
    const grenze = TRAGKRAFT + (p.techs.schubkarre ? TECHS.schubkarre.wirkung.tragkraft : 0)
                             + (p.techs.handkarre ? TECHS.handkarre.wirkung.tragkraft : 0);
    if (e.ladung >= grenze) this.zurAbgabe(e, w);
  }

  zurAbgabe(e, w) {
    const ziel = this.naechsteAbgabe(e, e.ladungArt);
    if (!ziel) { e.zustand = ZUSTAND.sammeln; return; }   // nirgends abzugeben: weitersammeln
    e.abgabeId = ziel.id;
    e.zustand = ZUSTAND.zurueck;
    this.zumGebaeude(e, ziel);
  }

  zurueckTakt(e, w) {
    if (e.wartetAufWeg && !e.pfad) return;
    const ziel = this.nachId.get(e.abgabeId);
    if (!ziel || ziel.tot || !ziel.fertig) { this.zurAbgabe(e, w); return; }
    if (!this.amGebaeude(e, ziel)) {
      if (this.bewegen(e, w) || ++e.warteRest > 120) { e.warteRest = 0; this.zumGebaeude(e, ziel); }
      return;
    }
    e.warteRest = 0;
    const p = this.spieler[e.spieler];
    p.rohstoffe[e.ladungArt] += e.ladung;
    p.statistik.gesammelt[e.ladungArt] += e.ladung;
    this.ereignisse.push({ art: 'abgabe', spieler: e.spieler, rohstoff: e.ladungArt, menge: e.ladung, x: e.x, y: e.y });
    e.ladung = 0;
    /* Zurueck zur Quelle — genau wie im Vorbild von selbst. */
    if (e.befehl && (e.befehl.art === 'sammeln' || e.befehl.art === 'ackern')) {
      this.befehlSetzen(e, e.befehl);
    } else {
      this.befehlFertig(e);
    }
  }

  /** Naechstes Gebaeude, das diesen Rohstoff annimmt. */
  naechsteAbgabe(e, rohstoff) {
    /* Achtung: Abstaende stehen im Quadrat und in Fixpunkt — schon
       40 Kacheln ergeben 1,6 Milliarden. Deshalb Infinity als
       Startwert und nirgends 1<<30. */
    let bestes = null, bestD = Infinity;
    for (const b of this.gebaeude) {
      if (b.tot || !b.fertig || b.spieler !== e.spieler) continue;
      const def = GEBAEUDE[b.typ];
      if (!def.abgabe || def.abgabe.indexOf(rohstoff) < 0) continue;
      const d = abstand2(e.x, e.y, b.x, b.y);
      if (d < bestD) { bestD = d; bestes = b; }
    }
    return bestes;
  }

  /** Quelle erschoepft: die naechste gleicher Art suchen. */
  quelleErsetzen(e, w, rohstoff) {
    if (!rohstoff) { this.befehlFertig(e); return; }
    if (e.ladung > 0) { this.zurAbgabe(e, w); return; }
    const k = this.karte;
    const sx = this.kx(e), sy = this.ky(e);
    let bestes = -1, bestD = Infinity;
    const R = 14;
    for (let y = Math.max(0, sy - R); y <= Math.min(k.hoehe - 1, sy + R); y++) {
      for (let x = Math.max(0, sx - R); x <= Math.min(k.breite - 1, sx + R); x++) {
        const i = y * k.breite + x;
        const v = k.vorkommen[i];
        if (!v || k.menge[i] <= 0) continue;
        if (VORKOMMEN[VORKOMMEN_LISTE[v - 1]].rohstoff !== rohstoff) continue;
        const d = (x - sx) * (x - sx) + (y - sy) * (y - sy);
        if (d < bestD) { bestD = d; bestes = i; }
      }
    }
    if (bestes >= 0) {
      const bx = bestes % k.breite, by = (bestes / k.breite) | 0;
      this.befehlSetzen(e, { art: 'sammeln', kx: bx, ky: by });
      return;
    }
    /* Nichts mehr da: Farm suchen, sonst stehen bleiben. */
    if (rohstoff === 'nahrung') {
      for (const b of this.gebaeude) {
        if (b.tot || b.spieler !== e.spieler || !GEBAEUDE[b.typ].acker) continue;
        this.befehlSetzen(e, { art: 'ackern', ziel: b.id });
        return;
      }
    }
    this.befehlFertig(e);
  }

  /* ── Bauen und Reparieren ── */

  bauenTakt(e, w) {
    if (e.wartetAufWeg && !e.pfad) return;
    const b = this.nachId.get(e.bauId);
    if (!b || b.tot) { this.befehlFertig(e); return; }
    if (!this.amGebaeude(e, b)) {
      if (this.bewegen(e, w) || ++e.warteRest > 150) {
        e.warteRest = 0;
        /* Kommt hier niemand hin, ist der Platz verbaut — dann lieber
           zurueck an die Arbeit als bis zum Ende der Partie anrennen. */
        if (++e.bauVersuche > 3) { e.bauVersuche = 0; this.befehlFertig(e); return; }
        this.zumGebaeude(e, b);
      }
      return;
    }
    e.warteRest = 0; e.bauVersuche = 0;
    if (e.zustand === ZUSTAND.reparieren) {
      if (b.hp >= b.hpMax) { this.befehlFertig(e); return; }
      /* Reparieren kostet nichts, dauert aber. */
      if (this.takt % 2 === 0) b.hp = Math.min(b.hpMax, b.hp + Math.max(1, Math.round(b.hpMax / 200)));
      return;
    }
    if (b.fertig) { this.befehlFertig(e); return; }
    b.bauer++;
    return;
  }

  /* ── Kampf ── */

  angreifenTakt(e, w) {
    let ziel = this.nachId.get(e.zielId);
    if (!ziel || ziel.tot) {
      /* Ziel erledigt: Nachbarn suchen, sonst zurueck zur Wache. */
      const neues = e.haltung === HALTUNG.passiv ? null : this.zielSuchen(e, w, w.sichtFP);
      if (neues) { e.zielId = neues.id; return; }
      if (e.wache && e.haltung !== HALTUNG.stellung) {
        const wache = e.wache; e.wache = null;
        this.befehlSetzen(e, { art: 'gehen', x: wache.x, y: wache.y });
        return;
      }
      this.befehlFertig(e);
      return;
    }
    if (this.verbuendet(e.spieler, ziel.spieler)) { this.befehlFertig(e); return; }

    /* Wer von sich aus angreift, verfolgt nicht bis ans Kartenende.
       Wird der Wachposten zu weit, kehrt die Einheit zurueck — sonst
       laufen ganze Doerfer einem Spaeher hinterher. */
    if (e.wache && abstand2(e.x, e.y, e.wache.x, e.wache.y) > VERFOLGUNG * VERFOLGUNG) {
      const wache = e.wache; e.wache = null;
      this.befehlSetzen(e, { art: 'gehen', x: wache.x, y: wache.y });
      return;
    }

    const reich = w.reichweiteFP + (ziel.art === 'gebaeude' ? Math.round(ziel.groesse * FP / 2) : Math.round(FP * 0.3));
    const d2 = abstand2(e.x, e.y, ziel.x, ziel.y);
    if (d2 > reich * reich) {
      if (e.haltung === HALTUNG.stellung) { this.befehlFertig(e); return; }
      /* Nachlaufen — der Weg wird nur alle paar Takte neu gesucht. */
      if ((this.takt % 15) === (e.id % 15) || !e.pfad) {
        /* Nur nachfuehren, wenn das Ziel merklich gewandert ist. */
        if (!e.pfad || abstand2(e.zielX, e.zielY, ziel.x, ziel.y) > (2 * FP) * (2 * FP)) {
          this.wegSuchen(e, ziel.x, ziel.y, Math.max(1, w.reichweite | 0));
        }
      }
      if (!e.wartetAufWeg || e.pfad) this.bewegen(e, w);
      return;
    }
    e.richtung = richtungAus(ziel.x - e.x, ziel.y - e.y);
    if (e.angriffRest > 0) return;
    e.angriffRest = w.angriffTakte;
    if (w.fern) {
      this.geschosse.push({
        id: this.naechsteId++, von: e.id, spieler: e.spieler, typ: e.typ,
        x: e.x, y: e.y, startX: e.x, startY: e.y,
        zielId: ziel.id, zx: ziel.x, zy: ziel.y,
        rest: Math.max(1, w.flugTakte), gesamt: Math.max(1, w.flugTakte),
        schaden: w.schaden, bonus: w.bonus, flaeche: w.flaecheFP
      });
      this.ereignisse.push({ art: 'schuss', spieler: e.spieler, typ: e.typ, x: e.x, y: e.y });
    } else {
      this.schadenGeben(e.spieler, w, ziel, false);
      this.ereignisse.push({ art: 'hieb', spieler: e.spieler, typ: e.typ, x: ziel.x, y: ziel.y });
    }
  }

  /** Sucht das lohnendste Ziel im Umkreis. */
  zielSuchen(e, w, rFP) {
    /* Erst der Rang (Soldat vor Dorfbewohner vor Gebaeude), bei
       gleichem Rang der Abstand. Getrennt vergleichen statt in eine
       Zahl zu packen — Fixpunkt-Quadrate sind dafuer zu gross. */
    let bestes = null, bestRang = 99, bestD = Infinity;
    this.imUmkreis(e.x, e.y, rFP, (o) => {
      if (o === e || this.verbuendet(e.spieler, o.spieler)) return;
      if (o.art === 'gebaeude' && !o.fertig && o.hp <= 1) return;
      const d2 = abstand2(e.x, e.y, o.x, o.y);
      if (d2 > rFP * rFP) return;
      /* Soldaten zuerst, dann Dorfbewohner, dann Gebaeude. */
      let rang = 2;
      if (o.art === 'einheit') {
        const ow = this.werte(o.spieler, o.typ);
        rang = ow.schaden ? 0 : 1;
      } else {
        const def = GEBAEUDE[o.typ];
        rang = def.waffe ? 1 : (def.kette ? 3 : 2);
      }
      if (rang < bestRang || (rang === bestRang && d2 < bestD)) {
        bestRang = rang; bestD = d2; bestes = o;
      }
    });
    return bestes;
  }

  schadenGeben(spielerId, w, ziel, ausFlaeche) {
    if (!ziel || ziel.tot) return;
    let s = w.schaden;
    let ruestung;
    if (ziel.art === 'gebaeude') {
      const gw = this.gebaeudeWerte(ziel.spieler, ziel.typ);
      s += (w.bonus && w.bonus.gebaeude) || 0;
      ruestung = w.fern ? gw.ruestungFern : gw.ruestungNah;
    } else {
      const zw = this.werte(ziel.spieler, ziel.typ);
      s += (w.bonus && w.bonus[zw.klasse]) || 0;
      ruestung = w.fern ? zw.ruestungFern : zw.ruestungNah;
    }
    const netto = Math.max(1, s - ruestung);
    ziel.hp -= netto;
    if (ziel.hp <= 0) {
      if (ziel.art === 'gebaeude') this.gebaeudeWeg(ziel, spielerId);
      else this.einheitTot(ziel, spielerId);
    } else if (ziel.art === 'einheit' && ziel.zustand === ZUSTAND.ruhig && !ausFlaeche) {
      /* Wer beschossen wird, wehrt sich (ausser er soll stillhalten). */
      const zw = this.werte(ziel.spieler, ziel.typ);
      if (zw.schaden && ziel.haltung !== HALTUNG.passiv && !zw.kannSammeln) {
        const taeterEinheit = this.naechsterFeindNah(ziel, zw);
        if (taeterEinheit) { ziel.zielId = taeterEinheit.id; ziel.zustand = ZUSTAND.angreifen; ziel.wache = { x: ziel.x, y: ziel.y }; }
      }
    }
  }

  naechsterFeindNah(e, w) {
    return this.zielSuchen(e, w, Math.max(w.sichtFP, 6 * FP));
  }

  geschosseTakt() {
    if (!this.geschosse.length) return;
    const bleiben = [];
    for (const g of this.geschosse) {
      const ziel = this.nachId.get(g.zielId);
      if (ziel && !ziel.tot) { g.zx = ziel.x; g.zy = ziel.y; }
      g.rest--;
      const t = (g.gesamt - g.rest) * 1000 / g.gesamt;
      g.x = g.startX + Math.round((g.zx - g.startX) * t / 1000);
      g.y = g.startY + Math.round((g.zy - g.startY) * t / 1000);
      if (g.rest > 0) { bleiben.push(g); continue; }
      /* Einschlag */
      const w = { schaden: g.schaden, bonus: g.bonus, fern: true };
      if (g.flaeche > 0) {
        this.imUmkreis(g.zx, g.zy, g.flaeche, (o) => {
          if (abstand2(o.x, o.y, g.zx, g.zy) > g.flaeche * g.flaeche) return;
          if (o.art === 'gebaeude' && this.verbuendet(g.spieler, o.spieler)) return;
          this.schadenGeben(g.spieler, w, o, true);
        });
        this.ereignisse.push({ art: 'einschlag', x: g.zx, y: g.zy, flaeche: g.flaeche });
      } else if (ziel && !ziel.tot) {
        this.schadenGeben(g.spieler, w, ziel, false);
        this.ereignisse.push({ art: 'treffer', x: g.zx, y: g.zy });
      }
    }
    this.geschosse = bleiben;
  }

  /* ── Moenche ── */

  heilenTakt(e, w) {
    const ziel = this.nachId.get(e.zielId);
    if (!ziel || ziel.tot || ziel.hp >= ziel.hpMax) { this.befehlFertig(e); return; }
    const r = w.heilt.reichweite * FP;
    if (abstand2(e.x, e.y, ziel.x, ziel.y) > r * r) {
      if (!e.pfad && !e.wartetAufWeg) this.wegSuchen(e, ziel.x, ziel.y, w.heilt.reichweite - 1);
      if (!e.wartetAufWeg) this.bewegen(e, w);
      return;
    }
    const p = this.spieler[e.spieler];
    let rate = w.heilt.rate;
    if (p.techs.inbrunst) rate = Math.round(rate * TECHS.inbrunst.wirkung.heilRate / 100);
    if (this.takt % Math.max(1, Math.round(TAKTE_PRO_S * 10 / rate)) === 0) {
      ziel.hp = Math.min(ziel.hpMax, ziel.hp + 1);
    }
  }

  bekehrenTakt(e, w) {
    const ziel = this.nachId.get(e.zielId);
    if (!ziel || ziel.tot || this.verbuendet(e.spieler, ziel.spieler)) { this.befehlFertig(e); return; }
    if (e.ruheRest > 0) { return; }
    const r = w.bekehrt.reichweite * FP;
    if (abstand2(e.x, e.y, ziel.x, ziel.y) > r * r) {
      if (!e.pfad && !e.wartetAufWeg) this.wegSuchen(e, ziel.x, ziel.y, w.bekehrt.reichweite - 1);
      if (!e.wartetAufWeg) this.bewegen(e, w);
      e.bekehrRest = 0;
      return;
    }
    if (!e.bekehrRest) e.bekehrRest = takte(w.bekehrt.dauer);
    if (--e.bekehrRest <= 0) {
      /* Geschafft: die Einheit wechselt die Seite. */
      const p = this.spieler[e.spieler];
      if (ziel.art === 'einheit') {
        const alt = this.spieler[ziel.spieler];
        alt.bev -= this.werte(ziel.spieler, ziel.typ).bev;
        ziel.spieler = e.spieler;
        ziel.befehl = null; ziel.pfad = null; ziel.zustand = ZUSTAND.ruhig; ziel.zielId = 0;
        const nw = this.werte(e.spieler, ziel.typ);
        ziel.hpMax = nw.hp; ziel.hp = Math.min(ziel.hp, nw.hp);
        p.bev += nw.bev;
        this.ereignisse.push({ art: 'bekehrt', spieler: e.spieler, id: ziel.id, x: ziel.x, y: ziel.y });
      }
      let ruhe = w.bekehrt.ruhe;
      if (p.techs.glaube) ruhe = Math.round(ruhe * 100 / TECHS.glaube.wirkung.moenchTempo);
      e.ruheRest = takte(ruhe);
      this.befehlFertig(e);
    }
  }

  /* ── Einheiten schieben sich auseinander ──
     Ohne das stehen zwanzig Ritter auf einem Punkt. */

  abstossen() {
    const r = Math.round(FP * 0.55);
    for (const zelle of this.zellen) {
      for (let i = 0; i < zelle.length; i++) {
        const a = zelle[i];
        if (a.art !== 'einheit' || a.tot) continue;
        for (let j = i + 1; j < zelle.length; j++) {
          const b = zelle[j];
          if (b.art !== 'einheit' || b.tot) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r || d2 === 0) continue;
          const d = Math.max(1, iwurzel(d2));
          const schub = Math.min(Math.round(FP * 0.08), (r - d) / 2 | 0);
          const sx = Math.round(dx * schub / d), sy = Math.round(dy * schub / d);
          if (this.begehbarFP(a.x - sx, a.y - sy, a)) { a.x -= sx; a.y -= sy; }
          if (this.begehbarFP(b.x + sx, b.y + sy, b)) { b.x += sx; b.y += sy; }
        }
      }
    }
  }

  /* ─────────────── Gebaeude ─────────────── */

  gebaeudeTakt(b) {
    if (!b.fertig) {
      if (b.bauer > 0) {
        /* Mehr Bauleute helfen, aber nicht im vollen Umfang. */
        const punkte = 10 + (b.bauer - 1) * 7;
        b.bauFortschritt += punkte;
        b.hp = Math.max(1, Math.min(b.hpMax, Math.round(b.hpMax * b.bauFortschritt / b.bauGesamt)));
        if (b.bauFortschritt >= b.bauGesamt) {
          this.gebaeudeFertig(b);
          /* Die Bauleute machen weiter: das naechste Bauwerk oder Arbeit. */
          for (const e of this.einheiten) {
            if (!e.tot && e.bauId === b.id && e.zustand === ZUSTAND.bauen) this.befehlFertig(e);
          }
        }
      }
      b.bauer = 0;
      return;
    }

    /* Warteschlange */
    const auftrag = b.warteschlange[0];
    if (auftrag) {
      const p = this.spieler[b.spieler];
      if (auftrag.art === 'einheit') {
        const w = this.werte(b.spieler, auftrag.typ);
        const raum = Math.min(p.bevRaum, p.bevGrenze);
        if (p.bev + w.bev > raum) {
          if (this.takt % 50 === 0) this.ereignisse.push({ art: 'bevVoll', spieler: b.spieler });
        } else if (--auftrag.rest <= 0) {
          b.warteschlange.shift();
          this.einheitAusstossen(b, auftrag.typ);
        }
      } else if (--auftrag.rest <= 0) {
        b.warteschlange.shift();
        if (auftrag.art === 'tech') {
          p.techs[auftrag.typ] = true;
          this.werteVerwerfen(b.spieler);
          this.ereignisse.push({ art: 'techFertig', spieler: b.spieler, tech: auftrag.typ });
        } else if (auftrag.art === 'zeitalter') {
          p.zeitalter++;
          p.aufstieg = null;
          this.werteVerwerfen(b.spieler);
          this.ereignisse.push({ art: 'zeitalterFertig', spieler: b.spieler, zeitalter: p.zeitalter });
        }
      }
    }

    /* Verteidigungsanlagen schiessen von selbst. */
    const gw = this.gebaeudeWerte(b.spieler, b.typ);
    if (gw.waffe) {
      if (b.angriffRest > 0) b.angriffRest--;
      else if ((this.takt % 4) === (b.id % 4)) {
        const ziel = this.zielSuchenGebaeude(b, gw.waffe.reichweiteFP);
        if (ziel) {
          b.angriffRest = gw.waffe.takte;
          this.geschosse.push({
            id: this.naechsteId++, von: b.id, spieler: b.spieler, typ: b.typ,
            x: b.x, y: b.y, startX: b.x, startY: b.y - Math.round(FP * 0.5),
            zielId: ziel.id, zx: ziel.x, zy: ziel.y,
            rest: 4, gesamt: 4, schaden: gw.waffe.schaden, bonus: {}, flaeche: 0
          });
          this.ereignisse.push({ art: 'schuss', spieler: b.spieler, typ: b.typ, x: b.x, y: b.y });
        }
      }
    }
  }

  zielSuchenGebaeude(b, rFP) {
    let bestes = null, bestD = Infinity;
    this.imUmkreis(b.x, b.y, rFP, (o) => {
      if (o.art !== 'einheit' || this.verbuendet(b.spieler, o.spieler)) return;
      const d = abstand2(b.x, b.y, o.x, o.y);
      if (d <= rFP * rFP && d < bestD) { bestD = d; bestes = o; }
    });
    return bestes;
  }

  /** Frische Einheit neben dem Gebaeude absetzen. */
  einheitAusstossen(b, typ) {
    const g = b.groesse;
    /* Feste Reihenfolge: unten, rechts, oben, links — aussen herum. */
    const stellen = [];
    for (let x = b.kx - 1; x <= b.kx + g; x++) { stellen.push([x, b.ky + g]); }
    for (let y = b.ky + g - 1; y >= b.ky - 1; y--) { stellen.push([b.kx + g, y]); }
    for (let x = b.kx + g - 1; x >= b.kx - 1; x--) { stellen.push([x, b.ky - 1]); }
    for (let y = b.ky; y < b.ky + g; y++) { stellen.push([b.kx - 1, y]); }
    let platz = null;
    for (const [x, y] of stellen) {
      if (!drin(this.karte, x, y)) continue;
      if (this.sperre[y * this.karte.breite + x] === GESPERRT) continue;
      platz = [x, y]; break;
    }
    if (!platz) platz = [b.kx, b.ky + g];
    const e = this.einheitSetzen(b.spieler, typ, platz[0] * FP + FP / 2, platz[1] * FP + FP / 2);
    if (!e) return;
    this.ereignisse.push({ art: 'einheitFertig', spieler: b.spieler, typ, id: e.id, x: e.x, y: e.y });
    /* Sammelpunkt beachten. */
    if (b.treffpunkt) {
      const t = b.treffpunkt;
      if (t.ziel) {
        const z = this.nachId.get(t.ziel);
        if (z && !z.tot) {
          if (z.art === 'gebaeude' && GEBAEUDE[z.typ].acker && this.werte(e.spieler, typ).kannSammeln) {
            this.befehlSetzen(e, { art: 'ackern', ziel: z.id });
            return;
          }
        }
      }
      const kx = (t.x / FP) | 0, ky = (t.y / FP) | 0;
      const v = drin(this.karte, kx, ky) ? this.karte.vorkommen[this.kachelIdx(kx, ky)] : 0;
      if (v && this.werte(e.spieler, typ).kannSammeln) {
        this.befehlSetzen(e, { art: 'sammeln', kx, ky });
      } else {
        this.befehlSetzen(e, { art: 'gehen', x: t.x, y: t.y });
      }
    }
  }

  /* ─────────────── Sicht und Nebel ───────────────
     Jeder Spieler hat zwei Felder: was er je gesehen hat
     (erkundet) und was er gerade sieht (sichtbar). */

  sichtErneuern() {
    for (const p of this.spieler) p.sichtbar.fill(0);
    const b = this.karte.breite, h = this.karte.hoehe;
    const stempeln = (spielerId, cx, cy, r) => {
      const team = this.spieler[spielerId].team;
      const r2 = r * r;
      const x0 = Math.max(0, cx - r), x1 = Math.min(b - 1, cx + r);
      const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          if (dx * dx + dy * dy > r2) continue;
          const i = y * b + x;
          for (const p of this.spieler) {
            if (p.team !== team) continue;
            p.sichtbar[i] = 1; p.erkundet[i] = 1;
          }
        }
      }
    };
    for (const e of this.einheiten) {
      if (e.tot) continue;
      const w = this.werte(e.spieler, e.typ);
      stempeln(e.spieler, this.kx(e), this.ky(e), w.sicht);
    }
    for (const g of this.gebaeude) {
      if (g.tot) continue;
      const w = this.gebaeudeWerte(g.spieler, g.typ);
      const c = Math.floor(g.groesse / 2);
      stempeln(g.spieler, g.kx + c, g.ky + c, w.sicht);
    }
  }

  sichtbarFuer(spielerId, kx, ky) {
    if (spielerId == null) return 2;   // Zuschauer sehen alles
    const p = this.spieler[spielerId];
    if (!p || !drin(this.karte, kx, ky)) return 0;
    const i = ky * this.karte.breite + kx;
    return p.sichtbar[i] ? 2 : (p.erkundet[i] ? 1 : 0);
  }

  /* ─────────────── Sieg und Niederlage ─────────────── */

  siegPruefen() {
    for (const p of this.spieler) {
      if (p.besiegt) continue;
      if (p.aufgegeben) { this.spielerBesiegen(p, 'aufgegeben'); continue; }
      let hatEinheiten = false, hatGebaeude = false;
      for (const e of this.einheiten) if (!e.tot && e.spieler === p.id) { hatEinheiten = true; break; }
      for (const b of this.gebaeude) {
        if (b.tot || b.spieler !== p.id) continue;
        const def = GEBAEUDE[b.typ];
        if (def.kette || def.durchlass || def.acker) continue;
        hatGebaeude = true; break;
      }
      if (!hatEinheiten && !hatGebaeude) this.spielerBesiegen(p, 'vernichtet');
    }
    /* Steht nur noch ein Team, ist die Partie entschieden. */
    const teams = new Set();
    for (const p of this.spieler) if (!p.besiegt) teams.add(p.team);
    if (teams.size <= 1 && !this.vorbei) {
      this.vorbei = true;
      this.sieger = teams.size ? [...teams][0] : null;
      this.ereignisse.push({ art: 'partieEnde', sieger: this.sieger });
    }
  }

  spielerBesiegen(p, grund) {
    if (p.besiegt) return;
    p.besiegt = true;
    this.ereignisse.push({ art: 'besiegt', spieler: p.id, grund });
    /* Alles, was ihm gehoerte, verschwindet. */
    for (const e of this.einheiten) if (!e.tot && e.spieler === p.id) this.einheitTot(e, null);
    for (const b of this.gebaeude) if (!b.tot && b.spieler === p.id) this.gebaeudeWeg(b, null);
  }

  /* ─────────────── Pruefsumme ───────────────
     Sie faellt bei jeder Runde an und wird im Mehrspieler
     verglichen. Weicht sie ab, sind die Rechner auseinander-
     gelaufen — dann hilft nur noch Abbruch statt stiller
     Falschanzeige. */

  pruefsumme() {
    const werte = [this.takt, this.einheiten.length, this.gebaeude.length];
    for (const e of this.einheiten) {
      werte.push(e.id, e.x, e.y, e.hp, e.zustand, e.spieler);
    }
    for (const b of this.gebaeude) {
      werte.push(b.id, b.hp, b.bauFortschritt, b.warteschlange.length, b.spieler);
    }
    for (const p of this.spieler) {
      werte.push(p.rohstoffe.nahrung, p.rohstoffe.holz, p.rohstoffe.gold, p.rohstoffe.stein,
                 p.bev, p.zeitalter, p.besiegt ? 1 : 0);
    }
    return summe32(werte);
  }

  /* ─────────────── Auskuenfte fuer die Oberflaeche ─────────────── */

  /** Spielzeit in Sekunden. */
  zeit() { return Math.floor(this.takt / TAKTE_PRO_S); }

  /** Alles, was ein Spieler gerade sieht (fuer die Minikarte). */
  bevoelkerung(spielerId) {
    const p = this.spieler[spielerId];
    return { jetzt: p.bev, raum: Math.min(p.bevRaum, p.bevGrenze), grenze: p.bevGrenze };
  }

  /** Zaehlt Einheiten eines Spielers nach Typ. */
  zaehlen(spielerId) {
    const raus = { gesamt: 0, dorf: 0, militaer: 0, untaetig: 0, typen: {} };
    for (const e of this.einheiten) {
      if (e.tot || e.spieler !== spielerId) continue;
      raus.gesamt++;
      raus.typen[e.typ] = (raus.typen[e.typ] || 0) + 1;
      const w = this.werte(spielerId, e.typ);
      if (w.kannSammeln) {
        raus.dorf++;
        if (e.zustand === ZUSTAND.ruhig && !e.folge.length) raus.untaetig++;
      } else raus.militaer++;
    }
    return raus;
  }

  /** Untaetige Dorfbewohner der Reihe nach (fuer die Punkt-Taste). */
  untaetigeDorfbewohner(spielerId) {
    const raus = [];
    for (const e of this.einheiten) {
      if (e.tot || e.spieler !== spielerId) continue;
      if (!this.werte(spielerId, e.typ).kannSammeln) continue;
      if (e.zustand === ZUSTAND.ruhig && !e.folge.length) raus.push(e);
    }
    return raus;
  }
}

/** Blickrichtung in 16 Sektoren — nur fuer die Anzeige. */
function richtungAus(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let s;
  if (ax >= ay) s = (ay * 4 / ax) | 0; else s = 8 - ((ax * 4 / ay) | 0);
  let r = s;
  if (dx < 0 && dy >= 0) r = 16 - s;
  else if (dx < 0 && dy < 0) r = 8 + s;
  else if (dx >= 0 && dy < 0) r = 8 + (8 - s);
  return r & 15;
}

export { richtungAus };
