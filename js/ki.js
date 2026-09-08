/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Der Rechner als Gegner

   Die KI ist Teil der Simulation: Sie faellt ihre Entscheidungen
   aus dem Spielstand, nicht aus Zufall der Aussenwelt. Damit
   rechnet jeder Teilnehmer im Mehrspieler dieselbe KI aus und
   es muss nichts uebertragen werden.

   Sie arbeitet wie ein ordentlicher Spieler: Dorfbewohner auf
   die knappsten Rohstoffe, Haeuser bevor es klemmt, Zeitalter
   sobald bezahlbar, dann Kaserne, dann Wellen.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import { FP, GEBAEUDE, EINHEITEN, TECHS, ZEITALTER, ROHSTOFFE, kosten as kostenVon, aufstiegKosten, spezialEinheit } from './regeln.js';
import { VORKOMMEN_LISTE } from './karte.js';
import { abstand2, klemme } from './zufall.js';

const STUFEN = {
  leicht: { dorfZiel: [14, 20, 26, 30], armee: [0, 6, 10, 16], denkTakt: 3, techEifer: 0.4, angriffPause: 150 },
  normal: { dorfZiel: [18, 28, 38, 46], armee: [0, 9, 16, 24], denkTakt: 2, techEifer: 0.8, angriffPause: 100 },
  schwer: { dorfZiel: [22, 36, 50, 60], armee: [2, 14, 24, 36], denkTakt: 1, techEifer: 1.0, angriffPause: 70 }
};

/* Wieviel Anteil jedes Rohstoffs im jeweiligen Zeitalter gewuenscht ist. */
const VERTEILUNG = [
  { nahrung: 65, holz: 35, gold: 0,  stein: 0 },
  { nahrung: 46, holz: 30, gold: 19, stein: 5 },
  { nahrung: 40, holz: 28, gold: 22, stein: 10 },
  { nahrung: 38, holz: 26, gold: 26, stein: 10 }
];

export const KI = {
  anfang(sim, p) {
    const stufe = STUFEN[p.ki] ? p.ki : 'normal';
    return {
      stufe, s: STUFEN[stufe],
      zaehler: 0,
      naechsterAngriff: 60 * 10,
      welle: 0,
      spaeherZiel: 0,
      letzterBau: 0,
      armee: [],
      sammelplatz: null
    };
  },

  takt(sim, p) {
    const z = p.kiZustand;
    if (!z || p.besiegt) return;
    z.zaehler++;

    /* Nicht alles in einem Takt — das kostet nur Rechenzeit. */
    switch (z.zaehler % 6) {
      case 0: wirtschaft(sim, p, z); break;
      case 1: bauen(sim, p, z); break;
      case 2: ausbilden(sim, p, z); break;
      case 3: forschen(sim, p, z); break;
      case 4: militaer(sim, p, z); break;
      case 5: spaehen(sim, p, z); break;
    }
    if (z.zaehler % 12 === 7) fischerei(sim, p, z);
  }
};

/* ─────────────── Hilfen ─────────────── */

function meineGebaeude(sim, p, typ) {
  const raus = [];
  for (const b of sim.gebaeude) if (!b.tot && b.spieler === p.id && (!typ || b.typ === typ)) raus.push(b);
  return raus;
}
function zahlGebaeude(sim, p, typ, auchImBau) {
  let n = 0;
  for (const b of sim.gebaeude) if (!b.tot && b.spieler === p.id && b.typ === typ && (auchImBau || b.fertig)) n++;
  return n;
}
function meineEinheiten(sim, p, pruef) {
  const raus = [];
  for (const e of sim.einheiten) if (!e.tot && e.spieler === p.id && (!pruef || pruef(e))) raus.push(e);
  return raus;
}
function hauptzentrum(sim, p) {
  for (const b of sim.gebaeude) if (!b.tot && b.spieler === p.id && b.typ === 'dorfzentrum') return b;
  return null;
}
function befehl(sim, p, c) { c.s = p.id; sim.befehlAusfuehren(c); }

/* ─────────────── Dorfbewohner verteilen ─────────────── */

