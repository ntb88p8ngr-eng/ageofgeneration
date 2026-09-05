/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Kartengenerator

   Aus einer einzigen Zahl (der Saat) entsteht eine vollstaendige
   Landschaft: Hoehen, Boden, Wasser, Waelder, Wild, Erz und
   faire Startplaetze. Weil alles nur aus der Saat berechnet
   wird, muss im Mehrspieler keine Karte uebertragen werden —
   jeder Rechner erzeugt dieselbe.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import { Zufall, rauschfeld, klemme, abstand2 } from './zufall.js';
import { BODEN, BODEN_BEGEHBAR, VORKOMMEN } from './regeln.js';

/** Reihenfolge der Vorkommen — die Zahl steht im Kartenfeld. */
export const VORKOMMEN_LISTE = ['baum', 'beere', 'wild', 'schaf', 'gold', 'stein'];

export const KARTEN_GROESSEN = {
  klein:  { name: 'Klein (2 Spieler)',   kacheln: 96 },
  mittel: { name: 'Mittel (4 Spieler)',  kacheln: 120 },
  gross:  { name: 'Gross (6 Spieler)',   kacheln: 144 },
  riesig: { name: 'Riesig (8 Spieler)',  kacheln: 168 }
};

export const KARTEN_ARTEN = {
  ebene:    { name: 'Ebene',        beschreibung: 'Offenes Land, wenig Wald, kaum Wasser. Reiterei hat freie Bahn.' },
  seen:     { name: 'Seenplatte',   beschreibung: 'Teiche und Buchten zerteilen das Land in Engstellen.' },
  hochland: { name: 'Hochland',     beschreibung: 'Huegel und Felsriegel. Wer oben steht, sieht weiter.' },
  waelder:  { name: 'Waelder',      beschreibung: 'Dichter Wald mit Lichtungen. Holz im Ueberfluss, Wege eng.' }
};

/**
 * Erzeugt die Karte.
 * @param {object} o  saat, groesse ('klein'…), art ('ebene'…), plaetze (Zahl der Startplaetze)
 */
export function erzeugeKarte(o) {
  const groesse = KARTEN_GROESSEN[o.groesse] ? o.groesse : 'mittel';
  const art = KARTEN_ARTEN[o.art] ? o.art : 'ebene';
  const n = KARTEN_GROESSEN[groesse].kacheln;
  const plaetze = klemme(o.plaetze || 2, 2, 8);
  const saat = (o.saat | 0) || 12345;
  const rnd = new Zufall(saat);

  const k = {
    saat, groesse, art, breite: n, hoehe: n,
    hoehen: new Uint8Array(n * n),
    boden: new Uint8Array(n * n),
    vorkommen: new Uint8Array(n * n),
    menge: new Uint16Array(n * n),
    start: []
  };

  gelaende(k, rnd, art);
  startplaetze(k, rnd, plaetze);
  bewaldung(k, rnd, art);
  erze(k, rnd, art);
  startvorraete(k, rnd);
  verbinde(k);
  return k;
}

export function idx(k, x, y) { return y * k.breite + x; }
export function drin(k, x, y) { return x >= 0 && y >= 0 && x < k.breite && y < k.hoehe; }

/** Kann man die Kachel betreten? (Ohne Gebaeude und Einheiten.) */
export function begehbar(k, x, y) {
  if (!drin(k, x, y)) return false;
  const i = y * k.breite + x;
  if (!BODEN_BEGEHBAR[k.boden[i]]) return false;
  const v = k.vorkommen[i];
  /* Baeume und Erz blockieren, Beeren/Wild/Schafe nicht. */
  if (v === 1 || v === 5 || v === 6) return false;
  return true;
}

/* ─────────────── Gelaende ─────────────── */

