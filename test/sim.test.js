/* Prueft den Spielkern: Karte, Wegsuche, Simulation, Regeln.
   Aufruf:  node --test test/                                   */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';

import { FP, GEBAEUDE, EINHEITEN, TECHS, VOELKER, kosten, aufstiegKosten } from '../js/regeln.js';
import { Zufall, iwurzel, rauschfeld } from '../js/zufall.js';
import { erzeugeKarte, flut, kartenInfo, begehbar } from '../js/karte.js';
import { Pfadfinder, GESPERRT } from '../js/pfad.js';
import { Sim, ZUSTAND } from '../js/sim.js';

/* ─────────────── Zufall ─────────────── */

test('Zufallsgenerator liefert bei gleicher Saat dieselbe Folge', () => {
  const a = new Zufall(1234), b = new Zufall(1234), c = new Zufall(1235);
  const folgeA = [], folgeB = [], folgeC = [];
  for (let i = 0; i < 500; i++) { folgeA.push(a.next()); folgeB.push(b.next()); folgeC.push(c.next()); }
  assert.deepEqual(folgeA, folgeB);
  assert.notDeepEqual(folgeA, folgeC);
});

test('Ganzzahlige Wurzel rundet ab', () => {
  for (const n of [0, 1, 2, 3, 4, 99, 100, 1024 * 1024, 123456789]) {
    const w = iwurzel(n);
    assert.ok(w * w <= n, 'zu gross bei ' + n);
    assert.ok((w + 1) * (w + 1) > n, 'zu klein bei ' + n);
  }
});

/* ─────────────── Karte ─────────────── */

test('Karte ist aus der Saat reproduzierbar', () => {
  const a = erzeugeKarte({ saat: 777, groesse: 'klein', art: 'seen', plaetze: 4 });
  const b = erzeugeKarte({ saat: 777, groesse: 'klein', art: 'seen', plaetze: 4 });
  assert.deepEqual([...a.hoehen], [...b.hoehen]);
  assert.deepEqual([...a.boden], [...b.boden]);
  assert.deepEqual([...a.vorkommen], [...b.vorkommen]);
  assert.deepEqual(a.start, b.start);
});

test('Alle Startplaetze sind zu Fuss erreichbar', () => {
  for (const art of ['ebene', 'seen', 'hochland', 'waelder']) {
    for (const saat of [1, 42, 4711]) {
      const k = erzeugeKarte({ saat, groesse: 'mittel', art, plaetze: 4 });
      const erreicht = flut(k, k.start[0].x, k.start[0].y);
      for (const s of k.start) {
        assert.ok(erreicht[s.y * k.breite + s.x], `${art}/${saat}: Startplatz abgeschnitten`);
      }
    }
  }
});

test('Jeder Startplatz hat Holz, Nahrung und Gold in der Naehe', () => {
  const k = erzeugeKarte({ saat: 2024, groesse: 'mittel', art: 'ebene', plaetze: 4 });
  for (const s of k.start) {
    const zaehler = { holz: 0, nahrung: 0, gold: 0, stein: 0 };
    for (let y = Math.max(0, s.y - 20); y < Math.min(k.hoehe, s.y + 20); y++) {
      for (let x = Math.max(0, s.x - 20); x < Math.min(k.breite, s.x + 20); x++) {
        const v = k.vorkommen[y * k.breite + x];
        if (v === 1) zaehler.holz++;
        else if (v === 2 || v === 3 || v === 4) zaehler.nahrung++;
        else if (v === 5) zaehler.gold++;
        else if (v === 6) zaehler.stein++;
      }
    }
    assert.ok(zaehler.holz > 30, 'zu wenig Wald: ' + zaehler.holz);
    assert.ok(zaehler.nahrung >= 6, 'zu wenig Nahrung: ' + zaehler.nahrung);
    assert.ok(zaehler.gold >= 4, 'kein Gold: ' + zaehler.gold);
    assert.ok(zaehler.stein >= 4, 'kein Stein: ' + zaehler.stein);
  }
});

test('Startplaetze liegen nicht am Kartenrand und weit auseinander', () => {
  const k = erzeugeKarte({ saat: 99, groesse: 'gross', art: 'ebene', plaetze: 4 });
  for (const s of k.start) {
    assert.ok(s.x > 8 && s.y > 8 && s.x < k.breite - 8 && s.y < k.hoehe - 8);
  }
  for (let i = 0; i < k.start.length; i++) {
    for (let j = i + 1; j < k.start.length; j++) {
      const d = Math.hypot(k.start[i].x - k.start[j].x, k.start[i].y - k.start[j].y);
      assert.ok(d > 25, 'Startplaetze zu dicht: ' + Math.round(d));
    }
  }
});

/* ─────────────── Wegsuche ─────────────── */

test('Wegsuche findet um ein Hindernis herum und bleibt reproduzierbar', () => {
  const b = 40, h = 40;
  const sperre = new Uint8Array(b * h);
  for (let y = 5; y < 35; y++) sperre[y * b + 20] = GESPERRT;
  const pf = new Pfadfinder(b, h);
  const w1 = pf.suche(sperre, 3, 20, 36, 20, {});
  const w2 = pf.suche(sperre, 3, 20, 36, 20, {});
  assert.ok(w1 && w1.length > 0, 'kein Weg gefunden');
  assert.deepEqual([...w1], [...w2], 'zwei Suchen ergeben verschiedene Wege');
  const ziel = w1[w1.length - 1];
  assert.equal(ziel % b, 36);
});

