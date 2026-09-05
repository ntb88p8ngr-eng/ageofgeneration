/* Prueft den Server: Anmeldung, Warteraum, Rundenrelais, Aufzeichnungen.
   Startet dafuer einen echten Server auf einem freien Port.            */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Partien, RUNDE_MS } from '../partien.js';

/* ─────────────── Partienverwaltung ohne Netz ─────────────── */

function neu() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'aog-test-'));
  return { p: new Partien(ordner), ordner };
}

test('Anmeldung liefert eine eigene Sitzung je Spieler', () => {
  const { p } = neu();
  const a = p.anmelden('Anna');
  const b = p.anmelden('Bert');
  assert.notEqual(a.token, b.token);
  assert.equal(p.spielerVon(a.token).name, 'Anna');
  assert.equal(p.spielerVon('unsinn'), null);
});

test('Namen werden gekuerzt und von spitzen Klammern befreit', () => {
  const { p } = neu();
  const a = p.anmelden('<script>boese</script>lange');
  assert.ok(!a.name.includes('<'));
  assert.ok(a.name.length <= 16);
});

test('Wer eroeffnet, sitzt auf Platz eins; die uebrigen sind Rechner', () => {
  const { p } = neu();
  const wirt = p.spielerVon(p.anmelden('Wirt').token);
  const partie = p.erstellen(wirt, { plaetze: 4 });
  assert.equal(partie.plaetze.length, 4);
  assert.equal(partie.plaetze[0].name, 'Wirt');
  assert.equal(partie.plaetze[1].ki, 'normal');
  assert.equal(p.lobbyListe().length, 1);
});

test('Beitreten belegt einen freien Platz, Verlassen gibt ihn frei', () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const b = p.spielerVon(p.anmelden('B').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.platz(a, 'art', { platz: 1, wert: '' });        // Platz 2 auf Mensch stellen
  p.beitreten(b, partie.id);
  assert.equal(partie.plaetze[1].name, 'B');
  p.verlassen(b);
  assert.equal(partie.plaetze[1].name, null);
});

test('Nur der Wirt darf Einstellungen und fremde Plaetze aendern', () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const b = p.spielerVon(p.anmelden('B').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.platz(a, 'art', { platz: 1, wert: '' });
  p.beitreten(b, partie.id);
  p.einstellung(b, 'kartengroesse', 'riesig');
  assert.notEqual(partie.karte.groesse, 'riesig', 'Gast durfte die Karte aendern');
  p.einstellung(a, 'kartengroesse', 'riesig');
  assert.equal(partie.karte.groesse, 'riesig');
  /* Gast darf sein eigenes Volk waehlen. */
  p.platz(b, 'volk', { platz: 1, wert: 'mongolen' });
  assert.equal(partie.plaetze[1].volk, 'mongolen');
  /* Aber nicht das des Wirts. */
  p.platz(b, 'volk', { platz: 0, wert: 'mongolen' });
  assert.notEqual(partie.plaetze[0].volk, 'mongolen');
});

test('Start verlangt zwei Teilnehmer und veroeffentlicht dann Runden', async () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.starten(a);
  assert.ok(partie.gestartet, 'Start mit Wirt und Rechner muss gehen');
  await new Promise(r => setTimeout(r, RUNDE_MS * 4));
  assert.ok(partie.runden.length >= 2, 'keine Runden veroeffentlicht');
  clearInterval(partie.uhr);
});

test('Der Server setzt die Spielernummer selbst', async () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const b = p.spielerVon(p.anmelden('B').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.platz(a, 'art', { platz: 1, wert: '' });
  p.beitreten(b, partie.id);
  p.bereit(b, true);
  p.starten(a);
  /* B versucht, als Spieler 0 zu befehlen. */
  p.befehle(b, [{ a: 'gehen', s: 0, ids: [1], x: 0, y: 0 }]);
  assert.equal(partie.offen[0].s, 1, 'fremde Spielernummer nicht ueberschrieben');
  clearInterval(partie.uhr);
});

test('Zuschauer duerfen keine Befehle geben', async () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const z = p.spielerVon(p.anmelden('Zuschauer').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.starten(a);
  p.beitreten(z, partie.id, true);
  p.befehle(z, [{ a: 'gehen', ids: [1], x: 0, y: 0 }]);
  assert.equal(partie.offen.length, 0, 'Zuschauer konnte befehlen');
  clearInterval(partie.uhr);
});