function gelaende(k, rnd, art) {
  const n = k.breite;
  const hoehenfeld = rauschfeld(n, n, rnd.next() | 0, 5, 24);
  const bodenfeld = rauschfeld(n, n, rnd.next() | 0, 4, 12);

  /* Wie stark faellt das Gelaende aus? */
  const profil = {
    ebene:    { stufen: 3, wasser: -8000, rau: 0 },
    seen:     { stufen: 3, wasser: 8000,   rau: 0 },
    hochland: { stufen: 6, wasser: 0,      rau: 1 },
    waelder:  { stufen: 4, wasser: 1000,   rau: 0 }
  }[art];

  for (let i = 0; i < n * n; i++) {
    const h = klemme(hoehenfeld[i], 0, 65535);
    if (h < profil.wasser) {
      k.boden[i] = BODEN.wasser;
      k.hoehen[i] = 0;
      continue;
    }
    /* Hoehenstufen: 0 … stufen */
    const stufe = Math.min(profil.stufen, ((h - profil.wasser) * (profil.stufen + 1) / (65536 - profil.wasser)) | 0);
    k.hoehen[i] = stufe;
    const b = bodenfeld[i];
    k.boden[i] = b < 16000 ? BODEN.wiese : (b > 52000 ? BODEN.sand : BODEN.gras);
  }

  /* Ufer sanden an. */
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (k.boden[i] === BODEN.wasser) continue;
    if (nachbarIst(k, x, y, BODEN.wasser)) k.boden[i] = BODEN.sand;
  }

  /* Felsriegel im Hochland: steile Kanten werden unpassierbar. */
  if (profil.rau) {
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      if (k.boden[i] === BODEN.wasser) continue;
      const h = k.hoehen[i];
      let steil = 0;
      if (Math.abs(h - k.hoehen[i - 1]) >= 2) steil++;
      if (Math.abs(h - k.hoehen[i + 1]) >= 2) steil++;
      if (Math.abs(h - k.hoehen[i - n]) >= 2) steil++;
      if (Math.abs(h - k.hoehen[i + n]) >= 2) steil++;
      if (steil >= 2 && h >= 3) k.boden[i] = BODEN.fels;
    }
  }

  /* Der Kartenrand bleibt Land, damit niemand in der Ecke ertrinkt. */
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x < 2 || y < 2 || x >= n - 2 || y >= n - 2) {
      const i = y * n + x;
      if (k.boden[i] === BODEN.wasser) { k.boden[i] = BODEN.sand; k.hoehen[i] = 1; }
    }
  }
}

function nachbarIst(k, x, y, b) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    if (!drin(k, x + dx, y + dy)) continue;
    if (k.boden[(y + dy) * k.breite + x + dx] === b) return true;
  }
  return false;
}

/* ─────────────── Startplaetze ───────────────
   Die Plaetze liegen gleichmaessig auf einem Kreis um die
   Kartenmitte. Sie werden planiert, damit jeder dieselben
   Voraussetzungen hat — Ecken und Kanten waeren unfair. */

function startplaetze(k, rnd, plaetze) {
  const n = k.breite;
  const mitte = n / 2;
  const radius = Math.round(n * 0.34);
  /* Der Anfangswinkel wird gewuerfelt, damit nicht jede Partie gleich aussieht.
     Gerechnet wird mit einer Tabelle statt mit Winkelfunktionen — die duerfen
     in der Simulation nicht vorkommen, weil sie sich zwischen Rechnern
     minimal unterscheiden koennen. */
  const versatz = rnd.bis(360);
  for (let p = 0; p < plaetze; p++) {
    const winkel = (versatz + Math.round(p * 360 / plaetze)) % 360;
    const [cx, cy] = kreisPunkt(winkel, radius);
    let x = klemme(Math.round(mitte + cx), 12, n - 13);
    let y = klemme(Math.round(mitte + cy), 12, n - 13);
    [x, y] = besterPlatz(k, x, y);
    k.start.push({ x, y });
    planiere(k, x, y, 9);
  }
}

/* Sinus/Kosinus in Grad, als Ganzzahltabelle (Wert × 10000).
   So kommt kein Fliesskomma aus der Standardbibliothek ins Spiel. */
const SIN = (() => {
  const t = new Int32Array(361);
  for (let g = 0; g <= 360; g++) t[g] = Math.round(Math.sin(g * Math.PI / 180) * 10000);
  return t;
})();
export function sinT(grad) { return SIN[((grad % 360) + 360) % 360]; }
export function cosT(grad) { return SIN[((grad + 90) % 360 + 360) % 360]; }
function kreisPunkt(grad, r) {
  return [Math.round(cosT(grad) * r / 10000), Math.round(sinT(grad) * r / 10000)];
}