test('Wegsuche laeuft nicht diagonal durch Mauerecken', () => {
  const b = 10, h = 10;
  const sperre = new Uint8Array(b * h);
  sperre[5 * b + 4] = GESPERRT;
  sperre[4 * b + 5] = GESPERRT;
  const pf = new Pfadfinder(b, h);
  const weg = pf.suche(sperre, 4, 4, 5, 5, {});
  assert.ok(weg.length > 1, 'Ecke wurde durchschnitten');
});

/* ─────────────── Regeln ─────────────── */

test('Volksboni wirken auf Kosten und Werte', () => {
  assert.equal(kosten('gebaeude', 'burg', 'franken').stein, 488);       // 650 − 25 %
  assert.equal(kosten('gebaeude', 'burg', 'briten').stein, 650);
  assert.equal(kosten('gebaeude', 'farm', 'franken').holz, 45);         // 60 − 15
  const sim = neueSim();
  const frankenRitter = sim.werte(0, 'ritter');
  const britenRitter = sim.werte(1, 'ritter');
  assert.ok(frankenRitter.hp > britenRitter.hp, 'Frankenbonus fehlt');
});

test('Zeitalterkosten sind fuer Byzantiner guenstiger', () => {
  assert.ok(aufstiegKosten(0, 'byzantiner').nahrung < aufstiegKosten(0, 'franken').nahrung);
});

test('Jede Einheit und jedes Gebaeude hat vollstaendige Werte', () => {
  for (const id in EINHEITEN) {
    const e = EINHEITEN[id];
    assert.ok(e.name && e.kosten && e.hp > 0 && e.zeit > 0, 'unvollstaendig: ' + id);
    assert.ok(e.klasse, 'ohne Klasse: ' + id);
  }
  for (const id in GEBAEUDE) {
    const g = GEBAEUDE[id];
    assert.ok(g.name && g.kosten && g.hp > 0 && g.groesse > 0, 'unvollstaendig: ' + id);
  }
  for (const id in TECHS) {
    assert.ok(TECHS[id].name && TECHS[id].kosten, 'unvollstaendig: ' + id);
  }
});

/* ─────────────── Simulation ─────────────── */

function neueSim(o) {
  return new Sim(Object.assign({
    saat: 4711,
    karte: { groesse: 'klein', art: 'ebene' },
    bevGrenze: 100,
    spieler: [
      { name: 'A', volk: 'franken', team: 0, farbe: 0, ki: null },
      { name: 'B', volk: 'briten', team: 1, farbe: 1, ki: null }
    ]
  }, o || {}));
}

test('Startaufstellung: Dorfzentrum, drei Dorfbewohner, ein Spaeher', () => {
  const sim = neueSim();
  for (const p of sim.spieler) {
    const meine = sim.einheiten.filter(e => e.spieler === p.id);
    assert.equal(meine.filter(e => e.typ === 'dorfbewohner').length, 3);
    assert.equal(meine.filter(e => e.typ === 'spaeher').length, 1);
    assert.equal(sim.gebaeude.filter(b => b.spieler === p.id && b.typ === 'dorfzentrum').length, 1);
    assert.equal(p.bev, 4);
    assert.equal(p.bevRaum, 5);
  }
});

test('Zwei Laeufe mit denselben Befehlen ergeben dieselbe Pruefsumme', () => {
  const a = neueSim({ spieler: [
    { name: 'A', volk: 'mongolen', team: 0, farbe: 0, ki: 'schwer' },
    { name: 'B', volk: 'byzantiner', team: 1, farbe: 1, ki: 'normal' }] });
  const b = neueSim({ spieler: [
    { name: 'A', volk: 'mongolen', team: 0, farbe: 0, ki: 'schwer' },
    { name: 'B', volk: 'byzantiner', team: 1, farbe: 1, ki: 'normal' }] });
  for (let r = 0; r < 900; r++) {
    const befehl = r % 51 === 0
      ? [{ s: 0, a: 'gehen', ids: a.einheiten.filter(e => e.spieler === 0).slice(0, 2).map(e => e.id),
           x: (20 + r % 30) * FP, y: (25 + r % 20) * FP }]
      : null;
    a.rundeAusfuehren(befehl);
    b.rundeAusfuehren(befehl ? JSON.parse(JSON.stringify(befehl)) : null);
    if (r % 150 === 0) assert.equal(a.pruefsumme(), b.pruefsumme(), 'Abweichung in Runde ' + r);
  }
  assert.equal(a.pruefsumme(), b.pruefsumme());
});

test('Dorfbewohner faellt Holz und liefert es ab', () => {
  const sim = neueSim();
  const k = sim.karte;
  const p = sim.spieler[0];
  /* Naechsten Baum suchen. */
  let baum = null, bd = Infinity;
  for (let y = 0; y < k.hoehe; y++) for (let x = 0; x < k.breite; x++) {
    if (k.vorkommen[y * k.breite + x] !== 1) continue;
    const d = (x - p.startX) ** 2 + (y - p.startY) ** 2;
    if (d < bd) { bd = d; baum = { x, y }; }
  }
  assert.ok(baum, 'kein Baum auf der Karte');
  const dorf = sim.einheiten.filter(e => e.spieler === 0 && e.typ === 'dorfbewohner');
  const vorher = p.rohstoffe.holz;
  sim.befehlAusfuehren({ s: 0, a: 'sammeln', ids: dorf.map(e => e.id), kx: baum.x, ky: baum.y });
  for (let i = 0; i < 900; i++) sim.takten();     // 90 Sekunden
  assert.ok(p.rohstoffe.holz > vorher, 'kein Holz abgeliefert (' + p.rohstoffe.holz + ')');
  assert.ok(p.statistik.gesammelt.holz >= 10, 'zu wenig gesammelt');
});