function wirtschaft(sim, p, z) {
  const dorf = meineEinheiten(sim, p, e => sim.werte(p.id, e.typ).kannSammeln);
  if (!dorf.length) return;

  /* Wer nichts tut, bekommt Arbeit; ausserdem wird alle paar
     Runden ein Teil umverteilt, damit kein Rohstoff verhungert. */
  const untaetig = dorf.filter(e => e.zustand === 0 && !e.folge.length);
  const soll = VERTEILUNG[p.zeitalter];
  const ist = { nahrung: 0, holz: 0, gold: 0, stein: 0 };
  let arbeitend = 0;
  for (const e of dorf) {
    if (e.ladungArt && e.zustand !== 0) { ist[e.ladungArt]++; arbeitend++; }
  }
  const knapp = knappsterRohstoff(sim, p, ist, arbeitend, soll);

  for (const e of untaetig) schickeSammeln(sim, p, e, knapp);

  /* Wachhund: Wenn die Nahrung stockt, obwohl Aecker voll dastehen,
     stimmt etwas nicht — ein verbauter Weg, eine erschoepfte Quelle,
     eine Kette ungluecklicher Befehle. Dann werden Leute unmittelbar
     auf den naechsten Acker gesetzt, statt weiter zu rechnen. */
  if (z.zaehler % 12 === 0) {
    const jetzt = p.statistik.gesammelt.nahrung;
    /* Nur wenn wirklich gar nichts mehr hereinkommt — sonst reisst der
       Wachhund gut arbeitende Leute von ihrer Quelle weg. */
    const stockt = z.letzteNahrung != null && jetzt - z.letzteNahrung < 4;
    z.letzteNahrung = jetzt;
    if (stockt && p.rohstoffe.nahrung < 600) {
      const aecker = meineGebaeude(sim, p, 'farm').filter(b => b.fertig && b.vorrat > 0);
      if (aecker.length) {
        const helfer = dorf.filter(e => e.zustand !== 4 && e.ladungArt === 'nahrung').slice(0, 3);
        helfer.forEach((e, i) => {
          const acker = aecker[i % aecker.length];
          befehl(sim, p, { a: 'sammeln', ids: [e.id], ziel: acker.id });
        });
      }
    }
  }

  /* Wer weit laeuft, arbeitet kaum. Ein Dorfbewohner, dessen
     Ablieferweg zu lang geworden ist — die Beeren am Kartenrand sind
     abgeerntet, die Farmen daheim stehen leer —, bekommt eine naehere
     Quelle. Einer je Denkrunde, damit kein Wanderzirkus entsteht. */
  if (z.zaehler % 12 === 0) {
    for (const e of dorf) {
      if (e.zustand === 0 || e.zustand === 4 || !e.ladungArt) continue;
      if (abgabeWeg(sim, p, e) <= 13) continue;
      schickeSammeln(sim, p, e, e.ladungArt);
      break;
    }
  }

  /* Umverteilen: liegt die Verteilung schief, wandern bis zu zwei
     Leute um. Wer baut, bleibt in Ruhe. */
  if (arbeitend > 5) {
    const zuviel = ueberschussRohstoff(sim, p, ist, arbeitend, soll);
    if (zuviel && zuviel !== knapp) {
      /* Am liebsten jemanden mit leeren Haenden — der verliert keine Zeit. */
      const frei = dorf.filter(e => e.ladungArt === zuviel && e.zustand !== 0 && e.zustand !== 4 && e.ladung === 0);
      const kandidat = frei[0] || dorf.find(e => e.ladungArt === zuviel && e.zustand !== 0 && e.zustand !== 4);
      if (kandidat) schickeSammeln(sim, p, kandidat, knapp);
    }
  }
}

function knappsterRohstoff(sim, p, ist, arbeitend, soll) {
  let besteArt = 'nahrung', besterWert = -1e9;
  for (const r of ROHSTOFFE) {
    if (!soll[r]) continue;
    const anteil = arbeitend ? ist[r] * 100 / arbeitend : 0;
    let wert = soll[r] - anteil;
    /* Vorratslage einbeziehen: was knapp wird, ist dringend; was sich
       tuermt, kann warten. Ohne das haeuft der Rechner Holz an,
       waehrend die Nahrung fuer das naechste Zeitalter fehlt. */
    const vorrat = p.rohstoffe[r];
    wert += Math.max(0, (300 - vorrat) / 10);
    wert -= Math.max(0, (vorrat - 450) / 18);
    if (r === 'stein' && zahlGebaeude(sim, p, 'burg', true) > 0 && p.rohstoffe.stein > 200) wert -= 40;
    if (wert > besterWert) { besterWert = wert; besteArt = r; }
  }
  return besteArt;
}

function ueberschussRohstoff(sim, p, ist, arbeitend, soll) {
  let art = null, wert = 0;
  for (const r of ROHSTOFFE) {
    const anteil = arbeitend ? ist[r] * 100 / arbeitend : 0;
    const d = anteil - (soll[r] || 0);
    if (d > 8 && d > wert) { wert = d; art = r; }
  }
  return art;
}

/**
 * Schickt einen Dorfbewohner zur lohnendsten Quelle.
 *
 * Entscheidend ist nicht die Luftlinie zur Quelle, sondern der
 * ganze Weg: hin und danach immer wieder zum Ablieferplatz. Eine
 * Farm neben der Muehle schlaegt deshalb den Beerenstrauch zwanzig
 * Kacheln weiter — genau so, wie es ein Mensch machen wuerde.
 */