/** Sucht in der Naehe die flachste, trockenste Stelle. */
function besterPlatz(k, x0, y0) {
  let best = [x0, y0], bestWert = -1e9;
  for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 10 || y < 10 || x >= k.breite - 10 || y >= k.hoehe - 10) continue;
    let wert = 0, hSumme = 0, zahl = 0;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
      const b = k.boden[(y + j) * k.breite + x + i];
      if (b === BODEN.wasser) wert -= 12;
      else if (b === BODEN.fels) wert -= 8;
      else wert += 1;
      hSumme += k.hoehen[(y + j) * k.breite + x + i]; zahl++;
    }
    const mittel = hSumme / zahl;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
      wert -= Math.abs(k.hoehen[(y + j) * k.breite + x + i] - mittel);
    }
    if (wert > bestWert) { bestWert = wert; best = [x, y]; }
  }
  return best;
}

/** Ebnet ein Quadrat ein und raeumt es frei. */
function planiere(k, cx, cy, r) {
  let summe = 0, zahl = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!drin(k, x, y)) continue;
    summe += k.hoehen[y * k.breite + x]; zahl++;
  }
  const h = Math.round(summe / Math.max(1, zahl));
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!drin(k, x, y)) continue;
    const i = y * k.breite + x;
    k.hoehen[i] = h;
    if (k.boden[i] === BODEN.wasser || k.boden[i] === BODEN.fels) k.boden[i] = BODEN.gras;
    k.vorkommen[i] = 0; k.menge[i] = 0;
  }
  /* Weicher Uebergang nach aussen, damit keine Stufenkante entsteht. */
  for (let y = cy - r - 3; y <= cy + r + 3; y++) for (let x = cx - r - 3; x <= cx + r + 3; x++) {
    if (!drin(k, x, y)) continue;
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (d <= r || d > r + 3) continue;
    const i = y * k.breite + x;
    if (k.boden[i] === BODEN.wasser) continue;
    k.hoehen[i] = Math.round((k.hoehen[i] + h) / 2);
  }
}

/* ─────────────── Waelder ─────────────── */

function bewaldung(k, rnd, art) {
  const n = k.breite;
  const dichte = { ebene: 26, seen: 34, hochland: 30, waelder: 70 }[art];
  const felder = Math.round(n * n * dichte / 10000);
  for (let f = 0; f < felder; f++) {
    const x = rnd.bis(n), y = rnd.bis(n);
    if (nahAmStart(k, x, y, 13)) continue;
    waldfleck(k, rnd, x, y, rnd.bereich(14, 46));
  }
  /* Jedes Volk braucht Holz vor der Haustuer: zwei Waldstuecke je Start. */
  for (const s of k.start) {
    for (let w = 0; w < 2; w++) {
      const winkel = rnd.bis(360);
      const r = rnd.bereich(8, 11);
      const [dx, dy] = kreisPunkt(winkel + w * 150, r);
      waldfleck(k, rnd, klemme(s.x + dx, 2, n - 3), klemme(s.y + dy, 2, n - 3), rnd.bereich(28, 44), true);
    }
  }
}

/** Ein Waldstueck als zufaelliger Fleck (kein Kreis — das saehe gepflanzt aus). */
function waldfleck(k, rnd, cx, cy, menge, nahErlaubt) {
  const offen = [[cx, cy]];
  let gesetzt = 0, wache = menge * 8;
  while (offen.length && gesetzt < menge && wache-- > 0) {
    const i = rnd.bis(offen.length);
    const [x, y] = offen[i];
    offen.splice(i, 1);
    if (!drin(k, x, y)) continue;
    const p = y * k.breite + x;
    if (k.boden[p] === BODEN.wasser || k.boden[p] === BODEN.fels || k.vorkommen[p]) continue;
    if (!nahErlaubt && nahAmStart(k, x, y, 11)) continue;
    if (nahAmStart(k, x, y, 6)) continue;
    setzeVorkommen(k, x, y, 'baum');
    gesetzt++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (rnd.chance(72)) offen.push([x + dx, y + dy]);
    }
  }
  /* Wild lebt am Waldrand. */
  if (gesetzt > 20 && rnd.chance(55)) {
    for (let t = 0; t < 8; t++) {
      const x = cx + rnd.bereich(-4, 4), y = cy + rnd.bereich(-4, 4);
      if (drin(k, x, y) && !k.vorkommen[y * k.breite + x] && begehbar(k, x, y) && !nahAmStart(k, x, y, 10)) {
        setzeVorkommen(k, x, y, 'wild');
        if (rnd.chance(50)) break;
      }
    }
  }
}

