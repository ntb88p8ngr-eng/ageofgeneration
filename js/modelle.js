/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Modelle

   Alle Gebaeude, Einheiten und Baeume werden hier aus Kaesten,
   Zylindern und Kegeln zusammengesetzt. Kein einziges fremdes
   Modell, keine Texturen — das haelt das Spiel klein und macht
   es unabhaengig von Bilddateien.

   Jedes Modell zerfaellt in zwei Teile:
     koerper  — wird in der Spielerfarbe eingefaerbt
     neutral  — Holz, Stein, Haut, Metall in eigener Farbe

   Beide Teile werden getrennt als InstancedMesh gezeichnet, damit
   auch bei tausend Einheiten nur eine Handvoll Zeichenaufrufe
   noetig sind.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import * as THREE from './vendor/three.module.js';
import { GEBAEUDE, VOELKER } from './regeln.js';

/* Farben der neutralen Teile. */
export const FARBE = {
  holz:    0x8a5a33,
  holzHell:0xb78a5a,
  stein:   0x9c9c94,
  steinDunkel: 0x6f6f68,
  stroh:   0xc8a24a,
  metall:  0xb9bec6,
  haut:    0xd8ab86,
  leder:   0x6e4b2c,
  stoff:   0xe8e3d4,
  gruen:   0x4c7a34,
  dunkel:  0x3a3a38,
  gold:    0xd9b44a,
  wasserGruen: 0x2f6b58
};

/* Kleiner Baukasten: sammelt Dreiecke in zwei Toepfen. */
class Bau {
  constructor() {
    this.koerper = [];   // Spielerfarbe
    this.neutral = [];   // eigene Farbe
  }
  _lege(geo, farbe, x, y, z, drehX, drehY, drehZ) {
    const g = geo.toNonIndexed ? geo.toNonIndexed() : geo;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler(drehX || 0, drehY || 0, drehZ || 0);
    m.makeRotationFromEuler(e);
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    if (farbe == null) this.koerper.push(g);
    else {
      const c = new THREE.Color(farbe);
      const n = g.attributes.position.count;
      const farben = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { farben[i * 3] = c.r; farben[i * 3 + 1] = c.g; farben[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(farben, 3));
      this.neutral.push(g);
    }
    return this;
  }
  kasten(x, y, z, bx, by, bz, farbe, drehY, drehX) {
    return this._lege(new THREE.BoxGeometry(bx, by, bz), farbe, x, y, z, drehX, drehY, 0);
  }
  zylinder(x, y, z, rOben, rUnten, h, seiten, farbe, drehX, drehZ) {
    return this._lege(new THREE.CylinderGeometry(rOben, rUnten, h, seiten || 8), farbe, x, y, z, drehX, 0, drehZ);
  }
  kegel(x, y, z, r, h, seiten, farbe) {
    return this._lege(new THREE.ConeGeometry(r, h, seiten || 6), farbe, x, y, z, 0, 0, 0);
  }
  /* Ein Pyramidendach: Kegel mit vier Seiten, um 45° gedreht. */
  dach(x, y, z, breite, hoehe, farbe) {
    return this._lege(new THREE.ConeGeometry(breite * 0.72, hoehe, 4), farbe, x, y + hoehe / 2, z, 0, Math.PI / 4, 0);
  }
  /* Satteldach aus zwei geneigten Platten. */
  giebel(x, y, z, bx, bz, h, farbe) {
    const l = Math.sqrt((bx / 2) * (bx / 2) + h * h);
    const winkel = Math.atan2(h, bx / 2);
    this._lege(new THREE.BoxGeometry(l, 0.06, bz), farbe, x - bx / 4, y + h / 2, z, 0, 0, winkel);
    this._lege(new THREE.BoxGeometry(l, 0.06, bz), farbe, x + bx / 4, y + h / 2, z, 0, 0, -winkel);
    return this;
  }
  /* Zinnenkranz auf einer Mauer oder einem Turm. */
  zinnen(x, y, z, breite, tiefe, farbe, zahl) {
    const n = zahl || 4;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      this.kasten(x + t * breite, y, z - tiefe / 2, breite / (n * 2.2), 0.18, 0.12, farbe);
      this.kasten(x + t * breite, y, z + tiefe / 2, breite / (n * 2.2), 0.18, 0.12, farbe);
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      this.kasten(x - breite / 2, y, z + t * tiefe, 0.12, 0.18, tiefe / (n * 2.2), farbe);
      this.kasten(x + breite / 2, y, z + t * tiefe, 0.12, 0.18, tiefe / (n * 2.2), farbe);
    }
    return this;
  }
  fertig() {
    return { koerper: verschmelze(this.koerper), neutral: verschmelze(this.neutral) };
  }
}