function schickeSammeln(sim, p, e, rohstoff) {
  const k = sim.karte;
  const kx = (e.x / FP) | 0, ky = (e.y / FP) | 0;

  /* Wo kann dieser Rohstoff abgeliefert werden? */
  const abgaben = [];
  for (const b of sim.gebaeude) {
    if (b.tot || b.spieler !== p.id || !b.fertig) continue;
    const def = GEBAEUDE[b.typ];
    if (def.abgabe && def.abgabe.indexOf(rohstoff) >= 0) abgaben.push(b);
  }

  const wegBis = (x, y) => {
    let best = 40;
    for (const b of abgaben) {
      const d = kachelAbstand(x, y, (b.x / FP) | 0, (b.y / FP) | 0);
      if (d < best) best = d;
    }
    return best;
  };

  let beste = null, besterWert = Infinity;
  const R = 24;
  for (let y = Math.max(0, ky - R); y <= Math.min(k.hoehe - 1, ky + R); y++) {
    for (let x = Math.max(0, kx - R); x <= Math.min(k.breite - 1, kx + R); x++) {
      const i = y * k.breite + x;
      const v = k.vorkommen[i];
      if (!v || k.menge[i] <= 0) continue;
      const art = VORKOMMEN_LISTE[v - 1];
      const rs = art === 'baum' ? 'holz' : (art === 'gold' ? 'gold' : (art === 'stein' ? 'stein' : 'nahrung'));
      if (rs !== rohstoff) continue;
      /* Hinweg einfach, Rueckweg doppelt: der wird staendig gelaufen. */
      const wert = kachelAbstand(x, y, kx, ky) + 2 * wegBis(x, y);
      if (wert < besterWert) { besterWert = wert; beste = { kx: x, ky: y }; }
    }
  }

  /* Farmen zaehlen als Quelle — und sind meist die beste. */
  if (rohstoff === 'nahrung') {
    for (const b of sim.gebaeude) {
      if (b.tot || b.spieler !== p.id || !GEBAEUDE[b.typ].acker) continue;
      if (b.vorrat <= 0) continue;
      /* Auch eine Baustelle zaehlt: der Bewohner baut sie fertig und
         erntet danach — das ist besser, als quer ueber die Karte zu
         laufen. Nur schon abgeerntete Aecker sind uninteressant. */
      /* Nicht zu sechst auf einen Acker. */
      let schon = 0;
      for (const o of sim.einheiten) if (!o.tot && o.spieler === p.id && o.zielId === b.id) schon++;
      if (schon >= 2) continue;
      const bx = (b.x / FP) | 0, by = (b.y / FP) | 0;
      const wert = kachelAbstand(bx, by, kx, ky) + 2 * wegBis(bx, by);
      if (wert < besterWert) { besterWert = wert; beste = { farm: b.id }; }
    }
  }

  if (beste && beste.farm) { befehl(sim, p, { a: 'sammeln', ids: [e.id], ziel: beste.farm }); return true; }
  if (beste) { befehl(sim, p, { a: 'sammeln', ids: [e.id], kx: beste.kx, ky: beste.ky }); return true; }

  /* Nichts mehr da: Acker bestellen. */
  if (rohstoff === 'nahrung' && zahlGebaeude(sim, p, 'muehle', true) > 0) return bauAuftrag(sim, p, 'farm', [e]);
  /* Sonst irgendetwas anderes tun, damit niemand herumsteht. */
  for (const ersatz of ['holz', 'nahrung', 'gold', 'stein']) {
    if (ersatz === rohstoff) continue;
    if (schickeSammelnEinfach(sim, p, e, ersatz)) return true;
  }
  return false;
}

/** Kurzfassung ohne Ausweichkette — verhindert endloses Weiterreichen. */
function schickeSammelnEinfach(sim, p, e, rohstoff) {
  const k = sim.karte;
  const kx = (e.x / FP) | 0, ky = (e.y / FP) | 0;
  let beste = null, besteD = Infinity;
  const R = 24;
  for (let y = Math.max(0, ky - R); y <= Math.min(k.hoehe - 1, ky + R); y++) {
    for (let x = Math.max(0, kx - R); x <= Math.min(k.breite - 1, kx + R); x++) {
      const i = y * k.breite + x;
      const v = k.vorkommen[i];
      if (!v || k.menge[i] <= 0) continue;
      const art = VORKOMMEN_LISTE[v - 1];
      const rs = art === 'baum' ? 'holz' : (art === 'gold' ? 'gold' : (art === 'stein' ? 'stein' : 'nahrung'));
      if (rs !== rohstoff) continue;
      const d = kachelAbstand(x, y, kx, ky);
      if (d < besteD) { besteD = d; beste = { kx: x, ky: y }; }
    }
  }
  if (!beste) return false;
  befehl(sim, p, { a: 'sammeln', ids: [e.id], kx: beste.kx, ky: beste.ky });
  return true;
}

/** Wie weit hat es dieser Dorfbewohner bis zur naechsten Abgabe? */
function abgabeWeg(sim, p, e) {
  const kx = (e.x / FP) | 0, ky = (e.y / FP) | 0;
  let best = 99;
  for (const b of sim.gebaeude) {
    if (b.tot || b.spieler !== p.id || !b.fertig) continue;
    const def = GEBAEUDE[b.typ];
    if (!def.abgabe || def.abgabe.indexOf(e.ladungArt) < 0) continue;
    const d = kachelAbstand(kx, ky, (b.x / FP) | 0, (b.y / FP) | 0);
    if (d < best) best = d;
  }
  return best;
}