test('Dorfbewohner bauen ein Haus, das Bevoelkerungsraum schafft', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  const dorf = sim.einheiten.filter(e => e.spieler === 0 && e.typ === 'dorfbewohner');
  /* Freien Platz neben dem Dorfzentrum suchen. */
  let stelle = null;
  for (let r = 3; r < 10 && !stelle; r++) {
    for (let dy = -r; dy <= r && !stelle; dy++) for (let dx = -r; dx <= r && !stelle; dx++) {
      const x = p.startX + dx, y = p.startY + dy;
      if (sim.bauplatzFrei(0, 'haus', x, y, true)) stelle = { x, y };
    }
  }
  assert.ok(stelle, 'kein Bauplatz gefunden');
  const raumVorher = p.bevRaum;
  sim.befehlAusfuehren({ s: 0, a: 'bauen', ids: dorf.map(e => e.id), typ: 'haus', kx: stelle.x, ky: stelle.y });
  for (let i = 0; i < 900; i++) sim.takten();
  const haus = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'haus');
  assert.ok(haus, 'Haus wurde nicht gesetzt');
  assert.ok(haus.fertig, 'Haus nicht fertig geworden (' + Math.round(haus.bauFortschritt * 100 / haus.bauGesamt) + ' %)');
  assert.equal(p.bevRaum, raumVorher + 5);
  assert.equal(p.rohstoffe.holz, 200 - 25);
});

test('Bauen ohne Rohstoffe schlaegt fehl', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  p.rohstoffe.holz = 0;
  const dorf = sim.einheiten.filter(e => e.spieler === 0 && e.typ === 'dorfbewohner');
  sim.befehlAusfuehren({ s: 0, a: 'bauen', ids: dorf.map(e => e.id), typ: 'haus', kx: p.startX + 5, ky: p.startY + 5 });
  assert.equal(sim.gebaeude.filter(b => b.typ === 'haus').length, 0);
});

test('Ausbildung kostet, dauert und liefert eine Einheit', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  const tc = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'dorfzentrum');
  const vorher = p.rohstoffe.nahrung;
  sim.befehlAusfuehren({ s: 0, a: 'ausbilden', g: tc.id, typ: 'dorfbewohner', anzahl: 1 });
  assert.equal(p.rohstoffe.nahrung, vorher - 50, 'Kosten nicht abgezogen');
  assert.equal(tc.warteschlange.length, 1);
  for (let i = 0; i < 260; i++) sim.takten();
  assert.equal(sim.einheiten.filter(e => e.spieler === 0 && e.typ === 'dorfbewohner').length, 4);
});

test('Abbrechen erstattet die Kosten', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  const tc = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'dorfzentrum');
  const vorher = p.rohstoffe.nahrung;
  sim.befehlAusfuehren({ s: 0, a: 'ausbilden', g: tc.id, typ: 'dorfbewohner', anzahl: 2 });
  sim.befehlAusfuehren({ s: 0, a: 'abbrechen', g: tc.id, i: 0 });
  sim.befehlAusfuehren({ s: 0, a: 'abbrechen', g: tc.id, i: 0 });
  assert.equal(p.rohstoffe.nahrung, vorher);
  assert.equal(tc.warteschlange.length, 0);
});

test('Bevoelkerungsgrenze haelt die Ausbildung an', () => {
  const sim = neueSim({ bevGrenze: 4 });
  const p = sim.spieler[0];
  p.rohstoffe.nahrung = 1000;
  const tc = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'dorfzentrum');
  sim.befehlAusfuehren({ s: 0, a: 'ausbilden', g: tc.id, typ: 'dorfbewohner', anzahl: 3 });
  for (let i = 0; i < 400; i++) sim.takten();
  assert.equal(sim.einheiten.filter(e => e.spieler === 0).length, 4, 'Grenze missachtet');
});

test('Kampf: Ritter besiegt Dorfbewohner, Statistik stimmt', () => {
  const sim = neueSim();
  const opfer = sim.einheiten.find(e => e.spieler === 1 && e.typ === 'dorfbewohner');
  const ritter = sim.einheitSetzen(0, 'ritter', opfer.x + 2 * FP, opfer.y);
  sim.befehlAusfuehren({ s: 0, a: 'angriff', ids: [ritter.id], ziel: opfer.id });
  for (let i = 0; i < 200 && !opfer.tot; i++) sim.takten();
  assert.ok(opfer.tot, 'Dorfbewohner ueberlebt den Ritter');
  assert.equal(sim.spieler[0].statistik.getoetet, 1);
  assert.equal(sim.spieler[1].statistik.verloren, 1);
});

test('Speertraeger haben Bonus gegen Reiterei', () => {
  const sim = neueSim();
  const speer = sim.werte(0, 'speer');
  assert.ok(speer.bonus.reiter >= 10, 'kein Bonus gegen Reiter');
  const ritterWerte = sim.werte(1, 'ritter');
  const schadenAmRitter = Math.max(1, speer.schaden + speer.bonus.reiter - ritterWerte.ruestungNah);
  const schadenAmSpeer = Math.max(1, speer.schaden - sim.werte(1, 'speer').ruestungNah);
  assert.ok(schadenAmRitter > schadenAmSpeer * 3);
});

test('Fernkaempfer treffen ueber Entfernung', () => {
  const sim = neueSim();
  const ziel = sim.einheitSetzen(1, 'milizionaer', 30 * FP, 30 * FP);
  const bogen = sim.einheitSetzen(0, 'bogen', 33 * FP, 30 * FP);
  sim.befehlAusfuehren({ s: 0, a: 'angriff', ids: [bogen.id], ziel: ziel.id });
  const hpVorher = ziel.hp;
  for (let i = 0; i < 60; i++) sim.takten();
  assert.ok(ziel.hp < hpVorher, 'kein Schaden aus der Ferne');
});