/** Fasst mehrere Geometrien zu einer zusammen (ohne fremde Hilfsbibliothek). */
export function verschmelze(liste) {
  liste = liste.filter(g => g && g.attributes.position);
  if (!liste.length) return null;
  let punkte = 0;
  for (const g of liste) punkte += g.attributes.position.count;
  const pos = new Float32Array(punkte * 3);
  const nor = new Float32Array(punkte * 3);
  const far = new Float32Array(punkte * 3);
  let o = 0;
  for (const g of liste) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    pos.set(p.array.subarray ? p.array.subarray(0, p.count * 3) : p.array, o * 3);
    if (n) nor.set(n.array.subarray ? n.array.subarray(0, n.count * 3) : n.array, o * 3);
    if (c) far.set(c.array.subarray ? c.array.subarray(0, c.count * 3) : c.array, o * 3);
    else for (let i = 0; i < p.count; i++) { far[(o + i) * 3] = 1; far[(o + i) * 3 + 1] = 1; far[(o + i) * 3 + 2] = 1; }
    o += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(far, 3));
  geo.computeBoundingSphere();
  return geo;
}

/* ═══════════════ Gebaeude ═══════════════
   Masse in Kacheln: ein Gebaeude der Groesse g ist g × g gross,
   der Nullpunkt liegt in seiner Mitte auf dem Boden. */

const gebaeudeSpeicher = new Map();