function setzeVorkommen(k, x, y, art) {
  const i = y * k.breite + x;
  k.vorkommen[i] = VORKOMMEN_LISTE.indexOf(art) + 1;
  k.menge[i] = VORKOMMEN[art].menge;
}

function nahAmStart(k, x, y, r) {
  for (const s of k.start) if (abstand2(x, y, s.x, s.y) <= r * r) return true;
  return false;
}

/* ─────────────── Gold und Stein ─────────────── */

function erze(k, rnd, art) {
  const n = k.breite;
  const zahl = Math.round(n * n / 900);
  for (let i = 0; i < zahl; i++) {
    ader(k, rnd, rnd.bis(n), rnd.bis(n), rnd.chance(60) ? 'gold' : 'stein', rnd.bereich(4, 7));
  }
  /* Jedem Startplatz gehoeren eine Goldader und ein Steinbruch in Reichweite,
     dazu zwei weitere Goldadern etwas weiter draussen. */
  for (const s of k.start) {
    legeNah(k, rnd, s, 'gold', 5, 9, 14);
    legeNah(k, rnd, s, 'stein', 4, 9, 14);
    legeNah(k, rnd, s, 'gold', 5, 17, 24);
    legeNah(k, rnd, s, 'gold', 4, 17, 24);
    legeNah(k, rnd, s, 'stein', 4, 17, 24);
  }
}

function legeNah(k, rnd, s, art, menge, rMin, rMax) {
  for (let versuch = 0; versuch < 40; versuch++) {
    const [dx, dy] = kreisPunkt(rnd.bis(360), rnd.bereich(rMin, rMax));
    const x = s.x + dx, y = s.y + dy;
    if (!drin(k, x, y) || !begehbar(k, x, y)) continue;
    if (nahAmStart(k, x, y, 7)) continue;
    if (ader(k, rnd, x, y, art, menge)) return true;
  }
  return false;
}