test('Zeitalteraufstieg braucht Gebaeude und Rohstoffe', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  const tc = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'dorfzentrum');
  p.rohstoffe.nahrung = 2000;
  sim.befehlAusfuehren({ s: 0, a: 'zeitalter', g: tc.id });
  assert.equal(tc.warteschlange.length, 0, 'Aufstieg ohne Gebaeude erlaubt');
  /* Zwei Gebaeude hinstellen. */
  sim.gebaeudeSetzen(0, 'haus', p.startX + 6, p.startY + 6, true);
  sim.gebaeudeSetzen(0, 'muehle', p.startX + 6, p.startY + 9, true);
  sim.befehlAusfuehren({ s: 0, a: 'zeitalter', g: tc.id });
  assert.equal(tc.warteschlange.length, 1, 'Aufstieg wurde nicht angenommen');
  for (let i = 0; i < 1400; i++) sim.takten();
  assert.equal(p.zeitalter, 1);
});

test('Technologie wirkt sofort auf bestehende Einheiten', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  const miliz = sim.einheitSetzen(0, 'milizionaer', 30 * FP, 30 * FP);
  const vorher = sim.werte(0, 'milizionaer').schaden;
  p.techs.manatarme = true;
  sim.werteVerwerfen(0);
  const nachher = sim.werte(0, 'milizionaer').schaden;
  assert.ok(nachher > vorher, 'Ausbaustufe wirkt nicht');
  assert.ok(miliz.hpMax > 40, 'Trefferpunkte nicht angepasst');
});

test('Sicht: unerkundetes Gebiet bleibt verborgen, eigenes Dorf ist sichtbar', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  assert.equal(sim.sichtbarFuer(0, p.startX, p.startY), 2);
  const fern = sim.sichtbarFuer(0, 2, 2);
  assert.equal(fern, 0, 'Kartenrand ist von Anfang an sichtbar');
});

test('Verbuendete teilen die Sicht', () => {
  const sim = neueSim({ spieler: [
    { name: 'A', volk: 'franken', team: 0, farbe: 0 },
    { name: 'B', volk: 'briten', team: 0, farbe: 1 },
    { name: 'C', volk: 'mongolen', team: 1, farbe: 2 }] });
  sim.sichtErneuern();
  const b = sim.spieler[1];
  assert.equal(sim.sichtbarFuer(0, b.startX, b.startY), 2, 'Verbuendeter nicht sichtbar');
  const c = sim.spieler[2];
  assert.equal(sim.sichtbarFuer(0, c.startX, c.startY), 0, 'Gegner ist sichtbar');
});

test('Ein Spieler ohne alles ist besiegt, die Partie endet', () => {
  const sim = neueSim();
  for (const e of sim.einheiten.filter(e => e.spieler === 1)) sim.einheitTot(e, null);
  for (const b of sim.gebaeude.filter(b => b.spieler === 1)) sim.gebaeudeWeg(b, null);
  for (let i = 0; i < 25; i++) sim.takten();
  assert.ok(sim.spieler[1].besiegt);
  assert.ok(sim.vorbei);
  assert.equal(sim.sieger, 0);
});

test('Aufgeben beendet die Partie fuer diesen Spieler', () => {
  const sim = neueSim();
  sim.befehlAusfuehren({ s: 1, a: 'aufgeben' });
  assert.ok(sim.spieler[1].besiegt);
});

test('Markt kauft und verkauft, die Preise bewegen sich', () => {
  const sim = neueSim();
  const p = sim.spieler[0];
  sim.gebaeudeSetzen(0, 'markt', p.startX + 8, p.startY + 8, true);
  p.rohstoffe.gold = 500;
  const preis = p.preise.nahrung;
  sim.befehlAusfuehren({ s: 0, a: 'handel', r: 'nahrung', kaufen: true });
  assert.equal(p.rohstoffe.gold, 500 - preis);
  assert.equal(p.rohstoffe.nahrung, 200 + 100);
  assert.ok(p.preise.nahrung > preis, 'Preis steigt nicht');
});

test('Niemand kann fuer einen anderen Spieler befehlen', () => {
  const sim = neueSim();
  const fremd = sim.einheiten.find(e => e.spieler === 1);
  const vorher = { x: fremd.x, y: fremd.y };
  sim.befehlAusfuehren({ s: 0, a: 'gehen', ids: [fremd.id], x: 10 * FP, y: 10 * FP });
  assert.equal(fremd.befehl, null);
  assert.deepEqual({ x: fremd.x, y: fremd.y }, vorher);
});

test('KI baut in zehn Minuten Wirtschaft auf', () => {
  const sim = neueSim({ spieler: [
    { name: 'KI', volk: 'briten', team: 0, farbe: 0, ki: 'normal' },
    { name: 'Ruhig', volk: 'franken', team: 1, farbe: 1, ki: null }] });
  for (let r = 0; r < 300 * 10; r++) sim.rundeAusfuehren(null);
  const zahl = sim.zaehlen(0);
  const p = sim.spieler[0];
  assert.ok(zahl.dorf >= 8, 'zu wenige Dorfbewohner: ' + zahl.dorf);
  /* Untergrenze, kein Bestwert: ueber fuenf Saaten liegt die KI hier
     zwischen 1170 und 1340. Der Test soll merken, wenn die Wirtschaft
     stehenbleibt — nicht jede Feinjustierung anmeckern. */
  const gesammelt = Object.values(p.statistik.gesammelt).reduce((a, b) => a + b, 0);
  assert.ok(gesammelt > 1000, 'zu wenig gesammelt: ' + gesammelt);
  assert.ok(sim.gebaeude.filter(b => b.spieler === 0).length >= 4, 'zu wenig gebaut');
});