export function gebaeudeModell(typ, volk) {
  const schluessel = typ + ':' + volk;
  if (gebaeudeSpeicher.has(schluessel)) return gebaeudeSpeicher.get(schluessel);
  const dach = VOELKER[volk] ? VOELKER[volk].dach : 0x8d3b2f;
  const g = GEBAEUDE[typ].groesse;
  const b = new Bau();
  switch (typ) {
    case 'dorfzentrum': {
      /* Steinsockel, Holzgeschoss, vier Ecktuerme, breites Dach. */
      b.kasten(0, 0.35, 0, g - 0.4, 0.7, g - 0.4, FARBE.stein);
      b.kasten(0, 1.05, 0, g - 1.0, 0.7, g - 1.0, FARBE.holz);
      b.dach(0, 1.4, 0, g - 1.6, 0.8, null);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.zylinder(sx * (g / 2 - 0.35), 0.6, sz * (g / 2 - 0.35), 0.28, 0.32, 1.2, 8, FARBE.steinDunkel);
        b.kegel(sx * (g / 2 - 0.35), 1.45, sz * (g / 2 - 0.35), 0.34, 0.5, 6, null);
      }
      b.kasten(0, 0.5, g / 2 - 0.25, 0.5, 1.0, 0.12, FARBE.holzHell);   // Tor
      break;
    }
    case 'haus': {
      b.kasten(0, 0.35, 0, g - 0.5, 0.7, g - 0.6, FARBE.stoff);
      b.giebel(0, 0.7, 0, g - 0.35, g - 0.45, 0.5, null);
      b.kasten(0, 0.9, 0, 0.16, 0.5, 0.16, FARBE.stein);               // Schornstein
      b.kasten(0, 0.25, (g - 0.6) / 2, 0.24, 0.5, 0.06, FARBE.holz);
      break;
    }
    case 'muehle': {
      b.zylinder(0, 0.5, 0, 0.55, 0.7, 1.0, 8, FARBE.stoff);
      b.kegel(0, 1.25, 0, 0.75, 0.6, 8, null);
      /* Fluegelkreuz — dreht sich spaeter im Wind. */
      b.kasten(0, 0.95, 0.75, 0.1, 1.6, 0.06, FARBE.holz);
      b.kasten(0, 0.95, 0.75, 1.6, 0.1, 0.06, FARBE.holz);
      break;
    }
    case 'farm': {
      /* Acker: Furchen in wechselnden Gruen- und Erdtoenen. */
      b.kasten(0, 0.03, 0, g - 0.1, 0.06, g - 0.1, 0x6b4a2a);
      for (let i = 0; i < 6; i++) {
        b.kasten(0, 0.09, -g / 2 + 0.35 + i * (g - 0.7) / 5, g - 0.35, 0.05, 0.16, i % 2 ? 0x7d9a3e : 0x8fae4c);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.kasten(sx * (g / 2 - 0.12), 0.16, sz * (g / 2 - 0.12), 0.08, 0.32, 0.08, FARBE.holz);
      }
      break;
    }
    case 'lager': {
      b.kasten(0, 0.25, 0, g - 0.5, 0.5, g - 0.8, FARBE.holz);
      b.giebel(0, 0.5, 0, g - 0.3, g - 0.6, 0.35, null);
      for (let i = 0; i < 3; i++) b.zylinder(-0.4 + i * 0.35, 0.62, 0.55, 0.13, 0.13, 0.9, 6, FARBE.holzHell, 0, Math.PI / 2);
      break;
    }
    case 'kaserne': {
      b.kasten(0, 0.45, 0, g - 0.5, 0.9, g - 0.9, FARBE.holz);
      b.giebel(0, 0.9, 0, g - 0.3, g - 0.7, 0.5, null);
      b.kasten(-g / 2 + 0.45, 0.55, g / 2 - 0.35, 0.1, 1.1, 0.1, FARBE.holzHell);
      b.kasten(-g / 2 + 0.45, 1.0, g / 2 - 0.2, 0.06, 0.35, 0.4, null);  // Wimpel
      b.kasten(0.6, 0.35, g / 2 - 0.4, 0.5, 0.7, 0.1, FARBE.metall);     // Waffenstaender
      break;
    }
    case 'schuetzenstand': {
      b.kasten(0, 0.4, -0.3, g - 0.6, 0.8, g - 1.4, FARBE.holz);
      b.giebel(0, 0.8, -0.3, g - 0.4, g - 1.2, 0.4, null);
      b.zylinder(0.7, 0.55, 0.9, 0.35, 0.35, 0.1, 12, FARBE.stoff, Math.PI / 2);  // Zielscheibe
      b.zylinder(0.7, 0.55, 0.93, 0.16, 0.16, 0.06, 10, 0xc0392b, Math.PI / 2);
      b.kasten(0.7, 0.25, 0.95, 0.08, 0.5, 0.08, FARBE.holz);
      break;
    }
    case 'stall': {
      b.kasten(-0.3, 0.4, 0, g - 1.2, 0.8, g - 0.6, FARBE.holz);
      b.giebel(-0.3, 0.8, 0, g - 1.0, g - 0.4, 0.4, null);
      for (let i = 0; i < 4; i++) {
        b.kasten(g / 2 - 0.25, 0.3, -g / 2 + 0.4 + i * 0.6, 0.08, 0.6, 0.08, FARBE.holzHell);
      }
      b.kasten(g / 2 - 0.25, 0.5, 0, 0.06, 0.08, g - 0.6, FARBE.holzHell);
      break;
    }
    case 'belagerung': {
      b.kasten(0, 0.15, 0, g - 0.4, 0.3, g - 0.4, FARBE.holz);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.kasten(sx * (g / 2 - 0.3), 0.75, sz * (g / 2 - 0.3), 0.14, 1.2, 0.14, FARBE.holz);
      }
      b.kasten(0, 1.35, 0, g - 0.4, 0.12, g - 0.4, null);
      b.zylinder(0, 0.55, 0, 0.2, 0.2, 1.4, 8, FARBE.holzHell, 0, Math.PI / 2);   // Ramme in Arbeit
      b.zylinder(0, 0.8, -0.7, 0.32, 0.32, 0.12, 10, FARBE.metall, Math.PI / 2);
      break;
    }
    case 'markt': {
      b.kasten(0, 0.12, 0, g - 0.4, 0.24, g - 0.4, FARBE.stein);
      for (const [sx, sz] of [[-1, -1], [1, 1], [1, -1]]) {
        b.kasten(sx * 0.75, 0.45, sz * 0.75, 0.7, 0.42, 0.6, FARBE.holz);
        b.kasten(sx * 0.75, 0.78, sz * 0.75, 0.9, 0.08, 0.8, null);
      }
      b.kasten(-0.75, 0.95, -0.75, 0.07, 0.6, 0.07, FARBE.holz);
      b.kegel(-0.75, 1.35, -0.75, 0.18, 0.3, 6, FARBE.gold);
      break;
    }
    case 'kloster': {
      b.kasten(0, 0.5, 0, g - 0.8, 1.0, g - 1.0, FARBE.stoff);
      b.giebel(0, 1.0, 0, g - 0.6, g - 0.8, 0.45, null);
      b.kasten(-g / 2 + 0.5, 0.9, 0, 0.55, 1.8, 0.55, FARBE.stein);     // Turm
      b.kegel(-g / 2 + 0.5, 2.1, 0, 0.42, 0.7, 6, null);
      b.kasten(-g / 2 + 0.5, 2.62, 0, 0.06, 0.4, 0.06, FARBE.gold);
      b.kasten(-g / 2 + 0.5, 2.7, 0, 0.24, 0.06, 0.06, FARBE.gold);
      break;
    }
    case 'universitaet': {
      b.kasten(0, 0.55, 0, g - 0.5, 1.1, g - 0.8, FARBE.stoff);
      b.zylinder(0, 1.35, 0, 0.72, 0.85, 0.5, 12, FARBE.stein);
      b.zylinder(0, 1.75, 0, 0.1, 0.72, 0.6, 12, null);                 // Kuppel
      for (let i = 0; i < 4; i++) {
        b.zylinder(-1.0 + i * 0.65, 0.55, g / 2 - 0.3, 0.11, 0.11, 1.1, 8, FARBE.stein);
      }
      break;
    }
    case 'burg': {
      b.kasten(0, 0.8, 0, g - 0.8, 1.6, g - 0.8, FARBE.stein);
      b.zinnen(0, 1.68, 0, g - 0.8, g - 0.8, FARBE.stein, 5);
      b.kasten(0, 2.05, 0, g - 2.2, 1.0, g - 2.2, FARBE.steinDunkel);
      b.dach(0, 2.55, 0, g - 2.0, 0.8, null);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx * (g / 2 - 0.45), z = sz * (g / 2 - 0.45);
        b.zylinder(x, 1.15, z, 0.42, 0.48, 2.3, 8, FARBE.stein);
        b.zinnen(x, 2.35, z, 0.9, 0.9, FARBE.stein, 3);
        b.kegel(x, 2.75, z, 0.5, 0.8, 6, null);
      }
      b.kasten(0, 0.55, g / 2 - 0.45, 0.7, 1.1, 0.14, FARBE.holz);
      break;
    }
    case 'turm': {
      b.zylinder(0, 0.9, 0, 0.34, 0.42, 1.8, 8, FARBE.stein);
      b.zinnen(0, 1.9, 0, 0.8, 0.8, FARBE.stein, 3);
      b.kegel(0, 2.25, 0, 0.44, 0.7, 6, null);
      break;
    }
    case 'mauer': {
      b.kasten(0, 0.5, 0, 1.0, 1.0, 0.6, FARBE.stein);
      b.zinnen(0, 1.05, 0, 0.9, 0.5, FARBE.steinDunkel, 2);
      break;
    }
    case 'tor': {
      b.kasten(-0.4, 0.6, 0, 0.2, 1.2, 0.7, FARBE.stein);
      b.kasten(0.4, 0.6, 0, 0.2, 1.2, 0.7, FARBE.stein);
      b.kasten(0, 1.15, 0, 1.0, 0.2, 0.7, FARBE.stein);
      b.kasten(0, 0.5, 0, 0.62, 1.0, 0.12, null);                        // Torfluegel
      break;
    }
    default: {
      b.kasten(0, 0.4, 0, g - 0.5, 0.8, g - 0.5, FARBE.stein);
      b.dach(0, 0.8, 0, g - 0.4, 0.5, null);
    }
  }
  const modell = b.fertig();
  gebaeudeSpeicher.set(schluessel, modell);
  return modell;
}