/** Achteck-Abstand in Kacheln — reicht fuer Vergleiche und ist ganzzahlig. */
function kachelAbstand(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  return dx > dy ? dx + ((dy * 41) >> 6) : dy + ((dx * 41) >> 6);
}

/* ─────────────── Bauen ─────────────── */

function bauen(sim, p, z) {
  if (sim.takt - z.letzterBau < 20) return;
  const dorf = meineEinheiten(sim, p, e => sim.werte(p.id, e.typ).kannBauen && e.zustand !== 4);
  if (!dorf.length) return;

  /* Erst einmal fertigmachen, was schon angefangen ist. Kommt eine
     Baustelle trotz mehrerer Anlaeufe nicht voran, wird sie abgerissen —
     sonst haengt der ganze Bauplan an einer Ruine. */
  if (!z.baustellen) z.baustellen = {};
  /* „Haengengeblieben“ ist eine Baustelle nur, wenn ueberhaupt niemand
     mehr hinlaeuft. Wer noch unterwegs ist, zaehlt als Bauarbeiter —
     sonst reisst die KI ihre eigenen Farmen wieder ab, bevor der
     Erste angekommen ist. */
  const unterwegs = (b) => sim.einheiten.some(e => !e.tot && e.spieler === p.id && e.bauId === b.id);
  const baustelle = meineGebaeude(sim, p).find(b => !b.fertig && b.bauer === 0 && !unterwegs(b));
  if (baustelle) {
    const merk = z.baustellen[baustelle.id] || { versuche: 0, stand: -1 };
    if (merk.stand === baustelle.bauFortschritt) merk.versuche++;
    else { merk.versuche = 0; merk.stand = baustelle.bauFortschritt; }
    z.baustellen[baustelle.id] = merk;
    if (merk.versuche > 4) {
      befehl(sim, p, { a: 'abreissen', ids: [baustelle.id] });
      delete z.baustellen[baustelle.id];
    } else {
      const frei = dorf.filter(e => e.zustand === 0 || e.zustand === 2).slice(0, 2);
      if (frei.length) {
        befehl(sim, p, { a: 'weiterbauen', ids: frei.map(e => e.id), ziel: baustelle.id });
        z.letzterBau = sim.takt;
        return;
      }
    }
  }

  const raum = Math.min(p.bevRaum, p.bevGrenze);
  const haeuserImBau = zahlGebaeude(sim, p, 'haus', true) - zahlGebaeude(sim, p, 'haus', false);

  /* 1. Bevoelkerungsraum — nie ohne Haus dastehen. */
  if (raum - p.bev < 5 && raum < p.bevGrenze && haeuserImBau < 2) {
    if (bauAuftrag(sim, p, 'haus', dorf.slice(0, 2))) { z.letzterBau = sim.takt; return; }
  }
  /* 2. Wirtschaft */
  if (zahlGebaeude(sim, p, 'muehle', true) < (p.zeitalter >= 2 ? 2 : 1) && p.rohstoffe.holz >= 100) {
    if (bauAuftrag(sim, p, 'muehle', dorf.slice(0, 2))) { z.letzterBau = sim.takt; return; }
  }
  /* Lager sind die halbe Wirtschaft: jeder Schritt weniger zum
     Abliefern zaehlt bei jedem Gang. Deshalb ruhig mehrere. */
  if (zahlGebaeude(sim, p, 'lager', true) < 2 + p.zeitalter && p.rohstoffe.holz >= 100) {
    if (bauAuftrag(sim, p, 'lager', dorf.slice(0, 2))) { z.letzterBau = sim.takt; return; }
  }
  /* 3. Ein Hafen, wenn Wasser mit Fisch vor der Haustuer liegt. Fisch
     ist Nahrung, die niemand saet und niemand bewachen muss. Findet
     sich kein Platz, wird eine Weile nicht wieder gesucht — die Suche
     laeuft ueber die halbe Karte. */
  if (zahlGebaeude(sim, p, 'hafen', true) < 1
      && zahlGebaeude(sim, p, 'muehle', false) > 0
      && p.rohstoffe.holz >= 150 && sim.takt > (z.hafenPause || 0)) {
    const platz = hafenplatz(sim, p);
    if (platz) {
      befehl(sim, p, { a: 'bauen', ids: dorf.slice(0, 2).map(e => e.id), typ: 'hafen',
                       kx: platz[0], ky: platz[1] });
      z.letzterBau = sim.takt;
      return;
    }
    z.hafenPause = sim.takt + 1200;
  }
  /* 4. Farmen, sobald die Muehle steht und Nahrung knapp wird. */
  const farmen = zahlGebaeude(sim, p, 'farm', true);
  let farmZiel = [4, 9, 13, 15][p.zeitalter];
  /* Wenn die Nahrung ausgeht, wird gepflanzt statt gespart. */
  if (p.rohstoffe.nahrung < 200 && p.rohstoffe.holz > 300) farmZiel += 4;
  if (zahlGebaeude(sim, p, 'muehle', false) > 0 && farmen < farmZiel && p.rohstoffe.holz >= 120) {
    if (bauAuftrag(sim, p, 'farm', dorf.slice(0, 1))) { z.letzterBau = sim.takt; return; }
  }
  /* 5. Militaergebaeude nach Zeitalter. */
  const plan = [
    ['kaserne'],
    ['kaserne', 'schuetzenstand', 'stall'],
    ['schuetzenstand', 'stall', 'universitaet', 'burg', 'belagerung'],
    ['burg', 'schuetzenstand', 'stall', 'belagerung', 'universitaet']
  ][p.zeitalter];
  for (const typ of plan) {
    const def = GEBAEUDE[typ];
    if (def.zeitalter > p.zeitalter) continue;
    if (def.braucht && zahlGebaeude(sim, p, def.braucht, false) === 0) continue;
    const grenze = typ === 'burg' ? 1 : (p.zeitalter >= 2 ? 2 : 1);
    if (zahlGebaeude(sim, p, typ, true) >= grenze) continue;
    if (!sim.kannZahlen(p.id, kostenVon('gebaeude', typ, p.volk))) continue;
    if (bauAuftrag(sim, p, typ, dorf.slice(0, 2))) { z.letzterBau = sim.takt; return; }
  }
  /* 6. Ein Turm zur Absicherung, wenn Stein da ist. */
  if (p.zeitalter >= 1 && p.rohstoffe.stein > 300 && zahlGebaeude(sim, p, 'turm', true) < 2) {
    if (bauAuftrag(sim, p, 'turm', dorf.slice(0, 1))) { z.letzterBau = sim.takt; return; }
  }
}