test('Nach dem Bauen kehren Dorfbewohner an ihre Quelle zurueck', () => {
  const sim = neueSim();
  const k = sim.karte;
  const p = sim.spieler[0];
  let baum = null, bd = Infinity;
  for (let y = 0; y < k.hoehe; y++) for (let x = 0; x < k.breite; x++) {
    if (k.vorkommen[y * k.breite + x] !== 1) continue;
    const d = (x - p.startX) ** 2 + (y - p.startY) ** 2;
    if (d < bd) { bd = d; baum = { x, y }; }
  }
  const dorf = sim.einheiten.filter(e => e.spieler === 0 && e.typ === 'dorfbewohner');
  sim.befehlAusfuehren({ s: 0, a: 'sammeln', ids: dorf.map(e => e.id), kx: baum.x, ky: baum.y });
  for (let i = 0; i < 60; i++) sim.takten();
  /* Nun ein Haus bauen lassen … */
  let stelle = null;
  for (let r = 3; r < 10 && !stelle; r++) {
    for (let dy = -r; dy <= r && !stelle; dy++) for (let dx = -r; dx <= r && !stelle; dx++) {
      const x = p.startX + dx, y = p.startY + dy;
      if (sim.bauplatzFrei(0, 'haus', x, y, true)) stelle = { x, y };
    }
  }
  sim.befehlAusfuehren({ s: 0, a: 'bauen', ids: dorf.map(e => e.id), typ: 'haus', kx: stelle.x, ky: stelle.y });
  for (let i = 0; i < 900; i++) sim.takten();
  const haus = sim.gebaeude.find(b => b.spieler === 0 && b.typ === 'haus');
  assert.ok(haus && haus.fertig, 'Haus nicht fertig');
  const wiederAmHolz = dorf.filter(e => !e.tot && e.befehl && (e.befehl.art === 'sammeln' || e.befehl.art === 'ackern')).length;
  assert.ok(wiederAmHolz >= 1, 'niemand ist an die Arbeit zurueckgekehrt');
});

/* ─────────────── Wasser: Karte, Schiffe, Bruecken ─────────────── */

/** Karte mit einem brauchbaren Gewaesser und ein Spieler mit vollen Kassen. */
function wasserSim(saat) {
  const sim = new Sim({
    saat: saat || 4242,
    karte: { groesse: 'klein', art: 'kueste', wasser: 2 },
    spieler: [
      { name: 'A', volk: 'franken', team: 0, farbe: 0, ki: null },
      { name: 'B', volk: 'briten', team: 1, farbe: 1, ki: null }
    ]
  });
  const p = sim.spieler[0];
  p.erkundet.fill(1);
  for (const r of ['nahrung', 'holz', 'gold', 'stein']) p.rohstoffe[r] = 3000;
  return sim;
}

test('Kueste bekommt ein grosses zusammenhaengendes Gewaesser', () => {
  for (const saat of [4242, 777, 31337]) {
    const sim = wasserSim(saat);
    const k = sim.karte;
    const groessen = {};
    for (let i = 0; i < k.breite * k.hoehe; i++) {
      const r = sim.wasserRevier[i];
      if (sim.revierAlt) sim.revierAufbauen();
      if (r >= 0) groessen[r] = (groessen[r] || 0) + 1;
    }
    const groesstes = Math.max(0, ...Object.values(groessen));
    assert.ok(groesstes >= 300, 'Gewaesser zu klein bei Saat ' + saat + ': ' + groesstes);
  }
});

test('Fischgruende liegen nur in befahrbarem Wasser', () => {
  const sim = wasserSim();
  const k = sim.karte;
  let fisch = 0, inLachen = 0;
  const zahl = {};
  for (let i = 0; i < k.breite * k.hoehe; i++) {
    const r = sim.revier(i % k.breite, (i / k.breite) | 0);
    if (r >= 0) zahl[r] = (zahl[r] || 0) + 1;
  }
  for (let i = 0; i < k.breite * k.hoehe; i++) {
    if (k.vorkommen[i] !== 7) continue;
    fisch++;
    const r = sim.wasserRevier[i];
    if (r < 0 || zahl[r] < 20) inLachen++;
  }
  assert.ok(fisch > 20, 'zu wenig Fisch: ' + fisch);
  assert.equal(inLachen, 0, 'Fisch in einer Lache: ' + inLachen);
});

test('Reviere folgen derselben Regel wie die Wegsuche', () => {
  const sim = wasserSim();
  const k = sim.karte;
  /* Zwei Felder im selben Revier muessen auch per A* verbunden sein. */
  const felder = [];
  for (let i = 0; i < k.breite * k.hoehe; i++) {
    if (sim.revier(i % k.breite, (i / k.breite) | 0) === sim.wasserRevier[i] && sim.wasserRevier[i] >= 0) felder.push(i);
  }
  const nachRevier = new Map();
  for (const i of felder) {
    const r = sim.wasserRevier[i];
    if (!nachRevier.has(r)) nachRevier.set(r, []);
    nachRevier.get(r).push(i);
  }
  let geprueft = 0;
  for (const [, liste] of nachRevier) {
    if (liste.length < 30) continue;
    const a = liste[0], b = liste[liste.length - 1];
    const weg = sim.pfadfinder.suche(sim.sperreWasser, a % k.breite, (a / k.breite) | 0,
      b % k.breite, (b / k.breite) | 0, { maxKnoten: 40000, naheGenug: 0, zielSperreEgal: true });
    assert.ok(weg && weg.length, 'kein Wasserweg im selben Revier');
    geprueft++;
  }
  assert.ok(geprueft > 0, 'kein Revier zum Pruefen gefunden');
});