/* ═══════════════ Einheiten ═══════════════
   Eine Einheit ist etwa 0,6 Kacheln hoch. Rumpf und Kopfbedeckung
   tragen die Spielerfarbe, Haut, Holz und Metall bleiben neutral. */

const einheitSpeicher = new Map();

/** Grundgestalt eines Menschen: Beine, Rumpf, Kopf. */
function mensch(b, y0, gross) {
  const h = gross ? 0.62 : 0.55;
  b.kasten(-0.07, y0 + h * 0.14, 0, 0.08, h * 0.28, 0.08, FARBE.leder);
  b.kasten(0.07, y0 + h * 0.14, 0, 0.08, h * 0.28, 0.08, FARBE.leder);
  b.kasten(0, y0 + h * 0.47, 0, 0.24, h * 0.4, 0.16, null);            // Rumpf in Spielerfarbe
  b.zylinder(0, y0 + h * 0.78, 0, 0.09, 0.09, h * 0.18, 6, FARBE.haut);
  return y0 + h;
}

/** Pferd mit Reiter. */
function pferd(b) {
  b.kasten(0, 0.34, 0, 0.5, 0.22, 0.2, FARBE.leder);                    // Rumpf
  b.kasten(0.26, 0.42, 0, 0.16, 0.3, 0.16, FARBE.leder);                // Hals
  b.kasten(0.34, 0.55, 0, 0.2, 0.12, 0.14, FARBE.leder);                // Kopf
  for (const [dx, dz] of [[-0.18, -0.08], [-0.18, 0.08], [0.18, -0.08], [0.18, 0.08]]) {
    b.kasten(dx, 0.12, dz, 0.07, 0.24, 0.07, FARBE.dunkel);
  }
  b.kasten(-0.28, 0.4, 0, 0.12, 0.16, 0.05, FARBE.dunkel);              // Schweif
  b.kasten(0, 0.47, 0, 0.3, 0.06, 0.24, null);                          // Decke in Spielerfarbe
}