/** Sucht einen Platz und gibt den Bauauftrag. */
function bauAuftrag(sim, p, typ, bauer) {
  if (!bauer || !bauer.length) return false;
  const k = kostenVon('gebaeude', typ, p.volk);
  if (!sim.kannZahlen(p.id, k)) return false;
  const tc = hauptzentrum(sim, p);
  const mitte = tc || { kx: p.startX, ky: p.startY };
  const stelle = platzSuchen(sim, p, typ, mitte.kx, mitte.ky);
  if (!stelle) return false;
  befehl(sim, p, { a: 'bauen', ids: bauer.map(e => e.id), typ, kx: stelle[0], ky: stelle[1] });
  return true;
}

/** Spirale um das Zentrum, mit Abstand fuer Wege. */
function platzSuchen(sim, p, typ, cx, cy) {
  const def = GEBAEUDE[typ];
  const g = def.groesse;
  /* Farmen dicht an die Muehle, Lager an die naechste Quelle, Rest ums Zentrum. */
  if (typ === 'farm') {
    const m = meineGebaeude(sim, p, 'muehle')[0];
    if (m) { cx = m.kx; cy = m.ky; }
  } else if (typ === 'lager') {
    const quelle = quelleFernVomLager(sim, p, cx, cy);
    if (quelle) { cx = quelle[0]; cy = quelle[1]; }
  }
  for (let r = def.acker ? 2 : 3; r < 26; r++) {
    for (let s = 0; s < 4; s++) {
      for (let t = -r; t <= r; t += 1) {
        let x, y;
        if (s === 0) { x = cx + t; y = cy - r; }
        else if (s === 1) { x = cx + r; y = cy + t; }
        else if (s === 2) { x = cx + t; y = cy + r; }
        else { x = cx - r; y = cy + t; }
        x -= (g >> 1); y -= (g >> 1);
        if (!sim.bauplatzFrei(p.id, typ, x, y)) continue;
        /* Nicht direkt an das Zentrum kleben — sonst verstopft alles. */
        if (!def.acker && Math.abs(x - cx) < 2 && Math.abs(y - cy) < 2) continue;
        return [x, y];
      }
    }
  }
  return null;
}

/** Bauplatz fuer den Hafen: am Wasser, in Reichweite des Zentrums
    und nur dort, wo es auch etwas zu fischen gibt. */
function hafenplatz(sim, p) {
  const k = sim.karte;
  const tc = hauptzentrum(sim, p);
  if (!tc) return null;
  const cx = tc.kx, cy = tc.ky;
  let bestes = null, bestD = Infinity;
  for (let y = Math.max(0, cy - 24); y < Math.min(k.hoehe, cy + 24); y++) {
    for (let x = Math.max(0, cx - 24); x < Math.min(k.breite, cx + 24); x++) {
      const d = kachelAbstand(x, y, cx, cy);
      if (d >= bestD) continue;
      if (!p.erkundet[y * k.breite + x]) continue;
      if (!sim.bauplatzFrei(p.id, 'hafen', x, y)) continue;
      if (!fischInDerNaehe(sim, x, y)) continue;
      bestD = d; bestes = [x, y];
    }
  }
  return bestes;
}