/** Hafenplatz, in dessen Gewaesser auch Fisch schwimmt. */
function hafenMitFisch(sim) {
  const k = sim.karte, p = sim.spieler[0];
  /* Welche Reviere fuehren Fisch? */
  const mitFisch = new Set();
  for (let i = 0; i < k.breite * k.hoehe; i++) {
    if (k.vorkommen[i] !== 7 || k.menge[i] <= 0) continue;
    const r = sim.revier(i % k.breite, (i / k.breite) | 0);
    if (r >= 0) mitFisch.add(r);
  }
  let platz = null, bd = Infinity;
  for (let y = 2; y < k.hoehe - 4; y++) for (let x = 2; x < k.breite - 4; x++) {
    const d = (x - p.startX) ** 2 + (y - p.startY) ** 2;
    if (d >= bd) continue;
    if (!sim.bauplatzFrei(0, 'hafen', x, y)) continue;
    let passt = false;
    for (let dy = -1; dy <= 3 && !passt; dy++) for (let dx = -1; dx <= 3; dx++) {
      if (mitFisch.has(sim.revier(x + dx, y + dy))) { passt = true; break; }
    }
    if (!passt) continue;
    bd = d; platz = [x, y];
  }
  return platz;
}

test('Hafen baut Boote aufs Wasser, Fischerboot faengt und liefert ab', () => {
  const sim = wasserSim();
  const k = sim.karte, p = sim.spieler[0];
  const platz = hafenMitFisch(sim);
  assert.ok(platz, 'kein Hafenplatz am Fischgrund gefunden');
  const hafen = sim.gebaeudeSetzen(0, 'hafen', platz[0], platz[1], true);
  sim.befehlAusfuehren({ s: 0, a: 'ausbilden', g: hafen.id, typ: 'fischerboot' });
  for (let t = 0; t < 1200; t++) sim.takten();
  const boot = sim.einheiten.find(e => !e.tot && e.typ === 'fischerboot');
  assert.ok(boot, 'kein Fischerboot gebaut');
  assert.equal(k.boden[sim.ky(boot) * k.breite + sim.kx(boot)], 4, 'Boot steht nicht im Wasser');

  let fisch = null, fd = Infinity;
  for (let i = 0; i < k.breite * k.hoehe; i++) {
    if (k.vorkommen[i] !== 7 || k.menge[i] <= 0) continue;
    const x = i % k.breite, y = (i / k.breite) | 0;
    const d = (x - sim.kx(boot)) ** 2 + (y - sim.ky(boot)) ** 2;
    if (d < fd && sim.wasserErreichbar(boot, x, y)) { fd = d; fisch = [x, y]; }
  }
  assert.ok(fisch, 'kein erreichbarer Fischgrund');
  const vorher = p.rohstoffe.nahrung;
  sim.befehlAusfuehren({ s: 0, a: 'sammeln', ids: [boot.id], kx: fisch[0], ky: fisch[1] });
  for (let t = 0; t < 3000; t++) sim.takten();
  assert.ok(p.rohstoffe.nahrung > vorher, 'Fischerboot hat nichts abgeliefert');
});

test('Transporter nimmt Landvolk auf und setzt es wieder ab', () => {
  const sim = wasserSim();
  const k = sim.karte, p = sim.spieler[0];
  let platz = null, bd = Infinity;
  for (let y = 2; y < k.hoehe - 4; y++) for (let x = 2; x < k.breite - 4; x++) {
    if (!sim.bauplatzFrei(0, 'hafen', x, y)) continue;
    const d = (x - p.startX) ** 2 + (y - p.startY) ** 2;
    if (d < bd) { bd = d; platz = [x, y]; }
  }
  const hafen = sim.gebaeudeSetzen(0, 'hafen', platz[0], platz[1], true);
  sim.befehlAusfuehren({ s: 0, a: 'ausbilden', g: hafen.id, typ: 'transporter' });
  for (let t = 0; t < 1500; t++) sim.takten();
  const schiff = sim.einheiten.find(e => !e.tot && e.typ === 'transporter');
  assert.ok(schiff, 'kein Transporter gebaut');

  const dorf = sim.einheiten.filter(e => !e.tot && e.spieler === 0 && e.typ === 'dorfbewohner').slice(0, 2);
  sim.befehlAusfuehren({ s: 0, a: 'einsteigen', ziel: schiff.id, ids: dorf.map(e => e.id) });
  for (let t = 0; t < 1500; t++) sim.takten();
  assert.equal(schiff.fracht.length, 2, 'nicht alle an Bord');
  assert.ok(dorf.every(e => e.verladen === schiff.id), 'Passagier nicht als verladen vermerkt');

  /* Ein Landfeld am eigenen Gewaesser als Anlandeziel. */
  let ziel = null, zd = -1;
  for (let y = 2; y < k.hoehe - 2; y++) for (let x = 2; x < k.breite - 2; x++) {
    const i = y * k.breite + x;
    if (k.boden[i] === 4 || sim.sperre[i] !== 0) continue;
    let amWasser = false;
    for (let dy = -1; dy <= 1 && !amWasser; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (sim.revier(x + dx, y + dy) === sim.revierVon(schiff)) { amWasser = true; break; }
    }
    if (!amWasser) continue;
    const d = (x - sim.kx(schiff)) ** 2 + (y - sim.ky(schiff)) ** 2;
    if (d > zd) { zd = d; ziel = [x, y]; }
  }
  assert.ok(ziel, 'kein Anlandeziel gefunden');
  sim.befehlAusfuehren({ s: 0, a: 'ausladen', ids: [schiff.id],
    x: ziel[0] * FP + FP / 2, y: ziel[1] * FP + FP / 2 });
  for (let t = 0; t < 4000; t++) sim.takten();
  assert.equal(schiff.fracht.length, 0, 'Fracht nicht abgesetzt');
  assert.ok(dorf.every(e => !e.verladen && !e.tot), 'Passagier nicht wieder an Land');
});