export function einheitModell(typ) {
  if (einheitSpeicher.has(typ)) return einheitSpeicher.get(typ);
  const b = new Bau();
  switch (typ) {
    case 'dorfbewohner':
      mensch(b, 0, false);
      b.kasten(0.13, 0.3, 0, 0.05, 0.34, 0.05, FARBE.holz);             // Werkzeugstiel
      b.kasten(0.13, 0.47, 0, 0.14, 0.08, 0.04, FARBE.metall);          // Axtblatt
      break;
    case 'milizionaer': case 'wurfaxt':
      mensch(b, 0, true);
      b.zylinder(0, 0.52, 0, 0.1, 0.1, 0.09, 6, FARBE.metall);          // Helm
      b.kasten(0.15, 0.34, 0, 0.05, 0.32, 0.05, FARBE.holz);
      b.kasten(0.15, 0.52, 0, 0.16, 0.1, 0.04, FARBE.metall);
      b.kasten(-0.16, 0.32, 0, 0.05, 0.22, 0.18, FARBE.holzHell);       // Schild
      break;
    case 'speer':
      mensch(b, 0, true);
      b.zylinder(0.14, 0.42, 0, 0.02, 0.02, 0.85, 6, FARBE.holz);
      b.kegel(0.14, 0.88, 0, 0.05, 0.14, 5, FARBE.metall);
      b.kasten(-0.16, 0.32, 0, 0.05, 0.2, 0.16, FARBE.holzHell);
      break;
    case 'bogen': case 'langbogen':
      mensch(b, 0, false);
      b.zylinder(0.14, 0.34, 0, 0.02, 0.02, typ === 'langbogen' ? 0.6 : 0.44, 5, FARBE.holz, 0, 0.25);
      b.kasten(-0.13, 0.42, 0, 0.06, 0.2, 0.06, FARBE.leder);           // Koecher
      break;
    case 'plaenkler':
      mensch(b, 0, false);
      b.zylinder(0.15, 0.4, 0, 0.02, 0.02, 0.5, 5, FARBE.holz, 0, 0.5);
      b.kasten(-0.15, 0.32, 0, 0.05, 0.2, 0.16, FARBE.holzHell);
      break;
    case 'spaeher': case 'ritter': case 'kataphrakt': case 'mangudai': {
      pferd(b);
      b.kasten(0, 0.62, 0, 0.2, 0.26, 0.14, null);                      // Reiter
      b.zylinder(0, 0.8, 0, 0.08, 0.08, 0.1, 6, FARBE.haut);
      if (typ === 'mangudai') {
        b.zylinder(0.16, 0.66, 0, 0.02, 0.02, 0.4, 5, FARBE.holz, 0, 0.3);
      } else if (typ === 'spaeher') {
        b.zylinder(0.16, 0.6, 0, 0.02, 0.02, 0.5, 5, FARBE.holz);
      } else {
        b.zylinder(0, 0.86, 0, 0.09, 0.09, 0.1, 6, FARBE.metall);       // Helm
        b.zylinder(0.16, 0.68, 0, 0.02, 0.02, 0.7, 5, FARBE.holz, 0, 0.9);
        b.kegel(0.34, 0.9, 0, 0.05, 0.16, 5, FARBE.metall);             // Lanze
      }
      break;
    }
    case 'moench':
      b.kegel(0, 0.24, 0, 0.19, 0.48, 8, null);                         // Kutte
      b.zylinder(0, 0.54, 0, 0.09, 0.09, 0.1, 6, FARBE.haut);
      b.kasten(0.14, 0.34, 0, 0.04, 0.4, 0.04, FARBE.holz);
      b.kasten(0.14, 0.5, 0, 0.16, 0.04, 0.04, FARBE.gold);             // Kreuzstab
      break;
    case 'ramme':
      b.kasten(0, 0.22, 0, 0.9, 0.16, 0.5, FARBE.holz);
      b.zylinder(0, 0.34, 0, 0.11, 0.11, 0.95, 8, FARBE.holzHell, 0, Math.PI / 2);
      b.zylinder(0.5, 0.34, 0, 0.13, 0.13, 0.12, 8, FARBE.metall, 0, Math.PI / 2);
      b.giebel(0, 0.42, 0, 0.9, 0.55, 0.28, null);
      for (const dz of [-0.24, 0.24]) for (const dx of [-0.3, 0.3]) {
        b.zylinder(dx, 0.1, dz, 0.1, 0.1, 0.07, 8, FARBE.dunkel, Math.PI / 2);
      }
      break;
    case 'mangonel':
      b.kasten(0, 0.16, 0, 0.7, 0.12, 0.5, FARBE.holz);
      b.kasten(-0.15, 0.42, 0, 0.1, 0.55, 0.1, FARBE.holz, 0, 0.35);
      b.kasten(0.2, 0.34, 0, 0.55, 0.07, 0.07, FARBE.holzHell, 0, -0.4);
      b.zylinder(0.45, 0.5, 0, 0.1, 0.1, 0.1, 8, FARBE.stein);          // Stein im Arm
      for (const dz of [-0.22, 0.22]) for (const dx of [-0.24, 0.24]) {
        b.zylinder(dx, 0.09, dz, 0.09, 0.09, 0.06, 8, FARBE.dunkel, Math.PI / 2);
      }
      b.kasten(0, 0.24, 0, 0.3, 0.08, 0.4, null);
      break;
    case 'trebuchet':
      b.kasten(0, 0.14, 0, 0.7, 0.12, 0.6, FARBE.holz);
      b.kasten(-0.2, 0.6, -0.2, 0.09, 1.0, 0.09, FARBE.holz, 0, 0.3);
      b.kasten(-0.2, 0.6, 0.2, 0.09, 1.0, 0.09, FARBE.holz, 0, -0.3);
      b.kasten(0.1, 1.0, 0, 1.1, 0.07, 0.07, FARBE.holzHell, 0, 0, -0.5);
      b.kasten(-0.42, 0.72, 0, 0.2, 0.24, 0.2, FARBE.stein);            // Gegengewicht
      b.kasten(0, 0.26, 0, 0.34, 0.1, 0.44, null);
      break;
    default:
      mensch(b, 0, false);
  }
  const modell = b.fertig();
  einheitSpeicher.set(typ, modell);
  return modell;
}