/** Legt eine kleine Ader aus benachbarten Kacheln. */
function ader(k, rnd, cx, cy, art, menge) {
  if (!drin(k, cx, cy) || !begehbar(k, cx, cy) || nahAmStart(k, cx, cy, 6)) return false;
  let gesetzt = 0;
  const offen = [[cx, cy]];
  let wache = menge * 10;
  while (offen.length && gesetzt < menge && wache-- > 0) {
    const [x, y] = offen.shift();
    if (!drin(k, x, y)) continue;
    const i = y * k.breite + x;
    if (k.boden[i] === BODEN.wasser || k.boden[i] === BODEN.fels || k.vorkommen[i]) continue;
    setzeVorkommen(k, x, y, art);
    gesetzt++;
    const richtungen = rnd.mische([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (const [dx, dy] of richtungen) offen.push([x + dx, y + dy]);
  }
  return gesetzt > 0;
}

/* ─────────────── Vorraete am Startplatz ───────────────
   Vier Schafe direkt am Dorfzentrum, ein Beerenfeld daneben —
   genau wie im Vorbild. */

function startvorraete(k, rnd) {
  for (const s of k.start) {
    /* Schafe rund um das Dorfzentrum. */
    let gesetzt = 0;
    for (let versuch = 0; versuch < 60 && gesetzt < 4; versuch++) {
      const [dx, dy] = kreisPunkt(rnd.bis(360), rnd.bereich(4, 6));
      const x = s.x + dx, y = s.y + dy;
      if (drin(k, x, y) && begehbar(k, x, y) && !k.vorkommen[y * k.breite + x]) {
        setzeVorkommen(k, x, y, 'schaf'); gesetzt++;
      }
    }
    /* Ein Beerenfeld aus sechs Straeuchern. */
    for (let versuch = 0; versuch < 40; versuch++) {
      const [dx, dy] = kreisPunkt(rnd.bis(360), rnd.bereich(7, 9));
      const bx = s.x + dx, by = s.y + dy;
      if (!drin(k, bx, by) || !begehbar(k, bx, by)) continue;
      let n = 0;
      for (let j = 0; j < 3 && n < 6; j++) for (let i = 0; i < 3 && n < 6; i++) {
        const x = bx + i, y = by + j;
        if (drin(k, x, y) && begehbar(k, x, y) && !k.vorkommen[y * k.breite + x]) {
          setzeVorkommen(k, x, y, 'beere'); n++;
        }
      }
      if (n >= 4) break;
    }
    /* Zwei Stueck Wild in mittlerer Entfernung. */
    for (let t = 0; t < 2; t++) {
      for (let versuch = 0; versuch < 30; versuch++) {
        const [dx, dy] = kreisPunkt(rnd.bis(360), rnd.bereich(11, 15));
        const x = s.x + dx, y = s.y + dy;
        if (drin(k, x, y) && begehbar(k, x, y) && !k.vorkommen[y * k.breite + x]) {
          setzeVorkommen(k, x, y, 'wild'); break;
        }
      }
    }
  }
}

/* ─────────────── Erreichbarkeit ───────────────
   Kein Startplatz darf hinter Wasser oder Fels eingesperrt sein.
   Was nicht verbunden ist, wird verbunden — mit einem Damm. */

function verbinde(k) {
  if (k.start.length < 2) return;
  for (let runde = 0; runde < 8; runde++) {
    const erreicht = flut(k, k.start[0].x, k.start[0].y);
    let alleDa = true;
    for (let p = 1; p < k.start.length; p++) {
      const s = k.start[p];
      if (!erreicht[s.y * k.breite + s.x]) {
        damm(k, k.start[0], s);
        alleDa = false;
      }
    }
    if (alleDa) return;
  }
}

/** Welche Kacheln sind von hier aus zu Fuss erreichbar? */
export function flut(k, sx, sy) {
  const n = k.breite;
  const da = new Uint8Array(n * k.hoehe);
  const stapel = [sy * n + sx];
  da[sy * n + sx] = 1;
  while (stapel.length) {
    const i = stapel.pop();
    const x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!drin(k, nx, ny)) continue;
      const j = ny * n + nx;
      if (da[j]) continue;
      if (!begehbarRoh(k, nx, ny)) continue;
      da[j] = 1; stapel.push(j);
    }
  }
  return da;
}

/* Wie begehbar(), aber Baeume zaehlen als passierbar: Holz laesst
   sich faellen, ein See nicht. */
function begehbarRoh(k, x, y) {
  const i = y * k.breite + x;
  const b = k.boden[i];
  return b !== BODEN.wasser && b !== BODEN.fels;
}

/** Zieht eine trockene Gasse zwischen zwei Punkten. */
function damm(k, a, b) {
  let x = a.x, y = a.y;
  const schritte = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let s = 0; s <= schritte; s++) {
    x = Math.round(a.x + (b.x - a.x) * s / schritte);
    y = Math.round(a.y + (b.y - a.y) * s / schritte);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!drin(k, x + dx, y + dy)) continue;
      const i = (y + dy) * k.breite + x + dx;
      if (k.boden[i] === BODEN.wasser) { k.boden[i] = BODEN.sand; k.hoehen[i] = 1; }
      else if (k.boden[i] === BODEN.fels) k.boden[i] = BODEN.gras;
    }
  }
}

/** Kurzfassung fuer die Uebersicht (Lobby, Minikarte). */
export function kartenInfo(k) {
  let baeume = 0, gold = 0, stein = 0, wasser = 0;
  for (let i = 0; i < k.vorkommen.length; i++) {
    const v = k.vorkommen[i];
    if (v === 1) baeume++; else if (v === 5) gold++; else if (v === 6) stein++;
    if (k.boden[i] === BODEN.wasser) wasser++;
  }
  return { baeume, gold, stein, wasserAnteil: Math.round(wasser * 100 / k.vorkommen.length) };
}