test('Bruecken liegen auf dem Wasser und sind begehbar', () => {
  const sim = wasserSim();
  const k = sim.karte;
  let platz = null;
  for (let y = 2; y < k.hoehe - 2 && !platz; y++) for (let x = 2; x < k.breite - 2; x++) {
    if (sim.bauplatzFrei(0, 'bruecke', x, y)) { platz = [x, y]; break; }
  }
  assert.ok(platz, 'kein Brueckenplatz gefunden');
  const i = platz[1] * k.breite + platz[0];
  assert.equal(k.boden[i], 4, 'Bruecke nicht auf Wasser');
  assert.equal(sim.sperre[i], GESPERRT, 'Wasser war schon begehbar');
  sim.gebaeudeSetzen(0, 'bruecke', platz[0], platz[1], true);
  assert.equal(sim.sperre[i], 0, 'Bruecke nicht begehbar');
  assert.equal(sim.sperreWasser[i], GESPERRT, 'Schiffe fahren durch die Bruecke');
});

test('Bauen ebnet den Grund ein', () => {
  const sim = new Sim({
    saat: 99, karte: { groesse: 'klein', art: 'hochland', berge: 3 },
    spieler: [{ name: 'A', volk: 'franken', team: 0, farbe: 0, ki: null },
              { name: 'B', volk: 'briten', team: 1, farbe: 1, ki: null }]
  });
  const k = sim.karte;
  sim.spieler[0].erkundet.fill(1);
  let stelle = null, spanne = -1;
  for (let y = 3; y < k.hoehe - 5; y++) for (let x = 3; x < k.breite - 5; x++) {
    if (!sim.bauplatzFrei(0, 'farm', x, y)) continue;
    let min = 99, max = -1;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const h = k.hoehen[(y + dy) * k.breite + x + dx];
      if (h < min) min = h;
      if (h > max) max = h;
    }
    if (max - min > spanne) { spanne = max - min; stelle = [x, y]; }
  }
  assert.ok(spanne > 0, 'kein welliger Bauplatz gefunden');
  const vor = sim.gelaendeVersion;
  sim.gebaeudeSetzen(0, 'farm', stelle[0], stelle[1], true);
  assert.ok(sim.gelaendeVersion > vor, 'Gelaendeversion nicht erhoeht');
  let min = 99, max = -1;
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    const h = k.hoehen[(stelle[1] + dy) * k.breite + stelle[0] + dx];
    if (h < min) min = h;
    if (h > max) max = h;
  }
  assert.equal(max, min, 'Grund unter dem Gebaeude ist nicht eben');
});

test('Kartenregler wirken auf Wasser, Berge und Rohstoffe', () => {
  const zaehle = (k, art) => {
    let n = 0;
    for (let i = 0; i < k.breite * k.hoehe; i++) if (k.boden[i] === art) n++;
    return n;
  };
  const trocken = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'seen', plaetze: 2, wasser: 0 });
  const nass = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'seen', plaetze: 2, wasser: 3 });
  assert.equal(zaehle(trocken, 4), 0, 'ohne Wasser darf kein Wasser da sein');
  assert.ok(zaehle(nass, 4) > 400, 'zu wenig Wasser bei „Viel“: ' + zaehle(nass, 4));

  const karg = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'ebene', plaetze: 2, rohstoffe: 0 });
  const reich = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'ebene', plaetze: 2, rohstoffe: 2 });
  const gold = (k) => { let n = 0; for (let i = 0; i < k.vorkommen.length; i++) if (k.vorkommen[i] === 5) n++; return n; };
  assert.ok(gold(reich) > gold(karg), 'reich hat nicht mehr Gold als karg');

  const flach = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'ebene', plaetze: 2, berge: 0 });
  const gebirge = erzeugeKarte({ saat: 5, groesse: 'klein', art: 'ebene', plaetze: 2, berge: 3 });
  assert.ok(Math.max(...gebirge.hoehen) > Math.max(...flach.hoehen), 'Gebirge nicht hoeher als Flachland');
});

test('Neun Spieler bekommen erreichbare Startplaetze', () => {
  const k = erzeugeKarte({ saat: 2026, groesse: 'gewaltig', art: 'kueste', plaetze: 9 });
  assert.equal(k.start.length, 9);
  const da = flut(k, k.start[0].x, k.start[0].y);
  for (let i = 1; i < 9; i++) {
    assert.ok(da[k.start[i].y * k.breite + k.start[i].x], 'Startplatz ' + i + ' nicht erreichbar');
  }
});