/* ═══════════════ Landschaft ═══════════════ */

const landSpeicher = new Map();

/** Baum, Beerenstrauch, Wild, Schaf, Gold- und Steinvorkommen. */
export function landModell(art) {
  if (landSpeicher.has(art)) return landSpeicher.get(art);
  const b = new Bau();
  switch (art) {
    case 'baum':
      b.zylinder(0, 0.3, 0, 0.07, 0.1, 0.6, 5, 0x6b4423);
      b.kegel(0, 0.95, 0, 0.42, 0.85, 6, 0x2f6b34);
      b.kegel(0, 1.35, 0, 0.3, 0.6, 6, 0x3c7d3f);
      break;
    case 'baum2':
      b.zylinder(0, 0.28, 0, 0.08, 0.11, 0.56, 5, 0x7a5230);
      b.kegel(0, 0.85, 0, 0.46, 0.7, 5, 0x4a7c2a);
      break;
    case 'beere':
      b.kegel(0, 0.16, 0, 0.28, 0.34, 6, 0x3e6b2e);
      for (const [dx, dz] of [[0.1, 0.06], [-0.09, 0.1], [0.02, -0.12], [0.13, -0.05]]) {
        b.zylinder(dx, 0.28, dz, 0.05, 0.05, 0.05, 5, 0xa3263f);
      }
      break;
    case 'gold':
      b.kegel(0, 0.14, 0, 0.34, 0.3, 5, 0x8a8377);
      b.zylinder(0.08, 0.26, 0.05, 0.07, 0.07, 0.09, 5, 0xe2b32c);
      b.zylinder(-0.1, 0.22, -0.05, 0.06, 0.06, 0.08, 5, 0xe2b32c);
      break;
    case 'stein':
      b.kegel(0, 0.15, 0, 0.36, 0.32, 5, 0x8d8d88);
      b.kasten(0.12, 0.12, 0.1, 0.2, 0.2, 0.2, 0xa5a5a0, 0.6);
      break;
    case 'schaf':
      b.kasten(0, 0.2, 0, 0.34, 0.2, 0.2, 0xe8e4dc);
      b.kasten(0.2, 0.26, 0, 0.12, 0.12, 0.12, 0x4a4a48);
      for (const [dx, dz] of [[-0.11, -0.06], [-0.11, 0.06], [0.11, -0.06], [0.11, 0.06]]) {
        b.kasten(dx, 0.06, dz, 0.05, 0.12, 0.05, 0x4a4a48);
      }
      break;
    case 'wild':
      b.kasten(0, 0.3, 0, 0.42, 0.18, 0.18, 0x8a6134);
      b.kasten(0.22, 0.4, 0, 0.14, 0.22, 0.12, 0x8a6134);
      b.kasten(0.22, 0.56, 0.05, 0.04, 0.16, 0.04, 0x5c4326);
      b.kasten(0.22, 0.56, -0.05, 0.04, 0.16, 0.04, 0x5c4326);
      for (const [dx, dz] of [[-0.14, -0.07], [-0.14, 0.07], [0.14, -0.07], [0.14, 0.07]]) {
        b.kasten(dx, 0.11, dz, 0.05, 0.22, 0.05, 0x6f4d29);
      }
      break;
    default:
      b.kegel(0, 0.2, 0, 0.3, 0.4, 5, 0x777777);
  }
  const modell = b.fertig();
  landSpeicher.set(art, modell);
  return modell;
}

/** Geschosse: Pfeil, Stein, Speer. */
export function geschossModell(art) {
  const schluessel = 'g:' + art;
  if (landSpeicher.has(schluessel)) return landSpeicher.get(schluessel);
  const b = new Bau();
  if (art === 'stein') b.zylinder(0, 0, 0, 0.13, 0.13, 0.13, 6, FARBE.stein);
  else if (art === 'speer') { b.zylinder(0, 0, 0, 0.02, 0.02, 0.4, 4, FARBE.holz, 0, Math.PI / 2); }
  else { b.zylinder(0, 0, 0, 0.015, 0.015, 0.34, 4, 0x5a4632, 0, Math.PI / 2); }
  const modell = b.fertig();
  landSpeicher.set(schluessel, modell);
  return modell;
}