/** Liegt im selben Gewaesser ein Fischgrund? */
function fischInDerNaehe(sim, kx, ky) {
  const k = sim.karte;
  /* Erst das Wasser vor dem Hafen finden, dann dessen Revier. */
  let revier = -1;
  for (let dy = -1; dy <= 3 && revier < 0; dy++) for (let dx = -1; dx <= 3; dx++) {
    const r = sim.revier(kx + dx, ky + dy);
    if (r >= 0) { revier = r; break; }
  }
  if (revier < 0) return false;
  const fischNr = VORKOMMEN_LISTE.indexOf('fisch') + 1;
  for (let y = Math.max(0, ky - 30); y < Math.min(k.hoehe, ky + 30); y++) {
    for (let x = Math.max(0, kx - 30); x < Math.min(k.breite, kx + 30); x++) {
      const i = y * k.breite + x;
      if (k.vorkommen[i] !== fischNr || k.menge[i] <= 0) continue;
      if (sim.wasserRevier[i] === revier) return true;
    }
  }
  return false;
}

/** Quelle, die weit vom naechsten Lager weg ist — dort lohnt ein neues. */
function quelleFernVomLager(sim, p, cx, cy) {
  const k = sim.karte;
  let beste = null, besterWert = -1;
  for (let y = Math.max(0, cy - 22); y < Math.min(k.hoehe, cy + 22); y += 2) {
    for (let x = Math.max(0, cx - 22); x < Math.min(k.breite, cx + 22); x += 2) {
      const i = y * k.breite + x;
      const v = k.vorkommen[i];
      if (v !== 1 && v !== 5 && v !== 6) continue;   // Baum, Gold, Stein
      if (!p.erkundet[i]) continue;
      let nah = Infinity;
      for (const b of sim.gebaeude) {
        if (b.tot || b.spieler !== p.id) continue;
        const def = GEBAEUDE[b.typ];
        if (!def.abgabe) continue;
        nah = Math.min(nah, abstand2(x, y, b.kx, b.ky));
      }
      const wert = Math.min(nah, 400) - abstand2(x, y, cx, cy) / 40;
      if (wert > besterWert) { besterWert = wert; beste = [x, y]; }
    }
  }
  return beste;
}

/* ─────────────── Ausbilden ─────────────── */

function ausbilden(sim, p, z) {
  const dorfZahl = meineEinheiten(sim, p, e => sim.werte(p.id, e.typ).kannSammeln).length;
  const ziel = z.s.dorfZiel[p.zeitalter];
  const raum = Math.min(p.bevRaum, p.bevGrenze);

  /* Will die KI ins naechste Zeitalter? Dann wird der Beutel geschont.
     Wichtig ist die Reihenfolge: Erst der Entschluss, dann das Sparen —
     nicht umgekehrt. Wer erst spart, wenn schon fast alles beisammen
     ist, gibt vorher jede Muenze fuer Soldaten aus und kommt nie an. */
  const naechstes = aufstiegKosten(p.zeitalter, p.volk);
  const willAufsteigen = !!naechstes && !p.aufstieg && dorfZahl >= Math.round(ziel * 0.55);
  z.spart = willAufsteigen;

  /* Dorfbewohner zahlen sich immer aus — beim Sparen nur etwas
     zurueckhaltender, damit die Nahrung nicht komplett draufgeht. */
  const dorfGrenze = willAufsteigen ? Math.round(ziel * 0.8) : ziel;
  for (const tc of meineGebaeude(sim, p, 'dorfzentrum')) {
    if (!tc.fertig || tc.warteschlange.length >= 3) continue;
    if (dorfZahl >= dorfGrenze || p.bev >= raum) break;
    befehl(sim, p, { a: 'ausbilden', g: tc.id, typ: 'dorfbewohner', anzahl: 1 });
  }

  if (p.zeitalter < 1) return;
  if (p.bev >= raum - 1) return;

  const armeeJetzt = meineEinheiten(sim, p, e => {
    const w = sim.werte(p.id, e.typ);
    return w.schaden > 0 && !w.kannSammeln;
  }).length;
  /* Ein kleiner Kern zur Verteidigung wird immer gehalten. Alles
     darueber wartet, bis das Zeitalter steht. */
  const kern = Math.min(z.s.armee[p.zeitalter], 8);
  if (willAufsteigen && armeeJetzt >= kern) return;
  const armeeGrenze = z.s.armee[p.zeitalter] + z.welle * 4 + 6;
  if (armeeJetzt >= armeeGrenze) return;

  const wunsch = truppenwunsch(sim, p);
  for (const b of sim.gebaeude) {
    if (b.tot || b.spieler !== p.id || !b.fertig) continue;
    const def = GEBAEUDE[b.typ];
    if (!def.produziert || b.typ === 'dorfzentrum') continue;
    if (b.warteschlange.length >= 2) continue;
    for (const typ of wunsch) {
      const echterTyp = typ === 'spezial' ? spezialEinheit(p.volk) : typ;
      if ((def.produziert || []).indexOf(typ) < 0 && (def.produziert || []).indexOf(echterTyp) < 0) continue;
      const ed = EINHEITEN[echterTyp];
      if (!ed || ed.zeitalter > p.zeitalter) continue;
      if (!sim.kannZahlen(p.id, kostenVon('einheit', echterTyp, p.volk))) continue;
      befehl(sim, p, { a: 'ausbilden', g: b.id, typ, anzahl: 1 });
      break;
    }
  }
}