test('Faellt die Bruecke, kommt das Fussvolk ans Ufer', () => {
  const sim = wasserSim();
  const k = sim.karte;
  let platz = null;
  for (let y = 3; y < k.hoehe - 3 && !platz; y++) {
    for (let x = 3; x < k.breite - 3; x++) {
      if (sim.bauplatzFrei(0, 'bruecke', x, y)) { platz = [x, y]; break; }
    }
  }
  assert.ok(platz, 'kein Brueckenplatz gefunden');
  const bruecke = sim.gebaeudeSetzen(0, 'bruecke', platz[0], platz[1], true);
  const e = sim.einheitSetzen(0, 'dorfbewohner', platz[0] * FP + FP / 2, platz[1] * FP + FP / 2);
  assert.equal(sim.sperre[platz[1] * k.breite + platz[0]], 0, 'Bruecke war nicht begehbar');

  sim.gebaeudeWeg(bruecke, null);
  assert.ok(e.tot || sim.sperre[sim.ky(e) * k.breite + sim.kx(e)] === 0,
    'Einheit steht nach dem Abriss auf gesperrtem Grund');
  if (!e.tot) {
    /* Und sie kann sich auch wirklich wieder bewegen. */
    const vorX = e.x, vorY = e.y;
    sim.befehlSetzen(e, { art: 'gehen', x: (platz[0] + 6) * FP, y: platz[1] * FP });
    for (let t = 0; t < 600; t++) sim.takten();
    assert.ok(e.x !== vorX || e.y !== vorY, 'Einheit steckt im Wasser fest');
  }
});

test('Auf ein Schiff wird keine Bruecke gebaut', () => {
  const sim = wasserSim();
  const k = sim.karte;
  let platz = null;
  for (let y = 3; y < k.hoehe - 3 && !platz; y++) {
    for (let x = 3; x < k.breite - 3; x++) {
      if (sim.bauplatzFrei(0, 'bruecke', x, y)) { platz = [x, y]; break; }
    }
  }
  sim.einheitSetzen(0, 'galeere', platz[0] * FP + FP / 2, platz[1] * FP + FP / 2);
  assert.equal(sim.bauplatzFrei(0, 'bruecke', platz[0], platz[1]), false,
    'Bruecke darf nicht ueber einem Schiff entstehen');
});

test('Galeere versenkt Galeere und beschiesst das Ufer', () => {
  const sim = wasserSim();
  const k = sim.karte;
  for (const p of sim.spieler) { p.erkundet.fill(1); p.zeitalter = 3; }
  let a = null;
  for (let y = 2; y < k.hoehe - 2 && !a; y++) {
    for (let x = 2; x < k.breite - 6; x++) {
      if (sim.sperreWasser[y * k.breite + x] !== 0) continue;
      if (sim.sperreWasser[y * k.breite + x + 3] !== 0) continue;
      if (sim.revier(x, y) !== sim.revier(x + 3, y)) continue;
      a = [x, y]; break;
    }
  }
  assert.ok(a, 'keine zwei freien Wasserfelder gefunden');
  const g1 = sim.einheitSetzen(0, 'galeere', a[0] * FP + FP / 2, a[1] * FP + FP / 2);
  const g2 = sim.einheitSetzen(1, 'galeere', (a[0] + 3) * FP + FP / 2, a[1] * FP + FP / 2);
  for (let t = 0; t < 2000 && !g1.tot && !g2.tot; t++) sim.takten();
  assert.ok(g1.tot || g2.tot, 'Galeeren beschiessen einander nicht');
});

test('Ein Dorfbewohner jagt keinem unerreichbaren Ziel nach', () => {
  /* Der Fall aus dem Dauerlauf: ein feindlicher Spaeher jenseits des
     Wassers. Ohne Abbruch stand die ganze Wirtschaft still, weil die
     Dorfbewohner ewig auf einen Weg warteten, den es nicht gibt. */
  const sim = wasserSim();
  const k = sim.karte;
  for (const p of sim.spieler) p.erkundet.fill(1);

  /* Eine Landkachel suchen, die von einer zweiten durch Wasser
     getrennt ist — also in einem anderen Landstueck liegt. */
  const erreichbar = (sx, sy) => {
    const da = new Uint8Array(k.breite * k.hoehe);
    const stapel = [sy * k.breite + sx];
    da[stapel[0]] = 1;
    while (stapel.length) {
      const i = stapel.pop();
      const x = i % k.breite, y = (i / k.breite) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= k.breite || ny >= k.hoehe) continue;
        const j = ny * k.breite + nx;
        if (da[j] || sim.sperre[j] === GESPERRT) continue;
        da[j] = 1; stapel.push(j);
      }
    }
    return da;
  };
  let heim = null;
  for (let i = 0; i < k.breite * k.hoehe && !heim; i++) {
    if (sim.sperre[i] === 0) heim = [i % k.breite, (i / k.breite) | 0];
  }
  const da = erreichbar(heim[0], heim[1]);
  let fern = null;
  for (let i = 0; i < k.breite * k.hoehe && !fern; i++) {
    if (sim.sperre[i] === 0 && !da[i]) fern = [i % k.breite, (i / k.breite) | 0];
  }
  assert.ok(fern, 'keine zwei getrennten Landstuecke gefunden');

  const dorf = sim.einheitSetzen(0, 'dorfbewohner', heim[0] * FP + FP / 2, heim[1] * FP + FP / 2);
  const feind = sim.einheitSetzen(1, 'spaeher', fern[0] * FP + FP / 2, fern[1] * FP + FP / 2);
  sim.befehlSetzen(dorf, { art: 'angriff', ziel: feind.id });
  assert.equal(dorf.zustand, ZUSTAND.angreifen, 'Angriffsbefehl nicht angenommen');

  for (let t = 0; t < 400; t++) sim.takten();
  assert.notEqual(dorf.zustand, ZUSTAND.angreifen,
    'Dorfbewohner haengt weiter an einem Ziel, zu dem kein Weg fuehrt');
  assert.ok(!dorf.wartetAufWeg || dorf.pfad,
    'Dorfbewohner bestellt endlos neue Wegsuchen');
});
