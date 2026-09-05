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