test('Abweichende Pruefsummen werden erkannt', () => {
  const { p } = neu();
  const a = p.spielerVon(p.anmelden('A').token);
  const b = p.spielerVon(p.anmelden('B').token);
  const partie = p.erstellen(a, { plaetze: 2 });
  p.platz(a, 'art', { platz: 1, wert: '' });
  p.beitreten(b, partie.id);
  assert.equal(p.pruefsumme(a, 10, 12345).gleich, true);
  assert.equal(p.pruefsumme(b, 10, 12345).gleich, true);
  assert.equal(p.pruefsumme(b, 20, 1).gleich, true);
  assert.equal(p.pruefsumme(a, 20, 2).gleich, false);
});

test('Aufzeichnungen lassen sich schreiben und wieder lesen', () => {
  const { p } = neu();
  const daten = {
    name: 'Testpartie', zeit: Date.now(),
    aufbau: { saat: 1, karte: { art: 'ebene', groesse: 'klein' }, bevGrenze: 100, startgut: 'normal',
              spieler: [{ name: 'A', volk: 'franken', team: 0, farbe: 0 }] },
    runden: [[], [{ s: 0, a: 'gehen', ids: [1], x: 100, y: 100 }], []]
  };
  const { id } = p.replaySchreiben(daten);
  const liste = p.replayListe();
  assert.equal(liste.length, 1);
  assert.equal(liste[0].name, 'Testpartie');
  const gelesen = p.replayLesen(id);
  assert.equal(gelesen.runden.length, 3);
  assert.throws(() => p.replayLesen('../geheim'), /Unbekannte/);
});

/* ─────────────── Ueber HTTP ─────────────── */

test('Der Server liefert Seite und Schnittstelle aus', async () => {
  process.env.PORT = '0';
  const { server, port } = await serverStarten();
  try {
    const g = await hole(port, '/api/gesundheit');
    assert.equal(g.inhalt.da, true);

    const seite = await hole(port, '/');
    assert.ok(seite.text.includes('Age of Generation'));

    const js = await hole(port, '/js/sim.js');
    assert.match(js.typ, /javascript/);

    /* Daten und Ausbrueche sind gesperrt. */
    assert.equal((await hole(port, '/daten/replays/x.json')).status, 403);
    assert.equal((await hole(port, '/api/quatsch')).status, 401);

    const an = await hole(port, '/api/anmelden', { name: 'Netz' });
    assert.ok(an.inhalt.token);

    const lobby = await hole(port, '/api/lobby');
    assert.ok(Array.isArray(lobby.inhalt.partien), 'Lobby auch ohne Anmeldung lesbar');

    const erstellt = await hole(port, '/api/partie/erstellen', { plaetze: 2 }, an.inhalt.token);
    assert.ok(erstellt.inhalt.partie.id);
    assert.equal(erstellt.inhalt.partie.plaetze.length, 2);

    const gestartet = await hole(port, '/api/partie/starten', {}, an.inhalt.token);
    assert.equal(gestartet.inhalt.ok, true);

    await new Promise(r => setTimeout(r, RUNDE_MS * 3));
    const runden = await hole(port, '/api/partie/runden?ab=0', null, an.inhalt.token);
    assert.ok(runden.inhalt.runden.length >= 1, 'keine Runden ausgeliefert');
  } finally {
    server.close();
    for (const p of server.__partien.partien.values()) if (p.uhr) clearInterval(p.uhr);
  }
});

async function serverStarten() {
  const modul = await import('../server.js?test=' + Math.random());
  /* server.js startet selbst; wir warten kurz und fragen den Port ab. */
  await new Promise(r => setTimeout(r, 250));
  const server = globalThis.__aogServer;
  return { server, port: server.address().port };
}

function hole(port, weg, koerper, token) {
  return new Promise((loesen, ablehnen) => {
    const daten = koerper ? JSON.stringify(koerper) : null;
    const anfrage = http.request({
      host: '127.0.0.1', port, path: weg, method: daten ? 'POST' : 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Sitzung': token } : {})
    }, res => {
      let text = '';
      res.on('data', s => text += s);
      res.on('end', () => {
        let inhalt = null;
        try { inhalt = JSON.parse(text); } catch (e) {}
        loesen({ status: res.statusCode, typ: res.headers['content-type'] || '', text, inhalt });
      });
    });
    anfrage.on('error', ablehnen);
    if (daten) anfrage.write(daten);
    anfrage.end();
  });
}