/* ─────────────── Fischerei ───────────────
   Der Hafen zahlt sich nur mit Booten aus. Ein leerlaufendes Boot
   bekommt den naechsten Fischgrund im eigenen Gewaesser zugewiesen. */

function fischerei(sim, p, z) {
  const haefen = meineGebaeude(sim, p, 'hafen').filter(b => b.fertig);
  if (!haefen.length) return;
  const boote = meineEinheiten(sim, p, e => e.typ === 'fischerboot');
  const raum = Math.min(p.bevRaum, p.bevGrenze);

  if (boote.length < 5 && p.bev < raum
      && sim.kannZahlen(p.id, kostenVon('einheit', 'fischerboot', p.volk))) {
    const hafen = haefen.find(b => b.warteschlange.length < 2);
    if (hafen) befehl(sim, p, { a: 'ausbilden', g: hafen.id, typ: 'fischerboot', anzahl: 1 });
  }

  const fischNr = VORKOMMEN_LISTE.indexOf('fisch') + 1;
  const k = sim.karte;
  for (const boot of boote) {
    if (boot.zustand !== 0) continue;          // nur was untaetig herumliegt
    let bestes = null, bestD = Infinity;
    for (let i = 0; i < k.vorkommen.length; i++) {
      if (k.vorkommen[i] !== fischNr || k.menge[i] <= 0) continue;
      const x = i % k.breite, y = (i / k.breite) | 0;
      const d = kachelAbstand(x, y, sim.kx(boot), sim.ky(boot));
      if (d >= bestD) continue;
      if (!sim.wasserErreichbar(boot, x, y)) continue;
      bestD = d; bestes = [x, y];
    }
    if (bestes) befehl(sim, p, { a: 'sammeln', ids: [boot.id], kx: bestes[0], ky: bestes[1] });
  }
}

/** Was gebaut werden soll — je Zeitalter und je nachdem, was der Feind hat. */
function truppenwunsch(sim, p) {
  if (p.zeitalter === 1) return ['bogen', 'milizionaer', 'speer', 'spaeher'];
  if (p.zeitalter === 2) return ['ritter', 'bogen', 'spezial', 'speer', 'mangonel'];
  return ['spezial', 'ritter', 'bogen', 'trebuchet', 'mangonel', 'speer'];
}

/* ─────────────── Forschen und Zeitalter ─────────────── */

function forschen(sim, p, z) {
  const tc = meineGebaeude(sim, p, 'dorfzentrum').find(b => b.fertig && !b.warteschlange.some(a => a.art === 'zeitalter'));
  /* Zeitalter, sobald bezahlbar — das ist im Zweifel wichtiger als alles andere. */
  if (tc && !p.aufstieg && p.zeitalter < ZEITALTER.length - 1) {
    const k = aufstiegKosten(p.zeitalter, p.volk);
    const dorfZahl = meineEinheiten(sim, p, e => sim.werte(p.id, e.typ).kannSammeln).length;
    if (sim.kannZahlen(p.id, k) && dorfZahl >= Math.min(12, Math.round(z.s.dorfZiel[p.zeitalter] * 0.6))) {
      befehl(sim, p, { a: 'zeitalter', g: tc.id });
      return;
    }
  }
  if (sim.zufall.bis(100) > z.s.techEifer * 100) return;
  /* Wer fuer das Zeitalter spart, forscht nicht nebenbei die Kasse leer. */
  if (z.spart) return;

  /* Wirtschafts- und Kampftechnologien, wenn Vorrat da ist. */
  const reihenfolge = ['schubkarre', 'manatarme', 'schmiede1', 'ruestung1', 'handkarre', 'pflug',
                       'armbrust', 'langschwert', 'pike', 'schmiede2', 'ruestung2', 'ballistik',
                       'elitplaenkler', 'mauerwerk', 'kreuzritter', 'wehrturm'];
  for (const t of reihenfolge) {
    const tech = TECHS[t];
    if (p.techs[t] || tech.zeitalter > p.zeitalter) continue;
    if (tech.braucht && !p.techs[tech.braucht]) continue;
    if (!sim.kannZahlen(p.id, tech.kosten)) continue;
    /* Nicht das letzte Holz verforschen. */
    if (p.rohstoffe.nahrung < 300 && tech.kosten.nahrung > 150) continue;
    for (const b of sim.gebaeude) {
      if (b.tot || b.spieler !== p.id || !b.fertig) continue;
      if ((GEBAEUDE[b.typ].forscht || []).indexOf(t) < 0) continue;
      if (b.warteschlange.length >= 2) continue;
      befehl(sim, p, { a: 'forschen', g: b.id, tech: t });
      return;
    }
  }
}

/* ─────────────── Militaer ─────────────── */

