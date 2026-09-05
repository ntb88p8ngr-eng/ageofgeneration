#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Server

   Liefert die Seite aus und vermittelt die Mehrspielerpartien.
   Ohne Abhaengigkeiten: nur Node.

       node server.js          →  http://localhost:3000

   Umgebung:
       PORT       Standard 3000
       HOST       Standard 0.0.0.0
       BASE_PATH  wenn die Seite hinter einem Proxy in einem
                  Unterpfad liegt, z. B. /spiel
   ═══════════════════════════════════════════════════════════ */
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { Partien, Fehler, RUNDE_MS } from './partien.js';

const HIER = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = process.env.PORT === '0' ? 0 : (Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const partien = new Partien(path.join(HIER, 'daten'));

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
  bearbeiten(req, res).catch(fehler => {
    if (!res.headersSent) {
      const status = fehler instanceof Fehler ? 400 : 500;
      antwortJSON(res, status, { fehler: fehler.message || 'Serverfehler' });
    }
    if (!(fehler instanceof Fehler)) console.error('[aog]', fehler);
  });
});

async function bearbeiten(req, res) {
  let pfad = decodeURIComponent((req.url || '/').split('?')[0]);
  const abfrage = new URLSearchParams((req.url || '').split('?')[1] || '');
  if (BASE && pfad.startsWith(BASE)) pfad = pfad.slice(BASE.length) || '/';

  if (pfad.startsWith('/api/')) return api(req, res, pfad.slice(5), abfrage);
  return datei(req, res, pfad);
}

/* ─────────────── Schnittstelle ─────────────── */

async function api(req, res, weg, abfrage) {
  const koerper = req.method === 'POST' ? await leseKoerper(req) : {};
  const token = req.headers['x-sitzung'];
  const s = token ? partien.spielerVon(String(token)) : null;

  if (weg === 'gesundheit') return antwortJSON(res, 200, { da: true, rundeMs: RUNDE_MS });

  if (weg === 'anmelden' && req.method === 'POST') {
    return antwortJSON(res, 200, partien.anmelden(koerper.name));
  }

  /* Die Liste offener Partien darf jeder sehen — auch ohne Anmeldung. */
  if (weg === 'lobby') {
    const version = Number(abfrage.get('v')) || 0;
    if (version) await partien.wartenLobby(version);
    return antwortJSON(res, 200, { v: partien.lobbyV, partien: partien.lobbyListe() });
  }
  if (weg === 'replays') return antwortJSON(res, 200, { replays: partien.replayListe() });
  if (weg === 'replay') return antwortJSON(res, 200, { replay: partien.replayLesen(abfrage.get('id')) });

  /* Alles Weitere braucht eine Anmeldung. */
  if (!s) return antwortJSON(res, 401, { fehler: 'Nicht angemeldet' });

  if (weg === 'partie/erstellen') {
    const p = partien.erstellen(s, koerper);
    return antwortJSON(res, 200, { partie: partien.sicht(p, s) });
  }
  if (weg === 'partie/beitreten') {
    const p = partien.beitreten(s, koerper.id, koerper.zuschauer);
    return antwortJSON(res, 200, { partie: partien.sicht(p, s) });
  }
  if (weg === 'partie/platz') { partien.platz(s, koerper.feld, koerper.wert || {}); return antwortJSON(res, 200, { ok: true }); }
  if (weg === 'partie/einstellung') { partien.einstellung(s, koerper.feld, koerper.wert); return antwortJSON(res, 200, { ok: true }); }
  if (weg === 'partie/bereit') { partien.bereit(s, koerper.bereit); return antwortJSON(res, 200, { ok: true }); }
  if (weg === 'partie/chat') { partien.chat(s, koerper.text); return antwortJSON(res, 200, { ok: true }); }
  if (weg === 'partie/starten') { partien.starten(s); return antwortJSON(res, 200, { ok: true }); }
  if (weg === 'partie/verlassen') { partien.verlassen(s); return antwortJSON(res, 200, { ok: true }); }

  if (weg === 'partie/zustand') {
    const p = partien.partien.get(abfrage.get('id')) || partien.meine(s);
    if (!p) return antwortJSON(res, 404, { fehler: 'Partie gibt es nicht mehr' });
    const version = Number(abfrage.get('v')) || 0;
    if (version) await partien.wartenRaum(p, version);
    return antwortJSON(res, 200, { v: p.v, partie: partien.sicht(p, s) });
  }

  if (weg === 'partie/befehle') { partien.befehle(s, koerper.befehle); return antwortJSON(res, 200, { ok: true }); }

  if (weg === 'partie/runden') {
    const { p, ab } = partien.runden(s, Number(abfrage.get('ab')));
    if (ab >= p.runden.length && !p.beendet) await partien.wartenRunden(p);
    return antwortJSON(res, 200, {
      ab, runden: p.runden.slice(ab, ab + 900), vorbei: p.beendet, gestartet: p.gestartet
    });
  }

  if (weg === 'partie/pruefsumme') {
    return antwortJSON(res, 200, partien.pruefsumme(s, Number(koerper.runde) | 0, Number(koerper.summe) | 0));
  }

  if (weg === 'replay/sichern') return antwortJSON(res, 200, partien.replaySchreiben(koerper));

  return antwortJSON(res, 404, { fehler: 'Unbekannter Weg' });
}

function leseKoerper(req) {
  return new Promise((loesen, ablehnen) => {
    let daten = '';
    let zuViel = false;
    req.on('data', stueck => {
      daten += stueck;
      if (daten.length > 48 * 1024 * 1024) { zuViel = true; req.destroy(); }
    });
    req.on('end', () => {
      if (zuViel) return ablehnen(new Fehler('Anfrage zu gross'));
      if (!daten) return loesen({});
      try { loesen(JSON.parse(daten)); } catch (e) { ablehnen(new Fehler('Unlesbare Anfrage')); }
    });
    req.on('error', ablehnen);
  });
}

function antwortJSON(res, status, inhalt) {
  const text = JSON.stringify(inhalt);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

/* ─────────────── Dateien ─────────────── */

function datei(req, res, pfad) {
  if (pfad === '/') pfad = '/index.html';
  /* Kein Ausbruch aus dem Ordner. */
  const ziel = path.normalize(path.join(HIER, pfad));
  if (!ziel.startsWith(HIER)) { res.writeHead(403); return res.end('Verboten'); }
  if (ziel.includes(path.join(HIER, 'daten'))) { res.writeHead(403); return res.end('Verboten'); }

  fs.stat(ziel, (fehler, stat) => {
    if (fehler || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    const typ = TYPEN[path.extname(ziel).toLowerCase()] || 'application/octet-stream';
    /* three.js aendert sich nie — das darf der Browser behalten. */
    const dauerhaft = ziel.includes(path.join('js', 'vendor'));
    res.writeHead(200, {
      'Content-Type': typ,
      'Content-Length': stat.size,
      'Cache-Control': dauerhaft ? 'public, max-age=604800' : 'no-cache'
    });
    fs.createReadStream(ziel).pipe(res);
  });
}

server.__partien = partien;
/* Fuer die Tests greifbar: sie brauchen den zufaellig vergebenen Port. */
globalThis.__aogServer = server;

server.listen(PORT, HOST, () => {
  const echt = server.address().port;
  console.log('[aog] Age of Generation laeuft auf http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + echt + (BASE || ''));
});

process.on('SIGINT', () => { console.log('\n[aog] Ende.'); process.exit(0); });