function militaer(sim, p, z) {
  const armee = meineEinheiten(sim, p, e => {
    const w = sim.werte(p.id, e.typ);
    return w.schaden > 0 && !w.kannSammeln;
  });

  /* Verteidigung geht vor: Feind in der Naehe des Zentrums? */
  const tc = hauptzentrum(sim, p);
  if (tc) {
    let eindringling = null;
    sim.imUmkreis(tc.x, tc.y, 18 * FP, (o) => {
      if (o.art !== 'einheit' || sim.verbuendet(p.id, o.spieler)) return;
      if (!eindringling) eindringling = o;
    });
    if (eindringling) {
      const ids = armee.map(e => e.id);
      if (ids.length) befehl(sim, p, { a: 'angriff', ids, ziel: eindringling.id });
      /* Ohne Soldaten greifen notgedrungen die Dorfbewohner zur Axt —
         aber nur, wenn der Feind wirklich vor der Tuer steht. */
      const nah = abstand2(eindringling.x, eindringling.y, tc.x, tc.y) < (9 * FP) * (9 * FP);
      if (armee.length < 2 && nah) {
        const dorf = meineEinheiten(sim, p, e => sim.werte(p.id, e.typ).kannSammeln)
          .filter(e => abstand2(e.x, e.y, tc.x, tc.y) < (12 * FP) * (12 * FP)).slice(0, 6);
        if (dorf.length) {
          befehl(sim, p, { a: 'angriff', ids: dorf.map(e => e.id), ziel: eindringling.id });
          z.dorfKampf = dorf.map(e => e.id);
        }
      }
      return;
    }
    /* Luft ist rein: die Dorfbewohner gehen wieder arbeiten. */
    if (z.dorfKampf) {
      befehl(sim, p, { a: 'stopp', ids: z.dorfKampf });
      z.dorfKampf = null;
    }
  }

  const schwelle = z.s.armee[p.zeitalter] + z.welle * 3;
  if (armee.length < schwelle || sim.takt < z.naechsterAngriff) {
    /* Sammeln: Truppen warten beim Zentrum. */
    if (tc && z.zaehler % 10 === 0) {
      const weit = armee.filter(e => abstand2(e.x, e.y, tc.x, tc.y) > (16 * FP) * (16 * FP) && e.zustand === 0);
      if (weit.length) {
        befehl(sim, p, { a: 'gehen', ids: weit.map(e => e.id), x: tc.x + 4 * FP, y: tc.y + 4 * FP });
      }
    }
    return;
  }

  /* Angriff: das naechstgelegene bekannte Ziel des Feindes. */
  const ziel = angriffsziel(sim, p);
  if (!ziel) return;
  befehl(sim, p, { a: 'angriff', ids: armee.map(e => e.id), ziel: ziel.id });
  z.welle++;
  z.naechsterAngriff = sim.takt + z.s.angriffPause * 10;
}

function angriffsziel(sim, p) {
  const tc = hauptzentrum(sim, p);
  const ax = tc ? tc.x : p.startX * FP, ay = tc ? tc.y : p.startY * FP;
  /* Abstaende im Quadrat werden gross: Infinity als Startwert, sonst
     bleibt alles jenseits von 32 Kacheln unsichtbar. */
  let bestes = null, bestD = Infinity;
  /* Erst Einheiten in Sichtweite, dann Gebaeude — Dorfzentren zuletzt,
     weil sie am zaehesten sind. */
  for (const e of sim.einheiten) {
    if (e.tot || sim.verbuendet(p.id, e.spieler)) continue;
    const d = abstand2(ax, ay, e.x, e.y);
    if (d < bestD) { bestD = d; bestes = e; }
  }
  if (bestes && bestD < (40 * FP) * (40 * FP)) return bestes;
  bestes = null; bestD = Infinity;
  for (const b of sim.gebaeude) {
    if (b.tot || sim.verbuendet(p.id, b.spieler)) continue;
    const def = GEBAEUDE[b.typ];
    const strafe = def.kette || def.durchlass ? (60 * FP) * (60 * FP) : 0;
    const d = abstand2(ax, ay, b.x, b.y) + strafe;
    if (d < bestD) { bestD = d; bestes = b; }
  }
  return bestes;
}

/* ─────────────── Erkunden ─────────────── */

function spaehen(sim, p, z) {
  const spaeher = meineEinheiten(sim, p, e => e.typ === 'spaeher');
  if (!spaeher.length) return;
  const e = spaeher[0];
  if (e.zustand !== 0 && z.zaehler % 40 !== 0) return;
  /* Im Kreis um die Karte, damit Startplaetze der Gegner gefunden werden. */
  const k = sim.karte;
  const punkte = [];
  for (const s of k.start) punkte.push({ x: s.x, y: s.y });
  punkte.push({ x: (k.breite / 2) | 0, y: (k.hoehe / 2) | 0 });
  const ziel = punkte[z.spaeherZiel % punkte.length];
  z.spaeherZiel++;
  befehl(sim, p, { a: 'gehen', ids: [e.id], x: ziel.x * FP, y: ziel.y * FP });
}
